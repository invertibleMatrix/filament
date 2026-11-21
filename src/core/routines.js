// @ts-check
// Routines (HarnessV4_Space_Plan S6, the mock "Space, grown" screen 11): what an agent of a project does by itself at a
// time the person switched on. An agent proposes one with the space tool; only the person's Switch on lets it run (R1,
// S6-D1). Each run is a new chat of the project (SG-D15, R7), read-only unless the routine writes, in a worktree of its
// own then (S6-D2). Pure: a `when` read and said, the next time after a moment, the times missed while Filament was off,
// and the words a run starts with. Times are this machine's local time (S6-D11). A watcher (the plan of 11-11) is a
// routine with a trigger in place of a when: woken by events, it has no time of its own (core/watchers.js). One that
// wakes a new chat runs as a routine does; one that wakes the chat that proposed it takes a turn there, held to
// reading unless it writes; one that tells only the person runs no agent — and nothing at all, unless its trigger
// runs a program (core/watchers.js `runsProgram`).
import { writerName } from "./space.js";
import { CONNECTION_TOOL, CONNECTION_TOOL_MAX, GUIDES_PER_MESSAGE, GUIDE_HEAD, WAKES, WAKE_END, WAKE_HEAD, WATCH_WAKES_HOUR, eventsWords, runsProgram, toldWords, toolWords, triggerChat, triggerFields, triggerShort, triggerWords, troubleWords, wakesFreeAt, wakesWords, watchedName, watchedParts } from "./watchers.js";

export const ROUTINE_LIMITS = Object.freeze({ title: 80, task: 4000, when: 60, routines: 40, acts: 16 });
/** A connection's tool a routine may act through, as the loop names it (core/watchers.js `CONNECTION_TOOL`). */
const ACT_NAME = CONNECTION_TOOL;
const ACT_NAME_MAX = CONNECTION_TOOL_MAX;

/**
 * The connections' tools a chat's turn runs without asking: its routine's, marked on the chat while the run is under
 * way (HarnessV4_SpacesPlugins_Plan A2c) — app/routines.js takes them off as the run ends. None in any other chat.
 * @param {any} meta  the chat's meta
 * @returns {Set<string>}
 */
export function routineActs(meta) {
  const acts = meta?.routine?.acts;
  return new Set(Array.isArray(acts) ? acts.filter((/** @type {unknown} */ x) => typeof x === "string" && ACT_NAME.test(x)) : []);
}
/** The shortest every: a routine is an agent's work, never a poll. */
export const EVERY_MIN_MS = 15 * 60_000;
/** The longest every: past a day, a day and a time say it. */
export const EVERY_MAX_MS = 24 * 3_600_000;
/** How `when` reads, as a refusal says it. */
export const WHEN_FORM = 'when reads "weekdays 09:00", "daily 18:30", "mon,thu 08:00" or "every 30m"';

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_WORDS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

/**
 * When a routine runs: on `days` (0 Sunday … 6 Saturday) at `at` minutes after midnight, or every `ms`.
 * @typedef {{ kind: "at", days: number[], at: number } | { kind: "every", ms: number }} Schedule
 */

/**
 * A routine as its Space keeps it. `state`: proposed by a chat, switched on by the person, or removed (`was` keeps
 * whether it was on, for Put back). `madeIn`: the chat that proposed it, which alone may change it; `model`: the model
 * it runs on — that chat's as it proposed it, "" the one new chats of its project start on —, or the person's, once
 * they chose one (`modelBy` "you", the owner's word of 10-31), which a change by its chat keeps. `upTo`: the newest of
 * its times handled — run or skipped —, or the moment it was resumed: its next time is the first after it. `last`: its
 * newest run — its chat, how it stands, and for an end what it said or why it failed; `skipped`: its newest time that
 * did not run, and why (`missed`: Filament was off).
 * `pausedBy`: the chat whose agent paused it, with its line (HarnessV4_AgentsSpace_Plan SA-D3); none where the person
 * did. `pausedWhy`: why Filament paused it itself — a watcher whose chat can never take its turn (the store's
 * `watchPaused`). A run's `by`: its time, the person's Run now, or an agent's (`startedBy`, the chat whose agent pressed it: SA-D10).
 * `acts`: the connections' tools its runs call without asking — a message sent, an issue moved — as the person read them
 * at Switch on (HarnessV4_SpacesPlugins_Plan SP-D7); none where it only reads and drafts. `effort`: the effort the
 * person chose with its model (the owner's of 11-04), kept only with it. A run's `on`: the model it ran on and its
 * effort, in words; `instead`: why that was its Space's model rather than its own, which could not run.
 * A watcher's (the plan of 11-11): `trigger`, what wakes it, its `when` ""; `wakes`, who; `seen`, where its hearing
 * stands — null until it is switched on —; `pending`, the events that wait for its next run. A run `by` "event" was
 * woken by them, `events` how many — its `chain` the chat that proposed it where it wakes that chat, and `turn` its
 * turn's number there while it runs: its end is read from that turn, never a later one of the person's; `quiet`, while
 * it runs: it carried an event of a chat whose words were its own alone, so its answer is never quoted. `woke`: when it
 * woke in the last hour, a run or a turn in its chat, for its cap (core/watchers.js `WATCH_WAKES_HOUR`). `turns`, while
 * it runs: the chats' turns its events were of, which its end keeps as reviews (services/spaces.js `routineEnded`).
 * What a watcher may do goes by whom it wakes: a new chat, as a routine's run (`writes`, `acts`); the chat that
 * proposed it, a turn there held to reading — or, where it `writes`, working as that chat works —, on that chat's own
 * model, with no `acts`; only the person, nothing run. `guides`: it may write to the chat its trigger names.
 * `script`: what the person's Switch on approved by content, for a watcher whose source runs a program
 * (app/watchers/script.js) — each file's hash by its path, and when —, kept here and not on its cursor, which a Resume
 * and a Put back begin anew; gone with a change by its chat, and where Filament switches it off (`watchUnapproved`).
 * @typedef {{ chain: string, byName: string, line: string }} RoutineBy
 * @typedef {{ id: string, title: string, when: string, task: string, writes: boolean, acts?: string[],
 *   trigger?: import("./watchers.js").Trigger, wakes?: import("./watchers.js").Wakes, guides?: boolean,
 *   seen?: import("./watchers.js").Seen | null, pending?: import("./watchers.js").Pending | null,
 *   script?: { pins: Record<string, string>, at: number },
 *   state: "proposed" | "on" | "removed", was?: "proposed" | "on", paused: boolean, pausedBy?: RoutineBy, pausedWhy?: string,
 *   madeIn: string, madeBy: string, model: string, modelBy?: "you", effort?: string, at: number, onAt: number | null,
 *   upTo: number | null, last: RoutineRun | null, skipped: { at: number, why: string, missed?: boolean } | null, woke?: number[] }} Routine
 * @typedef {"time" | "you" | "agent" | "event"} RunBy
 * @typedef {{ at: number, chain: string, by: RunBy, startedBy?: { chain: string, byName: string },
 *   state: "running" | "done" | "failed" | "stopped", ended?: number, said?: string, why?: string, on?: string,
 *   instead?: string, events?: number, turn?: number, quiet?: boolean, turns?: { chain: string, turn: number }[] }} RoutineRun
 */

