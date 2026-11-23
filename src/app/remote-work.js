// @ts-check
// Run on, the desk's side (the remote desk's s2b): a folder of the person's sent to another machine for a chat of
// theirs to run there, and what that chat changed brought back into the folder. Each such send is a record kept here
// (`remote-work.json`), apart from the sub-agents' registry: the machine, the copy placed there for the person
// (services/copies.js `owned`, POST /transfers/place `for: "person"`), the commit it went at, the chat this Filament's
// app started in it there, and what was brought back of it. The send and the bring back ride this Filament's agents'
// device there (remote-agents.js `placeForPerson`, `takeBack`); the chat is started by the app's own device there, the
// copy's machine key, and named to the record after. What comes back is applied as a sub-agent's work is
// (adapters/git/worktree.js `applyTaskWork`): a file the person left as it was takes its version, one both changed is
// merged three ways, and one that cannot come through stops the whole apply with choices — nothing written.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, repoOf } from "../adapters/git/snapshot.js";
import { applyTaskWork, previewApply } from "../adapters/git/worktree.js";

/** Where a record's commits are held in the folder's repository, against git's pruning: `<id>/copy`, `/back`, `/applied`. */
export const WORK_REF_PREFIX = "refs/filament/work/";
/** How many records are kept: past it, the oldest brought back or gone go first. */
export const WORKS_MAX = 200;

/**
 * One send: `machine`, where it went; `folder`, the folder it went from (a chat's, in its repository `repo`); `project`,
 * the repository's folder name; `base`, the commit it went at, uncommitted work in it; `copy`, the copy placed there,
 * and `cwd`, this folder in it, where the chat starts; `chat`, the chat started there ("" until named); `back`, the last
 * capture brought here; `applied`, the last one applied to the folder, which the next is measured from; `left`, what
 * stayed here of the send, or there of the last bring back, with why; `state`: `placed` (no chat named yet), `running`
 * (a chat named), `brought` (its change applied), `gone` (its copy there went).
 * @typedef {{ id: string, machine: { id: string, name: string }, folder: string, repo: string, project: string, base: string,
 *   copy: { id: string, folder: string }, cwd: string, chat: string, back: string, applied: string, left: { path: string, why: string }[],
 *   files: number, bytes: number, madeAt: number, broughtAt: number, state: "placed" | "running" | "brought" | "gone" }} RemoteWork
 */
/**
 * What the person is asked before a send (remote-agents.js `SendAsk`, its `untracked` the first `SAID_MAX`), and more:
 * `untrackedCount`, all of them; `fresh` (the first `SAID_MAX`) and `freshCount`, the files in no commit that no yes of
 * theirs for this repository and machine named yet; `lfs`, how many files Git LFS keeps, whose content stays here (a
 * build that needs it fails there); `id`, this ask's, which their yes names (`WorkAllow`).
 * @typedef {import("./agent/remote-agents.js").SendAsk & { untrackedCount: number, fresh: string[], freshCount: number, lfs: number, id: string }} WorkAsk
 */
/** The person's yes to a send: the `id` of the ask they answered. @typedef {{ ask: string }} WorkAllow */
/** What the person said yes to, by machine and repository: the files in no commit that went on it, and Git LFS's. @typedef {{ untracked: string[], lfs: boolean }} WorkYes */

/** The most files an ask names: the rest are counted. */
export const SAID_MAX = 200;

/** An error with the status a route answers it by. @param {number} status @param {string} words @param {Record<string, unknown>} [more] */
const refused = (status, words, more = {}) => Object.assign(new Error(words), { status, ...more });

/**
 * @param {{ dataDir: string | null, remote: Pick<ReturnType<typeof import("./agent/remote-agents.js").createRemoteAgents>, "placeForPerson" | "takeBack">,
 *   may?: (repo: string) => string, inRepo?: (<T>(repo: string, fn: () => Promise<T>) => Promise<T>) | null,
 *   now?: () => number, log?: (level: string, line: string) => void }} o
 *   `may`: why a repository may not be sent nor written by a bring back here, "" where it may (a chat's folder, as its
 *   start judges one: the whole repository goes and comes back); `inRepo`: a write into a repository in its turn, beside
 *   no other — a sub-agent's Apply's (subagents.js `inRepoAhead`) —, else one at a time here
 */
