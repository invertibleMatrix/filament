// @ts-check
// The admin API's git area: git for a project folder (plan B5) — status, the recent log, the branches, where a chat
// works (HarnessV4_Git_Plan step 2), what merging each of its places would bring (step 3), the places in its
// repository (step 4), a new worktree as a chat's first send would make it (step 5), the project's worktree template
// (HarnessV4_Four_Plan E19), Filament's own footprint in the repository (the footprint plan, Phase 7) — for the
// harness's header, sidebar, New chat, Files and Changes panes and a project's places. Four rows write, each on the
// developer's click and only there (GW-D1): removing a worktree that loses nothing but what git ignores, checked again
// at the click (GW-D40), putting it back, saving the template on the project (FO-D35), and Clean up, which takes what of
// Filament's own nothing needs, read again at the press; the new worktree is made by the session's create (sessions.js).
// Stage, discard, commit, push and checkout stay the developer's, by hand; every folder is fenced like every
// project-reading row (folder.js).
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fewAtOnce } from "../../core/at-once.js";
import { keptReads } from "../../core/kept-reads.js";
import { normalizeCwd } from "../../core/project-id.js";
import { sendJson } from "../../app/pipeline/respond.js";
import { guard } from "./guard.js";
import { allowedFolder } from "./folder.js";
import { newFolderRefusal } from "../../app/agent/turn.js";
import { statusOf, logOf, branchesOf, placeInfo, apartInfo, noPlace, branchOf, branchFileOf, placeChanges, lastCommits } from "../../adapters/git/inspect.js";
import { patchPlace } from "../../adapters/git/patch.js";
import { ROUNDS_BACK_MS, attribute, namedFiles, writersOf } from "../../core/changes-view.js";
import { goesWith, heldBack, planWorktree, putBack, readWorktree, removeWorktree, worktreesOf } from "../../adapters/git/places.js";
import { copyCandidates, measure } from "../../adapters/git/template.js";
import { copyPath } from "../../core/worktree-copy.js";
import { createFootprint } from "../../app/git-footprint.js";
import { dropBranch } from "../../adapters/git/footprint.js";
import { pressedPlanOf } from "../../core/footprint.js";

/** The folders one `/git/where` reads at most; any row reads its places a few at once (`fewAtOnce`). */
const WHERE_MAX = 100;
/** How long the Changes tab's read of a place serves every ask (the Designer's of 10-29): one at a time per place. */
export const CHANGES_TTL_MS = 3000;
/** The git marks kept at most: each place's reads, whole, light and apart, and each repository's places. */
const MARKS_MOST = 1000;

/**
 * The area's guard, with the sessions service's refusals answered at their own status (the projects' templates,
 * HarnessV4_Four_Plan FO-D40: a path the list cannot hold is a 400).
 * @param {(r: any, a: any) => any} fn
 */
const servedGuard = (fn) =>
  guard(async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 && !r.res.headersSent) return sendJson(r.res, e.status, { error: e.message });
      throw e;
    }
  });