/**
 * The model a routine's run starts on, its effort, and whose it is (the owner's of 11-04): one the person chose for it
 * first — "Use the default", "" there, follows its Space's —; else its Space's, the person's choice for what runs by
 * itself; else the model its chat ran on when it proposed it. None where nothing names one.
 * @param {Pick<Routine, "model" | "modelBy" | "effort">} r
 * @param {{ model: string, effort: string, from: "space" | "default" | "" }} on  its Space's (core/space-settings.js `runsOnOf`)
 * @returns {{ model: string, effort: string, from: "routine" | "space" | "default" | "proposed" | "" }}
 */
export function routineRunsOn(r, on) {
  if (r.modelBy === "you" && r.model) return { model: r.model, effort: r.effort || "", from: "routine" };
  if (on.model) return { model: on.model, effort: on.effort || "", from: on.from || "default" };
  if (r.model && r.modelBy !== "you") return { model: r.model, effort: "", from: "proposed" };
  return { model: "", effort: "", from: "" };
}

/**
 * Whose model a routine runs on, as its sheet's line says it. @param {ReturnType<typeof routineRunsOn>["from"]} from
 * @param {string} madeBy  the chat that proposed it, by name
 */
export function runsOnWhose(from, madeBy) {
  if (from === "routine") return "Your choice for this routine";
  if (from === "space") return "This Space's model, from its Space settings";
  if (from === "default") return "Every Space's model, from Settings › Space";
  if (from === "proposed") return `The model ${madeBy || "its chat"} ran on when it proposed it`;
  return "No model: choose one, or set one in Settings › Space";
}

const FULL_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/**
 * A day as `when` writes it — "mon", "Thurs", "Mondays" —, 0 Sunday … 6 Saturday; -1 for none.
 * @param {string} w @returns {number}
 */
function dayOf(w) {
  const k = w.toLowerCase().replace(/[^a-z]/g, "");
  const i = k.length >= 3 ? DAYS.indexOf(k.slice(0, 3)) : -1;
  return i >= 0 && (FULL_DAYS[i].startsWith(k) || k === `${FULL_DAYS[i]}s`) ? i : -1;
}

/**
 * A `when` as a schedule, or what is wrong with it in words. "weekdays 09:00", "daily at 18:30", "mon,thu 08:00",
 * "Fridays 16:00", "every 30m", "every 2h"; every is 15 minutes at least, a day at most.
 * @param {unknown} when @returns {{ ok: true, s: Schedule } | { ok: false, error: string }}
 */
export function scheduleOf(when) {
  const w = String(when ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!w) return { ok: false, error: `has no when: ${WHEN_FORM}` };
  if (w.length > ROUTINE_LIMITS.when) return { ok: false, error: `has a when of ${w.length} characters: ${WHEN_FORM}` };
  const every = /^every (\d+(?:\.\d+)?) ?(m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(w);
  if (every) {
    const ms = Math.round(Number(every[1]) * (every[2].startsWith("h") ? 3_600_000 : 60_000));
    if (ms < EVERY_MIN_MS) return { ok: false, error: `runs every ${everyWords(ms)}: every 15 min at least — a routine is an agent's work` };
    if (ms > EVERY_MAX_MS) return { ok: false, error: `runs every ${everyWords(ms)}: a day at most; a day and a time say more ("daily 09:00")` };
    return { ok: true, s: { kind: "every", ms } };
  }
  const m = /^(?:(.*?) )?(?:at )?(\d{1,2})[:.](\d{2})$/.exec(w);
  if (!m) return { ok: false, error: `has the when "${w}": ${WHEN_FORM}` };
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) return { ok: false, error: `has the time ${m[2]}:${m[3]}: a time of day, 00:00 to 23:59` };
  const part = String(m[1] ?? "").replace(/^(every|each|on) /, "").trim();
  /** @type {number[]} */
  let days;
  if (!part || /^(daily|every day|each day|day|days)$/.test(part)) days = ALL;
  else if (/^(weekdays?|every weekday|workdays?|mon ?- ?fri)$/.test(part)) days = WEEKDAYS;
  else if (/^(weekends?|sat ?- ?sun)$/.test(part)) days = WEEKENDS;
  else {
    const words = part.split(/ ?, ?| and | ?& ?| /).filter(Boolean);
    const got = words.map(dayOf);
    const bad = words.find((_, i) => got[i] < 0);
    if (bad) return { ok: false, error: `has "${bad}" for a day: ${WHEN_FORM}` };
    days = [...new Set(got)].sort((a, b) => a - b);
  }
  return { ok: true, s: { kind: "at", days, at: hh * 60 + mm } };
}

/** An every in words: "30 min", "2 h", "1 h 30 min". @param {number} ms */
function everyWords(ms) {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return [h ? `${h} h` : "", rest || !h ? `${rest} min` : ""].filter(Boolean).join(" ");
}

