// @ts-check
// What every importer shares: the sink that writes a chat's turns into the archive, the shape of a turn, the line
// reader a big file is read with, and the small helpers. Every archive write goes through the sink so a dry run can
// count where a real one writes, and so a chat's own times land in started_at / last_at / ended_at (the archive's
// clock is injectable; it is swapped for the length of each call).
import { open } from "node:fs/promises";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { projectFolderOf } from "../../project-folder.js";
import { pinHashOf } from "../../../core/fold.js";
import { sha256 } from "../../../core/hash.js";
import { redactSecrets } from "../../../core/redact.js";

/** @type {(p?: any) => void} */
export const noop = () => {};
export const hashOf = (m) => sha256(JSON.stringify(m === undefined ? null : m)); // the same hash Archive.putMessage computes
/** A path with a leading `~` as the person's home folder. @param {string} p @returns {string} */
export const expandHome = (p) => (p ? String(p).replace(/^~(?=$|[\\/])/, homedir()) : p);
export const toMs = (t) => {
  if (t == null || t === "") return null;
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number") return Number.isFinite(t) ? t : null;
  const n = Date.parse(t);
  return Number.isNaN(n) ? null : n;
};
export const parseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
export const pct = (done, total) => (total ? Math.round((done / total) * 100) : 100);
export const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
/** How many characters of a chat's first message a list row shows. */
export const PREVIEW_CHARS = 80;
/** A message's first line, as a list row's label. @param {string} text */
export const previewOf = (text) => {
  const line = String(text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
};
/**
 * What a run brought, counted from nothing. @param {Record<string, any>} [extra]
 * `empty`: the chats read whole that held no turn, each with how big it was (sources.js `noteEmpty`). `chains` are
 * the person's chats, `kin` the sub-agents' sessions written under them. `long`: the lines past `LINE_MAX_BYTES`,
 * each with its file, its number there and its size, left out while the rest of its chat came in.
 * @returns {{ chains: number, newChains: number, kin: number, newKin: number, turns: number, newTurns: number, messages: number, compactions: number, links: number, skipped: number, errors: any[], empty: { key: string, mark: number }[], long: { file: string, line: number, bytes: number }[], [k: string]: any }}
 */
export const summary = (extra = {}) => ({
  chains: 0,
  newChains: 0,
  kin: 0,
  newKin: 0,
  turns: 0,
  newTurns: 0,
  messages: 0,
  compactions: 0,
  links: 0,
  skipped: 0,
  errors: [],
  empty: [],
  long: [],
  ...extra,
});
// The secrets filter runs before every write (architecture §1.7); a message it cannot rewrite is stored as is.
export function scrub(msg, redact) {
  if (!redact || msg == null) return msg;
  try {
    return redactSecrets(msg);
  } catch {
    return msg;
  }
}

/**
 * A turn's numbers, as an agent's file tells them, in the shape Filament keeps for a turn of its own
 * (core/turn-facts.js): the model, the tokens of every response summed, what the last request held, when it began
 * and ended, how the last response stopped, and the failure's words where the service failed it. No cost: Filament
 * paid for none of it.
 * @param {{ calls: number, model?: string | null, tokens: { input: number, output: number, cacheRead: number, cacheWrite: number }, held?: number | null, startedAt?: number | null, endedAt?: number | null, stopReason?: string | null, error?: string | null }} t
 */
export function turnFacts({ calls, model = null, tokens, held = null, startedAt = null, endedAt = null, stopReason = null, error = null }) {
  return {
    v: 1,
    requests: 1,
    calls,
    model,
    models: null,
    upstream: null,
    tokens: { ...tokens },
    held: held || null,
    costUsd: null,
    listUsd: null,
    startedAt,
    endedAt,
    stopReason: error ? null : stopReason,
    context: null,
    memory: null,
    view: null,
    failovers: 0,
    errors: error ? 1 : 0,
    error: error || null,
    errorDetail: null,
    limit: null,
    needsRoom: null,
    signIn: null,
    agentSession: null,
    changes: [],
    changesMore: 0,
  };
}

/** The words between a tag's two ends, or null. @param {string} text @param {string} tag */
export const inTag = (text, tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? null;
/** How a background task ended, in Filament's three words (the page's tones); the agent's own word where it has another. */
const TASK_STATUS = /** @type {Record<string, string>} */ ({ completed: "completed", failed: "failed", errored: "failed", killed: "stopped", stopped: "stopped" });
/**
 * A background task's end, as an agent hands it to its model (`<task-notification>`, Claude Code's shape): the
 * task's id, how it ended, what it was. @param {string} text
 * @returns {{ id: string, status: string, summary: string }}
 */
export function taskOfNotice(text) {
  const status = (inTag(text, "status") || "").trim().toLowerCase();
  return {
    id: (inTag(text, "task-id") || "").trim().slice(0, 120),
    status: (TASK_STATUS[status] || status).slice(0, 40),
    summary: (inTag(text, "summary") || "").trim().slice(0, 600),
  };
}

/**
 * What a turn that is over and never answered answers with: how it ended, in Filament's words. Words alone, valid in
 * every wire format.
 * @param {string} agent  the agent's name @param {boolean} stopped  the person stopped it
 */
export const unansweredLine = (agent, stopped) => (stopped ? `(turn stopped in ${agent})` : `(the turn ended in ${agent} with no answer)`);

/** An import the person stopped: the job's panel says stopped, never failed (`aborted`, as the engine's jobs). */
export function stopped() {
  return Object.assign(new Error("the import was stopped"), { aborted: true });
}
/** @param {AbortSignal | null | undefined} signal */
export function throwIfStopped(signal) {
  if (signal?.aborted) throw stopped();
}

/**
 * A pause the server answers other requests in: an import writes turn after turn on the server's own thread, and
 * without one a long file would hold every other request until it ends. `breathe()` lets the waiting ones run when
 * the last pause is more than `every` ms old. @param {number} [every]
 */
export function breather(every = 20) {
  let last = Date.now();
  return async () => {
    if (Date.now() - last < every) return;
    await new Promise((r) => setImmediate(r));
    last = Date.now();
  };
}

/**
 * The longest line an import reads: a string that long is half what V8 can make one, and a line past it would fail its
 * whole chat. One longer is passed over as it streams by, never held, and named in the import's report (`long`).
 */
export const LINE_MAX_BYTES = 256 << 20;

/**
 * A file's lines, read a block at a time: a session file can be gigabytes (one line alone tens of megabytes: a
 * screenshot in a tool result), far past what one string holds. Each line comes with the offset just behind it, so
 * progress is bytes read. A last line with no newline is given too (a file still being written ends in half a line;
 * the caller's parser passes it). A line past `maxLine` bytes is passed over as it streams by and never held: it
 * comes as `line: null` with `long`, its number in the file (from 1) and its size, and the lines after it as ever.
 * @param {string} file @param {{ block?: number, maxLine?: number }} [o]
 * @returns {AsyncGenerator<{ line: string | null, pos: number, long?: { line: number, bytes: number } }>}
 */
export async function* readLines(file, { block = 1 << 20, maxLine = LINE_MAX_BYTES } = {}) {
  const fd = await open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(block);
    /** @type {Buffer[]} the pieces of a line that spans blocks */
    let carry = [];
    /** How many bytes those pieces hold. */
    let held = 0;
    /** The size so far of a line past `maxLine`, passed over until its newline; null while none is. @type {number | null} */
    let passing = null;
    let lines = 0;
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, block, pos);
      if (!bytesRead) break;
      const base = pos;
      pos += bytesRead;
      let start = 0;
      for (;;) {
        const nl = buf.indexOf(10, start);
        if (nl < 0 || nl >= bytesRead) break;
        const piece = buf.subarray(start, nl);
        const bytes = (passing ?? held) + piece.length;
        lines++;
        start = nl + 1;
        if (passing != null || bytes > maxLine) yield { line: null, pos: base + start, long: { line: lines, bytes } };
        else yield { line: carry.length ? Buffer.concat([...carry, piece]).toString("utf8") : piece.toString("utf8"), pos: base + start };
        carry = [];
        held = 0;
        passing = null;
      }
      // The block is used again by the next read: what is left of it is copied out, unless its line is past the most a
      // line is read to, which is counted and let go.
      const rest = bytesRead - start;
      if (!rest) continue;
      if (passing == null && held + rest > maxLine) {
        passing = held;
        carry = [];
        held = 0;
      }
      if (passing != null) passing += rest;
      else {
        carry.push(Buffer.from(buf.subarray(start, bytesRead)));
        held += rest;
      }
    }
    if (passing != null) yield { line: null, pos, long: { line: lines + 1, bytes: passing } };
    else if (carry.length) yield { line: Buffer.concat(carry).toString("utf8"), pos };
  } finally {
    await fd.close();
  }
}

