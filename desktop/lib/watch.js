// @ts-check
// The harness, watched from the tray (HarnessV3-Native NA3b): the chats that come to need you — a question, a
// permission, a plan waiting for your yes —, the turns that stop on an error, and the long ones that finish, for the
// app's notifications and its tray's tooltip. Read as the harness's left bar reads its Now, with the harness's own rows
// (src/ui/harness/lib/now.js, which needs no page): the runs list, each followed turn's newest events, the threads of
// the chats whose agents run, the chats' names. And the rows a project's dashboards bring to Your Space (S5b): read
// every 30 s, counted by project. What was there at the first look is not told, as an alert older than the app is not;
// nor what came while Filament went unseen (`OUTAGE_MS`). Every machine the window keeps beside this computer is watched
// the same, each its own watch (`createFleet`, the owner's remote Filament of 11-06, Part 3); each look gives its Now's
// rows and its chats too, which the desk — this computer's page — lists every machine's from (the remote desk of
// 11-22). Nothing here answers, starts or sends but a chat's unread mark on another machine. Plain Node (NA-D13);
// main.js asks it every 10 s.
import { FOLD_TAIL, blankFold, chainsWithThreads, foldEvents, nowRows, runsToFold } from "../../src/ui/harness/lib/now.js";
import { readAgents } from "../../src/ui/harness/lib/agents-since.js";
import { pinnedFetch } from "../../src/cli/pinned.js";
import { machineWatch, pickRoute } from "./machines.js";

/** How often the app watches. */
export const WATCH_MS = 10_000;
/**
 * Filament unseen longer than this — a restart, a machine away, this computer asleep — is an outage: what came meanwhile
 * is learned at the look that sees it again, not told, so a reconnect is no flood of notifications. Unseen is from the
 * end of the last look that saw it to the start of the next, so a slow look is no outage; and it falls between the
 * ticks, never on one (the review of p3-watch): two looks missed are none, what came in them told at the next — three are.
 */
export const OUTAGE_MS = 35_000;
/** A turn this long or longer that finishes is told; a shorter one is not. A team's lead's is told whatever it took. */
export const LONG_MS = 2 * 60_000;
/** The chats' names are read again this often, and at once for a chat the list does not hold yet. */
export const CHATS_MS = 60_000;
/** A chat's threads are read again this often while none of them runs (a waiting Apply, a question): as the harness. */
const THREADS_QUIET_MS = 30_000;
/** Your Space's rows are read this often (S5b): a dashboard's watch looks minutes apart, a source stops after three. */
export const SPACE_MS = 30_000;
/** Each with its repository's remote's key (`remotes=1`), by which the desk lists a repository's on every machine as one; a Filament from before leaves it out. */
const CHATS_PATH = "/memory/sessions?limit=200&kind=interactive,fork,team&remotes=1";
/** The most desk flags a machine's answer is read for. */
const FLAGS_MOST = 32;
/** Your Space's rows, without At a glance: the tray reads no dashboard's source. */
const SPACE_PATH = "/your-space?glance=0";

/**
 * A turn that ended since the last look: its chat, its words, whether it failed, how long it ran, and whether a
 * notification tells it (`told`: failed, long, or a team lead's).
 * @typedef {{ chain: string, title: string, project: string, failed: boolean, ms: number, told: boolean }} Ended
 * @typedef {import("../../src/ui/harness/lib/now.js").NowRow} NowRow
 * @typedef {{ project: string, count: number }} SpaceNew  how many rows came to Your Space since the last read, of one
 *   project, by its name
 * @typedef {{ chain: string, title: string, project: string, projectId: string, cwd: string, when: number, unread: boolean, pinned: boolean, threadOf: string | null, from: string, remoteKey: string | null, kind: "interactive" | "fork" | "team" }} DeskChat
 *   a chat of the machine's as the desk lists it (the remote desk of 11-22): its title, its project's name and id, its
 *   folder, its newest moment (ms), its marks, the chat a thread of it is under, whose agents started it (another
 *   machine's, by name), its repository's remote's key (null: none, or not known yet), and its kind (`team`: a team's
 *   on a chat's side)
 * @typedef {{ needs: NowRow[], works: NowRow[], done: NowRow[] }} NowGroups  Now's three groups, as the harness's left bar has them
 * @typedef {{ needs: number, works: number, needsNew: NowRow[], ended: Ended[], spaceNew: SpaceNew[], rows: NowGroups, recent: DeskChat[], flags: string[] }} Look
 *   `rows`: its Now, Done's chats among them (the unread marks its list says); `recent`: its chats, the newest first;
 *   `flags`: what its Filament does for the desk (`deskFlagsOf`)
 */