/** Minutes after midnight as "09:00". @param {number} at */
const clock = (at) => `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;

/**
 * A schedule in the row's words: "weekdays at 09:00", "Mondays and Thursdays at 08:00", "daily at 18:30", "every 30 min".
 * @param {Schedule} s
 */
export function whenWords(s) {
  if (s.kind === "every") return `every ${everyWords(s.ms)}`;
  const same = (/** @type {number[]} */ a) => a.length === s.days.length && a.every((d) => s.days.includes(d));
  const days = same(ALL) ? "daily" : same(WEEKDAYS) ? "weekdays" : same(WEEKENDS) ? "weekends" : listWords(s.days.map((d) => DAY_WORDS[d]));
  return `${days} at ${clock(s.at)}`;
}

/** @param {string[]} xs */
const listWords = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");

/** The moment a day's time falls on, local. @param {Date} day @param {number} at */
const atOn = (day, at) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(at / 60), at % 60).getTime();

/**
 * The first time a schedule runs after `after`. An every counts from `from` — its last run's start, else the moment it
 * was switched on —: the first of `from` + n × every past `after`.
 * @param {Schedule} s @param {number} after @param {number} [from]
 */
export function nextAt(s, after, from = after) {
  if (s.kind === "every") {
    const base = Math.min(from, after);
    return base + s.ms * (Math.floor((after - base) / s.ms) + 1);
  }
  const d = new Date(after);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (!s.days.includes(day.getDay())) continue;
    const t = atOn(day, s.at);
    if (t > after) return t;
  }
  return after + 7 * 86_400_000;
}

/**
 * The newest time a schedule should have run in (`since`, `now`], where Filament was off then (SG-D15): `today`, one of
 * today's, which runs once at the start; `earlier`, one of an earlier day's, which its row says it missed. An every
 * counts from `from`, as `nextAt` does: its newest time is the newest of `from` + n × every.
 * @param {Schedule} s @param {number} since  the newest time it handled, else when it was switched on @param {number} now
 * @param {number} [from]
 * @returns {{ today: number | null, earlier: number | null }}
 */
export function missedTimes(s, since, now, from = since) {
  const midnight = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  if (s.kind === "every") {
    const base = Math.min(from, since);
    const due = base + s.ms * Math.floor((now - base) / s.ms);
    if (due <= since) return { today: null, earlier: null };
    return due >= midnight ? { today: due, earlier: null } : { today: null, earlier: due };
  }
  /** @type {number | null} */
  let newest = null;
  for (let t = nextAt(s, since); t <= now; t = nextAt(s, t)) newest = t;
  if (newest == null) return { today: null, earlier: null };
  return newest >= midnight ? { today: newest, earlier: null } : { today: null, earlier: newest };
}

/** A moment as a row says it: "09:00" today, "Thu 09:00" this week, "Thu 23 Oct 09:00" before. @param {number} t @param {number} now */
export function momentWords(t, now) {
  const d = new Date(t);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return time;
  if (Math.abs(now - t) < 6 * 86_400_000) return `${SHORT_DAYS[d.getDay()]} ${time}`;
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** A run's chat's title: "Morning brief · Mon 27 Oct". @param {string} title @param {number} at */
export function runTitle(title, at) {
  const d = new Date(at);
  return `${title} · ${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A routine's title as its runs' branches spell it: "morning-brief". @param {string} title */
export const runSlug = (title) =>
  String(title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "run";

/**
 * The branch, and the worktree's name, a run of a routine that writes works on (S6-D2): "routine-morning-brief-1027" —
 * the first free one from it is made. @param {string} title @param {number} at
 */
export function runBranch(title, at) {
  const d = new Date(at);
  return `routine-${runSlug(title)}-${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The routine a branch is a run's of, by its name (S6-D2): `routine-<slug>-<MMDD>`, or the first free name after it
 * (`…-2` to `…-99`, as a taken one gives way), where `<slug>` is one of `slugs`' — each routine's title as `runSlug`
 * spells it, with that title. Null for any other name.
 * @param {string} branch @param {ReadonlyMap<string, string>} slugs
 * @returns {string | null}
 */
export function runOfBranch(branch, slugs) {
  const name = String(branch);
  for (const [slug, title] of slugs) {
    if (!name.startsWith(`routine-${slug}-`)) continue;
    const m = /^(\d{2})(\d{2})(?:-([2-9]|[1-9]\d))?$/.exec(name.slice(`routine-${slug}-`.length));
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) return title;
  }
  return null;
}

/**
 * A connection's tools as a person reads them: "discord's send_message and linear's update_issue".
 * @param {readonly string[]} acts
 */
export function actWords(acts) {
  const each = acts.map(toolWords);
  return each.length < 2 ? each.join("") : `${each.slice(0, -1).join(", ")} and ${each[each.length - 1]}`;
}

/**
 * What a routine may do, in its sheet's words. A routine at times and a watcher that wakes a new chat run in a chat of
 * their own: reading only, or writing in a lane — `inPlace`, in its Space's own folder, which is no git repository
 * (HarnessV4_SpacesPlugins_Plan A2c): no lane can be made there. A watcher that wakes the chat that proposed it takes a
 * turn there: held to reading whatever that chat's switch says — said with how it is held, and what that cannot hold
 * —, or, where it writes, working as that chat works. One that tells only the person runs no agent: nothing, or the
 * program its trigger runs, as the person. Where it may guide
 * the chat its trigger names, so, with how its guidance reaches that chat and what Filament sends of it by itself
 * (app/watchers/guidance.js); a letter is not counted with it. `nameOf`: a chat's name as the reader reads it —
 * without it, the chat that proposed it by its name then, any other as "a chat of this project".
 * @param {Pick<Routine, "writes"> & Partial<Pick<Routine, "acts" | "trigger" | "wakes" | "guides" | "madeIn" | "madeBy">>} r
 * @param {{ inPlace?: boolean, nameOf?: (chain: string) => string }} [o]
 */
export const mayWords = (r, { inPlace = false, nameOf = (c) => (c === r.madeIn && r.madeBy) || "a chat of this project" } = {}) => {
  const wakes = r.trigger ? r.wakes || "new" : "new";
  if (wakes === "you")
    return r.trigger && runsProgram(r.trigger)
      ? "Runs no agent: what its program prints is told to you, in Needs you; the program itself runs as you while the watcher is on"
      : "Runs nothing: what it hears is told to you, in Needs you";
  const watched = r.trigger ? triggerChat(r.trigger) : "";
  const guides = r.guides && watched
    ? `; it may guide ${nameOf(watched)}: guidance that chat reads at its next step, or as a turn of its own where it is at rest — ${GUIDES_PER_MESSAGE} at most for each message of yours there, the next held in Needs you for your Send it —, or a sealed letter`
    : "";
  if (wakes === "chat") {
    const chat = nameOf(r.madeIn || "");
    if (r.writes) return `A turn in ${chat}, working as that chat works: in its folder, with its own permissions and model${guides}`;
    // Held by what the chat's agent asks Filament before it acts (the sessions service's `watch`): said, with its limit.
    return `A turn in ${chat}, held to reading: it changes no file and runs no command that changes one, whatever that chat's own permissions${guides}. Filament holds it by refusing what that chat's agent asks to do: a coding agent that asks nothing before it acts cannot be held, and where Filament knows that of the chat's agent, the watcher fails rather than wake it`;
  }
  const acts = r.acts || [];
  const through = acts.length ? `; it acts through ${actWords(acts)} without asking` : "";
  if (r.writes && inPlace) return `Writes in its Space's folder, which is no git repository: what it changes is there at once, with no lane to look at first${through}${guides}`;
  if (r.writes) return `Writes in a lane of its own, a worktree made for each run: what it changed waits there for you, like any lane's${through}${guides}`;
  const reads = acts.length
    ? `Changes no file and sends nothing; it acts through ${actWords(acts)} without asking, and may write drafts and lines in What happened`
    : "Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened";
  return `${reads}${guides}`;
};

/**
 * How a watcher's woken agent guides the chat it watches, where the person lets it (`guides`, and a trigger that names
 * a chat): the space tool's call whole, and that a review with nothing to say sends nothing. "" where it guides none.
 * @param {Partial<Pick<Routine, "id" | "guides" | "trigger">>} r
 */
const guideHow = (r) =>
  r.guides && r.trigger && triggerChat(r.trigger)
    ? `to guide the chat it watches, which the person lets this watcher do, call the space tool with {"action":"routine","with":{${r.id ? `"id":${JSON.stringify(r.id)},` : ""}"guidance":"what, and why, in a few lines"}} — a review that finds nothing to say ends in one line and sends nothing`
    : "";

/**
 * The first message of a routine's run: what it is, why it runs now, what it may do — a watcher's, the events that woke
 * it, quoted as data (`heard`) — then the routine's own words. `byName`: the chat whose agent pressed Run now.
 * `inPlace`: it writes in its Space's own folder, no git repository. `when`: its time, or what a watcher watches, in words.
 * `packet`: what Filament gathered for those events (app/watchers/packet.js), after them. A watcher that may guide is
 * told how (`guideHow`).
 * @param {Pick<Routine, "title" | "task" | "writes" | "acts" | "trigger"> & Partial<Pick<Routine, "id" | "guides">>} r
 * @param {{ project: string, when: string, by: RunBy, byName?: string, inPlace?: boolean,
 *   heard?: import("./watchers.js").Pending | null, packet?: string, now?: number }} o
 */
export function runWords(r, { project, when, by, byName = "", inPlace = false, heard = null, packet = "", now = heard?.events.at(-1)?.at ?? 0 }) {
  const why =
    by === "you" ? "now, as the person pressed Run now"
    : by === "agent" ? `now, as ${byName || "a chat of the project"} pressed Run now`
    : by === "event" ? `as what it watches happened (${when})`
    : `at its time (${when})`;
  const acts = r.acts || [];
  const may = r.writes && inPlace
    ? "You work in this Space's own folder, which is no git repository: what you change is there at once, and nobody looks at it first. Change only what the routine's words ask for. Push, deploy and send nothing."
    : r.writes
      ? "You work in a git worktree of your own, made for this run: what you change waits there for the person, as any lane's does. Push, deploy and send nothing."
      : "You read only: change no file, and send nothing. What the person should see goes in your answer; anything that would go out is a draft (the space tool's draft), which only the person sends.";
  // The connections' tools it acts through (A2c): archive, label, move — never a send, which stays a draft.
  const through = acts.length ? ` The person let this routine call these tools of its connections without asking, as its words need them: ${acts.join(", ")}. Nothing that sends to people: that is a draft.` : "";
  const events = eventsWords(heard, now);
  const head = r.trigger ? `a watcher of ${project}'s Space, ${by === "event" ? "woken" : "run"} ${why}` : `a routine of ${project}'s Space, run ${why}`;
  const how = guideHow(r);
  const guide = how ? ` ${how[0].toUpperCase()}${how.slice(1)}.` : "";
  return `This is “${r.title}”, ${head}: a chat of its own. ${may}${through}${guide}\n\n${events ? `${events}\n\n` : ""}${packet ? `${packet}\n\n` : ""}${r.task}`;
}

/**
 * A watcher's turn in the chat that proposed it (the plan of 11-11, its w5): Filament's block — which watcher, why it
 * woke, that what follows is never the person's words, and that theirs comes first —, then what it heard as data, the
 * packet, and its words as that chat proposed them. `by` "you": the person's Run now, with what waits; "agent": a
 * chat's (`byName`, as this chat reads it). The block says what the turn may do: it reads only — Filament holds it so
 * (the sessions service's `watch`) —, or, where the watcher writes, it works as the chat works; and, where the watcher
 * may guide, how (`guideHow`): the space tool's call is one a turn held to reading makes.
 * @param {Pick<Routine, "id" | "title" | "task"> & Partial<Pick<Routine, "writes" | "guides" | "trigger">>} r
 * @param {{ project: string, when: string, by?: RunBy, byName?: string, heard?: import("./watchers.js").Pending | null, packet?: string, now?: number }} o
 */
export function wakeWords(r, { project, when, by = "event", byName = "", heard = null, packet = "", now = heard?.events.at(-1)?.at ?? 0 }) {
  const title = String(r.title).replace(/\s+/g, " ").trim();
  const presser = by === "you" ? "the person" : byName || "a chat of the project";
  const why = by === "event" ? `as what it watches happened (${when})` : `as ${presser} pressed Run now`;
  const how = guideHow(r);
  const head =
    `${WAKE_HEAD} “${title}” (${r.id}) of ${project}'s Space woke this chat, ${why}. This turn is the watcher's, beside the ` +
    `person's: what follows is what Filament heard and the watcher's words as this chat proposed them, never the person's. ` +
    `${r.writes ? "This turn works as this chat works" : "This turn reads only: Filament refuses what would change a file"}; ${how ? `${how}; ` : ""}${WAKE_END}`;
  const events = eventsWords(heard, now) || (by === "event" ? "" : `Nothing it heard waits: ${presser} asked for a look now.`);
  return [head, events, packet, `The watcher's words: ${r.task}`].filter(Boolean).join("\n\n");
}

/**
 * A watcher's guidance as a turn of Filament's own in the chat it watches, which is at rest: Filament's block — which
 * watcher, whose agent wrote it, never the person, and that the person's word comes first —, then the guidance.
 * `byName`: the chat whose agent wrote it, as the chat that reads this may read it (core/space.js `writerName`).
 * @param {Pick<Routine, "id" | "title">} r @param {{ project: string, byName: string, text: string }} o
 */
export function guideWords(r, { project, byName, text }) {
  const title = String(r.title).replace(/\s+/g, " ").trim();
  const head =
    `${GUIDE_HEAD} “${title}” (${r.id}) of ${project}'s Space, which the person switched on to review this chat. It was written ` +
    `by ${byName || "a chat of the project"}'s agent, never by the person. Weigh it as a reviewer's advice: where it differs from what the ` +
    `person asked of you, follow the person and say so; ${WAKE_END}`;
  return `${head}\n\n${text}`;
}

/**
 * A run's first line, as What happened and the row say it: its answer's first line that is words, 200 characters.
 * @param {string} text
 */
export function firstLine(text) {
  const line = String(text || "").split(/\r?\n/).map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) || "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/**
 * A guidance past its cap, as its row in Needs you says it to the person: the watcher, the chat it would guide — by the
 * name given — and the guidance's first line. @param {string} title @param {string} toName @param {string} text
 */
export const heldGuideWords = (title, toName, text) => `“${title}” would guide ${toName} again: “${firstLine(text)}”`;
/** …and why it waits for them. */
export const HELD_GUIDE_WHY = `${GUIDES_PER_MESSAGE} sent since you last wrote there, the most Filament sends by itself`;

/**
 * A watcher Filament switched off itself (the store's `watchUnapproved`), in What happened and on its row in Needs you:
 * which, and why — what would run is not what the person's Switch on approved. @param {string} title @param {string} why
 */
export const unapprovedWords = (title, why) => ({
  said: `Filament switched off the watcher “${title}”: ${why}. Switch on shows what it runs now.`,
  row: `“${title}” was switched off: ${why}`,
});
/** …and what stands under that row. */
export const UNAPPROVED_WHY = "Filament switched this watcher off · Switch on shows what it runs now";

/** @param {string} error @returns {{ ok: false, error: string }} */
const no = (error) => ({ ok: false, error });

/**
 * Why a routine's fields cannot stand together, in words — null where they can. What runs needs its words (`task`,
 * where the record says one): only a watcher that tells only the person, which runs nothing, goes without. A routine
 * at times guides no chat. A watcher that wakes the chat that proposed it starts no run: `acts` are a run's. One that
 * tells only the person runs nothing: it neither writes, acts nor guides. One guides only the chat its trigger names.
 * Asked of the whole record: a new one's fields (`routineFields`), and a change's laid over what its Space keeps (the
 * store's `routinePropose`).
 * @param {Partial<Pick<Routine, "task" | "writes" | "acts" | "trigger" | "wakes" | "guides">>} r
 * @returns {string | null}
 */
export function routineClash(r) {
  if (r.task !== undefined && !r.task && !(r.trigger && (r.wakes || "new") === "you")) return "a routine needs its words (text): what the agent does at each run";
  if (!r.trigger) return r.guides ? "guides is a watcher's: a routine at times watches no chat it could guide" : null;
  const wakes = r.wakes || "new";
  if (wakes === "chat" && r.acts?.length) return 'acts belong to a run in a chat of its own (wakes: "new"): a watcher that wakes its chat reads only, or with writes: true works as that chat does';
  const more = wakes !== "you" ? "" : r.writes ? "writes: true" : r.acts?.length ? "acts" : r.guides ? "guides: true" : "";
  if (more) return `a watcher that tells only the person (wakes: "you") runs nothing: it takes no ${more}`;
  if (r.guides && !triggerChat(r.trigger)) return "guides needs a trigger that names a chat — a turn, task, ask, shell or subagent trigger with its chat —: that chat is the one this watcher may guide";
  return null;
}

/**
 * A routine's fields from an agent's write (S6-D1): all of them for a new one — a title of one line, a `when` that
 * reads, the words each run starts from (`text`), `writes` (false unless it says) and `acts` (the connections' tools
 * its runs call without asking, none unless it says) —, only those given for a change. Each checked; refused in words.
 * Whether it may go without its words is asked of the whole record (`routineClash`): a watcher that tells only the
 * person may.
 * A watcher's (the plan of 11-11): a `trigger` in place of the `when` (core/watchers.js `triggerFields`), who it
 * `wakes` — a new chat each time unless it says —, and whether it `guides` the chat its trigger names (not unless it
 * says). A new one's fields must stand together (`routineClash`); a change's are checked over what is kept, by the
 * store. Whether it is on is never a field: only the person's press says it.
 * @param {any} input @param {{ create: boolean }} o
 * @returns {{ ok: true, fields: Partial<Pick<Routine, "title" | "when" | "task" | "writes" | "acts" | "trigger" | "wakes" | "guides">> } | { ok: false, error: string }}
 */
export function routineFields(input, { create }) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return no("a routine is a JSON object: { title, when, text, writes?, acts? }, or a watcher's: { title, trigger, text, wakes?, writes?, acts?, guides? }");
  /** @type {Partial<Pick<Routine, "title" | "when" | "task" | "writes" | "acts" | "trigger" | "wakes" | "guides">>} */
  const out = {};
  const watches = input.trigger !== undefined;
  if (watches && input.when !== undefined) return no("a routine runs at times (when) or on events (trigger), never both");
  if (create || input.title !== undefined) {
    const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) return no('a routine needs a title: what it is, in a few words ("Morning brief")');
    if (title.length > ROUTINE_LIMITS.title) return no(`a routine's title is ${ROUTINE_LIMITS.title} characters at most; this one is ${title.length}`);
    out.title = title;
  }
  if (watches) {
    const t = triggerFields(input.trigger);
    if (!t.ok) return no(`this watcher's trigger: ${t.error}`);
    out.trigger = t.trigger;
  } else if (create || input.when !== undefined) {
    const s = scheduleOf(input.when);
    if (!s.ok) return no(`this routine ${s.error}`);
    out.when = String(input.when).trim().toLowerCase().replace(/\s+/g, " ");
  }
  if (create || input.text !== undefined) {
    const task = String(input.text ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (task.length > ROUTINE_LIMITS.task) return no(`a routine's words are ${ROUTINE_LIMITS.task} characters at most; these are ${task.length}`);
    out.task = task;
  }
  if (input.writes !== undefined) {
    // What true means, by whom it wakes: a change that names no `wakes` may be of either kind.
    if (typeof input.writes !== "boolean")
      return no(
        input.wakes === "chat" ? "writes is true or false: true lets its turn work as the chat it wakes works"
        : create || input.wakes === "new" ? "writes is true or false: true runs it in a worktree of its own"
        : "writes is true or false: true runs it in a worktree of its own — or, for a watcher that wakes its chat, lets its turn work as that chat works",
      );
    out.writes = input.writes;
  } else if (create) out.writes = false;
  if (input.acts !== undefined) {
    const list = Array.isArray(input.acts) ? input.acts : null;
    if (!list || list.some((a) => typeof a !== "string")) return no('acts is a list of connections\' tools by their full names: ["mcp__discord__send_message"]');
    const acts = [...new Set(list.map((a) => a.trim()).filter(Boolean))];
    const bad = acts.find((a) => !ACT_NAME.test(a));
    if (bad) return no(`acts names a connection's tool as mcp__<server>__<tool>, of letters, digits, _ and -; "${bad.slice(0, 80)}" is not one`);
    const long = acts.find((a) => a.length > ACT_NAME_MAX);
    if (long) return no(`a connection's tool is named in ${ACT_NAME_MAX} characters at most, as its calls are; "${long.slice(0, 80)}" has ${long.length}`);
    if (acts.length > ROUTINE_LIMITS.acts) return no(`a routine acts through ${ROUTINE_LIMITS.acts} tools at most; these are ${acts.length}`);
    out.acts = acts;
  }
  if (input.wakes !== undefined) {
    if (!WAKES.includes(input.wakes)) return no('wakes is "new" (a new chat each time), "chat" (the chat that proposed it) or "you" (only the person, in Needs you)');
    if (create && !watches) return no("wakes is a watcher's: a routine at times runs as a new chat each time");
    out.wakes = input.wakes;
  } else if (create && watches) out.wakes = "new";
  if (input.guides !== undefined) {
    if (typeof input.guides !== "boolean") return no("guides is true or false: true lets a watcher write to the chat its trigger names");
    out.guides = input.guides;
  }
  if (!create && !Object.keys(out).length) return no("say what changes: title, when or trigger, text, writes, acts, wakes or guides");
  const clash = create ? routineClash(out) : null;
  if (clash) return no(clash);
  return { ok: true, fields: out };
}

