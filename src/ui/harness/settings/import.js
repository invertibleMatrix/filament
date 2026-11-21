// @ts-check
// Settings → Import (HarnessV4_Tasks E17; the plan: HarnessV4_Import_Plan in the vault): chats from other coding
// agents become sessions of Filament's. A card says what a Sync would bring before the click and holds the one
// button; under it a row per agent the server lists (the page names none itself), each with its Sync switch and
// Browse, a sheet of that agent's chats by project folder; then what memory does with what comes in. A run shows as
// a bar with Stop wherever it was started, and is found again on coming back: the server names the run under way.
// Every number is the server's. The words are pure functions at the top, so a test reads them without a page. What
// the page holds of the server, and each press that writes, is `importKeeper`'s: the welcome tour's Your chats
// (views/welcome.js) brings chats in through the same one.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { sheet } from "../lib/ui.js";
import { markTile } from "../lib/coding-agents.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** How often a run under way is asked how far it is. */
const POLL_MS = 700;
/** How many unread chats one click has memory read: the server's batch. */
const READ_BATCH = 200;

/** A chat's state on an agent's list, in the row's words. */
export const STATE_WORDS = Object.freeze({ new: "new", grown: "grown", imported: "in Filament", own: "ran through Filament", removed: "removed by you", empty: "nothing in it" });

/** @param {unknown} v */
const num = (v) => (Number(v) || 0).toLocaleString("en-US");
/** A count with its noun: "1 chat", "1,203 turns". @param {unknown} v @param {string} one @param {string} [many] */
export const countWords = (v, one, many = `${one}s`) => `${num(v)} ${Number(v) === 1 ? one : many}`;

