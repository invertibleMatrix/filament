// @ts-check
// What a chat is owed survives a restart (the nudge map of 11-10, a second opinion's too: "Nothing wakes a chat after a
// restart"). A chat is owed a wake by what came for its agent while no turn of it ran — a background command's end,
// the lines a watch caught, the time it set to come back, Filament's check-in, another agent's report, a letter — and
// by the timers that will bring one: its come_back, its idle check-in, a driving goal's next round. Each lived in
// memory alone but the reports and letters, which the chat's queue kept, and nothing woke the chat for those after a
// restart: what came waited for the person's next message, or was lost.
// Now each chat keeps what waits for it and its timers in its meta (`owedWakes`, written as each changes:
// `createOwedKeeper`), as it keeps its waiting reports (sessions/service.js `saveSubagentQueue`) and its running
// commands (agent/commands.js `runningRecord`); a goal's owed round keeps itself (service.js `goalOwed`). As Filament
// starts, memory's open gives it all back (`restoreOwed`) before any turn can begin — each by its id, so nothing is told
// twice, and each part by itself, so one that fails stays kept and takes no other with it — and once the turns the
// restart cut went on, the chats owed a wake are woken one after another, a few seconds apart (`wakeOwedAtStart`):
// never many at once on one account's quota, never one whose account is out of quota, never one no turn of Filament's
// starts in at any moment — the person stopped it, or archived it (server.js `liveSkip`, the rules the wake's gate
// keeps too). The start's own rules weigh what it gave back, and nothing that comes later (server.js `startSkip`): a
// chat the person left over a day ago (`staleWords`), every chat where they turned off going on after a restart, a
// team's chat. A come_back or an idle check-in whose time came while Filament was not running comes once then, the
// come_back saying it came late; one still to come waits for its time again — and wakes nothing where the start did
// not go on with its chat (server.js `heldAtStart`), which anything that comes since wakes as it would any chat. What
// was told never to wake its chat — the person's Stop of a command, a restart's word — stays so (`quiet`).
import { redactSecrets } from "../../core/redact.js";
import { idleCutText } from "./idle-wake.js";

/** How far apart the start wakes the chats it owes a wake: one account's quota is not spent by them all at once. */
export const OWED_STAGGER_MS = 3000;
/**
 * How long ago the person may have last written in a chat, and a start still wake it (11-10, `staleWords`): longer, what
 * it is owed is given back all the same and waits for their next message — a chat left a day or more is not woken to
 * spend a turn on it.
 */
export const OWED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How long the start holds the wakes asked for while it settles, at most, for the turns a restart cut to go on first
 * (FabeleHelper's of 11-10: one cut turn that compacts held every chat's wakes as long).
 */
export const OWED_HOLD_MAX_MS = 15_000;

/**
 * @typedef {import("../../adapters/tools/hands.js").UntoldItem} UntoldItem
 * @typedef {{ id: string, at: number, setAt: number, note: string }} KeptComeBack
 * @typedef {import("./idle-wake.js").KeptIdleWake} KeptIdleWake
 * @typedef {{ untold: UntoldItem[], comeBack: KeptComeBack | null, idle: KeptIdleWake | null }} Owed  what a chat is
 *   owed: what waits untold for its agents (hands.js `untoldOf`), its come-back (`comeBackKept`), its idle check-in
 *   (idle-wake.js `kept`)
 * @typedef {{ chainId: string, owed: Owed, goal: boolean, queued: boolean }} KeptOwed  a chat's, as Filament starts:
 *   `goal`, a driving goal's round owed; `queued`, a report or letter in its queue that wakes it
 * @typedef {"untold" | "comeBack" | "idle"} OwedPart  a part of what a chat keeps, each given back by itself
 */

/** Nothing owed. @returns {Owed} */
const nothing = () => ({ untold: [], comeBack: null, idle: null });
/** Whether a chat is owed nothing its meta keeps. @param {Owed} o */
const isNothing = (o) => !o.untold.length && !o.comeBack && !o.idle;
/** Whether an untold item wakes its chat: all but the person's Cancel of a come-back, and one told never to (hands.js `wakes`). @param {UntoldItem} x */
const wakes = (x) => x.kind !== "cancel" && x.quiet !== true;