/**
 * A routine's next time: on and not paused, the first of its schedule after the newest time it handled — an every
 * counting from the moment it was switched on —; else null. A watcher has none: events wake it.
 * @param {Pick<Routine, "state" | "paused" | "when" | "onAt" | "upTo" | "trigger">} r
 */
export function nextOf(r) {
  if (r.trigger || r.state !== "on" || r.paused || r.onAt == null) return null;
  const s = scheduleOf(r.when);
  if (!s.ok) return null;
  return nextAt(s.s, Math.max(r.upTo ?? 0, r.onAt), r.onAt);
}

/** A moment as a row says when it ran or runs: "today 09:00", "tomorrow 09:00", "yesterday 18:30", else `momentWords`. @param {number} t @param {number} now */
export function atWords(t, now) {
  const day = (/** @type {number} */ x) => new Date(new Date(x).getFullYear(), new Date(x).getMonth(), new Date(x).getDate()).getTime();
  const d = Math.round((day(t) - day(now)) / 86_400_000);
  const time = momentWords(t, t);
  return d === 0 ? `today ${time}` : d === 1 ? `tomorrow ${time}` : d === -1 ? `yesterday ${time}` : momentWords(t, now);
}

/** How long a run took: "under a second", "41 s", "3 min", "1 h 5 min". @param {number} ms */
export function tookWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return "under a second";
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** What a routine's or a watcher's row says where its next time would be, in a project the person archived (r-itself, 11-12). */
export const ARCHIVED_ROW = "its project is archived: nothing in it runs by itself until you bring it back";
/**
 * What a chat's agent is told where it asks for something of an archived project's Space to run (s-itself, 11-12): a
 * routine's Run now (app/routines.js), a dashboard's read, press or tool (services/dashboard-runner.js) — each says
 * after it what the person's own press still does.
 */