export function createRemoteWork({ dataDir, remote, may = () => "", inRepo = null, now = Date.now, log = () => {} }) {
  const file = dataDir ? join(dataDir, "remote-work.json") : null;
  // The yeses apart, written only when one changes: a yes names every file in no commit that went on it, thousands in
  // a game's repository, and the records are written at every send and bring back.
  const yesFile = dataDir ? join(dataDir, "remote-work-yes.json") : null;
  /** @param {string | null} f */
  const read = (f) => {
    try {
      return f ? JSON.parse(readFileSync(f, "utf8")) : null;
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `[remote-work] ${f} could not be read (${e?.message || e}): it starts empty`);
      return null;
    }
  };
  const j = read(file);
  /** @type {RemoteWork[]} */
  let works = Array.isArray(j?.works) ? j.works.filter((/** @type {any} */ w) => w && typeof w.id === "string" && typeof w.repo === "string") : [];
  const y = read(yesFile);
  /** What the person said yes to, by machine and repository. @type {Record<string, Record<string, WorkYes>>} */
  const allowed = y?.allowed && typeof y.allowed === "object" ? y.allowed : {};
  /** @param {string | null} f @param {unknown} what */
  const keep = (f, what) => {
    if (!f) return;
    try {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, JSON.stringify(what), { mode: 0o600 });
      renameSync(`${f}.tmp`, f);
    } catch (/** @type {any} */ e) {
      log("warn", `[remote-work] could not keep ${f}: ${e?.message || e}`);
    }
  };
  const save = () => keep(file, { version: 1, works });
  const saveYes = () => keep(yesFile, { version: 1, allowed });
  /** A repository as Windows compares one. @param {string} repo */
  const repoKey = (repo) => (process.platform === "win32" ? repo.toLowerCase() : repo);
  /** One record's bring backs and its forgetting, one at a time; and, `inRepo` none, one repository's writes. @type {Map<string, Promise<unknown>>} */
  const turns = new Map();
  /** @template T @param {string} id @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (id, fn) => {
    const run = (turns.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    turns.set(id, run);
    return run.finally(() => turns.get(id) === run && turns.delete(id));
  };
  /** @template T @param {string} repo @param {() => Promise<T>} fn @returns {Promise<T>} */
  const writeIn = (repo, fn) => (inRepo ? inRepo(repo, fn) : inTurn(`repo:${repoKey(repo)}`, fn));
  /** An ask's id: what it asked of which repository and machine. @param {unknown[]} what */
  const askId = (what) => createHash("sha256").update(JSON.stringify(what)).digest("hex");
  /** Hold a commit under the record's ref, or let it go. @param {string} repo @param {string} id @param {string} name @param {string} commit */
  const hold = async (repo, id, name, commit) => {
    const r = await git(commit ? ["update-ref", `${WORK_REF_PREFIX}${id}/${name}`, commit] : ["update-ref", "-d", `${WORK_REF_PREFIX}${id}/${name}`], { cwd: repo });
    if (r.code !== 0) log("warn", `[remote-work] ${repo}: ${WORK_REF_PREFIX}${id}/${name} could not be ${commit ? "written" : "removed"}: ${String(r.err || r.out).trim().slice(0, 200)}`);
  };
  /** How many files of the repository Git LFS keeps: their content never goes (adapters/git/send.js). @param {string} repo */
  const lfsCount = async (repo) => {
    const r = await git(["ls-files", "-z", ":(attr:filter=lfs)"], { cwd: repo });
    return r.code === 0 ? String(r.out).split("\0").filter(Boolean).length : 0;
  };
  /** A record as said: a copy. @param {RemoteWork} w */
  const said = (w) => ({ ...w, machine: { ...w.machine }, copy: { ...w.copy }, left: w.left.map((l) => ({ ...l })) });
  /** @param {string} id */
  const find = (id) => {
    const w = works.find((x) => x.id === String(id));
    if (!w) throw refused(404, `no Run on ${String(id).slice(0, 60)} here`);
    return w;
  };
  /** Past `WORKS_MAX`, the oldest brought back or gone go, their refs with them. */
  const trim = async () => {
    while (works.length > WORKS_MAX) {
      const old = [...works].sort((a, b) => a.madeAt - b.madeAt).find((w) => w.state === "brought" || w.state === "gone") ?? works[0];
      works = works.filter((w) => w !== old);
      for (const n of ["copy", "back", "applied"]) await hold(old.repo, old.id, n, "");
    }
  };

  return {
    /** Every record, newest first. @returns {RemoteWork[]} */
    list: () => [...works].sort((a, b) => b.madeAt - a.madeAt).map(said),
    /** @param {string} id @returns {RemoteWork | null} */
    get: (id) => {
      const w = works.find((x) => x.id === String(id));
      return w ? said(w) : null;
    },
    /**
     * Run on: the folder `folder` is in sent to the machine `machine` names and placed there for the person's chat. A
     * send asks first (`WorkAsk`, thrown with status 409 and `ask`, before its bundle is built) where this repository
     * never went to that machine with the person's yes, where files in no commit that no yes named go now, and where Git
     * LFS keeps files whose content stays here; `allow`, the person's yes to that very ask, sends it. → the record;
     * refused in words, with a status.
     * @param {{ machine: string, folder: string, allow?: WorkAllow | null, signal?: AbortSignal | null }} o
     * @returns {Promise<RemoteWork>}
     */
    async send({ machine, folder, allow = null, signal = null }) {
      const found = await repoOf(folder);
      if (!found.repo) throw refused(400, `${folder} is in no git repository: Run on sends a repository's copy`);
      const top = found.repo;
      const no = may(top);
      if (no) throw refused(403, no);
      // The machine's id, as the send names it before it asks (`sent.has`): a yes is one machine's, whatever its name.
      let machineId = "";
      /** @param {import("./agent/remote-agents.js").SendAsk} o */
      const ask = async (o) => {
        const key = repoKey(top);
        const by = allowed[machineId]?.[key] ?? null;
        const lfs = await lfsCount(top);
        const had = new Set(by?.untracked ?? []);
        const fresh = o.untracked.filter((u) => !had.has(u));
        // Asked the first time, again where files in no commit that no yes named go now, and where LFS keeps files.
        if (by && !fresh.length && !(lfs > 0 && !by.lfs)) return true;
        const id = askId([machineId, key, [...o.untracked].sort(), lfs, !!by]);
        if (allow?.ask !== id) {
          /** @type {WorkAsk} */
          const said = { ...o, untracked: o.untracked.slice(0, SAID_MAX), untrackedCount: o.untracked.length, fresh: fresh.slice(0, SAID_MAX), freshCount: fresh.length, lfs, id };
          throw refused(409, `${o.project} goes to ${o.machine} on your yes`, { ask: said });
        }
        // What went on it, kept: the files in no commit now, and LFS's yes.
        allowed[machineId] = { ...allowed[machineId], [key]: { untracked: [...o.untracked], lfs: lfs > 0 || !!by?.lfs } };
        saveYes();
        return true;
      };
      /** @type {Awaited<ReturnType<typeof remote.placeForPerson>>} */
      let out;
      try {
        const sent = { has: (/** @type {string} */ id) => ((machineId = String(id)), false), add: () => {} };
        out = await remote.placeForPerson(machine, { folder, ask, sent, signal });
      } catch (/** @type {any} */ e) {
        if (e?.ask) throw e;
        throw refused(/no machine "/.test(String(e?.message)) ? 404 : 422, String(e?.message || e));
      }
      const id = randomUUID();
      /** @type {RemoteWork} */
      const w = { id, machine: out.machine, folder, repo: out.repo, project: out.project, base: out.commit, copy: out.copy, cwd: out.cwd, chat: "", back: "", applied: "", left: out.left, files: out.files, bytes: out.bytes, madeAt: now(), broughtAt: 0, state: "placed" };
      await hold(out.repo, id, "copy", out.commit);
      works.push(w);
      await trim();
      save();
      log("info", `[remote-work] ${out.project} went to ${out.machine.name} for a chat of yours (${out.files} files)`);
      return said(w);
    },
    /**
     * The chat this Filament's app started in the record's copy there, named to it: what it changed is brought back from
     * there. Another started there in its place names itself the same way. @param {string} id @param {string} chat
     * @returns {RemoteWork}
     */
    chat(id, chat) {
      const w = find(id);
      const c = String(chat ?? "").trim();
      if (!c || c.length > 200) throw refused(400, "chat is the id of the chat started in its copy there");
      w.chat = c;
      if (w.state === "placed") w.state = "running";
      save();
      return said(w);
    },
    /**
     * What the record's chat changed there, brought back (remote-agents.js `takeBack`) and applied to the folder from
     * where the last apply left it (`applied`, else the commit sent): as uncommitted edits, nothing committed, the index
     * and HEAD untouched. A file both changed that cannot come through stops it, nothing written (`conflicts`), until the
     * person's `choices` (by path: `yours`, `its`, `both`) or an `overlap` way name one for each, for the capture they
     * saw (`at`, as `conflicts` came with it: one taken since says `moved`). → what came in and what stayed there;
     * refused in words, with a status (410 where its copy there went).
     * @param {string} id
     * @param {{ choices?: Readonly<Record<string, import("../adapters/git/worktree.js").ApplyChoice>>, overlap?: import("../adapters/git/worktree.js").OverlapWay | null, at?: string, signal?: AbortSignal | null }} [o]
     * @returns {Promise<{ ok: true, work: RemoteWork, unchanged: boolean, files: { path: string, status: string, added: number, removed: number }[], came: { path: string, how: string }[], left: { path: string, why: string }[] }
     *   | { ok: false, work: RemoteWork, conflicts: import("../adapters/git/worktree.js").ApplyConflict[], stuck?: string[], moved?: true, error?: string, at: string, left: { path: string, why: string }[] }>}
     */
    back(id, { choices = {}, overlap = null, at = "", signal = null } = {}) {
      return inTurn(String(id), async () => {
        const w = find(id);
        if (!w.chat) throw refused(409, `no chat of yours was named for its copy on ${w.machine.name} yet: start one there first`);
        if (!existsSync(w.repo)) throw refused(410, `${w.repo}, the folder it went from, is gone from this machine: nothing can come back into it`);
        const no = may(w.repo);
        if (no) throw refused(403, no);
        /** @type {Awaited<ReturnType<typeof remote.takeBack>>} */
        let got;
        try {
          got = await remote.takeBack(w.machine.id, { copy: w.copy.id, chat: w.chat, repo: w.repo, base: w.base, haves: [w.back, w.applied].filter(Boolean), signal });
        } catch (/** @type {any} */ e) {
          if (e?.kind === "gone") {
            w.state = "gone";
            save();
          }
          throw refused(e?.kind === "gone" ? 410 : e?.kind === "refused" ? 422 : 503, String(e?.message || e), { kind: e?.kind || "cut" });
        }
        const from = w.applied || w.base;
        if (got.commit !== w.back) {
          w.back = got.commit;
          await hold(w.repo, w.id, "back", got.commit);
          save();
        }
        // The copy as the folder had it last: nothing to bring. One put back there as it went, after an apply, brings
        // that back (its `unchanged` capture is the commit sent).
        if (got.commit === from) return { ok: /** @type {const} */ (true), work: said(w), unchanged: true, files: [], came: [], left: got.left };
        // The choices name files of the capture the person saw (`at`): one taken since is shown again with what stops it
        // now, nothing written.
        if ((Object.keys(choices).length || overlap) && at !== got.commit) {
          const now = await previewApply(w.repo, { base: from, head: got.commit }).catch(() => null);
          return { ok: /** @type {const} */ (false), work: said(w), conflicts: now?.conflicts ?? [], moved: true, at: got.commit, left: got.left, error: `it changed again on ${w.machine.name} since those choices: choose again for what stops it now` };
        }
        const applied = await writeIn(w.repo, () => applyTaskWork(w.repo, { base: from, head: got.commit }, { choices, overlap }));
        if (!applied.ok) return { ok: /** @type {const} */ (false), work: said(w), conflicts: applied.conflicts, ...(applied.stuck ? { stuck: applied.stuck } : {}), at: got.commit, left: got.left };
        w.applied = got.commit;
        w.broughtAt = now();
        w.state = "brought";
        w.left = got.left;
        await hold(w.repo, w.id, "applied", got.commit);
        save();
        log("info", `[remote-work] ${applied.files.length} files of ${w.project} came back from ${w.machine.name}`);
        return { ok: /** @type {const} */ (true), work: said(w), unchanged: false, files: applied.files.map((f) => ({ path: f.path, status: f.status, added: f.added, removed: f.removed })), came: applied.came, left: got.left };
      });
    },
    /**
     * A record forgotten here, its commits' refs with it, once a bring back under way has ended; its copy there is that
     * machine's to clear. @param {string} id
     */
    forget(id) {
      return inTurn(String(id), async () => {
        const w = find(id);
        works = works.filter((x) => x !== w);
        save();
        for (const n of ["copy", "back", "applied"]) await hold(w.repo, w.id, n, "");
        return true;
      });
    },
  };
}

/** @typedef {ReturnType<typeof createRemoteWork>} RemoteWorkStore */