/** A chat's own turn, not a sub-agent's run nor a replay. @param {any} r */
const isTurn = (r) => r?.kind === "agent-turn" || r?.kind === "coding-agent";
/**
 * The rows of a list as a row is read: objects alone — another machine's Filament, of another version or none of ours,
 * answers what it likes, and a null among its rows threw out the whole tick, this computer's look with it (the review
 * of p3-watch). @param {unknown} list @returns {any[]}
 */
const rowsOf = (list) => (Array.isArray(list) ? list.filter((r) => !!r && typeof r === "object") : []);
/** The folder's last name. @param {string} p */
const placeName = (p) => String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p);

/** Where a chat opens in the harness: its chat, a thread's on its Sub Agents view. @param {{ chain: string, thread?: string | null }} r */
export const chatRoute = (r) => `#/task/${encodeURIComponent(r.chain)}${r.thread ? "/side" : ""}`;

/** A list row's newest moment: its whole one (`lastAt`), else its day. @param {any} s */
const whenOf = (s) => Number(s.lastAt) || Date.parse(String(s.when || "")) || 0;

/**
 * The chats as the desk lists them, the newest first: what a row of the sidebar names, nothing more — another
 * machine's Filament, of another version, answers what it likes. @param {Iterable<any>} sessions @returns {DeskChat[]}
 */
export const deskChats = (sessions) =>
  [...sessions]
    .filter((s) => typeof s.id === "string" && s.id && !s.archived)
    .map((s) => ({
      chain: s.id,
      title: String(s.title || s.preview || "untitled"),
      project: placeName(String(s.projectName || s.cwd || "")) || "",
      projectId: typeof s.project === "string" ? s.project : "",
      cwd: typeof s.cwd === "string" ? s.cwd : "",
      when: whenOf(s),
      unread: !!s.unread,
      pinned: !!s.pinned,
      threadOf: typeof s.threadOf === "string" && s.threadOf ? s.threadOf : null,
      from: typeof s.fromAgents?.name === "string" ? s.fromAgents.name : "",
      remoteKey: typeof s.remoteKey === "string" && s.remoteKey ? s.remoteKey : null,
      // A team's on a chat's side stands under that chat there, as a thread does: the desk lists neither on its own.
      kind: s.kind === "team" || s.kind === "fork" ? s.kind : "interactive",
    }))
    .sort((a, b) => b.when - a.when);

/**
 * What a machine's Filament does for the desk, by name (its GET /remote/me `desk`, the server's `DESK`): names alone —
 * another machine's Filament, of another version or none of ours, answers what it likes —; none from one from before.
 * @param {any} me @returns {string[]}
 */
export const deskFlagsOf = (me) =>
  Array.isArray(me?.desk) ? [...new Set(me.desk.filter((/** @type {unknown} */ f) => typeof f === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(f)))].slice(0, FLAGS_MOST) : [];

/**
 * @param {{ call: (path: string, init?: any) => Promise<any>, now?: () => number, outageMs?: number }} o
 *   `call`: Filament's admin API by its path under `/api`, its answer read (a failure rejects); `outageMs`: how long
 *   unseen is an outage (Infinity: never — this computer's, which tells after a restart what the restart cut)
 */