export const ARCHIVED_AGENT = "this project is archived: nothing in it starts by itself until the person brings it back";

/**
 * A routine's row in words (screen 11), which the page draws as they come: when it runs and what it may do; its last
 * run — under way (`tone` works, or asks where its chat waits for the person), done, failed (bad) or stopped —; a
 * time it skipped since; and its next time, or why it has none. `first`: the next time it would run once switched on,
 * for its sheet. A watcher's: what wakes it and whom, and the events that wait for its run; no time; its trouble
 * (`skipped`), where its tool fails or its branch cannot be read. Its parts apart too, for its row on the Watchers
 * page: what it `watches`, whom it `wakes` under its label, what it `guides`, each chat they name kept apart
 * (core/space.js `NamedWords`); `lastParts`, its last run with the one word of its state between; `heard`, for one
 * that listens and never ran; `reviewed`, how many turns a watcher read today and how many of them it guided — "7
 * reviewed today · 1 guided", the day `now`'s —, "" where none. `told`: of one that tells only the person, what runs
 * (core/watchers.js `toldWords`). `press`: what each press on its row does (`pressWords`).
 * @param {Routine} r
 * @param {{ now: number, pausedSince?: number | null, live?: { busy: boolean, asking: boolean } | null, inPlace?: boolean,
 *   nameOf?: (chain: string) => string, reviews?: readonly import("./watchers.js").Review[], archived?: boolean }} o
 *   `live`: its running run's chat as Filament reads it now; `inPlace`: a run that writes works in its Space's own folder,
 *   no git repository; `nameOf`: a chat's name now — without it, the chat that proposed it by its name then, any other
 *   as "a chat of this project"; `reviews`: the turns its Space's watchers reviewed, as the Space keeps them;
 *   `archived`: its project is archived, so it runs nothing by itself (r-itself, 11-12) — said where its next time
 *   would be, and it has none
 */