/**
 * The keeper of what each chat is owed: `keep(chainId, owed)` writes it into the chat's meta where it changed — its
 * words (an exit's text, the lines a watch caught, a come-back's note) archived as messages, as the chat's waiting
 * reports are, encrypted at rest when the archive is; its commands' lines redacted, as the record of its running
 * commands is. Nothing owed clears it. `kept()` reads back every chat's as Filament starts, with the chats a goal's
 * round or a waking report or letter is owed to. `stop()`: Filament's stop clears what it holds and keeps nothing more,
 * so what was owed as it stopped stays kept. What fails is logged, and never fails the change that asked.
 * @param {{ archive: () => any, log?: (level: string, msg: string) => void }} o
 */
export function createOwedKeeper({ archive, log = () => {} }) {
  /** What was last written for each chat, as JSON ("" for nothing): a change that leaves it so writes nothing. @type {Map<string, string>} */
  const written = new Map();
  /**
   * Each chat's record as `kept` read it, until the start's own keep of the chat (`keep` with `failed`): the parts the
   * start could not give back are taken from it, and until then the record stands as it was read. @type {Map<string, any>}
   */
  const read = new Map();
  /**
   * The parts of a chat's record the start could not give back (`keep`'s `failed`), as they were read: memory never
   * held them, so a keep written from memory alone would erase them (the review of 11-11). @type {Map<string, Partial<Record<OwedPart, any>>>}
   */
  const ungiven = new Map();
  let stopped = false;
  /** @param {any} a @param {string} text */
  const hashOf = (a, text) => String(a.putMessage("user", { role: "user", content: [{ type: "text", text }] }).hash);
  /** @param {any} a @param {unknown} hash */
  const textOf = (a, hash) => {
    const m = hash ? a.getMessage(String(hash))?.message : null;
    return Array.isArray(m?.content) ? String(m.content.find((/** @type {any} */ b) => b?.type === "text")?.text ?? "") : "";
  };
  /** @param {any} a @param {Owed} o */
  const recordOf = (a, o) => ({
    ...(o.untold.length
      ? {
          untold: o.untold.map((x) => ({
            id: String(x.id),
            command: redactSecrets(String(x.command || "")),
            code: x.code ?? null,
            agent: x.agent ?? null,
            ...(x.kind ? { kind: x.kind } : {}),
            ...(x.text != null ? { textHash: hashOf(a, String(x.text)) } : {}),
            ...(x.capped === false ? { capped: false } : {}),
            ...(x.quiet === true ? { quiet: true } : {}),
            ...(x.ceiling ? { ceiling: String(x.ceiling) } : {}),
            ...(x.machine ? { machine: String(x.machine) } : {}),
            ...(x.why ? { why: String(x.why) } : {}),
          })),
        }
      : {}),
    ...(o.comeBack ? { comeBack: { id: o.comeBack.id, at: o.comeBack.at, setAt: o.comeBack.setAt, noteHash: hashOf(a, o.comeBack.note) } } : {}),
    ...(o.idle ? { idle: { ...o.idle, commands: o.idle.commands.map((c) => ({ id: c.id, command: redactSecrets(String(c.command || "")), startedAt: c.startedAt })) } } : {}),
  });
  /** A record read back; an item whose words are gone is left out. @param {any} a @param {any} r @returns {Owed} */
  const owedOf = (a, r) => {
    /** @type {UntoldItem[]} */
    const untold = [];
    for (const x of Array.isArray(r?.untold) ? r.untold : []) {
      if (!x?.id) continue;
      const text = x.textHash ? textOf(a, x.textHash) : null;
      if (x.textHash && !text) continue;
      untold.push({
        id: String(x.id),
        command: String(x.command || ""),
        code: Number.isInteger(x.code) ? x.code : null,
        agent: typeof x.agent === "string" ? x.agent : null,
        ...(x.kind ? { kind: x.kind } : {}),
        ...(text ? { text } : {}),
        ...(x.capped === false ? { capped: false } : {}),
        ...(x.quiet === true ? { quiet: true } : {}),
        ...(x.ceiling ? { ceiling: String(x.ceiling) } : {}),
        ...(x.machine ? { machine: String(x.machine) } : {}),
        ...(x.why ? { why: String(x.why) } : {}),
      });
    }
    const c = r?.comeBack;
    const note = c?.id ? textOf(a, c.noteHash) : "";
    const i = r?.idle;
    return {
      untold,
      comeBack: c?.id && note ? { id: String(c.id), at: Number(c.at) || 0, setAt: Number(c.setAt) || 0, note } : null,
      idle: i && Number.isFinite(Number(i.at))
        ? { id: Number(i.id) || 0, at: Number(i.at), ...(Number(i.since) > 0 ? { since: Number(i.since) } : {}), waitMin: Number(i.waitMin) || 0, streak: Number(i.streak) || 0, commands: Array.isArray(i.commands) ? i.commands : [] }
        : null,
    };
  };
  /**
   * A chat's record with the parts the start could not give back set in as they were read: its untold items ahead of
   * what came since, each once by its id; its come-back and its idle check-in, until one set since takes its place.
   * @param {string} chainId @param {Record<string, any>} rec
   */
  const withUngiven = (chainId, rec) => {
    const left = ungiven.get(chainId);
    if (!left) return rec;
    if (rec.comeBack) delete left.comeBack;
    if (rec.idle) delete left.idle;
    if (!Object.keys(left).length) return (ungiven.delete(chainId), rec);
    const { untold, ...timers } = left;
    const since = Array.isArray(rec.untold) ? rec.untold : [];
    return { ...rec, ...timers, ...(untold ? { untold: [...untold.filter((/** @type {any} */ x) => !since.some((/** @type {any} */ y) => y.id === x.id)), ...since] } : {}) };
  };
  return {
    /**
     * What `chainId` is owed now, kept where it changed. `failed`: the start's own keep of a chat it gave back to
     * (`restoreOwed`), naming the parts of what it kept that could not be given back, which stay kept as they were
     * read — for the next start, not written over by what memory holds without them. A keep that comes before that one
     * writes nothing: each part given back asks one at once (server.js: hands.js `onUntoldChange`, `onComeBackChange`,
     * the idle waker's `changed`), while the parts not given back yet are in no memory.
     * @param {string} chainId @param {Owed} owed @param {readonly OwedPart[]} [failed]
     */
    keep(chainId, owed, failed) {
      if (stopped) return;
      const a = archive();
      if (!a) return;
      const was = read.get(chainId);
      if (was && !failed) return;
      read.delete(chainId);
      const parts = Object.fromEntries((failed || []).filter((p) => was?.[p] != null).map((p) => [p, was[p]]));
      if (Object.keys(parts).length) ungiven.set(chainId, parts);
      const json = isNothing(owed) ? "" : JSON.stringify(owed);
      if ((written.get(chainId) ?? "") === json) return;
      try {
        if (!a.hasChain(chainId)) return void (written.delete(chainId), ungiven.delete(chainId));
        const rec = withUngiven(chainId, json ? recordOf(a, owed) : {});
        a.mergeMeta(chainId, { owedWakes: Object.keys(rec).length ? rec : undefined });
        written.set(chainId, json);
      } catch (/** @type {any} */ e) {
        log("warn", `sessions: session ${chainId}: what it is owed a wake for could not be kept for a restart (${e?.message || e})`);
      }
    },
    /** Every chat's as Filament last stopped, read back as it starts. @returns {KeptOwed[]} */
    kept() {
      const a = archive();
      if (!a?.owedWakes) return [];
      const all = a.owedWakes();
      const rows = all.map((/** @type {any} */ r) => {
        // A chat that kept something is kept again whatever the start gives back, so what it no longer holds goes.
        written.set(r.id, r.owed ? "\0read" : "");
        return { chainId: r.id, owed: r.owed ? owedOf(a, r.owed) : nothing(), goal: !!r.goal, queued: !!r.queued };
      });
      // Once every chat's was read: a read that fails midway gives nothing back, and holds no chat's keep for a
      // start's own that will not come.
      for (const r of all) if (r.owed) read.set(r.id, r.owed);
      return rows;
    },
    stop() {
      stopped = true;
    },
  };
}