export function createWatch({ call, now = () => Date.now(), outageMs = OUTAGE_MS }) {
  /** runId → its fold. @type {Map<string, import("../../src/ui/harness/lib/now.js").RunFold>} */
  const folds = new Map();
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  /** @type {Map<string, number>} */
  const threadsAt = new Map();
  /** @type {Map<string, any>} */
  let chats = new Map();
  let chatsAt = -Infinity;
  /** The chats as the desk lists them, made anew as the list is read again (`deskChats`). @type {DeskChat[]} */
  let recent = [];
  /** chain → its newest turn as the last look saw it. @type {Map<string, { id: string, status: string, lead: boolean }>} */
  const turns = new Map();
  /** What needs you, as the last look saw it: a row and what it waits on. @type {Set<string>} */
  let needing = new Set();
  let primed = false;
  /** When the last look that found Filament answering ended. */
  let seenAt = -Infinity;
  /** Your Space's open rows as its last read saw them; null until its first read, which only learns. @type {Set<string> | null} */
  let spaceOpen = null;
  let spaceAt = -Infinity;
  /** What its Filament does for the desk as last read (`deskFlagsOf`), read again at the chats' pace. @type {string[]} */
  let flags = [];
  let flagsAt = -Infinity;

  /** Its desk flags read at the chats' pace; a read that fails keeps the last. @param {number} t */
  async function readFlags(t) {
    if (t - flagsAt < CHATS_MS) return;
    const me = await call("/remote/me").catch(() => null);
    if (me) [flags, flagsAt] = [deskFlagsOf(me), t];
  }

  /**
   * Your Space read at its pace (S5b, A8): the rows Filament keeps that are open now and were not at its last read,
   * counted by project — a row put off that comes back by itself is new again. None at its first read, nor between.
   * @param {number} t @returns {Promise<SpaceNew[]>}
   */
  async function readSpace(t) {
    if (t - spaceAt < SPACE_MS) return [];
    const r = await call(SPACE_PATH).catch(() => null);
    if (!r) return [];
    spaceAt = t;
    const names = new Map(rowsOf(r.projects).map((p) => [String(p.id), String(p.name || "")]));
    const open = rowsOf(r.needs).filter((n) => n.state === "open");
    const key = (/** @type {any} */ n) => `${n.project}\n${n.id}`;
    const was = spaceOpen;
    spaceOpen = new Set(open.map(key));
    if (!was) return [];
    /** @type {Map<string, number>} */
    const by = new Map();
    for (const n of open) {
      if (was.has(key(n))) continue;
      const name = names.get(String(n.project)) || "a project";
      by.set(name, (by.get(name) || 0) + 1);
    }
    return [...by].map(([project, count]) => ({ project, count }));
  }

  /** @param {string} chain @returns {import("../../src/ui/harness/lib/now.js").ChatFacts | null} */
  const facts = (chain) => {
    const s = chats.get(chain);
    return s ? { title: String(s.title || s.preview || "untitled"), project: placeName(String(s.projectName || s.cwd || "")) || "", when: whenOf(s), unread: !!s.unread } : null;
  };
  /** @param {any} r */
  async function readFold(r) {
    const had = folds.get(r.id);
    if (had && r.status === "paused") return;
    const f = had || blankFold();
    const since = Math.max(f.n, (Number(r.events) || 0) - FOLD_TAIL);
    const page = await call(`/runs/${encodeURIComponent(r.id)}/events?since=${since}&limit=${FOLD_TAIL}`).catch(() => null);
    if (!page) return;
    foldEvents(f, rowsOf(page.events));
    folds.set(r.id, f);
  }
  /** @param {string} chain */
  async function readThreads(chain) {
    // As the rows that moved since the last read of the chat's list (`readAgents`, the slowness of 11-02).
    const r = await readAgents(chain, call).catch(() => null);
    threadsAt.set(chain, now());
    if (r) threads.set(chain, rowsOf(r.subagents));
  }

  /** One look; null where Filament did not answer. @returns {Promise<Look | null>} */
  async function look() {
    const asked = now();
    const listed = await call("/runs?limit=50").catch(() => null);
    if (!listed) return null;
    const runs = rowsOf(listed.runs);
    const t = now();
    // The first look, and the first after an outage, learn what is there and tell none of it.
    const quiet = !primed || asked - seenAt > outageMs;
    const unknown = runs.some((/** @type {any} */ r) => isTurn(r) && r.meta?.chain && !chats.has(String(r.meta.chain)));
    if (t - chatsAt >= CHATS_MS || unknown) {
      const c = await call(CHATS_PATH).catch(() => null);
      if (c) {
        [chats, chatsAt] = [new Map(rowsOf(c.sessions).map((s) => [String(s.id), s])), t];
        recent = deskChats(chats.values());
      }
    }
    const follow = runsToFold(runs);
    for (const id of [...folds.keys()]) if (!follow.some((r) => r.id === id)) folds.delete(id);
    const crews = chainsWithThreads(runs);
    for (const c of [...threads.keys()]) if (!crews.includes(c)) [threads.delete(c), threadsAt.delete(c)];
    const due = (/** @type {string} */ chain) => !threads.has(chain) || runs.some((/** @type {any} */ r) => r.kind === "subagent" && r.endedAt == null && String(r.meta?.chain || "") === chain) || t - (threadsAt.get(chain) || 0) >= THREADS_QUIET_MS;
    const [spaceNew] = await Promise.all([readSpace(t), readFlags(t), ...follow.map(readFold), ...crews.filter(due).map(readThreads)]);
    // Done's chats as the list marks them unread, as the harness's own Now has them: the desk draws every group.
    const unread = new Set([...chats].filter(([, s]) => s.unread).map(([chain]) => chain));
    const g = nowRows({ runs, folds, threads, chats: facts, unread, holders: new Map(), now: t });

    // What needs you: each row once for what it waits on; a new question in the same chat is told again.
    const asks = g.needs.filter((r) => r.tone === "asks");
    const was = needing;
    needing = new Set(asks.map((r) => `${r.key}\n${r.fact}`));
    const needsNew = quiet ? [] : asks.filter((r) => !was.has(`${r.key}\n${r.fact}`));

    // Each chat's newest turn: one that ran at the last look and has ended since — after an outage listed for its unread
    // mark, and told of none.
    /** @type {Ended[]} */
    const ended = [];
    const seen = new Set();
    let marked = false;
    for (const r of runs) {
      const chain = String(r.meta?.chain || "");
      if (!isTurn(r) || !chain || seen.has(chain)) continue;
      seen.add(chain);
      const before = turns.get(chain);
      const lead = g.works.some((w) => w.chain === chain && !w.thread && !!w.team) || (before?.id === r.id && !!before?.lead);
      turns.set(chain, { id: r.id, status: String(r.status), lead });
      if (!primed || !before || before.id !== r.id || before.status !== "running") continue;
      if (r.status === "running" || r.status === "paused") continue;
      // Its end marks it unread there in a moment — its page, or this app's `markUnread` —: the chats are read again at
      // the next look, so the desk's Done has it then, not at the list's next minute (the review of s1a).
      marked = true;
      if (r.status === "stopped" || r.status === "aborted") continue;
      const failed = r.status === "error" || r.status === "failed";
      const ms = Math.max(0, (Number(r.endedAt) || t) - (Number(r.startedAt) || t));
      const f = facts(chain);
      ended.push({ chain, title: f?.title || "a chat", project: f?.project || "", failed, ms, told: !quiet && (failed || ms >= LONG_MS || lead) });
    }
    if (marked) chatsAt = -Infinity;
    primed = true;
    seenAt = now();
    return { needs: asks.length, works: g.works.length, needsNew, ended, spaceNew: quiet ? [] : /** @type {SpaceNew[]} */ (spaceNew), rows: g, recent, flags };
  }
  return {
    look,
    /** Its chats read again at the next look: a mark changed there that the desk lists them by. */
    reread: () => void (chatsAt = -Infinity),
  };
}