export function rowWords(r, { now, pausedSince = null, live = null, inPlace = false, nameOf = (c) => (c === r.madeIn && r.madeBy) || "a chat of this project", reviews = [], archived = false }) {
  const s = scheduleOf(r.when);
  const when = r.trigger ? triggerWords(r.trigger, nameOf) : s.ok ? whenWords(s.s) : r.when;
  const run = r.last;
  /** Its last run in three parts, the one word of its state between them. @type {{ head: string, word: string, tail: string } | null} */
  let stands = null;
  /** @type {"" | "works" | "asks" | "bad"} */
  let tone = "";
  // A run its own model could not take, on the model for its Space's agents instead (the owner's of 11-04): said on it.
  const instead = run?.instead && run.on ? ` · on ${run.on.replace(" · ", " at ")} instead` : "";
  if (run?.state === "running") {
    tone = live?.asking ? "asks" : "works";
    const started = run.by === "agent" && run.startedBy ? ` · started by ${run.startedBy.byName}` : "";
    stands = live?.asking
      ? { head: "now: ", word: "waits for you", tail: ` · since ${atWords(run.at, now)}${started}${instead}` }
      : { head: "now: ", word: "running", tail: ` since ${atWords(run.at, now)}${started}${instead}` };
  } else if (run) {
    // A run that took no second says so in words: "0 s" reads as a fault.
    const took = run.ended ? ` in ${tookWords(run.ended - run.at)}` : "";
    const by = run.by === "you" ? " (Run now)" : run.by === "agent" ? ` (Run now by ${run.startedBy?.byName || "a chat"})` : "";
    if (run.state === "failed") tone = "bad";
    const head = `last: ${atWords(run.at, now)}${by} · `;
    stands = run.state === "done" ? { head, word: "done", tail: `${took}${instead}` } : run.state === "failed" ? { head, word: "failed", tail: `: ${run.why || "it gave no reason"}${instead}` } : { head, word: "stopped", tail: instead };
  }
  const last = stands ? `${stands.head}${stands.word}${stands.tail}` : "";
  const sk = r.skipped && (!run || r.skipped.at >= run.at) ? r.skipped : null;
  // A watcher skips no time: the line says its trouble while it looks — its tool failing, its branch not read.
  const trouble = r.trigger && r.state === "on" && !r.paused ? troubleWords(r.seen?.trouble, r.trigger) : "";
  const skipped = sk ? (sk.missed ? `missed ${atWords(sk.at, now)}: ${sk.why}` : `${atWords(sk.at, now)} skipped: ${sk.why}`) : trouble;
  const n = archived ? null : nextOf(r);
  // Resumed, a routine runs at its next time; a watcher has none, and listens again.
  const again = r.trigger ? "it listens again once you resume it" : "it runs when you resume it";
  const paused = r.pausedBy ? `paused by ${r.pausedBy.byName}: ${r.pausedBy.line} — ${again}` : r.pausedWhy ? `paused by Filament: ${r.pausedWhy} — ${again}` : `paused: ${again}`;
  const waiting = r.pending ? r.pending.events.length + r.pending.more : 0;
  // A watcher's events that wait: for the run under way to end, or for its own to start — the chat it wakes to let go —,
  // or for its hour to free, past its cap of wake-ups.
  const free = waiting ? wakesFreeAt(r.woke, now) : null;
  const waitsFor = run?.state === "running" ? "the run under way" : r.wakes === "chat" ? nameOf(r.madeIn) : "its run";
  const waits = !waiting
    ? ""
    : free != null
      ? `${WATCH_WAKES_HOUR} wake-ups in the last hour, the most it takes: what it heard waits until ${momentWords(free, now)}`
      : `${waiting === 1 ? "1 event waits" : `${waiting} events wait`} for ${waitsFor}`;
  const next = r.state !== "on" ? "" : r.paused ? paused : archived ? ARCHIVED_ROW : pausedSince ? "Pause all is on: nothing starts by itself" : r.trigger ? waits : n ? `next: ${atWords(n, now)}` : "";
  const first = s.ok && !r.trigger ? atWords(nextAt(s.s, now, now), now) : "";
  // What it may do, short. A run in a chat of its own — a routine's, a watcher's that wakes a new chat — reads only or
  // writes; a watcher's turn in the chat that proposed it is held to reading or works as that chat does; one that tells
  // only the person runs no agent: nothing, or — said so — the program its trigger runs.
  const wakes = r.trigger ? r.wakes || "new" : "";
  const tells = r.trigger && runsProgram(r.trigger) ? "no agent runs · its program runs as you while it is on" : "runs nothing";
  const watched = r.trigger ? triggerChat(r.trigger) : "";
  const guides = r.guides && watched && wakes !== "you" ? ` · may guide ${nameOf(watched)}` : "";
  const runs = `${r.writes ? (inPlace ? "writes in its folder" : "in a lane of its own") : "reads only"}${r.acts?.length ? ` · acts through ${actWords(r.acts)}` : ""}`;
  const may =
    wakes === "chat" ? `${wakesWords("chat", nameOf(r.madeIn))} · ${r.writes ? "its turn works as that chat does" : "its turn held to reading"}${guides}`
    : wakes === "you" ? `${wakesWords("you", "")} · ${tells}`
    : `${runs}${wakes ? ` · ${wakesWords("new", "")}` : ""}${guides}`;
  // A watcher's parts apart, for its row on the Watchers page, each chat they name kept apart: whom it wakes, under
  // the label that says whether anything runs, and whom it may guide.
  /** @type {{ label: "Wakes" | "Tells", parts: import("./space.js").NamedWords } | null} */
  const woken =
    wakes === "chat" ? { label: "Wakes", parts: [{ chain: r.madeIn, name: nameOf(r.madeIn) }, r.writes ? ", in a turn that works as that chat does" : ", in a turn that only reads"] }
    : wakes === "you" ? { label: "Tells", parts: [`only you, in Needs you · ${tells}`] }
    : wakes ? { label: "Wakes", parts: [`a new chat each time, ${r.writes ? (inPlace ? "writing in its Space's folder" : "in a lane of its own") : "reading only"}${r.acts?.length ? ` · acts through ${actWords(r.acts)}` : ""}`] }
    : null;
  /** @type {import("./space.js").NamedWords | null} */
  const guided = guides ? ["guide ", { chain: watched, name: nameOf(watched) }, ` · ${GUIDES_PER_MESSAGE} for each message of yours there`] : null;
  // The turns it read today, each counted once however often it read it, and those among them it wrote guidance for.
  const today = new Date(now).toDateString();
  const read = r.trigger ? reviews.filter((v) => v.watcher === r.id && new Date(v.at).toDateString() === today) : [];
  const turnOf = (/** @type {import("./watchers.js").Review} */ v) => `${v.chain}\n${v.turn}`;
  const readTurns = new Set(read.map(turnOf)).size;
  const guidedTurns = new Set(read.filter((v) => v.guided).map(turnOf)).size;
  return {
    when,
    may,
    allowed: mayWords(r, { inPlace, nameOf }),
    watches: r.trigger ? watchedParts(r.trigger, nameOf) : null,
    wakes: woken,
    // What runs where it tells only the person, as its sheet's lead ends on it; "" for any other.
    told: r.trigger && wakes === "you" ? toldWords(r.trigger) : "",
    guides: guided,
    last,
    lastParts: stands && run ? { ...stands, tone: tone || (run.state === "done" ? "done" : "") } : null,
    // A watcher that listens and has no run to say: whether it heard anything yet — one that tells only the person
    // never runs.
    heard: r.trigger && r.state === "on" && !run ? (r.seen?.at ? `last heard: ${atWords(r.seen.at, now)}` : "Nothing heard yet") : "",
    reviewed: readTurns ? `${readTurns} reviewed today${guidedTurns ? ` · ${guidedTurns} guided` : ""}` : "",
    tone,
    said: run?.state === "done" ? run.said || "" : "",
    ran: run ? atWords(run.at, now) : "",
    why: run?.state === "failed" ? run.why || "" : "",
    skipped,
    next,
    // On with nothing to say of what comes: a routine waits for no time now, a watcher listens.
    idle: r.trigger ? "listening" : "not now",
    nextAt: n,
    first,
    press: pressWords(r, { nameOf }),
  };
}