/** A size as a person reads one: "212 MB", "5.7 GB". @param {unknown} bytes */
export function sizeWords(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[u]}`;
}

/** When, as the page says it: "today 14:02", "yesterday 09:10", "12 Oct", "3 Dec 2025". @param {number} at @param {number} now */
export function whenWords(at, now) {
  const d = new Date(at);
  const n = new Date(now);
  const day = (/** @type {Date} */ x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === n.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
}

/** A reach on the select: "30 days", "Everything". @param {number} days */
export const reachWords = (days) => (days > 0 ? `${days} days` : "Everything");
/** That no chat inside a reach is new or has grown, as the Sync card and the welcome tour's Your chats say it. @param {number} days  0: everything */
export const nothingNew = (days) => (days > 0 ? `No chat of the last ${days} days is new or has grown.` : "No chat is new or has grown.");

/**
 * What the Sync card says before the click, and whether there is anything to click for: the chats of the agents
 * that are found and switched on, new or grown inside the reach.
 * @param {any} data  the overview @param {"below" | "above"} [switches]  where the agents' switches stand from these words
 * @returns {{ head: string, sub: string, can: boolean, bytes: number }}
 */
export function syncSays(data, switches = "below") {
  const found = (data.sources || []).filter((/** @type {any} */ s) => s.found);
  if (!found.length) return { head: "No coding agent's chats were found on this computer", sub: "", can: false, bytes: 0 };
  const on = found.filter((/** @type {any} */ s) => s.on);
  if (!on.length) return { head: "Every agent is switched off", sub: `Switch one on ${switches}, or bring single chats in through Browse.`, can: false, bytes: 0 };
  const chats = on.reduce((/** @type {number} */ a, /** @type {any} */ s) => a + (s.pending?.chats || 0), 0);
  const bytes = on.reduce((/** @type {number} */ a, /** @type {any} */ s) => a + (s.pending?.bytes || 0), 0);
  const reach = Number(data.prefs?.reachDays) || 0;
  if (!chats) return { head: "Up to date", sub: nothingNew(reach), can: false, bytes: 0 };
  return {
    head: `${countWords(chats, "chat")} ${chats === 1 ? "is new or has grown" : "are new or have grown"}`,
    sub: [`about ${sizeWords(bytes)} to read`, ...on.filter((/** @type {any} */ s) => s.pending?.chats).map((/** @type {any} */ s) => `${s.label} ${num(s.pending.chats)}`)].join(" · "),
    can: true,
    bytes,
  };
}

/**
 * More to read than the drive has free, said before the click; null where there is room, or the system does not say.
 * @param {any} data  the overview @param {{ bytes: number }} says  what a run would bring (`syncSays`; the welcome tour's choice)
 * @param {string} [advice]  what to do about it, where the run is no Sync
 */
export const tightSays = (data, says, advice = "Choose a shorter reach, or bring single chats in through Browse.") =>
  data.free != null && says.bytes > data.free ? `That is more than the ${sizeWords(data.free)} free on the drive Filament keeps its sessions on. ${advice}` : null;

/** How many of the agents' chats are in Filament: imported whole, or grown since. @param {any} data  the overview */
export const inFilament = (data) => (data?.sources || []).reduce((/** @type {number} */ a, /** @type {any} */ s) => a + (s.states?.imported || 0) + (s.states?.grown || 0), 0);

/** What an agent's store holds, in short: "79 chats in 20 projects · about 5.7 GB". @param {any} s  the agent, from the overview */
export const holdsWords = (s) => `${countWords(s.chats, "chat")} in ${countWords(s.projects, "project")} · ${s.about ? "about " : ""}${sizeWords(s.bytes)}`;

/**
 * An agent's row in words: whether its chats were found, where and how many, and how they stand in Filament.
 * @param {any} s  the agent, from the overview @param {number} reachDays
 * @returns {{ found: string, where: string, states: string }}
 */
export function agentSays(s, reachDays) {
  if (!s.found) return { found: "not found", where: `Looked in ${s.where}`, states: "" };
  if (s.error) return { found: "found, cannot be read", where: String(s.where), states: String(s.error) };
  if (!s.chats) return { found: "found, no chats", where: String(s.where), states: "" };
  const st = s.states || {};
  const fresh = (st.new || 0) + (st.grown || 0);
  const pending = s.pending?.chats || 0;
  const parts = [`${num((st.imported || 0) + (st.grown || 0))} in Filament`];
  if (pending) parts.push(`${num(pending)} new or grown${reachDays > 0 ? ` in the last ${reachDays} days` : ""}`);
  if (fresh - pending > 0) parts.push(`${num(fresh - pending)} older than that (Browse brings them)`);
  if (st.own) parts.push(`${num(st.own)} ran through Filament, so ${st.own === 1 ? "it is" : "they are"} here already`);
  if (st.removed) parts.push(`${num(st.removed)} removed by you`);
  if (st.empty) parts.push(`${num(st.empty)} with nothing in ${st.empty === 1 ? "it" : "them"}`);
  return { found: "found", where: `${s.where} · ${holdsWords(s)}`, states: parts.join(" · ") };
}

/** The last run, on the card's foot. @param {any} last @param {number} now */
export function lastSays(last, now) {
  if (!last) return "Nothing has been imported yet";
  const what = last.chats ? `${countWords(last.chats, "chat")}, ${countWords(last.newTurns, "new turn")}` : "nothing new";
  const failed = last.errors?.length ? ` · ${countWords(last.errors.length, "file")} could not be read` : "";
  return `Last ${last.by === "sync" ? "sync" : "import"}: ${whenWords(last.at, now)} · ${what}${failed}`;
}

/** Memory's last reading, on its part's foot, with why chats were left unread; null when there was none. @param {any} read @param {number} now */
export function lastReadSays(read, now) {
  if (!read) return null;
  const left = (read.unread || []).map((/** @type {any} */ u) => `${countWords(u.chats, "chat")} left unread: ${u.why}`);
  return [`Last reading: ${whenWords(read.at, now)}`, `${num(read.learned)} of ${countWords(read.considered ?? read.learned, "chat")} read`, ...left].join(" · ");
}

/**
 * A run under way, in words: which agent, which chat of how many, how far. Memory's reading says its own, with the
 * chats it could not read so far.
 * @param {any} job  the job as the server tells it @param {(id: string) => string} labelOf  an agent's name by its id
 */
export function runSays(job, labelOf) {
  const p = (job.progress || []).at(-1) || {};
  const which = p.total ? `chat ${Math.min((Number(p.done) || 0) + 1, p.total)} of ${num(p.total)}` : "";
  if (job.kind === "learn-backfill") return which ? `Memory is reading ${which}${p.unread ? ` · ${num(p.unread)} left unread so far` : ""}` : "Memory is starting to read";
  return [labelOf(String(p.step || "")), which, `${Math.round(Number(job.percent) || 0)}%`].filter(Boolean).join(" · ");
}

/**
 * How a run ended, in words, with each file that could not be read and why, and each line too long to read, left out
 * while the rest of its chat came in; for memory's reading, the chats left unread, by reason.
 * @param {any} job  the ended job, or `{ lost }` when the page lost sight of it @param {(id: string) => string} labelOf
 * @returns {{ tone: "good" | "warn" | "bad" | "quiet", text: string, errors: string[] }}
 */
export function endSays(job, labelOf) {
  const reading = job.kind === "learn-backfill";
  if (job.lost) return { tone: "bad", text: `Lost sight of the run: ${job.lost}`, errors: [] };
  if (job.status === "error") {
    if (job.stopped) return { tone: "quiet", text: reading ? "Stopped. What memory read stays." : "Stopped. What was read stays, and the next run goes on from there.", errors: [] };
    return { tone: "bad", text: `${reading ? "Memory's reading" : "The import"} failed: ${job.error}`, errors: [] };
  }
  const r = job.result || {};
  if (reading) {
    const unread = (r.unread || []).map((/** @type {any} */ u) => `${countWords(u.chats, "chat")} left unread: ${u.why}`);
    const text = `Memory read ${num(r.learned)} of ${countWords(r.considered ?? r.learned, "chat")}.${r.nothing ? ` ${num(r.nothing)} had nothing to read.` : ""}`;
    return { tone: unread.length ? "warn" : "good", text, errors: unread };
  }
  const errors = (r.errors || []).map((/** @type {any} */ e) => `${labelOf(String(e.source || ""))} · ${e.file || e.session || "a chat"}: ${e.error}`);
  const long = (r.long || []).map((/** @type {any} */ l) => `${labelOf(String(l.source || ""))} · ${l.file}: line ${num(l.line)}, ${sizeWords(l.bytes)}`);
  const hollow = r.empty ? ` ${countWords(r.empty, "chat")} had nothing in ${r.empty === 1 ? "it" : "them"}.` : "";
  const text = !r.chats
    ? `Nothing new came in.${hollow}`
    : !r.newTurns && !r.newChats
      ? `Nothing new: ${countWords(r.chats, "chat")} read, all in Filament already.${hollow}`
      : `${countWords(r.chats, "chat")} came in, ${countWords(r.newTurns, "new turn")}.${r.newChats !== r.chats ? ` ${num(r.newChats)} new, the rest had grown.` : ""}${hollow}`;
  const says = [
    ...(errors.length ? [`${countWords(errors.length, "file")} could not be read`] : []),
    ...(long.length ? [`${countWords(long.length, "line")} too long to read ${long.length === 1 ? "was" : "were"} left out, the rest of ${long.length === 1 ? "its chat" : "their chats"} read`] : []),
  ];
  return { tone: says.length ? "warn" : "good", text: says.length ? `${text} ${says.join("; ")}:` : text, errors: [...errors, ...long] };
}

/**
 * Whether a chat's folder or words hold a filter, one rule for Browse and the welcome tour's Your chats: the filter,
 * in any case, stands in its folder — or, where the folder is not on this computer, the name its agent gave the
 * project —, its title or its first words. No filter holds every chat.
 * @param {string} [filter] @returns {(c: any) => boolean}
 */
export function chatFilter(filter = "") {
  const want = filter.trim().toLowerCase();
  return (c) => {
    if (!want) return true;
    const cwd = String(c.cwd || "");
    return `${cwd}\n${cwd ? "" : String(c.project || "")}\n${c.title || ""}\n${c.preview || ""}`.toLowerCase().includes(want);
  };
}

/**
 * An agent's chats as Browse lists them: by project folder, the folder with the newest chat first, each folder's
 * chats newest first; `filter` keeps the chats whose folder or words hold it (`chatFilter`). A project whose folder
 * is not on this computer is a group by the name its agent gave it (`project`, with no `cwd`).
 * @param {any[]} chats  newest first, as the server sends them @param {string} [filter]
 * @returns {{ cwd: string, project: string, chats: any[], open: any[] }[]}  `open`: the group's chats an import would bring something of
 */
export function browseGroups(chats, filter = "") {
  const holds = chatFilter(filter);
  /** @type {Map<string, { cwd: string, project: string, chats: any[] }>} */
  const by = new Map();
  for (const c of chats) {
    const cwd = String(c.cwd || "");
    const project = cwd ? "" : String(c.project || "");
    if (!holds(c)) continue;
    const key = cwd ? `folder ${cwd}` : `name ${project}`;
    const group = by.get(key);
    if (group) group.chats.push(c);
    else by.set(key, { cwd, project, chats: [c] });
  }
  return [...by.values()].map((g) => ({ ...g, open: g.chats.filter((c) => c.state === "new" || c.state === "grown" || c.state === "removed") }));
}

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * What a page that brings the agents' chats in holds of the server, one rule each for Settings → Import and the
 * welcome tour's Your chats (views/welcome.js): the overview as last read, the runs under way — found again on a
 * read, the server naming them — and how each last ended; and the presses that write: a choice kept, a Sync started,
 * Stop. So what one page sets or starts is what the other shows.
 * - `paint`: the page drawn again from what is held; `onStart`: a run started; `onRun`: one under way was heard from.
 * - `alive`: whether a run under way is still asked how far it is (unsaid: until it ends).
 * - `onEnd`: a run ended, its ending kept: what is read again is the page's to say (unsaid: the overview).
 * - `onSessions`: chats came in, so the list of sessions is to be read again.
 * - `list`: the overview is read with the chats a Sync would bring named (`?list=1`: the tour chooses among them);
 *   unsaid, their count alone.
 * @param {{ paint: () => void, onStart?: () => void, onRun?: (kind: "import" | "read") => void, alive?: () => boolean, onEnd?: () => any,
 *   onToast?: (msg: string, kind?: string) => void, onSessions?: () => void, list?: boolean }} cb
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, later?: (fn: () => void, ms: number) => void }} [io]
 */
export function importKeeper(cb, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const later = io.later || ((fn, ms) => void setTimeout(fn, ms));
  const toast = cb.onToast || (() => {});
  const paint = () => cb.paint();

  const st = {
    /** @type {any} the overview */ data: null,
    /** @type {string | null} why it could not be read */ failed: null,
    /** The runs under way, as last heard: an import, memory's reading. @type {{ import: any, read: any }} */ run: { import: null, read: null },
    /** How each last ended while this page was open. @type {{ import: any, read: any }} */ ended: { import: null, read: null },
    /** Stop was pressed and the run has not ended yet. */ stopping: { import: false, read: false },
  };
  /** Where a run's bar is drawn now, the page's to empty as it draws again: the Sync card, Memory's part, the open Browse's foot. @type {{ import: any[], read: any[] }} */
  const hosts = { import: [], read: [] };
  const labelOf = (/** @type {string} */ id) => String((st.data?.sources || []).find((/** @type {any} */ s) => s.id === id)?.label || id);
  const busy = () => !!st.run.import;

  // ---- runs -------------------------------------------------------------------------------------------------------
  /** A run's bar, its words and Stop; or how the last one ended. @param {"import" | "read"} kind */
  function runBlock(kind) {
    const job = st.run[kind];
    if (job) {
      const pct = Math.max(0, Math.min(100, Math.round(Number(job.percent) || 0)));
      return [
        m("div", { class: "imp-run" },
          m("div", { class: "imp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, m("span", { class: "imp-bar-fill", style: `width:${pct}%` })),
          m("div", { class: "imp-run-line" },
            m("span", { class: "imp-run-words" }, runSays(job, labelOf)),
            m("button", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm", type: "button", ...(st.stopping[kind] ? { disabled: "" } : {}), onclick: () => stop(kind) },
              st.stopping[kind] ? (kind === "import" ? "Stopping after this turn…" : "Stopping after this chat…") : "Stop"))),
      ];
    }
    const ended = st.ended[kind];
    if (!ended) return [];
    const says = endSays(ended, labelOf);
    return [
      m("div", { class: `imp-end is-${says.tone}` },
        m("div", { class: "imp-end-text" }, says.text),
        says.errors.length ? m("ul", { class: "imp-end-errors" }, ...says.errors.map((e) => m("li", {}, e))) : null),
    ];
  }
  /** @param {"import" | "read"} kind */
  const paintRun = (kind) => {
    for (const host of hosts[kind]) host.replaceChildren(...runBlock(kind));
    cb.onRun?.(kind);
  };
  /** A place a run's bar is drawn in, kept until the page or the sheet is drawn again. @param {"import" | "read"} kind */
  const runHost = (kind) => {
    const host = m("div", { class: "imp-run-host" }, ...runBlock(kind));
    hosts[kind].push(host);
    return host;
  };

  /** Ask a run how far it is until it ends; then read everything again. @param {"import" | "read"} kind @param {string} id */
  async function follow(kind, id) {
    /** @type {any} */
    let job;
    try {
      job = await call(`/memory/jobs/${encodeURIComponent(id)}`);
    } catch (e) {
      job = { lost: errText(e), kind: kind === "read" ? "learn-backfill" : "import" };
    }
    if (!job.lost && job.status === "running") {
      st.run[kind] = job;
      paintRun(kind);
      if (!cb.alive || cb.alive()) later(() => void follow(kind, id), POLL_MS);
      return;
    }
    st.run[kind] = null;
    st.stopping[kind] = false;
    st.ended[kind] = job;
    if (kind === "import") cb.onSessions?.();
    await (cb.onEnd ? cb.onEnd() : load());
  }
  /** @param {"import" | "read"} kind */
  async function stop(kind) {
    const job = st.run[kind];
    if (!job) return;
    st.stopping[kind] = true;
    paintRun(kind);
    try {
      const r = await call(`/memory/jobs/${encodeURIComponent(job.id)}/stop`, { method: "POST" });
      if (!r?.stopped) toast("It had ended already.");
    } catch (e) {
      st.stopping[kind] = false;
      paintRun(kind);
      toast(errText(e), "err");
    }
  }
  /** Start a run and follow it; a refusal is said in the server's words. @param {"import" | "read"} kind @param {string} path @param {any} [bodyOf] */
  async function start(kind, path, bodyOf) {
    if (st.run[kind]) return;
    try {
      const { job } = await call(path, { method: "POST", ...(bodyOf ? { body: bodyOf } : {}) });
      st.run[kind] = job;
      st.ended[kind] = null;
      paint();
      cb.onStart?.();
      later(() => void follow(kind, job.id), POLL_MS);
    } catch (e) {
      toast(errText(e), "err");
    }
  }
  /** Sync: the chats that are new or have grown, of the agents switched on, inside the reach. */
  const sync = () => start("import", "/memory/import/sync");

  // ---- what is read, and the choices kept ---------------------------------------------------------------------------
  async function load() {
    try {
      st.data = await call(`/memory/import/overview${cb.list ? "?list=1" : ""}`);
      st.failed = null;
    } catch (e) {
      st.failed = errText(e);
    }
    paint();
    // A run started before this visit, or in another window, is followed from here on.
    if (st.data?.job && !st.run.import) {
      st.run.import = { ...st.data.job, status: "running", percent: 0, progress: [] };
      paint();
      void follow("import", st.data.job.id);
    }
    if (st.data?.reading && !st.run.read) {
      st.run.read = { ...st.data.reading, kind: "learn-backfill", status: "running", percent: 0, progress: [] };
      paint();
      void follow("read", st.data.reading.id);
    }
  }
  /** A choice of the person's, kept at the server; a refusal is said and the page shows what stands. @param {any} patch */
  async function prefs(patch) {
    try {
      await call("/memory/import/prefs", { method: "PUT", body: patch });
    } catch (e) {
      toast(errText(e), "err");
    }
    await load();
  }
  /** @param {boolean} checked @param {string} label @param {(on: boolean) => void} onChange @param {boolean} [disabled] */
  const switchOf = (checked, label, onChange, disabled = false) => {
    const b = m("button", {
      class: `set-switch${checked ? " on" : ""}`, type: "button", role: "switch", "aria-checked": checked ? "true" : "false", "aria-label": label,
      ...(disabled ? { disabled: "" } : {}),
      onclick: () => {
        b.classList.toggle("on", !checked);
        b.setAttribute("aria-checked", checked ? "false" : "true");
        onChange(!checked);
      },
    });
    return b;
  };
  /** An agent's switch: on, a Sync brings its chats; the other agents' stay as they are. @param {any} s  the agent, from the overview @param {string} label */
  const agentSwitch = (s, label) => {
    const others = (st.data.prefs.on || []).filter((/** @type {string} */ id) => id !== s.id);
    return switchOf(!!s.on, label, (on) => void prefs({ on: on ? [...others, s.id] : others }));
  };
  /** Whether memory reads what comes in: the person's switch, held off while memory can read nothing (`learner.why`). */
  const learnSwitch = () => switchOf(!!st.data.prefs.learn, "Memory reads what is imported", (on) => void prefs({ learn: on }), !!st.data.learner?.why);
  /** How far back a Sync reaches, of the reaches the server offers; held while an import runs. @param {string} [cls]  the select's look, where it stands */
  const reachSelect = (cls = "set-select") => {
    const reach = Number(st.data.prefs.reachDays) || 0;
    const select = m("select", { class: cls, "aria-label": "Reaches back", ...(busy() ? { disabled: "" } : {}), onchange: () => void prefs({ reachDays: Number(select.value) }) },
      ...(st.data.reaches || []).map((/** @type {number} */ days) => m("option", { value: String(days), ...(days === reach ? { selected: "" } : {}) }, reachWords(days))));
    return select;
  };

  return { st, hosts, busy, runBlock, runHost, load, start, sync, agentSwitch, learnSwitch, reachSelect };
}

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onSessions?: () => void }} [cb]  `onSessions`: chats came
 *   in, so the list of sessions is to be read again
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, sheet?: typeof sheet, now?: () => number,
 *   later?: (fn: () => void, ms: number) => void, go?: (hash: string) => void }} [io]
 */
export function renderImport(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openSheet = io.sheet || sheet;
  const now = io.now || Date.now;
  const go = io.go || ((hash) => void (location.hash = hash));
  const root = m("div", { class: "imp-page" });
  /** @type {null | { source: any, chats: any[] | null, failed: string | null, filter: string, paint: () => void, close: () => void, runHost: any }} the open Browse */
  let browsing = null;
  const { st, hosts, busy, runBlock, runHost, load, start, sync, agentSwitch, learnSwitch, reachSelect } = importKeeper({
    paint: () => paint(),
    onStart: () => browsing?.paint(),
    // A page that has gone asks no more: the run goes on at the server, and the next visit finds it.
    alive: () => /** @type {any} */ (root).isConnected !== false,
    onEnd: async () => {
      await load();
      if (browsing) await loadBrowse();
    },
    onToast: cb.onToast,
    onSessions: cb.onSessions,
  }, io);

  // ---- the page ---------------------------------------------------------------------------------------------------
  function syncCard() {
    const d = st.data;
    const says = syncSays(d);
    const tight = tightSays(d, says);
    return m("section", { class: "imp-card imp-sync", "aria-label": "Sync" },
      m("div", { class: "imp-sync-main" },
        m("div", { class: "imp-sync-text" },
          m("div", { class: "imp-sync-head" }, busy() ? "Importing…" : says.head),
          !busy() && says.sub ? m("div", { class: "imp-sync-sub" }, says.sub) : null),
        m("button", { class: "zc-btn zc-btn-v-default zc-btn-s-default imp-sync-btn", type: "button", ...(says.can && !busy() ? {} : { disabled: "" }), onclick: () => void sync() }, "Sync now")),
      tight && !busy() ? m("div", { class: "imp-callout", role: "note" }, tight) : null,
      runHost("import"),
      m("div", { class: "imp-sync-foot" },
        m("label", { class: "imp-reach" }, "Reaches back", reachSelect()),
        d.free != null ? m("span", { class: "imp-quiet" }, `${sizeWords(d.free)} free`) : null,
        m("span", { class: "imp-grow" }),
        m("span", { class: "imp-quiet" }, lastSays(d.last, now()))));
  }

  /** @param {any} s */
  function agentCard(s) {
    const says = agentSays(s, Number(st.data.prefs.reachDays) || 0);
    return m("div", { class: `imp-agent${s.found ? "" : " is-missing"}`, "data-agent": s.id },
      markTile(m, { mark: null, name: s.label }),
      m("div", { class: "imp-agent-text" },
        m("div", { class: "imp-agent-top" }, m("span", { class: "imp-agent-name" }, s.label), m("span", { class: `imp-found${s.found ? "" : " is-missing"}` }, says.found)),
        m("div", { class: "imp-agent-where" }, says.where),
        says.states ? m("div", { class: "imp-agent-states" }, says.states) : null),
      s.found && s.chats
        ? m("div", { class: "imp-agent-acts" },
            m("label", { class: "imp-agent-sync" }, "Sync", agentSwitch(s, `Sync brings ${s.label}'s chats`)),
            m("button", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm", type: "button", onclick: () => void browse(s) }, "Browse"))
        : null);
  }

  function memoryPart() {
    const d = st.data;
    const model = d.learner?.model || "";
    const why = d.learner?.why || null;
    const unread = d.unread || { chats: 0, passes: 0 };
    const inShim = inFilament(d);
    const reading = !!st.run.read;
    // The last reading's ending as the server kept it; the page's own, when it saw one end, says more.
    const lastRead = reading || st.ended.read ? null : lastReadSays(d.lastRead, now());
    return m("section", { class: "imp-sec", "aria-label": "Memory" },
      m("h3", { class: "imp-h" }, "Memory"),
      m("div", { class: "imp-card imp-memory" },
        m("div", { class: "imp-mem-row" },
          m("div", { class: "imp-mem-text" },
            m("div", { class: "imp-mem-label" }, "Memory reads what is imported"),
            m("div", { class: "imp-quiet" }, why
              ? `Nothing can be read now: ${why}.`
              : `On: each chat a Sync or an Import brings is read by memory with ${model}, a call for every few turns. Off: importing calls no model.`)),
          learnSwitch()),
        unread.chats || reading
          ? m("div", { class: "imp-mem-row" },
              m("div", { class: "imp-mem-text" },
                m("div", { class: "imp-mem-label" }, `${countWords(unread.chats, "imported chat")} ${unread.chats === 1 ? "is" : "are"} unread`),
                m("div", { class: "imp-quiet" }, `About ${countWords(unread.passes, "call")}${model ? ` to ${model}` : ""}.${unread.chats > READ_BATCH ? ` A click reads the newest ${READ_BATCH}.` : ""}`)),
              m("button", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm", type: "button", ...(why || reading || !unread.chats ? { disabled: "" } : {}),
                onclick: () => void start("read", "/memory/backfill", { limit: READ_BATCH, imported: true }) }, "Let memory read them"))
          : inShim
            ? m("div", { class: "imp-mem-row" }, m("div", { class: "imp-quiet" }, "Memory has read every imported chat."))
            : null,
        lastRead ? m("div", { class: "imp-mem-row" }, m("div", { class: "imp-quiet" }, lastRead)) : null,
        runHost("read")));
  }

  function paint() {
    hosts.import = hosts.import.filter((host) => host === browsing?.runHost);
    hosts.read = [];
    if (st.failed) {
      root.replaceChildren(
        m("p", { class: "set-error" }, st.failed),
        m("button", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm", type: "button", onclick: () => void load() }, "Try again"));
      return;
    }
    if (!st.data) {
      root.replaceChildren(m("p", { class: "pane-note" }, "Looking for your coding agents' chats…"));
      return;
    }
    root.replaceChildren(
      syncCard(),
      m("section", { class: "imp-sec", "aria-label": "Agents" },
        m("h3", { class: "imp-h" }, "Agents"),
        m("div", { class: "imp-agents" }, ...st.data.sources.map(agentCard))),
      memoryPart());
  }

  // ---- Browse -----------------------------------------------------------------------------------------------------
  async function loadBrowse() {
    const b = browsing;
    if (!b) return;
    try {
      const r = await call(`/memory/import/chats?source=${encodeURIComponent(b.source.id)}`);
      b.chats = r.chats || [];
      b.failed = null;
    } catch (e) {
      b.failed = errText(e);
    }
    b.paint();
  }
  /** @param {any} source */
  async function browse(source) {
    const list = m("div", { class: "imp-browse-list" });
    const count = m("span", { class: "cag-n" });
    const filter = m("input", { class: "zc-input imp-filter", type: "search", placeholder: "Filter by folder or words", "aria-label": "Filter by folder or words", spellcheck: "false" });
    const run = m("div", { class: "imp-run-host" });
    const foot = m("div", { class: "imp-sheet-foot" }, run, m("span", { class: "imp-quiet" }, `${source.label}'s files are only read.`));
    // How the last import had ended when the sheet opened is on the card; the sheet says the runs of its own time.
    const endedBefore = st.ended.import;
    const sheetRun = () => (st.run.import || st.ended.import !== endedBefore ? runBlock("import") : []);
    /** @param {any} c */
    const chatRow = (c) => {
      const takes = c.state === "new" || c.state === "removed" ? "Import" : c.state === "grown" ? "Import the rest" : null;
      return m("div", { class: "imp-chat", "data-chat": c.id },
        m("div", { class: "imp-chat-main" },
          m("div", { class: "imp-chat-words" }, c.title || c.preview || "untitled"),
          m("div", { class: "imp-quiet" }, [whenWords(c.lastAt, now()), `${c.about ? "about " : ""}${sizeWords(c.bytes)}`, c.turns != null ? `${countWords(c.turns, "turn")} in Filament` : null].filter(Boolean).join(" · "))),
        m("span", { class: `imp-state is-${c.state}` }, STATE_WORDS[/** @type {keyof typeof STATE_WORDS} */ (c.state)] || String(c.state)),
        m("div", { class: "imp-chat-acts" },
          takes ? m("button", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm", type: "button", ...(busy() ? { disabled: "" } : {}), onclick: () => void start("import", "/memory/import/chosen", { source: source.id, chats: [c.id] }) }, takes) : null,
          c.chain ? m("button", { class: "zc-btn zc-btn-v-ghost zc-btn-s-sm", type: "button", onclick: () => { self.close(); go(routeFor("task", { id: c.chain })); } }, "Open") : null));
    };
    const paintList = () => {
      const b = browsing;
      if (!b) return;
      run.replaceChildren(...sheetRun());
      if (b.failed) return void list.replaceChildren(m("p", { class: "set-error" }, b.failed));
      if (!b.chats) return void list.replaceChildren(m("p", { class: "pane-note" }, "Reading the list…"));
      const groups = browseGroups(b.chats, b.filter);
      count.replaceChildren(countWords(b.chats.length, "chat"));
      if (!groups.length) return void list.replaceChildren(m("p", { class: "pane-note" }, b.chats.length ? "No chat's folder or words hold that." : "No chats."));
      list.replaceChildren(...groups.map((g) =>
        m("section", { class: "imp-group" },
          m("div", { class: "imp-group-head" },
            m("span", { class: "imp-folder" }, g.cwd ? g.cwd.split(/[\\/]/).filter(Boolean).at(-1) || g.cwd : g.project || "no folder"),
            g.cwd ? m("span", { class: "imp-quiet imp-folder-path", title: g.cwd }, g.cwd) : g.project ? m("span", { class: "imp-quiet imp-folder-path" }, "its folder is not on this computer") : null,
            m("span", { class: "cag-n" }, countWords(g.chats.length, "chat")),
            m("span", { class: "imp-grow" }),
            g.open.length
              ? m("button", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm", type: "button", ...(busy() ? { disabled: "" } : {}), onclick: () => void start("import", "/memory/import/chosen", { source: source.id, chats: g.open.map((c) => c.id) }) }, g.open.length === 1 ? "Import 1" : `Import all ${num(g.open.length)}`)
              : null),
          m("div", { class: "imp-chats" }, ...g.chats.map(chatRow)))));
    };
    filter.addEventListener("input", () => {
      if (!browsing) return;
      browsing.filter = String(filter.value || "");
      paintList();
    });
    const self = openSheet({
      label: `${source.label}'s chats`,
      head: m("div", { class: "imp-browse-head" }, m("h2", { class: "cag-h" }, `${source.label}'s chats`, count)),
      body: m("div", { class: "imp-browse" }, filter, list),
      foot,
      class: "imp-sheet",
      onClose: () => {
        hosts.import = hosts.import.filter((host) => host !== run);
        browsing = null;
      },
    });
    browsing = { source, chats: null, failed: null, filter: "", paint: paintList, close: self.close, runHost: run };
    hosts.import.push(run);
    paintList();
    await loadBrowse();
  }

  body.replaceChildren(root);
  paint();
  void load();
}