/**
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Route} Route
 * @typedef {{ id: string, name: string, partition: string, status: import("./machines.js").MachineStatus, why: string | null, refused: boolean, needs: number, look: Look | null }} MachineLook
 *   one machine as a tick found it: `look` null where it was not watched this time (no way to it answered as it, or its
 *   Filament did not answer); `refused`: it answers, and refuses this window's sign-in (revoked there, or never paired)
 */

/** How long one call to another machine waits. */
const CALL_MS = 5000;
/**
 * How long a tick waits on the machines' looks: one not done by then is said at the tick after it lands, so a slow
 * machine — a tunnel, a busy Filament, a way that no longer answers — holds up no other's notes, this computer's
 * included (the review of p3-watch).
 */
export const FLEET_WAIT_MS = 3000;

/** The fetch a route is read with: the network's over its pinned certificate alone, any other Node's own. @param {Route} route */
export const routeFetch = (route) => (route.kind === "lan" ? pinnedFetch(String(/** @type {any} */ (route).fingerprint)) : fetch);

/** Whether two routes are one way: its kind, its address and its pin. @param {Route} a @param {Route} b */
const sameRoute = (a, b) => a.kind === b.kind && a.url === b.url && (/** @type {any} */ (a).fingerprint ?? null) === (/** @type {any} */ (b).fingerprint ?? null);