/** The client every chat an import makes, and every turn written into one, names: the harness's (IM-58). */
const HERE = "harness";

export class Sink {
  #opts = new Map();
  /**
   * Where a chat's turns went, by the chat's id, once its writer has ended: `into` the chat that took them (the chat
   * itself, or its fork when the person went on with it here), `held` when none could take them (the chat the person
   * went on with, and the file brought nothing past it), `dropped` when its fork was deleted (IM-60, IM-61).
   * @type {Map<string, { into: any, held: boolean, dropped: boolean }>}
   */
  #went = new Map();
  /** @param {any} archive @param {{ dryRun?: boolean, redact?: boolean, agent?: string | null }} [o] */
  constructor(archive, { dryRun = false, redact = true, agent = null } = {}) {
    this.a = archive;
    this.dryRun = dryRun;
    this.redact = redact;
    // The agent's own name, in a fork's title: "(went on in Codex)".
    this.agent = agent;
    // `chains` are the person's chats; a sub-agent's session written under one is counted apart (`kin`), so a run
    // says how many chats it brought. Turns and messages count both.
    this.stats = { chains: 0, newChains: 0, kin: 0, newKin: 0, turns: 0, newTurns: 0, messages: 0, compactions: 0, links: 0 };
  }
  #at(ts, fn) {
    if (ts == null || this.dryRun) return fn();
    const prev = this.a.now;
    this.a.now = () => ts;
    try {
      return fn();
    } finally {
      this.a.now = prev;
    }
  }
  /**
   * The chain a chat's key names, made the first time the key is seen. It names no model: the other agent's is no
   * route of Filament's, so the session is the person's to pick one for, and each turn keeps the one that answered it.
   * A chat made now is the harness's own (IM-58): its client is the harness's and it is marked native, as a chat
   * made in the harness is, so it opens with the harness's settings, compaction and line. A chat an earlier import
   * made keeps what it was. One the person went on with here keeps its title too: it is theirs now. A chat made
   * before is read, not touched: its last activity moves only where its turns are written (`close`), so one the person
   * went on with here keeps theirs, and the sidebar keeps it where they left it.
   * @param {string} key
   * @param {{ cwd?: string | null, project?: string | null, title?: string | null, meta?: Record<string, any> | null, startedAt?: number | null, kind?: string | null }} [o]
   */
  chain(
    key,
    {
      cwd = null,
      project = null,
      title = null,
      meta = null,
      startedAt = null,
      kind = null,
    } = {},
  ) {
    const [seen, made] = kind === "subagent" ? /** @type {const} */ (["kin", "newKin"]) : /** @type {const} */ (["chains", "newChains"]);
    this.stats[seen]++;
    if (this.dryRun) {
      this.stats[made]++;
      return { id: `dry:${key}`, key, project_id: null, title, turns: 0, isNew: true, dry: true };
    }
    const id = this.a.chainIdForKey(key);
    // A chat that worked in a worktree stands in its main folder's project and keeps its own folder
    // (HarnessV4_Git_Plan GW-D46, GW-D47).
    const home = cwd && !project ? projectFolderOf(cwd) : cwd;
    const own = home !== cwd ? { cwd } : {};
    const opts = !id ? { cwd: home, project, client: HERE, meta: { ...(meta || {}), ...own, native: true }, kind } : { cwd: home, project, client: null, meta, kind };
    this.#opts.set(key, opts);
    const c = id ? { ...this.a.getChain(id), isNew: false } : this.#at(startedAt, () => this.a.chainForKey(key, opts));
    if (c.isNew) this.stats[made]++;
    if (title && title !== c.title && !this.#held(c)) {
      this.a.setTitle(c.id, title);
      c.title = title;
    }
    return c;
  }
  /**
   * Whether the person went on with a chat here (IM-60): it has a turn after the newest one the agent's copy holds
   * (`importedThrough`, which every writer's end keeps). A chat with no such number was never written so.
   * @param {any} chain
   */
  #held(chain) {
    if (chain?.dry || chain?.meta?.importedThrough == null) return false;
    const through = Number(chain.meta.importedThrough) || 0;
    return this.a.getTurns(chain.id, { from: through + 1, to: through + 1 }).length > 0;
  }
  /**
   * The fork the agent's newer turns of a chat go into, when the chat cannot take them (IM-61): the chat through turn
   * `at` (the same messages, none copied), named for what it is, marked as the chat's fork so a later Sync finds it
   * again by its key, and one the person deleted is not made again. A chat with no turn to start from gives a chat of
   * the file's turns alone. Null when the person deleted this fork.
   * @param {any} chain  the chat that cannot take them @param {number} at  the last turn both have, with an answer
   * @param {Record<string, any> | null} meta  what the import keeps on the chat (`chain`'s, as given to `chain`)
   */
  #fork(chain, at, meta) {
    const key = `${chain.key}~${at}`;
    const have = this.known(key);
    if (have) return have;
    const forks = Array.isArray(chain.meta?.syncForks) ? chain.meta.syncForks : [];
    if (forks.includes(key)) return null;
    const base = chain.title || (this.a.firstUserText?.(chain.id) || "").slice(0, 48) || "untitled";
    const title = `${base.replace(/ \(went on in [^)]*\)$/, "")} (went on in ${this.agent || "the agent"})`;
    let made = at >= 1 ? this.a.forkChain(chain.id, { atTurn: at, key, title }) : null;
    if (!made?.id) {
      made = this.a.chainForKey(key, { project: chain.project_id, client: chain.client, kind: "fork" });
      this.a.setTitle(made.id, title);
    }
    // A fork is what its chat is: the harness's where the chat is, an earlier import's where the chat is one.
    const { native, ...kept } = meta || {};
    this.a.mergeMeta(made.id, { ...kept, ...(chain.meta?.native === true ? { native: true } : {}), syncOf: { chat: chain.id, at }, importedThrough: at });
    this.a.mergeMeta(chain.id, { syncForks: [...forks, key] });
    this.stats.newChains++;
    return this.a.getChain(made.id);
  }
  /** Where what is written of a chat goes now (`#went`): the chat itself, its fork, or nowhere (null). @param {any} chain */
  #into(chain) {
    const w = this.#went.get(chain.id);
    return !w ? chain : w.held || w.dropped ? null : w.into;
  }
  /**
   * A chat forked from another, whose file holds its own turns alone: the chain Filament makes of a fork — the
   * source's turns through `atTurn` (the same messages, none copied), with what the fork's file adds written after
   * them (`writer`'s `after`). Made once, the first time the key is seen. False where the source has no such finished
   * turn, where the key is taken, and on a dry run: the fork is then a chat of its own turns.
   * @param {string} key @param {any} source  the chain it was forked from @param {number} atTurn
   * @param {{ meta?: Record<string, any> | null, at?: number | null }} [o]  the fork's meta (a fork takes none of
   *   what its source's file said of itself); when it was made
   */
  fork(key, source, atTurn, { meta = null, at = null } = {}) {
    if (this.dryRun || !source || !(atTurn >= 1)) return false;
    const made = this.#at(at, () => this.a.forkChain(source.id, { atTurn, key }));
    if (!made?.id) return false;
    // A fork is what its source is: the harness's where the source is (IM-58).
    const native = source.meta?.native === true ? { native: true } : {};
    if (meta || native.native) this.a.mergeMeta(made.id, { ...(meta || {}), ...native });
    this.stats.newChains++;
    return true;
  }
  /** The chain a key names, when Filament has it; null when it has none (and on a dry run). @param {string} key */
  known(key) {
    return this.dryRun ? null : this.a.chainsWithKeyPrefix(key).find((/** @type {any} */ c) => c.key === key) || null;
  }
  /**
   * What a chat's file told only at its end, once its turns are in: its title, and `mark`, the size (or
   * time) the source had as it was read. A chat whose source shows a bigger mark later has grown; one stopped midway
   * has none, so the next run goes on with it. `at` = the chat's last activity, the same on every run. `taken`: how
   * many of its turns its file did not hold, written from the file of the chat it was forked from.
   * @param {any} chain @param {{ at?: number | null, title?: string | null, mark?: number | null, taken?: number | null }} o
   */
  close(chain, { at = null, title = null, mark = null, taken = null } = {}) {
    if (this.dryRun) return;
    // The mark is the chat's, whichever chat took its turns: Import's list reads it on the chat its key names.
    if (mark != null) this.a.mergeMeta(chain.id, { mark });
    // The rest is the chat's that took the turns: none where the person went on with the chat and nothing went to a fork.
    const into = this.#into(chain);
    if (!into) return;
    const opts = this.#opts.get(chain.key) || {};
    const named = title && into.meta?.syncOf ? `${title} (went on in ${this.agent || "the agent"})` : title;
    if (named && named !== into.title) {
      this.a.setTitle(into.id, named);
      into.title = named;
    }
    if (at != null) this.#at(at, () => this.a.chainForKey(into.key, { ...opts, client: null }));
    if (taken != null) this.a.mergeMeta(into.id, { taken });
  }
  /**
   * The chat's turns, written in the chat's order: `put(turn)` per turn, where a turn is
   * `{ user, work: [msg…], final?, at, workAt, endAt, model, cut?, meta?, visuals? }`; `visuals` are pictures drawn in
   * it, kept on the turn as a visual of Filament's is (archive.js `addTurnVisual`). `meta` is what Filament keeps on a
   * turn of its own, so the chat reads as one made here: its wire format, whether it is a command's
   * (`command`, and the agent that answered it: `commandBy`) or one the agent began by itself (`own`), that the person
   * stopped it (`stopped`), that it failed (`failed`), that the agent compacted its own context in it and kept no
   * summary (`ownCompaction`), and its numbers (`facts`). Turns already in the chain are matched by position and by
   * the message's identity, as the archive tells one message from another (its words: `pinOfTurn`), so a picture
   * whose file is gone since the last read loses no turn its place. A chat's file only ever grows: a matched turn
   * only gains the work and final it was missing, and its marks as the file has them now; past the chat's last turn,
   * turns are appended.
   * A message sent again while its turn had no answer is that turn going on, as the archive keeps a resent message
   * (`beginTurn`): a turn with no answer is held until the next one tells, and the two are written as one — the
   * work of both, the answer, the model and the marks of the second. `end()` writes a turn still held and gives the
   * number in the chain of every turn given, in the order given: what a place in the chat is said in (a
   * compaction's), since a count of the source's turns is no number of the chain's. `after`: the chain's turns up
   * to that number are not the file's (a fork's, taken from its source), so the file's first turn is the one after.
   * A turn is written with its chat's client: the harness's in a chat an import makes now (IM-58).
   * A chat the person went on with here takes nothing more from the file (IM-60): the file's turns it already has are
   * passed over, and at the first the chat cannot take — one past the newest the agent's copy held when it was last
   * read, or one the chat has another turn in the place of — they go to the chat's fork instead (IM-61), from the
   * last turn both have with an answer: the turns read since that one are written there again first. A chat written
   * before `importedThrough` was kept is told by its turns alone: where the file and the chat first differ while the
   * chat has a turn there, the file's turns go to the fork, never after the person's.
   * @param {any} chain @param {{ after?: number }} [o] @returns {{ put: (t: any) => void, end: () => number[] }}
   */
  writer(chain, { after = 0 } = {}) {
    /** The chat the turns go into now: the chat, or its fork. */
    let into = chain;
    /** @param {any} c */
    const turnsOf = (c) => (c.dry ? [] : this.a.getTurns(c.id).filter((/** @type {any} */ t) => t.n > after));
    let existing = turnsOf(chain);
    let goneOn = this.#held(chain);
    let through = Number(chain.meta?.importedThrough) || 0;
    let dropped = false;
    let aligned = true;
    let i = 0;
    /** The newest place the file's turns reached in `into`, the newest of them whose turn there has an answer, and the turns read since that one. */
    let newest = 0;
    let answered = after;
    /** @type {{ t: any, at: number[] }[]} */
    let since = [];
    const meta = this.#opts.get(chain.key)?.meta ?? null;
    // The chat cannot take what comes now: on to its fork, the turns read since the last one both have written there
    // first. False when the person deleted that fork: nothing more of the file is written.
    const move = () => {
      const fork = this.#fork(into, answered, meta);
      if (!fork) {
        dropped = true;
        this.#went.set(chain.id, { into, held: false, dropped: true });
        return false;
      }
      into = fork;
      existing = turnsOf(fork);
      goneOn = this.#held(fork);
      through = Number(fork.meta?.importedThrough) || 0;
      aligned = true;
      i = answered - after;
      newest = answered;
      const again = since;
      since = [];
      for (const s of again) settle(s.t, s.at);
      return !dropped;
    };
    /** A turn, its messages scrubbed → its number in the chain. @param {any} t @param {number[]} given @returns {number} */
    const write = (t, given) => {
      const { user, work, final } = t;
      if (this.dryRun) {
        i++;
        this.stats.turns++;
        this.stats.newTurns++;
        this.stats.messages += 1 + work.length + (final !== undefined ? 1 : 0);
        return i;
      }
      if (dropped) return 0;
      const mine = existing[i];
      const same = aligned && !!mine && this.a.pinOfTurn(mine) === pinHashOf(user);
      const place = after + i + 1;
      if ((goneOn && !(same && place <= through)) || (!goneOn && aligned && mine && !same)) return move() ? write(t, given) : 0;
      const at = i++;
      this.stats.turns++;
      newest = place;
      // A turn of a chat the person went on with: the chat has it already, and nothing is written into the chat.
      if (goneOn) {
        if (mine.ended_at != null) {
          answered = place;
          since = [];
        } else since.push({ t, at: given });
        return mine.n;
      }
      const have = same ? existing[at] : null;
      if (!have) aligned = false;
      let turnId = have?.id,
        n = have?.n;
      const m = t.meta || {};
      if (!have) {
        const r = this.#at(t.at, () =>
          this.a.beginTurn(into.id, { model: t.model ?? null, userMessage: user, client: into.client ?? null, format: m.format ?? null, command: !!m.command, own: m.own ?? null }),
        );
        turnId = r.turnId;
        n = r.n;
        if (r.isNew) {
          this.stats.newTurns++;
          this.stats.messages++;
        }
      } else if (t.model && have.model !== t.model) this.a.setTurnModel(turnId, t.model); // read before its answer was written: who answered is known now
      if (work.length) {
        const before = (have ?? this.a.getTurn(turnId)).work.length;
        // A turn an earlier run closed short (`cut`) gets its work laid out again in order, so the call that stood as
        // its final comes before the result that answered it — only when the file still holds at least what the
        // archive has; a file that shrank (rotated, truncated) never takes work away.
        const all =
          have?.meta?.cut && work.length >= before
            ? this.#at(t.workAt ?? t.at, () => this.a.setWork(turnId, work))
            : this.#at(t.workAt ?? t.at, () => this.a.addWork(turnId, work));
        this.stats.messages += Math.max(0, all.length - before);
      }
      // A different final re-finishes the turn: the session grew an answer where an earlier run saw a loop cut short
      // (its tool call, then the final, has moved into the work above).
      if (final !== undefined && !(have && have.final_hash === hashOf(final))) {
        this.#at(t.endAt ?? t.at, () => this.a.finishTurn(turnId, { finalMessage: final }));
        this.stats.messages++;
      }
      // The pictures drawn in it, kept on the turn as Filament keeps its own; one the turn lists already is not kept
      // twice. One over what the archive keeps of a message is not kept: its call's line stays (Visuals plan VC-83).
      const listed = new Set((have?.meta?.visuals || []).map((/** @type {any} */ v) => v?.id));
      for (const v of t.visuals) if (!listed.has(v.id)) this.#at(t.workAt ?? t.at, () => this.a.addTurnVisual(turnId, v));
      if (!!t.cut !== !!have?.meta?.cut) this.a.mergeTurnMeta(turnId, { cut: t.cut ? true : undefined });
      // The marks a turn can gain or lose as its chat goes on: a turn that failed went on, one was stopped, its numbers grew.
      const was = have?.meta || {};
      /** @type {Record<string, any>} */
      const marks = {};
      for (const k of ["facts", "stopped", "failed", "own", "commandBy", "ownCompaction"]) if (JSON.stringify(m[k] ?? null) !== JSON.stringify(was[k] ?? null)) marks[k] = m[k] ?? undefined;
      if (Object.keys(marks).length) this.a.mergeTurnMeta(turnId, marks);
      // A turn both have: the newest with an answer is where a fork would start.
      if (have && (have.ended_at != null || final !== undefined)) {
        answered = place;
        since = [];
      } else if (have) since.push({ t, at: given });
      return n;
    };
    /** @type {number[]} the chain's number of each turn given */
    const ns = [];
    let given = 0;
    /** @type {{ t: any, pin: string, at: number[] } | null} a turn with no answer, and which of the given turns it is */
    let held = null;
    const settle = (/** @type {any} */ t, /** @type {number[]} */ at) => {
      const n = write(t, at);
      for (const k of at) ns[k] = n;
    };
    const flush = () => {
      if (!held) return;
      const h = held;
      held = null;
      settle(h.t, h.at);
    };
    return {
      put: (turn) => {
        let t = {
          ...turn,
          user: scrub(turn.user, this.redact),
          work: (turn.work || []).map((/** @type {any} */ m) => scrub(m, this.redact)),
          final: turn.final === undefined ? undefined : scrub(turn.final, this.redact),
          visuals: (turn.visuals || []).map((/** @type {any} */ v) => scrub(v, this.redact)),
        };
        const pin = pinHashOf(t.user);
        let at = [given++];
        if (held && held.pin === pin) {
          t = { ...t, at: held.t.at, model: t.model ?? held.t.model ?? null, work: [...held.t.work, ...t.work], visuals: [...held.t.visuals, ...t.visuals] };
          at = [...held.at, ...at];
          held = null;
        } else flush();
        if (t.final === undefined) held = { t, pin, at };
        else settle(t, at);
      },
      end: () => {
        flush();
        // Where the turns went, for the chat's compactions and its close; and how far the agent's copy reaches in the
        // chat that took them, so a turn the person adds after it marks the chat as theirs.
        if (!this.dryRun && !dropped) {
          this.#went.set(chain.id, { into, held: goneOn, dropped: false });
          if (!goneOn && newest > 0) this.a.mergeMeta(into.id, { importedThrough: Math.max(newest, through) });
        }
        return ns;
      },
    };
  }
  /**
   * A whole chat's turns at once (a source that holds them in memory already) → each one's number in the chain.
   * @param {any} chain @param {any[]} turns
   */
  turns(chain, turns) {
    const w = this.writer(chain);
    for (const t of turns) w.put(t);
    return w.end();
  }
  // A compaction is recorded once per (summary text, kind) on a chain → true when written. `method` and `detail` are
  // the row's own: "summary" for one whose writer is not known, "own" with `detail.by` (and `during`, `cutAfter`
  // where it fell inside a turn) for one the agent made of its own context, as Filament keeps one of an agent it runs.
  // `text` null: the agent kept no summary a reader can open (Codex seals its own); the row says the turns were
  // compacted and stands for none of them, as Filament keeps one an agent handed no summary of. Such a row is
  // recorded once per place (`toTurn`).
  /**
   * @param {any} chain
   * @param {{ fromTurn?: number, toTurn?: number | null, text?: string | null, kind?: string, at?: number | null, method?: string, detail?: Record<string, any> | null }} [o]
   */
  compaction(chain, { fromTurn = 1, toTurn = null, text, kind = "compaction", at = null, method = "summary", detail = null } = {}) {
    if (this.dryRun) {
      this.stats.compactions++;
      return true;
    }
    // The chat's turns went to its fork, or nowhere: so does its compaction. Never into a chat the person went on with.
    const into = this.#into(chain);
    if (!into) return false;
    chain = into;
    const rows = this.a.getCompactions(chain.id);
    if (text == null) {
      if (rows.some((/** @type {any} */ c) => c.summary_hash == null && c.method === method && c.kind === kind && Number(c.to_turn) === Number(toTurn))) return false;
    } else {
      const h = hashOf({ role: "system", content: String(text) });
      if (rows.some((/** @type {any} */ c) => c.summary_hash === h && c.kind === kind)) return false;
    }
    this.#at(at, () => this.a.addCompaction(chain.id, { fromTurn, toTurn, summaryText: text ?? null, kind, method, detail }));
    this.stats.compactions++;
    return true;
  }
  /**
   * A link is counted once: the archive upserts it, so a re-run finds it already there.
   * @param {any} src @param {any} dst @param {string} type @param {number | null} [at]
   */
  link(src, dst, type, at = null) {
    if (!this.dryRun && this.a.linksFor(src).some((l) => l.src === src && l.dst === dst && l.type === type))
      return false;
    this.stats.links++;
    if (!this.dryRun) this.#at(at, () => this.a.link(src, dst, type));
    return true;
  }
  parent(chain, parentId) {
    if (!this.dryRun && parentId) this.a.setParent(chain.id, parentId);
  }
  turnCount(chain) {
    return chain.dry ? null : (this.a.getTurns(chain.id).at(-1)?.n ?? null);
  }
  nextCompactionFrom(chain) {
    return chain.dry ? 1 : (this.a.getCompactions(chain.id).at(-1)?.to_turn ?? 0) + 1;
  }
}

