// @ts-check
// Threads at work (core/threads.js; the owner's of 11-09 and 11-11): a chat's agent starts a chat of its own, linked to
// its own — an advisor it writes for reviews, a worker it hands a part to —, on the model, provider and effort it names,
// in its own folder or another: one no project holds yet is asked for whatever a write there would do (Full access
// aside), another project's as a write there would be. The thread may no more than its starter (its asking settings,
// tool switches and privacy copied whole); a model named with its coding agent's mode, or whose route sets one, is
// refused. Its first message is the starter's brief, posted as Filament's own turn; with `notify`, its first finished
// reply comes back to the starter as a letter, owed across a restart (`threadStart` on its chat, `reconcile`). A chat's
// agent starts at most THREAD_LIMITS.perMessage threads while its person says nothing; a thread starts none of its own
// until its person wrote in it; a routine's run, a chat of another machine's agents, a team's, and a sub-agent start
// none.
import { mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { normalizeCwd } from "../core/project-id.js";
import { SUBAGENT_EFFORTS } from "../core/schema.js";
import { headChars } from "../core/text.js";
import { THREAD_LIMITS, briefBlock, briefProblem } from "../core/threads.js";
import { ADDED_FOLDERS_MAX, namesMode } from "../services/session-settings.js";
import { LETTER_CHARS } from "./letters.js";

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/** How long a brief's turn is given to be refused before the thread counts as started. */
const STARTS_MS = 1500;
/** What a start past its starter's limit is told. */
const PAST_LIMIT = `this chat's agent started ${THREAD_LIMITS.perMessage} threads since the person last wrote, the most it starts without them: say what you would start, and wait for their word`;

/**
 * What a start asks for: its title, model and who serves it, effort, folder, brief, and whether its first reply comes
 * back as a letter.
 * @typedef {{ title?: unknown, model?: unknown, provider?: unknown, effort?: unknown, folder?: unknown, brief?: unknown, notify?: unknown }} ThreadStart
 */
/**
 * A thread started: its chat, title, the model it runs on, its folder, whether that folder became a project now
 * (`made`), and whether the person was asked for the folder and said yes (`asked`).
 * @typedef {{ id: string, title: string, model: string, effort: string | null, folder: string, made: boolean, asked: boolean, notify: boolean }} ThreadStarted
 */
/**
 * The folder a start asks the person for: one no project holds yet, or that is not there (`fresh`), else a project's
 * that is not its starter's own folder.
 * @typedef {{ folder: string, fresh: boolean }} ThreadFolder
 */
/**
 * What a start asks of the turn its call is in, for a folder that is not its starter's own (`folder`): the person's
 * yes, asked for as agent/thread-tool.js `folderVerdict` says — `asked` false where the chat's mode runs it unasked —,
 * or thrown, with why the thread may not start there. The loop judged and asked before the call ran (agent/loop.js
 * `admit`); a coding agent's call asks on its turn's card (agent/thread-tool.js `folderAskOf`). None where no turn runs.
 * `mode`: the permission mode that turn runs in now. A turn Filament holds to reading — a plan's, a watcher's wake —
 * runs so whatever its chat's own mode says, and a thread it starts reads only too: a chat of its own would else do
 * what the turn that started it may not.
 * @typedef {{ folder?: ((at: ThreadFolder) => Promise<{ asked: boolean }>) | null, mode?: (() => string | null) | null }} ThreadCtx
 */

/**
 * @param {{
 *   sessions: { create: (args: any) => any, launchInfo: (id: string) => any, settingsOf: (id: string) => any, folderProject: (cwd: string) => { home: string, projectId: string, known: boolean },
 *     besideFacts: (id: string) => { busy: boolean, asking?: boolean, last: { text: string, why: string, failed?: boolean, stopped?: boolean, endedAt?: number | null } | null } },
 *   archive: () => any,
 *   registry: () => any,
 *   chatEffortOf: (model: string, wanted: string, asked: boolean) => { name: string, effort: string | null },
 *   postTurn: (chainId: string, body: any) => Promise<{ status: number, body: any }>,
 *   letters: { threadsAlone: (chainId: string) => number, threadStarted: (chainId: string, most: number) => boolean, threadDropped: (chainId: string) => void, send: (from: string, input: any) => { ok: boolean, text: string } },
 *   remove: (chainId: string) => Promise<unknown>,
 *   folderOk: (folder: string) => { ok: boolean, why: string | null },
 *   modeOf?: (model: string) => string | null,
 *   log?: (level: string, msg: string) => void,
 *   wait?: (ms: number) => Promise<void>,
 * }} deps
 *   `folderOk`: whether a folder is one chats may work in (agent/turn.js `folderVerdict`): `why` "missing" for one not
 *   there. `modeOf`: the mode a turn on a model sets its coding agent to, its route's own included (engine.js
 *   `agentModeOf`), null for none
 */
export function createThreads(deps) {
  const log = deps.log || (() => {});
  const wait = deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));

  /**
   * What a chat may do as it stands, to set on its thread: its mode, rules, commands refused, second look and the
   * folders added to its own for reading (`loop.addedFolders`),
   * its tool switches, and what of it memory may learn, index and must redact — each from where its document takes it,
   * so the thread may no more than its starter whatever its own project says.
   * @param {string} id
   */
  const askingOf = (id) => {
    const eff = deps.sessions.settingsOf(id)?.effective || {};
    const loop = eff.loop || {};
    const privacy = eff.privacy || {};
    const kept = {
      ...(privacy.bashDeny != null ? { bashDeny: privacy.bashDeny } : {}),
      ...(privacy.learn != null ? { learn: privacy.learn } : {}),
      ...(privacy.index != null ? { index: privacy.index } : {}),
      ...(privacy.redact != null ? { redact: privacy.redact } : {}),
    };
    return {
      loop: {
        ...(loop.permissions != null ? { permissions: loop.permissions } : {}),
        ...(loop.rules != null ? { rules: loop.rules } : {}),
        ...(loop.secondLook != null ? { secondLook: loop.secondLook } : {}),
        // Its starter's layers add up; one layer holds so many, and the thread's own takes the first of them.
        ...(Array.isArray(loop.addedFolders) ? { addedFolders: loop.addedFolders.slice(0, ADDED_FOLDERS_MAX) } : {}),
        ...(loop.tools != null ? { tools: loop.tools } : {}),
      },
      ...(Object.keys(kept).length ? { privacy: kept } : {}),
    };
  };

  /** The folder a start names, whole; "" for none. @param {unknown} v */
  const folderIn = (v) => {
    const f = String(v ?? "").trim();
    if (!f) return "";
    if (!isAbsolute(f)) throw refused(400, `folder is a whole path, as ${process.platform === "win32" ? "C:\\work\\site" : "/home/you/site"}; "${f.slice(0, 80)}" is not one`);
    return resolve(f);
  };

  /** The nearest folder of a path that is there. @param {string} p */
  const nearest = (p) => {
    let at = p;
    for (;;) {
      try {
        if (statSync(at).isDirectory()) return at;
      } catch {}
      const up = dirname(at);
      if (up === at) return at;
      at = up;
    }
  };

  /**
   * A start as it stands, kept on its thread's chat (`threadStart`) from before its brief is posted until it is settled
   * — its brief's turn began; with `notify`, its first reply went to its starter —, so a restart finds it (`reconcile`).
   * Bookkeeping, logged where it fails. @param {string} id @param {{ starter: string, title: string, notify: boolean } | undefined} start
   */
  const keepStart = (id, start) => {
    try {
      deps.archive().mergeMeta(id, { threadStart: start });
    } catch (/** @type {any} */ e) {
      log("warn", `threads: ${id}'s start could not be ${start ? "kept for a restart" : "settled"} (${e?.message || e})`);
    }
  };

  /**
   * The threads whose first reply is owed to their starter (`notify`), by the thread's id: sent as a turn of the thread
   * lets go of its chat (`released`). The post answers at its head, while the turn has only begun: the real Filament's
   * said "no reply" of every first turn (the trial of 11-11). `starting`: its brief's post has not answered yet, so a
   * turn's end waits for it (`let`: one came meanwhile) — a brief refused at once owes nothing.
   * @type {Map<string, { starter: string, title: string, starting: boolean, let: boolean }>}
   */
  const owed = new Map();
  /**
   * A first reply as a letter holds it: whole, or its head and where the rest is, where it is more than a letter's
   * LETTER_CHARS. @param {string} id @param {string} text
   */
  const replyLetter = (id, text) => {
    if (text.length <= LETTER_CHARS) return text;
    const rest = `\n\n[Filament: its reply is ${text.length.toLocaleString("en-US")} characters, more than a letter holds: this is how it begins, and the rest is in its chat (${id}).]`;
    return `${headChars(text, LETTER_CHARS - rest.length)}${rest}`;
  };
  /** A thread's first reply, or why there is none, as a letter from it, which the link lets it write: the debt is settled. @param {string} id @param {string} text */
  const notifyNow = (id, text) => {
    const o = owed.get(id);
    if (!o) return;
    owed.delete(id);
    const sent = deps.letters.send(id, { to: o.starter, subject: `${o.title}: its first reply`, text });
    if (!sent.ok) log("warn", `threads: ${id}'s first reply did not reach ${o.starter} (${sent.text})`);
    keepStart(id, undefined);
  };
  /** @param {string} why */
  const noReply = (why) => `Its first turn ended with no reply${why ? ` (${why})` : ""}. Open the chat to see why.`;

  /**
   * A turn of a thread that owes its first reply let go of its chat: sent now, read from its newest turn, or why there
   * is none. It waits on while the chat is at work, while a question of its turn waits for the person — its words are
   * no reply —, and where the turn was cut off before any reply, which a turn of Filament's own goes on from.
   * @param {string} id
   */
  const sendOwed = (id) => {
    const o = owed.get(id);
    if (!o) return;
    if (o.starting) {
      o.let = true;
      return;
    }
    let f;
    try {
      f = deps.sessions.besideFacts(id);
    } catch (/** @type {any} */ e) {
      log("warn", `threads: ${id}'s first reply could not be read (${e?.message || e})`);
      return;
    }
    if (f.busy || f.asking || !f.last) return;
    const l = f.last;
    if (!l.text && !l.failed && !l.stopped && !l.endedAt) return;
    notifyNow(id, l.text ? replyLetter(id, l.text) : noReply(l.why || (l.stopped ? "it was stopped" : "")));
  };

  /**
   * Where a start works: the folder it names, else its starter's; whether chats may work there now (`there`, "missing"
   * for one to be made); whether a project holds it, and whether it is its starter's own — or the refusal, in words.
   * @param {any} info  the starter's launch info @param {ThreadStart} input
   * @returns {{ folder: string, there: { ok: boolean, why: string | null }, known: boolean, own: boolean }}
   */
  const placeOf = (info, input) => {
    const folder = folderIn(input.folder) || String(info.cwd || "");
    if (!folder) throw refused(400, "this chat has no folder: name the thread's");
    const there = deps.folderOk(folder);
    if (!there.ok && there.why !== "missing") throw refused(403, `the thread cannot work in ${folder}: ${there.why === "outside" ? "it is under no folder listed in agentLoop.roots" : there.why}`);
    if (!there.ok) {
      const parent = deps.folderOk(nearest(folder));
      if (!parent.ok) throw refused(403, `the thread cannot work in ${folder}: ${parent.why === "outside" ? "it is under no folder listed in agentLoop.roots" : parent.why}`);
    }
    return { folder, there, known: there.ok ? deps.sessions.folderProject(folder).known : false, own: normalizeCwd(folder) === normalizeCwd(info.cwd) };
  };
  /** The folder a place asks the person for; null for its starter's own, a project's. @param {ReturnType<typeof placeOf>} p @returns {ThreadFolder | null} */
  const askedFor = (p) => (!p.known ? { folder: p.folder, fresh: true } : !p.own ? { folder: p.folder, fresh: false } : null);

  /**
   * What a start needs, read and judged before anyone is asked and anything is made: its starter, brief, model and
   * effort, title and place — or the refusal, in words. Counts nothing: `start` takes the starter's slot.
   * @param {string} starterId @param {ThreadStart} input
   */
  const checked = async (starterId, input) => {
    const a = deps.archive();
    const starter = a?.getChain?.(String(starterId || ""));
    if (!starter) throw refused(404, "no such session");
    if (starter.kind === "team") throw refused(400, "a team's chat starts no thread: its main chat's agent does");
    const theirs = a.metaOf?.(starter.id, ["agentDevice", "routine", "personAt"]) || {};
    if (typeof theirs.agentDevice === "string") throw refused(403, "a chat of another machine's agents starts no thread on this machine");
    // A routine's run is nobody's chat to answer in, and a thread no person wrote in is Filament's turns alone: each
    // would start threads with nobody's word between them, the limit counted anew in every one.
    if (theirs.routine) throw refused(403, "a routine's run starts no thread: say in your reply which thread you would start and why, for its person to read");
    const from = a.threadsOf?.(starter.id)?.from ?? null;
    if (from && !theirs.personAt)
      throw refused(403, `a thread starts none of its own until its person writes in it: say in your reply which thread you would start and why, or ask your starter for it in a letter (Filament's envelope tool, to: "${from}")`);
    if (deps.letters.threadsAlone(starter.id) >= THREAD_LIMITS.perMessage) throw refused(429, PAST_LIMIT);
    const problem = briefProblem(input.brief);
    if (problem) throw refused(400, problem);
    const brief = String(input.brief).replace(/\r\n?/g, "\n").trim();
    const info = deps.sessions.launchInfo(starter.id) || {};
    // Its model: the one named, as its starter's agent says it, by who serves it where several do; else the starter's.
    const named = String(input.model ?? "").trim();
    const provider = String(input.provider ?? "").trim();
    if (provider && !named) throw refused(400, "provider names who serves the thread's model: name the model too");
    if (namesMode(named)) throw refused(400, "name the model alone: a thread asks as its starter does, so its coding agent's mode is not named");
    let model = String(info.full || info.model || "");
    if (named) {
      const c = (await deps.registry()?.modelChoice?.(named, provider || null)) || { model: null, why: "Filament cannot read its models now" };
      if (!c.model) throw refused(400, `${named} cannot run now (${c.why}): name another model, or leave it out for this chat's`);
      model = String(c.model);
      // A name with no mode in it whose route sets one names it all the same (the second read of 11-12).
      const routed = deps.modeOf?.(model) ?? null;
      if (routed) throw refused(400, `${named} sets its coding agent's mode (${routed}) by its route, and a thread asks as its starter does: name another model, or leave it out for this chat's`);
    }
    if (!model) throw refused(400, "this chat has no model to start a thread on: name one");
    const wanted = input.effort == null || String(input.effort).trim() === "" ? null : String(input.effort).trim().toLowerCase();
    if (wanted && !SUBAGENT_EFFORTS.includes(wanted)) throw refused(400, `effort is one of ${SUBAGENT_EFFORTS.join(", ")}`);
    const lead = wanted && wanted !== "model" ? deps.chatEffortOf(model, wanted, true) : { name: model, effort: null };
    const place = placeOf(info, input);
    const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, THREAD_LIMITS.title) || brief.split("\n")[0].replace(/\s+/g, " ").slice(0, THREAD_LIMITS.title);
    return { starter, brief, lead, place, title };
  };

  return {
    /**
     * The folder a start would ask the person for (`start`'s `folder`): one no project holds yet, or one not there yet
     * (`fresh`), or a project's that is not its starter's own; null where it asks for none — and where the start is
     * refused for its place, which says why in its own words. Asks nothing, makes nothing: the loop judges the call by
     * it before it runs (agent/loop.js `judgedAs`).
     * @param {string} starterId @param {ThreadStart} input @returns {ThreadFolder | null}
     */
    asks(starterId, input) {
      try {
        return askedFor(placeOf(deps.sessions.launchInfo(String(starterId || "")) || {}, input || {}));
      } catch {
        return null;
      }
    },
    /**
     * Why a start would be refused whatever the person answers — its starter, its limit, its brief, its model, its
     * place —, in the start's own words; null where it would go on to ask or to start. Counts nothing, asks nothing:
     * the loop reads it before it asks the person for a folder (agent/loop.js `admit`).
     * @param {string} starterId @param {ThreadStart} input @returns {Promise<string | null>}
     */
    async refusal(starterId, input) {
      try {
        await checked(starterId, input || {});
        return null;
      } catch (/** @type {any} */ e) {
        if (Number.isInteger(e?.status)) return String(e.message);
        throw e;
      }
    },
    /**
     * A chat's turn let go of it (server.js, as its holder goes): a thread whose first reply is owed sends it now
     * (`sendOwed`); one still at work, or waiting for the person's answer, waits for its next.
     * @param {string} chainId
     */
    released(chainId) {
      sendOwed(String(chainId || ""));
    },
    /**
     * As Filament starts: the starts a stop left unsettled (`threadStart` on each thread's chat). One whose brief never
     * became a turn is taken back — its call never answered that it started, or its brief was refused —; one that owes
     * its first reply owes it again, sent now where its turn has ended; any other is settled.
     * @returns {{ back: number, owes: number }}  how many it took back, and how many still owe a reply
     */
    reconcile() {
      const a = deps.archive();
      let back = 0;
      for (const { id, start } of a.threadStarts()) {
        if (!(Number(a.newestTurnN(id)) > 0)) {
          back++;
          void deps.remove(id).catch((/** @type {any} */ e) => log("warn", `threads: ${id}, a thread that never got its brief, stays (${e?.message || e})`));
        } else if (start?.notify === true && typeof start.starter === "string" && a.threadsOf(id).from === start.starter) {
          owed.set(id, { starter: start.starter, title: String(start.title || ""), starting: false, let: false });
          sendOwed(id);
        } else keepStart(id, undefined);
      }
      return { back, owes: owed.size };
    },
    /**
     * A thread started by a chat's agent, or refused in words: what refuses it whatever the person answers first
     * (`checked`), then its starter's slot, then the person's yes for its folder, then the chat and its brief.
     * @param {string} starterId @param {ThreadStart} input @param {ThreadCtx} [ctx]
     * @returns {Promise<ThreadStarted>}
     */
    async start(starterId, input, ctx = {}) {
      const { starter, brief, lead, place, title } = await checked(starterId, input || {});
      const { folder, there } = place;
      // Its slot among the threads its starter starts while its person says nothing, taken in one step with the count
      // before anyone is asked: starts that run side by side pass none over the limit. Given back where this one is
      // refused or fails.
      if (!deps.letters.threadStarted(starter.id, THREAD_LIMITS.perMessage)) throw refused(429, PAST_LIMIT);
      try {
        // Its folder: the starter's, unless it names one. One no project holds yet becomes one only on the person's
        // yes, Full access aside; another project's is asked for as a write there would be. One that is not there is
        // made then, where chats may work.
        const at = askedFor(place);
        let asked = false;
        if (at) {
          if (!ctx.folder) throw refused(409, `${at.fresh ? "a new project folder" : "another folder than this chat's own"} needs the person's yes, and no turn of this chat runs now to ask it`);
          try {
            asked = (await ctx.folder(at)).asked === true;
          } catch (/** @type {any} */ e) {
            throw refused(403, `the thread did not start in ${folder}: ${String(e?.message || e)}`);
          }
        }
        let made = false;
        if (!there.ok) {
          mkdirSync(folder, { recursive: true });
          made = true;
        }
        const asking = askingOf(starter.id);
        // Its starter's turn held to reading holds the thread so (`ThreadCtx.mode`), over the chat's own mode.
        const loop = ctx.mode?.() === "read-only" ? { ...asking.loop, permissions: "read-only" } : asking.loop;
        const settings = { ...asking, loop, ...(lead.effort ? { model: { effort: lead.effort } } : {}) };
        const chat = deps.sessions.create({ cwd: folder, model: lead.name, title, settings, thread: starter.id });
        const notify = input.notify === true;
        // Kept before the brief is posted, the reply owed before its turn can end: a turn that ends within the post's
        // wait, and a restart, find both.
        keepStart(chat.id, { starter: starter.id, title, notify });
        const debt = notify ? { starter: starter.id, title, starting: true, let: false } : null;
        if (debt) owed.set(chat.id, debt);
        const posting = deps.postTurn(chat.id, { content: [briefBlock({ from: starter.id, title: starter.title || "", brief })], by: "thread" });
        // A brief its thread refuses at once (a model that cannot answer) takes the thread back and says why.
        const early = await Promise.race([posting.catch((/** @type {any} */ e) => ({ status: 502, body: { error: String(e?.message || e) } })), wait(STARTS_MS).then(() => null)]);
        if (early && (early.status < 200 || early.status >= 300)) {
          owed.delete(chat.id);
          await deps.remove(chat.id).catch((/** @type {any} */ e) => log("warn", `threads: a thread that could not start stays (${e?.message || e})`));
          throw refused(early.status >= 400 && early.status < 500 ? early.status : 502, `the thread could not start: ${String(early.body?.error || `HTTP ${early.status}`)}`);
        }
        if (debt) {
          // A post refused past its wait says so in the reply's place; one that failed owes nothing more, as Filament
          // starts again either: its start stays kept with no reply owed.
          void posting.then(
            (r) => {
              if (r.status >= 300) notifyNow(chat.id, noReply(String(r.body?.error || `HTTP ${r.status}`)));
            },
            (e) => {
              owed.delete(chat.id);
              keepStart(chat.id, { starter: starter.id, title, notify: false });
              log("warn", `threads: ${chat.id}'s brief turn failed (${e?.message || e})`);
            },
          );
          debt.starting = false;
          if (debt.let) sendOwed(chat.id);
        } else
          void posting.then(
            (r) => {
              if (r.status < 300) keepStart(chat.id, undefined);
            },
            () => {},
          );
        log("info", `threads: ${starter.id} started thread ${chat.id} on ${lead.name} in ${folder}${made ? " (made)" : ""}`);
        return { id: chat.id, title, model: lead.name, effort: lead.effort, folder, made: made || !place.known, asked, notify };
      } catch (e) {
        deps.letters.threadDropped(starter.id);
        throw e;
      }
    },
  };
}