/**
 * What the chats kept, given back as Filament starts, before any turn can begin: what waited untold for each — to its
 * main agent, by each one's id; a check-in of Filament's told before the stop, whose words say the command still runs,
 * in the restart's end of it instead (`idleCutText`, told as an end is) —, its come-back — waiting for its time again,
 * or told now where it came while Filament was not running —, its idle check-in, armed again at its time, and a goal's
 * round owed. Then each chat's keeping is
 * asked again (`kept`), so what it no longer holds goes from its meta. → the chats owed a wake now: something that
 * wakes waits untold for them, a come-back came late, a goal's round or a waking report or letter is owed — one whose
 * goal's drive ran out of time while Filament was down (`oweGoal` false) not for that. Whether each is woken is the
 * sweep's to say (`wakeOwedAtStart`, `staleWords`). Each part is given back by itself (the review of 11-11: one that
 * failed took those after it with it, and the keep that followed wrote them all off the disk): one that fails is
 * logged and named to the chat's keeping (`kept`'s `failed`), which leaves it as it was kept, for the next start; the
 * other parts, and the other chats, go on. A goal's round that fails stays owed in the chat's meta, which only its
 * drive writes.
 * @param {readonly KeptOwed[]} rows
 * @param {{ keepUntold: (chainId: string, items: UntoldItem[]) => void, keepComeBack: (chainId: string, c: KeptComeBack) => "armed" | "due" | null,
 *   restoreIdle: (chainId: string, k: KeptIdleWake) => boolean, oweGoal: (chainId: string) => boolean | void,
 *   kept: (chainId: string, failed: OwedPart[]) => void, log?: (level: string, msg: string) => void }} o
 * @returns {string[]}
 */