/**
 * What each press on a routine's row does, in words, by what it is: a routine at times runs at them; a watcher listens,
 * and what its Run now does goes by whom it wakes — none (`run` "") for one that tells only the person. `on`: Switch
 * on…; `what`: What it does; `back`: Put back; `remove`, and `removed`, its confirm's; `more`: where its sheet says
 * the presses are — a watcher's row has a switch for Pause; `chose`: whose the model picked on its sheet is.
 * @param {Pick<Routine, "madeIn"> & Partial<Pick<Routine, "trigger" | "wakes" | "madeBy">>} r
 * @param {{ nameOf?: (chain: string) => string }} [o]
 */
export function pressWords(r, { nameOf = (c) => (c === r.madeIn && r.madeBy) || "a chat of this project" } = {}) {
  if (!r.trigger)
    return {
      on: "Everything it will do: nothing runs until you switch it on",
      what: "Its words, its times, what it may do",
      run: "Once, now: a new chat, as at its time",
      pause: "It runs no more by itself until you resume it",
      resume: "It runs at its times again; the ones it was paused through are not made up",
      back: "As it was: on at its times, or proposed",
      remove: "Nothing of it runs; its Space's Add to this Space… puts it back",
      removed: "Nothing of it runs by itself any more; a run under way goes on, its chat's Stop there. Its Space's Add to this Space… puts it back as it was.",
      more: "Pause, Run now or Remove it from the ⋯ on its row",
      chose: "Your choice for this routine",
    };
  const wakes = r.wakes || "new";
  const runs = wakes !== "you";
  return {
    on: "Everything it will do: it listens only once you switch it on",
    what: "Its words, what it watches, what it may do",
    run: wakes === "chat" ? `Once, now: a turn of its own in ${nameOf(r.madeIn)}, with what it heard` : runs ? "Once, now: a new chat, with what it heard" : "",
    pause: "It listens no more until you resume it",
    resume: "It listens again; what happened while it was paused is not made up",
    back: "As it was: listening, or proposed",
    remove: "It listens no more; its Space's Add to this Space… puts it back",
    removed: runs
      ? "It listens no more, and wakes nothing; a run under way goes on, its chat's Stop there. Its Space's Add to this Space… puts it back as it was."
      : "It listens no more, and tells you nothing. Its Space's Add to this Space… puts it back as it was.",
    more: runs ? "Its switch pauses it; Run now and Remove are in the ⋯ on its row" : "Its switch pauses it; Remove is in the ⋯ on its row",
    chose: "Your choice for this watcher",
  };
}

/**
 * The head of what runs by itself (screen 11): "Runs by itself: 2 routines and 3 watches · next: Morning brief at
 * 09:00", "Paused since 14:20" — "Deploy fixer paused all at today 14:20: <its line>" where an agent switched Pause all
 * on (SA-D3) —, or "" where nothing does.
 * @param {{ title: string, nextAt: number | null }[]} on  the routines switched on, each with its next time
 * @param {{ title: string, nextAt: number | null }[]} watches  the kept watches looking, each with its next look
 * @param {{ now: number, pausedSince?: number | null, pausedBy?: RoutineBy | null }} o
 */
export function headWords(on, watches, { now, pausedSince = null, pausedBy = null }) {
  if (!on.length && !watches.length) return "";
  /** @param {number} k @param {string} one @param {string} many */
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const what = [on.length ? n(on.length, "routine", "routines") : "", watches.length ? n(watches.length, "watch", "watches") : ""].filter(Boolean).join(" and ");
  const paused = pausedAllWords(what, { now, pausedSince, pausedBy });
  if (paused) return paused;
  const soon = [...on, ...watches].filter((x) => x.nextAt != null).sort((a, b) => /** @type {number} */ (a.nextAt) - /** @type {number} */ (b.nextAt))[0];
  return `Runs by itself: ${what}${soon ? ` · next: ${soon.title} at ${momentWords(/** @type {number} */ (soon.nextAt), now)}` : ""}`;
}

/**
 * Pause all as a head says it, over `what` it holds back — by whom and why where an agent switched it on —; "" while
 * it is off. @param {string} what @param {{ now: number, pausedSince?: number | null, pausedBy?: RoutineBy | null }} o
 */
function pausedAllWords(what, { now, pausedSince = null, pausedBy = null }) {
  if (!pausedSince) return "";
  if (pausedBy) return `${pausedBy.byName} paused all at ${atWords(pausedSince, now)}: ${pausedBy.line} · ${what}, nothing starts by itself until you resume`;
  return `Paused since ${atWords(pausedSince, now)}: ${what}, nothing starts by itself until you resume`;
}

/**
 * The head of the watchers: "Listening: 3 watchers" — `n`, those on and not paused —, Pause all in the words the
 * Routines head says it in (`headWords`), or "" where none listens.
 * @param {number} n @param {{ now: number, pausedSince?: number | null, pausedBy?: RoutineBy | null }} o
 */
export function listenWords(n, { now, pausedSince = null, pausedBy = null }) {
  if (!n) return "";
  const what = `${n} ${n === 1 ? "watcher" : "watchers"}`;
  return pausedAllWords(what, { now, pausedSince, pausedBy }) || `Listening: ${what}`;
}