// The turn's final is its last assistant message — the answer when the model answered, its last tool call when the
// session ended mid-loop (HarnessV2 Phase 6: a tool-only turn closes like a live proxied turn does, with the newest
// reply as its final). Everything else is work, in order — the results of that last call, when the session stopped
// before the model saw them, stay in the work after it and the turn is marked `cut`. A turn with no assistant message
// at all stays open.
//
// `closing` (the reader's, where it knows the turn is over: stopped, or left for the next message): a turn whose
// model spoke last through a call never answered, and no more of it will come. All it did is its work, in order,
// and the line is its final (`unansweredLine`), so the last call is a card like the others and a model that reads
// the chat hears of the turn.
export function shapeTurn(t) {
  const items = t.items.slice();
  let final;
  const lastAssistant = items.findLastIndex((i) => i.msg?.role === "assistant");
  const said = lastAssistant >= 0 ? items[lastAssistant].msg.content : null;
  if (t.closing && Array.isArray(said) && said.some((/** @type {any} */ b) => b?.type === "tool_use")) {
    const end = items.at(-1)?.at ?? t.at;
    return { user: t.user, at: t.at, model: t.model ?? null, work: items.map((i) => i.msg), workAt: end, final: { role: "assistant", content: [{ type: "text", text: String(t.closing) }] }, endAt: end };
  }
  if (lastAssistant >= 0) final = items.splice(lastAssistant, 1)[0];
  const cut = lastAssistant >= 0 && lastAssistant < items.length;
  const times = [final?.at, items.at(-1)?.at].filter((v) => typeof v === "number" && Number.isFinite(v));
  return {
    user: t.user,
    at: t.at,
    model: t.model ?? null,
    work: items.map((i) => i.msg),
    workAt: items.at(-1)?.at ?? t.at,
    final: final?.msg,
    endAt: times.length ? Math.max(...times) : t.at,
    ...(cut ? { cut: true } : {}),
  };
}