/**
 * Every machine the window keeps beside this computer, watched as this computer is (the owner's remote Filament of 11-06,
 * Part 3): one watch each (`createWatch`), the window open or not, its view shown or not. Its calls go to the first of
 * its ways where that machine's own id answers (`pickRoute`, cookie-less, over the pinned certificate on the network),
 * with the sign-in its partition's session holds — the rail's pairing put it there (`cookieOf`) — over Node's fetch,
 * pinned as the pick was: never through the partition's own network, whose certificate check is the rail's (lib/rail.js
 * `arm`). The way is asked again before each look, so the sign-in goes only where the machine answered as itself just
 * now, and only while the machine still lists it; one that stopped answering is picked anew aside from the tick. A tick
 * waits on no machine longer than `FLEET_WAIT_MS`, and one whose look threw — on rows it does not read — did not
 * answer. A machine back after an outage learns what came meanwhile (`OUTAGE_MS`): no flood. One removed — or
 * disconnected (`off`), its ways not even asked — is told of nothing more, nor written to. Nothing here answers, starts or sends but a chat's unread mark (`markUnread`).
 * @param {{ machines: () => Machine[], cookieOf: (partition: string, origin: string) => Promise<string>, pick?: typeof pickRoute,
 *   fetchOf?: (route: Route) => typeof fetch, now?: () => number, wait?: (ms: number) => Promise<unknown> }} o
 *   `machines`: the machines kept, read now; `cookieOf`: the Cookie header the machine's partition sends that origin (""
 *   where it holds none); `wait`: a tick's wait on the looks under way
 */