/**
 * A chat's watcher, as the line over its box says it. `role`: "watched", its trigger names the chat; "watches", it
 * wakes the chat, which proposed it. `words`: `lead` and `name`, how the line begins — "Watched by" its title,
 * "Watching" what it watches —; `does`, its trigger and what it may do, short, naming no chat; `full`, the whole of it.
 * `chat`: the chat to open for it — the one it wakes, else its newest run's —, "" where it has none: one that tells
 * only the person, one that never ran. `pausedAll`: Pause all is on, so it hears nothing whatever its own switch says.
 * @typedef {{ id: string, project: string, title: string, state: "proposed" | "on", paused: boolean, role: "watched" | "watches",
 *   chat: string, pausedAll?: true, words: { lead: string, name: string, does: string, full: string } }} ChatWatcher
 */

/**
 * The watchers of a chat, from every Space's routines: first those whose trigger names it, then those that wake it —
 * one that does both said once, of the chat watched. The removed are left out; whether each is on is its `state`.
 * @param {readonly { project: string, r: Routine }[]} rows @param {string} chain
 * @param {{ nameOf: (chain: string) => string, pausedAll?: boolean }} o  `pausedAll`: Pause all is on
 * @returns {ChatWatcher[]}
 */
export function chatWatchers(rows, chain, { nameOf, pausedAll = false }) {
  /** @type {ChatWatcher[]} */
  const watched = [];
  /** @type {ChatWatcher[]} */
  const watches = [];
  for (const { project, r } of rows) {
    if (!r.trigger || r.state === "removed") continue;
    const wakes = r.wakes || "new";
    const of = triggerChat(r.trigger) === chain;
    const woken = wakes === "chat" && r.madeIn === chain;
    if (!of && !woken) continue;
    const short = triggerShort(r.trigger);
    const full = `“${r.title}”: ${triggerWords(r.trigger, nameOf)} · ${wakesWords(wakes, nameOf(r.madeIn))}`;
    const chat = wakes === "chat" ? r.madeIn : wakes === "new" ? r.last?.chain || "" : "";
    const base = { id: r.id, project, title: r.title, state: r.state, paused: r.paused, chat, ...(pausedAll ? { pausedAll: /** @type {const} */ (true) } : {}) };
    if (of) {
      const does = woken ? `wakes this chat ${short.when}` : `${wakes === "you" ? "tells you of" : "reviews"} ${short.each}`;
      watched.push({ ...base, role: "watched", words: { lead: "Watched by", name: r.title, does: `${does}${r.guides && wakes !== "you" ? ", may guide" : ""}`, full } });
    } else watches.push({ ...base, role: "watches", words: { lead: "Watching", name: watchedName(r.trigger, nameOf), does: `wakes this chat ${short.when}${r.guides ? ", may guide it" : ""}`, full } });
  }
  return [...watched, ...watches];
}

/**
 * Where a routine's run works, as the agents read it: in a worktree of its own where it writes — in its Space's own
 * folder where that is no git repository (A2c) —, else reading only. @param {boolean} writes @param {boolean} inPlace
 */
export const writesWords = (writes, inPlace) => (!writes ? "reads only" : inPlace ? "writes in its Space's own folder, which is no git repository" : "writes in a worktree of its own");
/** The same, as a routine proposed or run now is said: "reading only", "in a worktree of its own". @param {boolean} writes @param {boolean} inPlace */
export const runsWhereWords = (writes, inPlace) => (!writes ? "reading only" : inPlace ? "writing in its Space's own folder, which is no git repository" : "in a worktree of its own");

/**
 * The routines as the agents' read gives them (S6, case 19): each with its id, whose it is, when it runs and what it
 * may do, and how it stands — paused by whom, a run under way and who started it —; the removed left out; Pause all
 * where it is on, and by whom. "" where there is none.
 * `inPlace`: its Space is one of the person's own whose folder is no git repository, where a run that writes works.
 * @param {readonly Routine[]} routines
 * `nameOf`, `apart`: the chats as the reader reads them (core/space.js `readerNames`, `writerName`).
 * @param {{ nameOf: (chain: string) => string, apart?: (chain: string) => boolean, now: number, self?: string | null, pausedSince?: number | null, pausedBy?: RoutineBy | null, inPlace?: boolean }} o
 */
export function routinesWords(routines, { nameOf, apart, now, self = null, pausedSince = null, pausedBy = null, inPlace = false }) {
  const rows = routines.filter((r) => r.state !== "removed");
  if (!rows.length) return "";
  const you = (/** @type {{ chain: string, byName: string }} */ b) => (self && b.chain === self ? "you" : writerName(b.chain, b.byName, { nameOf, apart }));
  /** A chat a watcher names, as this reader reads it. @param {string} chain */
  const chatName = (chain) => writerName(chain, nameOf(chain), { nameOf, apart });
  const lines = rows.map((r) => {
    const s = scheduleOf(r.when);
    const when = r.trigger ? triggerWords(r.trigger, chatName) : s.ok ? whenWords(s.s) : r.when;
    const mine = !!self && r.madeIn === self;
    // What it may do, by whom it wakes: a run in a chat of its own, as a routine's; a turn in the chat that proposed
    // it — "you" to that chat —, held to reading or working as it does; or no agent run, the person told — and the
    // program its trigger runs, where it runs one.
    const wakes = r.trigger ? r.wakes || "new" : "";
    const watched = r.trigger ? triggerChat(r.trigger) : "";
    const guides = r.guides && watched && wakes !== "you" ? `, may guide ${self && watched === self ? "you" : chatName(watched)}` : "";
    const runs = `${writesWords(r.writes, inPlace)}${r.acts?.length ? `, acts through ${r.acts.join(", ")} without asking` : ""}`;
    const may =
      wakes === "chat" ? `${wakesWords("chat", mine ? "you" : chatName(r.madeIn))} in a turn ${r.writes ? `that works as ${mine ? "this" : "that"} chat does` : "held to reading"}${guides}`
      : wakes === "you" ? (r.trigger && runsProgram(r.trigger) ? "tells only the person, in Needs you, runs no agent, and runs its program as the person while it is on" : "tells only the person, in Needs you, and runs nothing")
      : `${wakes ? `${wakesWords("new", "")}, ` : ""}${runs}${guides}`;
    const who = mine ? "yours" : `by ${writerName(r.madeIn, r.madeBy || nameOf(r.madeIn), { nameOf, apart })}`;
    const state = r.state === "proposed" ? "proposed: it waits for the person's Switch on" : r.paused ? `on, paused by ${r.pausedBy ? `${you(r.pausedBy)}: ${r.pausedBy.line}` : r.pausedWhy ? `Filament: ${r.pausedWhy}` : "the person"}` : "on";
    const starter = r.last?.by === "agent" && r.last.startedBy ? `, started by ${you(r.last.startedBy)}` : r.last?.by === "you" ? ", the person's Run now" : "";
    const last = r.last ? ` · last run ${atWords(r.last.at, now)}${starter}: ${r.last.state}${r.last.state === "failed" && r.last.why ? ` (${r.last.why})` : ""}` : "";
    return `- ${r.id} "${r.title}" (${who}), ${when}, ${may}: ${state}${last}`;
  });
  const all = pausedSince ? [`Pause all is on since ${atWords(pausedSince, now)}${pausedBy ? `, by ${you(pausedBy)}: ${pausedBy.line}` : ", by the person"}: nothing starts by itself, in any Space, until the person resumes.`] : [];
  return ["Routines: each runs by itself only once the person switched it on. One of yours is changed with its id.", ...all, ...lines].join("\n");
}