export function restoreOwed(rows, { keepUntold, keepComeBack, restoreIdle, oweGoal, kept, log = () => {} }) {
  /** @type {string[]} */
  const owed = [];
  for (const r of rows) {
    let due = r.queued;
    /** @type {OwedPart[]} */
    const failed = [];
    /**
     * One part given back: where it throws, said in the log, and named for the chat's keeping where the keeper keeps it.
     * @param {string} what @param {OwedPart | null} name @param {() => void} back
     */
    const give = (what, name, back) => {
      try {
        back();
      } catch (/** @type {any} */ e) {
        if (name) failed.push(name);
        log("warn", `sessions: session ${r.chainId}: what it was owed a wake for as Filament stopped could not be given back (${e?.message || e}): ${what}, which stays kept for the next start`);
      }
    };
    if (r.owed.untold.length)
      give("what waited untold for its agent", "untold", () => {
        const untold = r.owed.untold.map((x) => (x.kind === "idle" ? { ...x, kind: /** @type {const} */ ("exit"), text: idleCutText() } : x));
        keepUntold(r.chainId, untold);
        if (untold.some(wakes)) due = true;
      });
    const comeBack = r.owed.comeBack;
    if (comeBack) give("its come-back", "comeBack", () => void (keepComeBack(r.chainId, comeBack) === "due" && (due = true)));
    const idle = r.owed.idle;
    if (idle) give("its idle check-in", "idle", () => void restoreIdle(r.chainId, idle));
    if (r.goal) give("its goal's round", null, () => void (oweGoal(r.chainId) !== false && (due = true)));
    if (due) owed.push(r.chainId);
    try {
      kept(r.chainId, failed);
    } catch {}
  }
  return owed;
}