/**
 * A worktree this Filament removed (HarnessV4_Git_Plan GW-D37), kept until it restarts for its Put back: `repo`, its
 * repository's git folder as the project id sees it; `commit`, the whole id a detached one is put back at — and a
 * branch that went with it (`branchGone`, the owner's of 11-09) is made again at.
 * @typedef {{ id: string, repo: string, path: string, name: string, branch: string | null, head: string | null,
 *   commit: string | null, at: number, branchGone?: boolean }} Removed
 */

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function gitRoutes(a) {
  const { config, memory, log = () => {}, sessionTurns = null, subagents = null, agentWork = () => [], sessions = null, events = null, keptMs = CHANGES_TTL_MS, spaces = null, openMoved = () => {} } = a;
  /** The sessions service, which keeps the projects' templates (HarnessV4_Four_Plan FO-D31). */
  const projects = () => {
    if (!sessions) throw Object.assign(new Error("no archive: projects are not wired"), { status: 503 });
    return sessions;
  };
  /** @type {Map<string, Removed>} */
  const removed = new Map();
  /** The worktrees a Remove or a Put back works on now: a second click is told so (GWC-94). @type {Set<string>} */
  const moving = new Set();
  /** The chats at work now (GW-D39): a turn running, a sub-agent working, a coding agent's own agents. */
  const atWorkNow = () =>
    new Set([
      ...(sessionTurns?.holders() || []).map((/** @type {{ key: string }} */ h) => memory?.archive?.chainIdForKey?.(h.key)).filter(Boolean).map(String),
      ...(subagents?.atWork?.() || []),
      ...agentWork().map(String),
    ]);
  /**
   * A worktree read whole, or as git listed it where the fence refuses its folder (GWC-89). `into`: the main folder's
   * branch, which its branch is compared with where Filament did not record the one it was made from.
   * @param {import("../../adapters/git/places.js").Worktree} w @param {string | null} [into]
   */
  const readFenced = (w, into = null) => {
    const f = allowedFolder(config.get(), w.path);
    return readWorktree(w, { refused: f.ok || f.status === 404 ? null : f.error, into });
  };
  /** The main folder's branch among a repository's worktrees, or null. @param {import("../../adapters/git/places.js").Worktree[]} list */
  const mainBranch = (list) => list.find((w) => w.main)?.branch || null;
  /**
   * A worktree as the places list shows it: its chats, each marked at work or not, and Remove or why not (GW-D10), and
   * Remove worktree and branch or why not (`whyBranch`, the owner's of 11-09). `home`: the chat's folder is there, gone
   * with it until Put back (GW-D39). `routine`: a routine's run, its routine's title (HarnessV4_Space_Plan S6), which
   * the Space's lanes put after the person's own chats. `own`: a chat of Filament's own, not a client's session.
   * @param {Awaited<ReturnType<typeof readFenced>>} p @param {{ id: string, name: string, home: boolean, own?: boolean, routine?: string }[]} chats
   * @param {Set<string>} busy
   */
  const rowOf = (p, chats, busy) => {
    const mine = chats.map((c) => ({ ...c, atWork: busy.has(c.id) }));
    const working = mine.filter((c) => c.atWork).map((c) => c.name || "an untitled chat");
    const why = heldBack(p, working);
    const whyBranch = heldBack(p, working, { branch: true });
    return { ...p, chats: mine, removable: !why, why, removableWithBranch: !whyBranch, whyBranch };
  };
  /** A chat as a refusal names it: “its name”, or "an untitled chat". @param {{ name?: string }} c */
  const chatNamed = (c) => (c.name ? `“${c.name}”` : "an untitled chat");
  /** A removal as the page shows it. @param {Removed} r */
  const shownRemoved = ({ id, path, name, branch, head, at, branchGone }) => ({ id, path, name, branch, head, at, ...(branchGone ? { branchGone } : {}) });
  /**
   * A place read as asked — lightly, whole, or `apart`: whole where it is kept apart from its base (`apartInfo`) —, or
   * the fence's refusal in words (GWC-55).
   * @param {string} asked @param {{ whole?: boolean, apart?: boolean }} o
   * @returns {Promise<import("../../adapters/git/inspect.js").PlaceInfo & { refused?: boolean }>}
   */
  const placeAt = async (asked, o) => {
    const f = allowedFolder(config.get(), asked);
    if (f.ok) return { ...(await markAt(o.whole ? "place" : o.apart ? "apart" : "light", f.root, asked)), cwd: asked };
    const unread = { whole: !!(o.whole || o.apart) };
    if (f.status === 404) return noPlace(asked, "the folder is gone", unread);
    return { ...noPlace(asked, f.error, unread), refused: true };
  };
  /**
   * A place's Branch read as asked, or why it was not read, in the same shape (GWC-69).
   * @param {string} asked @returns {Promise<import("../../adapters/git/inspect.js").BranchPlace & { refused?: boolean }>}
   */
  const branchAt = async (asked) => {
    const f = allowedFolder(config.get(), asked);
    if (f.ok) return { ...(await branchOf(f.root)), cwd: asked };
    const unread = { commits: [], moreCommits: 0, from: null, files: { committed: null, uncommitted: null } };
    if (f.status === 404) return { ...noPlace(asked, "the folder is gone", { whole: true }), ...unread };
    return { ...noPlace(asked, f.error, { whole: true }), ...unread, refused: true };
  };
  /**
   * Whether a place the chat's agents worked in is there still. One whose folder is gone — removed on purpose, or moved —
   * is left out of the chat's other places: there is nothing in it to read or to do (the owner's words of 10-18: "if
   * it is gone then why do i need to know about it. i had Removed that deliberately"). A folder the fence refuses is
   * there, and says why it is not read.
   * @param {string} p
   */
  const stillThere = (p) => {
    const f = allowedFolder(config.get(), p);
    return f.ok || f.status !== 404;
  };
  /**
   * A read of a place shared (the Designer's of 10-29): one under way at a time, and each answer serving every ask for
   * `CHANGES_TTL_MS` after it came — `fresh` (Read again) reads anew. A place's read is several git processes, and the
   * header, the panel and every window that shows a chat of the folder ask for it.
   * @param {Map<string, { p: Promise<any>, done: number }>} reads @param {string} key @param {boolean} fresh
   * @param {() => Promise<any>} read
   * @returns {Promise<any>}
   */
  const shared = (reads, key, fresh, read) => {
    const had = reads.get(key);
    if (had && !fresh && (!had.done || Date.now() - had.done < CHANGES_TTL_MS)) return had.p;
    const entry = { p: /** @type {Promise<any>} */ (Promise.resolve(null)), done: 0 };
    entry.p = read().finally(() => {
      entry.done = Date.now();
    });
    reads.set(key, entry);
    if (reads.size > 200) reads.delete(/** @type {string} */ (reads.keys().next().value));
    return entry.p;
  };
  /** The Changes tab's reads of each place. @type {Map<string, { p: Promise<any>, done: number }>} */
  const changeReads = new Map();
  /**
   * The git marks, each answered at once from its last read (`keptReads`, the slowness of 11-02): a place read whole as
   * `/git/place` answers it — the header's and the panel's —, lightly and `apart` as `/git/where` reads it — the
   * sidebar's —, and a repository's places as `/git/places` lists them — the Space's, a new chat's and a move's. Each
   * is read again behind its answer once `keptMs` old, and where it moved the page is told on the feed (`git-moved`:
   * which read, and each spelling of the folder it was asked by), so it asks again.
   */
  const marks = keptReads({
    freshMs: keptMs,
    most: MARKS_MOST,
    onMoved: (key, asked) => {
      const [what, root] = key.split("\n");
      events?.publish?.("git", { type: "git-moved", what, folders: [...new Set([root, ...asked])] });
    },
  });
  /**
   * A fenced place's mark: `place`, whole, with the lines it holds that its base lacks (the composer's `+N −N`);
   * `apart`, whole where it is kept apart from its base; `light`, its place and branch alone.
   * @param {"place" | "apart" | "light"} what @param {string} root  as the fence gave it @param {string} asked  as the page names it
   * @returns {Promise<import("../../adapters/git/inspect.js").PlaceInfo>}
   */
  const markAt = (what, root, asked) =>
    marks.get(`${what}\n${root}`, () => (what === "place" ? placeInfo(root, { whole: true, sinceBase: true }) : what === "apart" ? apartInfo(root) : placeInfo(root)), { asked });
  /**
   * Filament's footprint in a repository and its Clean up (the footprint plan): the process's one (`a.footprint`,
   * server.js), whose measures what is still open in a chat says too — else one of the area's own, over this Filament's
   * data folder, the registry's word on the helpers its refs and copies name, the archive's on the chats Filament has and
   * deleted, memory's backups' on since when one may hold a chat, every Space's routines with its project's folder.
   */
  const footprint = a.footprint || createFootprint({
    home: String(a.dataDir || ""),
    subagents,
    archive: () => memory?.archive ?? null,
    backups: () => memory?.backups?.heldSince?.() ?? null,
    routines: () =>
      (spaces?.routinesAll?.() || []).map((/** @type {{ project: string, r: { title: string } }} */ { project, r }) => ({
        title: r.title,
        folder: memory?.archive?.getProject?.(project)?.cwd || null,
      })),
    log,
  });
  /**
   * A repository's places as git has them: its worktrees, each read whole, and what goes with each git would let go —
   * its chats, and who is at work there, are the asker's, read at each ask (`rowOf`).
   * @param {string} root  as the fence gave it @param {string} asked
   */
  const placesAt = (root, asked) =>
    marks.get(`places\n${root}`, async () => {
      const wt = await worktreesOf(root);
      if (!wt.ok) return { wt, read: [], goes: [] };
      const into = mainBranch(wt.worktrees);
      const read = await fewAtOnce(wt.worktrees, (w) => readFenced(w, into));
      const goes = await fewAtOnce(read, (p) => (heldBack(p, []) && heldBack(p, [], { branch: true }) ? Promise.resolve(null) : goesWith(p.path)));
      return { wt, read, goes };
    }, { asked });
  /**
   * One place as the Changes tab shows it: its branch, base, ahead and behind, and each uncommitted file with who wrote
   * it — the writing rounds the archive keeps for it in `ROUNDS_BACK_MS`, after the file's last commit. A sub-agent's
   * copy is its own: what no round names there is the sub-agent's (`copyOf`); `stands`, how that sub-agent stands — its
   * status, its round, its work — keys its copy's read, so a read taken before it moved never serves one after (the
   * drive of 10-29: its last round's file was missing from its copy once it ended). A sub-agent's patch workspace, no
   * work tree, is read as one (patch.js `patchPlace`).
   * @param {string} path @param {{ fresh?: boolean, copyOf?: { chain: string, agent: string, at: number } | null, stands?: string }} [o]
   * @returns {Promise<any>}
   */
  const changesAt = (path, { fresh = false, copyOf = null, stands = "" } = {}) =>
    shared(changeReads, `${path}\n${copyOf ? copyOf.agent : ""}\n${stands}`, fresh, async () => {
      const f = allowedFolder(config.get(), path);
      if (!f.ok) return { ...noPlace(path, f.status === 404 ? "the folder is gone" : f.error, { whole: true }), headAt: null, files: [], writers: [], refused: f.status !== 404 };
      const patched = copyOf ? await patchPlace(f.root) : null;
      const p = patched || (await placeChanges(f.root));
      if (!p.ok || !p.place) return { ...p, writers: [] };
      const since = Date.now() - ROUNDS_BACK_MS;
      /** @type {import("../../core/changes-view.js").Round[]} */
      const rounds = memory?.archive?.roundChangesIn?.(p.place, since) || [];
      const named = namedFiles(p.files, rounds);
      const oldest = rounds.length ? Math.min(...rounds.map((x) => x.at)) : since;
      // A patch has no commit of its own: what it changed is none.
      const last = named.length && !patched ? await lastCommits(p.place, oldest, named) : { times: new Map(), error: null };
      if (last.error) log("warn", `git: the commit times in ${p.place} were not all read, so some files may name agents whose edits are committed: ${last.error}`);
      let files = attribute(p.files, rounds, last.times);
      if (copyOf) files = files.map((x) => (x.by.length ? x : { ...x, by: [copyOf] }));
      return { ...p, files, writers: writersOf(files) };
    });
  /** The folder a row works in, or the refusal already sent. @param {any} r */
  const rootOf = (r) => {
    const f = allowedFolder(config.get(), r.url.searchParams.get("cwd"));
    if (!f.ok) {
      sendJson(r.res, f.status, { error: f.error });
      return null;
    }
    return f.root;
  };
  return [
    [
      "GET",
      "/git/status",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        return sendJson(r.res, 200, { cwd: root, ...(await statusOf(root)) });
      }),
    ],
    [
      "GET",
      "/git/log",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        return sendJson(r.res, 200, { cwd: root, ...(await logOf(root, { limit: Number(r.url.searchParams.get("limit")) || 30 })) });
      }),
    ],
    [
      // One place, whole (HarnessV4_Git_Plan GW-D20): the header's. With `chain`, the chat's other places too, each
      // whole or refused in words; one whose folder is gone is left out (`stillThere`). Each place's answer is its last
      // read (`markAt`): every chat shown asks again while it is.
      "GET",
      "/git/place",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        const place = await markAt("place", root, String(r.url.searchParams.get("cwd")));
        const chain = r.url.searchParams.get("chain");
        const others = chain ? /** @type {string[]} */ (memory?.placesOf?.(chain) || []) : [];
        const also = await Promise.all(
          others.filter((p) => p !== place.place && stillThere(p)).map((p) => placeAt(p, { whole: true })),
        );
        return sendJson(r.res, 200, { ...place, cwd: root, also: also.filter((p) => !p.ok || p.place !== place.place) });
      }),
    ],
    [
      // Many folders, lightly (GW-D20): the sidebar's, one read per folder. A refused or missing folder is answered
      // in words, never as the whole request's failure. `apart=1`: each place kept apart from its base — a worktree, a
      // branch other than the base — read whole, what it holds that the base lacks (`apartInfo`): the sidebar's mark of
      // work not on main yet. Each folder's answer is its last read (`markAt`).
      "GET",
      "/git/where",
      guard(async (r) => {
        const asked = [...new Set(r.url.searchParams.getAll("cwd").filter(Boolean))];
        if (asked.length > WHERE_MAX)
          return sendJson(r.res, 400, { error: `at most ${WHERE_MAX} folders in one read; ${asked.length} were asked` });
        const apart = r.url.searchParams.get("apart") === "1";
        const read = await fewAtOnce(asked, (cwd) => placeAt(cwd, { apart }));
        return sendJson(r.res, 200, { places: Object.fromEntries(asked.map((cwd, i) => [cwd, read[i]])) });
      }),
    ],
    [
      // The Changes tab (the Designer's of 10-29, on the owner's words of 10-29: "what agents are writing where into which
      // worktree and what branches and what uncommitted files are there sitting"): by place — the chat's folder, the
      // places its agents wrote in, its sub-agents' own copies, and the repository's other worktrees where an agent
      // wrote in `ROUNDS_BACK_MS` or a chat at home there is at work —, each with its branch and its uncommitted files,
      // and who wrote each. One read of each place serves every ask for `CHANGES_TTL_MS`; `fresh=1` reads anew.
      "GET",
      "/git/changes",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        const q = r.url.searchParams;
        const chain = q.get("chain") || "";
        const fresh = q.get("fresh") === "1";
        const first = await changesAt(root, { fresh });
        if (!first.ok) return sendJson(r.res, 200, { cwd: root, ok: false, error: first.error, places: [], chats: {}, homes: {}, atWork: [] });
        /** Each place once, by how git spells it (a copy by its sub-agent). @type {Map<string, { path: string, kind: "folder" | "wrote" | "copy" | "other", sub?: any, saved?: true }>} */
        const want = new Map([[String(first.place), { path: root, kind: /** @type {const} */ ("folder") }]]);
        const taken = (/** @type {string} */ p) => [...want.keys(), ...[...want.values()].map((w) => w.path)].some((x) => normalizeCwd(x) === normalizeCwd(p));
        for (const p of chain ? /** @type {string[]} */ (memory?.placesOf?.(chain) || []) : [])
          if (stillThere(p) && !taken(p)) want.set(p, { path: p, kind: "wrote" });
        // Its sub-agents that edit in a copy of their own: there from its launch, before its first write.
        for (const sa of chain ? /** @type {any[]} */ (subagents?.list?.(chain) || []) : []) {
          const folder = sa?.may === "edit" ? sa.work?.folder : null;
          if (folder && stillThere(folder) && !taken(folder)) want.set(`copy:${sa.id}`, { path: String(folder), kind: "copy", sub: sa });
          // Its work that waits after its copy's folder went, kept on the repository's refs, which its Apply reads: its
          // copy's block all the same, with nothing of the folder to read (the owner's of 11-10: the tab's dot said it
          // waited, and the tab showed none of it).
          else if (sa?.status !== "running" && Number(sa?.work?.pending) > 0 && !want.has(`copy:${sa.id}`))
            want.set(`copy:${sa.id}`, { path: String(folder || ""), kind: "copy", sub: sa, saved: true });
        }
        // The repository's other worktrees where someone writes: a round in the window, or a chat at home there at work.
        const busy = atWorkNow();
        const wt = await worktreesOf(root);
        if (wt.ok) {
          const others = wt.worktrees.filter((w) => !w.bare && !taken(w.path));
          const homes = others.length ? memory?.chatsIn?.(others.map((w) => w.path)) || new Map() : new Map();
          for (const w of others) {
            const wrote = (memory?.archive?.roundChangesIn?.(w.path, Date.now() - ROUNDS_BACK_MS) || []).length > 0;
            const working = (homes.get(w.path) || []).some((/** @type {{ id: string, home: boolean }} */ c) => c.home && busy.has(c.id));
            if (wrote || working) want.set(w.path, { path: w.path, kind: "other" });
          }
        }
        const more = [...want.values()].slice(1);
        const rest = await fewAtOnce(more, (w) =>
          w.saved ? Promise.resolve({ ok: true, place: null, files: [], saved: true }) : changesAt(w.path, {
            fresh,
            copyOf: w.sub ? { chain, agent: String(w.sub.id), at: Number(w.sub.endedAt || w.sub.startedAt) || Date.now() } : null,
            stands: w.sub ? `${w.sub.status}:${w.sub.progress?.round ?? ""}:${w.sub.work?.sig ?? ""}:${w.sub.work?.pending ?? 0}:${w.sub.work?.applied ?? 0}` : "",
          }));
        const places = [
          { ...first, cwd: root, kind: "folder" },
          ...more.map((w, i) => ({ ...rest[i], cwd: w.path, kind: w.kind, ...(w.sub ? { sub: String(w.sub.id) } : {}) })),
        ];
        // The chats at home in each place, the chats their writers are of, named, and which of them are at work now.
        const read = places.filter((p) => p.ok && p.place).map((p) => String(p.place));
        const homesHere = read.length ? memory?.chatsIn?.(read) || new Map() : new Map();
        /** @type {Record<string, string[]>} */
        const homes = Object.fromEntries(read.map((p) => [p, (homesHere.get(p) || []).filter((/** @type {{ home: boolean }} */ c) => c.home).map((/** @type {{ id: string }} */ c) => String(c.id))]));
        const chains = new Set([...(chain ? [chain] : []), ...places.flatMap((p) => (p.writers || []).map((/** @type {{ chain: string }} */ w) => w.chain))]);
        for (const ids of Object.values(homes)) for (const id of ids) if (busy.has(id)) chains.add(id);
        /** @type {Record<string, { title: string, model: string }>} */
        const chats = {};
        for (const id of chains) {
          const c = memory?.archive?.getChain?.(id);
          if (c) chats[id] = { title: String(c.title || ""), model: String(c.model || "") };
        }
        return sendJson(r.res, 200, { cwd: root, ok: true, error: null, at: Date.now(), places, chats, homes, atWork: [...busy].filter((id) => chains.has(id)) });
      }),
    ],
    [
      // What merging each of the chat's places would bring (HarnessV4_Git_Plan GW-D29): the folder's place first, then
      // every place the chat's agents wrote in (`chain`) that is there still, each read whole or refused in words. With `path`, one file of
      // `place` (the folder's when none is named) with its diff: `part=committed` from where its branch left the base,
      // else uncommitted against HEAD; `old`, a rename's source.
      "GET",
      "/git/branch",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        const q = r.url.searchParams;
        const path = q.get("path");
        if (path) {
          const f = allowedFolder(config.get(), q.get("place") || root);
          if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
          const part = q.get("part") === "committed" ? "committed" : "uncommitted";
          const out = await branchFileOf(f.root, path, { part, oldPath: q.get("old") || null });
          return sendJson(r.res, out.error && /outside the allowed/.test(out.error) ? 403 : 200, out);
        }
        const first = await branchOf(root);
        const chain = q.get("chain");
        const others = (chain ? /** @type {string[]} */ (memory?.placesOf?.(chain) || []) : []).filter((p) => p !== first.place && stillThere(p));
        const rest = await fewAtOnce(others, branchAt);
        return sendJson(r.res, 200, { places: [{ ...first, cwd: root }, ...rest.filter((p) => !p.ok || p.place !== first.place)] });
      }),
    ],
    [
      // The places in the folder's repository (HarnessV4_Git_Plan GW-D38): each worktree git lists, Filament's helper
      // copies left out, read whole, with its chats and Remove or why not, and what goes with a removable one's folder
      // (GW-D36); the worktrees this Filament removed, with their Put back (GW-D37). What git says is the last read
      // (`placesAt`); the chats, and who is at work, are read at each ask.
      "GET",
      "/git/places",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        const { wt, read, goes } = await placesAt(root, String(r.url.searchParams.get("cwd")));
        // A folder in no repository has no places, and still its chats (HarnessV4_SpacesPlugins_Plan A3): a Space of the
        // person's own there says who needs them from these (found by the Hunter on A6: its chats were dropped).
        if (!wt.ok) {
          const busy = atWorkNow();
          const chats = (memory?.chatsIn?.([root])?.get(root) || []).map((/** @type {any} */ c) => ({ ...c, atWork: busy.has(c.id) }));
          return sendJson(r.res, 200, { cwd: root, ok: false, error: wt.error, places: [], removed: [], chats });
        }
        const chats = memory?.chatsIn?.(wt.worktrees.map((/** @type {any} */ w) => w.path)) || new Map();
        const busy = atWorkNow();
        const places = read.map((/** @type {any} */ p, /** @type {number} */ i) => {
          const row = rowOf(p, chats.get(p.path) || [], busy);
          return { ...row, goes: row.removable || row.removableWithBranch ? goes[i] : null };
        });
        const repo = normalizeCwd(wt.common);
        const gone = [...removed.values()].filter((x) => x.repo === repo).map(shownRemoved);
        const name = wt.main ? basename(wt.main) : basename(String(wt.common)).replace(/\.git$/, "");
        return sendJson(r.res, 200, { cwd: root, ok: true, error: null, name, main: wt.main, places, removed: gone });
      }),
    ],
    [
      // Remove a worktree (GW-D35): read again at the click and refused in words where anything moved (GW-D40,
      // GWC-83); then moved aside, git's record of it dropped, its folder deleted — a link as a link. The branch stays —
      // unless `branch` asks it to go too (Remove worktree and branch, the owner's of 11-09): only where the branch it is
      // compared with has every commit of it, read again at the click, and deleted only while it is still at the commit
      // read then. Its Put back makes it again there. `moveChats` (the owner's of 11-09): the chats of Filament's own
      // whose folder it is move to the main folder first, each as Move moves one (sessions/move.js), so none is left
      // naming a folder that is gone — a client's session is its client's, which names its folder at each request. Each
      // move is read first: one that cannot go leaves every chat where it is and the worktree standing, said in words.
      // Once they moved, the worktree is read again: what was written there meanwhile keeps it standing.
      "POST",
      "/git/places/remove",
      guard(async (r) => {
        const b = await r.json();
        const withBranch = b?.branch === true;
        const moveChats = b?.moveChats === true;
        const f = allowedFolder(config.get(), b?.cwd);
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const wt = await worktreesOf(f.root);
        if (!wt.ok) return sendJson(r.res, 409, { error: wt.error });
        const w = wt.worktrees.find((x) => normalizeCwd(x.path) === normalizeCwd(b?.path));
        if (!w) return sendJson(r.res, 404, { error: `not a worktree of this repository: ${b?.path}` });
        const key = normalizeCwd(w.path);
        if (moving.has(key)) return sendJson(r.res, 409, { error: "it is being removed already" });
        moving.add(key);
        let touched = false;
        try {
          const row = rowOf(await readFenced(w, mainBranch(wt.worktrees)), memory?.chatsIn?.(wt.worktrees.map((x) => x.path))?.get(w.path) || [], atWorkNow());
          const why = withBranch ? row.whyBranch : row.why;
          if (why) return sendJson(r.res, 409, { error: `not removed: ${why}` });
          const at = wt.main || String(wt.common);
          /** The chats moved to the main folder. @type {{ id: string, name: string }[]} */
          const moved = [];
          const homes = moveChats ? row.chats.filter((c) => c.home && c.own) : [];
          if (homes.length) {
            const main = wt.main;
            if (!main || !sessions?.move || !sessions?.moveRead) return sendJson(r.res, 409, { error: "not removed: there is no main folder to move its chats to" });
            const to = basename(main);
            /** Why a chat cannot move, in the refusal's words. @param {any} c @param {unknown} why */
            const cannot = (c, why) => `not removed: ${chatNamed(c)} cannot move to ${to} — ${String(why).replace(/^not moved: /, "")}`;
            for (const c of homes) {
              /** @type {any} */
              let plan;
              try {
                plan = await sessions.moveRead(c.id, { place: main });
              } catch (/** @type {any} */ e) {
                return sendJson(r.res, 409, { error: cannot(c, e?.message || e) });
              }
              if (plan.blocked.length) return sendJson(r.res, 409, { error: cannot(c, plan.blocked[0]) });
            }
            for (const c of homes) {
              try {
                await sessions.move(c.id, { to: { place: main } });
                moved.push({ id: c.id, name: c.name });
              } catch (/** @type {any} */ e) {
                const before = moved.length ? `; ${moved.map(chatNamed).join(", ")} moved there already` : "";
                return sendJson(r.res, 409, { error: `${cannot(c, e?.message || e)}${before}`, moved });
              }
            }
            const again = rowOf(await readFenced(w, mainBranch(wt.worktrees)), memory?.chatsIn?.(wt.worktrees.map((x) => x.path))?.get(w.path) || [], atWorkNow());
            const still = withBranch ? again.whyBranch : again.why;
            if (still) return sendJson(r.res, 409, { error: `not removed: ${still}; ${moved.map(chatNamed).join(", ")} moved to ${to} already`, moved });
          }
          touched = true;
          const done = await removeWorktree(at, w.path);
          // What each read of the repository said may have moved, the folder gone or part way: every mark is read anew —
          // and what each chat's Still open says of the folders once its branch went too (`touched`, the reviewer's of
          // 11-10 and the review of 4569417b8: a read between would say the branch merged, and be kept minutes).
          marks.forget();
          if (!done.ok) return sendJson(r.res, 409, { error: done.error, ...(moved.length ? { moved } : {}) });
          /** @type {string | null} why the branch stayed, where it was asked to go */
          let branchStays = null;
          if (withBranch && row.branch && row.commit) {
            const dropped = await dropBranch(at, { name: row.branch, commit: row.commit });
            if (!dropped.ok) branchStays = dropped.error;
          }
          const branchGone = withBranch && !branchStays;
          /** @type {Removed} */
          const rec = { id: randomUUID(), repo: normalizeCwd(wt.common), path: w.path, name: row.name, branch: row.branch, head: row.head, commit: row.commit, at: Date.now(), ...(branchGone ? { branchGone } : {}) };
          removed.set(rec.id, rec);
          // Put back lives as long as this Filament: the commit a branch that went was at is said whole, so it can be
          // made again by hand after a restart.
          log("info", `git: the worktree ${w.path} removed on the developer's click; ${row.branch ? `its branch ${row.branch} ${branchGone ? `went with it (${row.mergedInto} has every commit of it); it was at ${row.commit}: git branch ${row.branch} ${row.commit} makes it again` : `stays${branchStays ? ` (${branchStays})` : ""}`}` : `its commit ${row.head} stays`}`);
          return sendJson(r.res, 200, { ok: true, removed: shownRemoved(rec), left: done.left, ...(branchStays ? { branchStays } : {}), ...(moved.length ? { moved } : {}) });
        } finally {
          moving.delete(key);
          if (touched) openMoved();
        }
      }),
    ],
    [
      // Put a worktree this Filament removed back on its branch, or at its commit (GW-D37); git's refusal in words
      // (GWC-84). After a restart Filament no longer knows the removal: a branch Remove kept stays (GWC-85), and one
      // that went with its worktree is made again by hand, at the commit the removal's log line names.
      "POST",
      "/git/places/put-back",
      guard(async (r) => {
        const b = await r.json();
        const f = allowedFolder(config.get(), b?.cwd);
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const rec = removed.get(String(b?.id || ""));
        const wt = await worktreesOf(f.root);
        if (!rec)
          return sendJson(r.res, 404, { error: "Filament does not know that removal: it restarted since, or it was another repository's. A branch removed with its worktree is made again at the commit Filament's log names for it; any other stays." });
        if (!wt.ok || normalizeCwd(wt.common) !== rec.repo)
          return sendJson(r.res, 404, { error: `That removal was another repository's. ${rec.branchGone ? `The branch ${rec.branch} went with it, at ${rec.commit}.` : rec.branch ? `The branch ${rec.branch} stays.` : `Its commit ${rec.head} stays.`}` });
        const key = normalizeCwd(rec.path);
        if (moving.has(key)) return sendJson(r.res, 409, { error: "it is being put back already" });
        moving.add(key);
        try {
          const done = await putBack(wt.main || String(wt.common), { path: rec.path, branch: rec.branch, head: String(rec.commit || ""), make: !!rec.branchGone });
          marks.forget();
          openMoved();
          if (!done.ok) return sendJson(r.res, 409, { error: done.error });
          removed.delete(rec.id);
          log("info", `git: the worktree ${rec.path} put back on the developer's click`);
          return sendJson(r.res, 200, { ok: true });
        } finally {
          moving.delete(key);
        }
      }),
    ],
    [
      // Filament's footprint in the folder's repository (the footprint plan): its copies with their disk, its refs under
      // refs/filament/ by kind, the branches it made for its routines' runs — each with whether Clean up takes it, why it
      // stays, or whether it goes only where the developer ticks it. A row of its own, which the page reads after the
      // places: the copies' disk is measured within a budget. `plan=1`, the sheet's: each ref that goes, or may go
      // ticked, with the commit it was read at.
      "GET",
      "/git/footprint",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        return sendJson(r.res, 200, { cwd: root, ...(await footprint.read(root, { refs: r.url.searchParams.get("plan") === "1" })) });
      }),
    ],
    [
      // Clean up (the footprint plan), on the developer's press, with the plan the sheet showed (`plan`: its copies, refs
      // and branches as they were read, the groups the developer ticked among them): the repository read again, then
      // only what is in both goes — and the answer says what went and what stayed, with why. One at a time per repository.
      "POST",
      "/git/footprint/clean",
      guard(async (r) => {
        const b = await r.json();
        const f = allowedFolder(config.get(), b?.cwd);
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const pressed = pressedPlanOf(b?.plan);
        if (!pressed.ok) return sendJson(r.res, 400, { error: pressed.error });
        const out = await footprint.clean(f.root, pressed.plan);
        // A copy or a branch gone moves what the places' reads said: every mark is read anew, and Still open's.
        marks.forget();
        openMoved();
        if (!out.ok) return sendJson(r.res, out.status, { error: out.error });
        return sendJson(r.res, 200, out);
      }),
    ],
    [
      "GET",
      "/git/places/new",
      guard(async (r) => {
        // A new worktree as a chat's first send would make it, read only (GW-D44, GW-D45): the page asks on each pause
        // in the name, and the send makes it (POST /sessions with `worktree`).
        const root = rootOf(r);
        if (!root) return;
        const name = String(r.url.searchParams.get("name") || "").trim();
        return sendJson(r.res, 200, await planWorktree(root, name, { refuse: (f) => newFolderRefusal(config.get(), f, { from: root }) }));
      }),
    ],
    [
      "GET",
      "/git/places/template",
      servedGuard(async (r) => {
        // The worktree template of the folder's project (HarnessV4_Four_Plan FO-D40): its list and where it comes from,
        // each entry measured in the place the folder is in, or said not here; `all=1` adds what else the list can
        // hold, for the picker (FO-D32). Read only.
        const root = rootOf(r);
        if (!root) return;
        const t = projects().worktreeTemplate(root);
        const at = await placeInfo(root);
        if (!at.ok || !at.place) return sendJson(r.res, 200, { ...t, ok: false, error: at.error || "not in a git repository", entries: [], candidates: null });
        const place = at.place;
        const entries = await fewAtOnce(t.copy, (p) => measure(place, copyPath(p)));
        const candidates = r.url.searchParams.get("all") === "1" ? await copyCandidates(place) : null;
        return sendJson(r.res, 200, { ...t, ok: true, place, entries, candidates });
      }),
    ],
    [
      "POST",
      "/git/places/template",
      servedGuard(async (r) => {
        // The list saved on the folder's project, the project made where it is new (FO-D35); a path the list cannot
        // hold is refused in words (FOC-68).
        const b = await r.json();
        const f = allowedFolder(config.get(), b?.cwd);
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const t = projects().saveWorktreeTemplate(f.root, b?.copy);
        log("info", `git: the worktree template of ${t.project} saved: ${t.copy.join(", ") || "nothing"}`);
        return sendJson(r.res, 200, { ok: true, ...t });
      }),
    ],
    [
      "GET",
      "/git/branches",
      guard(async (r) => {
        const root = rootOf(r);
        if (!root) return;
        return sendJson(r.res, 200, { cwd: root, ...(await branchesOf(root)) });
      }),
    ],
  ];
}