export function createFleet({ machines, cookieOf, pick = pickRoute, fetchOf = routeFetch, now = Date.now, wait = (ms) => new Promise((r) => void setTimeout(r, ms).unref?.()) }) {
  /**
   * id → the machine as last read, the way it is reached (null: none answered as it yet), its pick on its way, its
   * watch, its state and what it said last, its look under way and one landed that no tick has said yet, and how the
   * last call of its look failed (its status; 0: nothing answered).
   * @typedef {{ machine: Machine, route: Route | null, picking: Promise<void> | null, why: string | null, watch: ReturnType<typeof createWatch>,
   *   watched: import("./machines.js").Watched | null, last: MachineLook | null, looking: Promise<void> | null, landed: MachineLook | null, failed: number | null }} Kept
   * @type {Map<string, Kept>}
   */
  const kept = new Map();
  /** The machines watched: each kept beside this computer but one disconnected, which is as if removed until it is connected again. */
  const watchedNow = () => machines().filter((m) => !m.local && !m.off);

  /**
   * Its admin API at the way picked: its path under /api, the answer read, the sign-in its partition holds; nothing
   * followed elsewhere. A refusal rejects with its status, its body let go — one unread holds its connection until it is
   * collected (the review of p3-watch).
   * @param {Kept} k @param {string} path @param {any} [init]
   */
  const send = async (k, path, init = {}) => {
    const route = k.route;
    if (!route) throw new Error("no way to it answers");
    const origin = new URL(String(route.url)).origin;
    const cookie = await cookieOf(k.machine.partition, origin).catch(() => "");
    const r = await fetchOf(route)(`${origin}/api${path}`, {
      ...init,
      headers: { "x-filament-ui": "1", ...(cookie ? { cookie } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(CALL_MS),
    });
    if (!r.ok) {
      void r.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    }
    return r.json();
  };

  /** @param {Machine} m @returns {Kept} */
  const keptOf = (m) => {
    const had = kept.get(m.id);
    if (had) {
      had.machine = m;
      return had;
    }
    /** @type {Kept} */
    const k = /** @type {any} */ ({ machine: m, route: null, picking: null, why: null, watched: null, last: null, looking: null, landed: null, failed: null });
    // Its watch's calls say how the last of them failed, for its look to read; a chat's unread mark says nothing there
    // — a refusal of it, a view-only device's, is no refusal of the look under way (the review of p3-watch).
    k.watch = createWatch({
      call: (path, init) =>
        send(k, path, init).catch((/** @type {any} */ e) => {
          k.failed = Number(e?.status) || 0;
          throw e;
        }),
      now,
    });
    kept.set(m.id, k);
    return k;
  };

  /** The machine's ways asked, aside from the tick: the first where it answers as itself is the one its calls take. @param {Kept} k */
  const pickFor = (k) => {
    if (k.picking) return;
    k.picking = pick(k.machine)
      .then(
        (r) => {
          if (kept.get(k.machine.id) !== k) return;
          k.route = r.route;
          k.why = r.route ? null : (r.tried.at(-1)?.why ?? null);
        },
        (/** @type {any} */ e) => void (k.why = String(e?.message || e)),
      )
      .finally(() => void (k.picking = null));
  };

  /** @param {Kept} k @param {{ answered: boolean, refused?: boolean, look?: Look | null }} o @returns {MachineLook} */
  const said = (k, { answered, refused = false, look = null }) => {
    k.watched = machineWatch(k.watched, { answered, why: k.why }, now());
    const m = k.machine;
    return (k.last = { id: m.id, name: m.name, partition: m.partition, status: k.watched.status, why: k.watched.why, refused, needs: look ? look.needs : 0, look });
  };
  /** A machine whose look is still under way: as it last stood, with no look. @param {Kept} k @returns {MachineLook} */
  const standing = (k) => {
    const m = k.machine;
    const was = k.last;
    return { id: m.id, name: m.name, partition: m.partition, status: was?.status ?? "reconnecting", why: was ? was.why : k.why, refused: was?.refused ?? false, needs: was?.needs ?? 0, look: null };
  };

  /** @param {Kept} k @returns {Promise<MachineLook>} */
  async function lookAt(k) {
    const m = k.machine;
    // A way the machine no longer lists is asked nothing: its address may be another's now (the review of p3-watch).
    const listed = k.route;
    if (listed && !m.routes.some((r) => sameRoute(r, listed))) k.route = null;
    if (k.route) {
      // Its way asked again, cookie-less: the sign-in goes where the machine's own id answers now, and nowhere else.
      const r = await pick({ ...m, routes: [k.route] }).catch(() => null);
      if (!r?.route) {
        k.route = null;
        k.why = r?.tried.at(-1)?.why ?? k.why;
      }
    }
    const route = k.route;
    if (!route) {
      pickFor(k);
      return said(k, { answered: false });
    }
    k.failed = null;
    /** @type {Look | null} */
    let look = null;
    let threw = false;
    try {
      look = await k.watch.look();
    } catch {
      // Rows it does not read: no answer this app can tell of.
      threw = true;
    }
    if (look) return said(k, { answered: true, look });
    // It answers as itself and refuses this window's sign-in: revoked there, or never paired.
    const refused = !threw && (k.failed === 401 || k.failed === 403);
    if (!refused) {
      const at = new URL(String(route.url)).origin;
      k.why = threw ? `${at} answered what this app does not read` : `${at} did not answer`;
      k.route = null;
    }
    return said(k, { answered: refused, refused });
  }

  /**
   * A chat's unread mark there, set or taken off: nothing else. A view-only device's is refused there, and that is all;
   * one removed or disconnected is written nothing. A mark taken off has the chats read again at its next look.
   * @param {string} id @param {string} chain @param {boolean} unread @returns {Promise<void>}
   */
  function mark(id, chain, unread) {
    const k = kept.get(id);
    if (!k?.route || !watchedNow().some((m) => m.id === id)) return Promise.resolve();
    return send(k, `/sessions/${encodeURIComponent(chain)}/settings`, { method: "PATCH", body: JSON.stringify({ patch: { display: { unread } } }) }).then(
      () => void (unread || k.watch.reread()),
      () => {},
    );
  }

  return {
    /**
     * Every machine kept beside this computer looked at once, the tick waiting on none longer than `FLEET_WAIT_MS`: a
     * look landed since the last tick is said, one under way is said as the machine last stood. One removed is forgotten.
     * `only`: those machines alone looked at — their events stream said something moved there (lib/desk.js) —, every
     * other said as it last stood, what landed for it kept for the tick that says it (the review of s1e: one busy machine
     * had every machine looked at each second).
     * @param {{ only?: ReadonlySet<string> | null }} [o] @returns {Promise<MachineLook[]>}
     */
    async look({ only = null } = {}) {
      const list = watchedNow();
      for (const id of [...kept.keys()]) if (!list.some((m) => m.id === id)) kept.delete(id);
      const ks = list.map(keptOf);
      const asked = only ? ks.filter((k) => only.has(k.machine.id)) : ks;
      // A look starts where none is under way and none landed that no tick has said.
      for (const k of asked)
        if (!k.looking && !k.landed)
          k.looking = lookAt(k)
            .then(
              (got) => void (k.landed = got),
              () => void (k.landed = said(k, { answered: false })),
            )
            .finally(() => void (k.looking = null));
      await Promise.race([Promise.all(asked.map((k) => k.looking)), wait(FLEET_WAIT_MS)]);
      // One removed while its look was under way is told of nothing (the review of p3-watch).
      const still = watchedNow();
      return ks
        .filter((k) => kept.get(k.machine.id) === k && still.some((m) => m.id === k.machine.id))
        .map((k) => {
          if (!asked.includes(k)) return standing(k);
          const got = k.landed;
          k.landed = null;
          return got ?? standing(k);
        });
    },
    /**
     * A chat of that machine's marked unread there, as its harness's page marks a turn that ended where no page of it is
     * open: a view-only device's mark is refused there, and that is all. A machine removed since its look is written
     * nothing (the review of p3-watch).
     * @param {string} id @param {string} chain
     */
    markUnread: (id, chain) => mark(id, chain, true),
    /**
     * A chat of that machine's marked seen there, as its own page marks one opened — the desk's Done cleared (the remote
     * desk of 11-22) —, and read again at its next look, so the desk's Done has it no more. @param {string} id @param {string} chain
     */
    markSeen: (id, chain) => mark(id, chain, false),
  };
}