/**
 * Why a chat owed a wake as Filament starts is left for the person's next message (11-10; FabeleHelper's: one cutoff, at
 * the sweep, for every wake the start holds — an idle check-in come due, a report of a sub-agent the stop cut —, measured
 * from the person, not from Filament's own turns): they last wrote in it over `maxAgeMs` ago (`personAt`), and no
 * come-back the agent set came due within it (`comeBackAt`). A chat that kept no moment of the person's — one from
 * before chats kept it — is measured from its newest turn that Filament did not start by itself (`turnAt`, sessions/
 * service.js `personLast`), and its words say that, not that the person wrote then (the review of 11-11: it was
 * measured from the chat's newest turn, which Filament's own wakes moved). A chat with no turn of the person's — one
 * Filament made for a routine's run, an ask's, a thread — is measured from when it began (`beganAt`, its first turn):
 * the person never wrote in it, and its own turns make it no fresher either. Null where it is woken, or nothing says
 * when.
 * @param {{ personAt: number, turnAt?: number, beganAt?: number, comeBackAt?: number, now: number, maxAgeMs?: number }} o
 */
export function staleWords({ personAt, turnAt = 0, beganAt = 0, comeBackAt = 0, now, maxAgeMs = OWED_MAX_AGE_MS }) {
  const wrote = Number(personAt) || 0;
  const theirs = wrote || Number(turnAt) || 0;
  const newest = Math.max(theirs || Number(beganAt) || 0, Number(comeBackAt) || 0);
  if (!(newest > 0) || now - newest <= maxAgeMs) return null;
  const from = wrote ? "the person last wrote in it" : theirs ? "its newest turn that Filament did not start by itself began" : "the chat began, with no turn of the person's in it";
  return `${from}, and any come-back it set came due, over ${Math.round(maxAgeMs / 3_600_000)} h ago (${Math.floor((now - newest) / 3_600_000)} h)`;
}

/** @param {number} ms */
const sleepFor = (ms) =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

/**
 * Wake each chat Filament owes a wake as it starts, one after another `staggerMs` apart, so many chats on one account's
 * quota do not start at once. Each is asked at its turn whether it is skipped (`skip`: why, or null) — the person
 * stopped its newest turn or archived it, the start does not go on with it and nothing new came for it, or its account
 * is out of quota, which a wall an earlier wake ran into says too —, and what came then waits for its next turn, said
 * in the log. `wake` is the waker's: it asks again whether the chat is still
 * owed, and sends it one turn at most — false where nothing that wakes it waits any more (a kept report of a kind the
 * restart dropped, a letter in a chat with no turn yet), which is recorded so, not as woken; and so is a wake that
 * throws, with why. `stop`: Filament stopping, which ends the sweep. → each chat's outcome.
 * @param {{ chats: readonly string[], skip: (chainId: string) => string | null, wake: (chainId: string) => boolean | void, staggerMs?: number,
 *   sleep?: (ms: number) => Promise<unknown>, stop?: () => boolean, log?: (level: string, msg: string) => void }} o
 * @returns {Promise<{ chainId: string, woke: boolean, why?: string }[]>}
 */
export async function wakeOwedAtStart({ chats, skip, wake, staggerMs = OWED_STAGGER_MS, sleep = sleepFor, stop = () => false, log = () => {} }) {
  /** @type {{ chainId: string, woke: boolean, why?: string }[]} */
  const out = [];
  for (const [i, chainId] of [...new Set(chats)].entries()) {
    if (i) await sleep(staggerMs);
    if (stop()) break;
    /** @type {string | null} */
    let why = null;
    try {
      why = skip(chainId);
    } catch (/** @type {any} */ e) {
      why = `what it stands on could not be read (${e?.message || e})`;
    }
    if (why) {
      log("info", `sessions: ${chainId} was owed a wake as Filament started, and is not woken: ${why}. Its next turn carries what came`);
      out.push({ chainId, woke: false, why });
      continue;
    }
    try {
      if (wake(chainId) === false) {
        const nothing = "nothing that wakes it waits for it any more";
        log("info", `sessions: ${chainId} was owed a wake as Filament started, and ${nothing}: no turn sent`);
        out.push({ chainId, woke: false, why: nothing });
        continue;
      }
    } catch (/** @type {any} */ e) {
      const failed = `its wake could not be sent (${e?.message || e})`;
      log("warn", `sessions: ${chainId} was owed a wake as Filament started, and ${failed}. Its next turn carries what came`);
      out.push({ chainId, woke: false, why: failed });
      continue;
    }
    out.push({ chainId, woke: true });
  }
  return out;
}
