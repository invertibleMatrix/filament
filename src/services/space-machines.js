// @ts-check
// One project's Space fed by every machine (the remote-agents plan's sp-cross): what another machine's Spaces of the same
// repository write — their What happened lines and their open rows of Needs you — shows in this machine's Space of it.
// This Filament pulls, through the agents' device it keeps on each machine (services/machines): a laptop asleep or behind
// a NAT cannot reach this one, and the device is kept here already. Every `everyMs` while Filament runs, each Space here
// whose project's folder has a git remote asks each such machine's GET /api/spaces/machine-feed for that remote, since
// where its feed left off (spaces.js `fedFrom`), and the store writes what came (`machineFed`) — a page more at once where
// the feed says there is more. A machine that does not answer in `timeoutMs` — each call —, or refuses — its agents'
// grant switched off, the device revoked, its chats' folders unread —, is asked again after `backOffMs`, said once in the
// log; a feed that leaves out Spaces past the most one carries is said once too. Nothing is asked where no machine is
// kept for the agents, nor where no Space's project has a remote; a folder's remote is read once, and again every `remoteMs`.

/** How often the machines' feeds are asked, while Filament runs. */
export const SPACE_MACHINES_MS = 60_000;
/** The most pages one Space reads from one machine in a pull: a feed far behind catches up over the next pulls. */
const PAGES = 5;

/**
 * @param {{
 *   spaces: Pick<import("./spaces.js").SpaceStore, "projects" | "has" | "get" | "fedFrom" | "machineFed">,
 *   machines: Pick<import("./machines/index.js").Machines, "list" | "clientOf"> | null,
 *   folderOf: (project: string) => string | null,
 *   remoteOf: (folder: string) => Promise<{ url: string } | null>,
 *   log?: (level: string, msg: string) => void, everyMs?: number, backOffMs?: number, remoteMs?: number,
 *   timeoutMs?: number, now?: () => number,
 * }} o
 *   `folderOf`: a project's folder, as the archive keeps it; `remoteOf`: a folder's remote, its URL without credentials
 *   (adapters/git/inspect.js); `timeoutMs`: how long a machine has to answer each call
 */
export function createSpaceMachines({ spaces, machines, folderOf, remoteOf, log = () => {}, everyMs = SPACE_MACHINES_MS, backOffMs = 5 * everyMs, remoteMs = 10 * everyMs, timeoutMs = 10_000, now = Date.now }) {
  /** Each folder's remote as last read, and when. @type {Map<string, { url: string | null, at: number }>} */
  const remotes = new Map();
  /** The machines that did not answer or refused, until when each rests, and the words it was said with. @type {Map<string, { until: number, words: string }>} */
  const resting = new Map();
  /** How many Spaces each machine's feed of each Space here left out past its most, as last said. @type {Map<string, number>} */
  const pastSaid = new Map();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let started = false;
  let stopped = false;
  /** The pull under way, which another waits for. @type {Promise<void> | null} */
  let running = null;

  /** A folder's remote's URL, read again after `remoteMs`; null for none. @param {string} folder */
  async function remoteFor(folder) {
    const kept = remotes.get(folder);
    if (kept && now() - kept.at < remoteMs) return kept.url;
    const url = (await remoteOf(folder).catch(() => null))?.url || null;
    remotes.set(folder, { url, at: now() });
    return url;
  }

  /** The Spaces here whose project's folder has a remote, each with it: a Space of the person's own is no project's. */
  async function withRemotes() {
    /** @type {{ project: string, url: string }[]} */
    const out = [];
    for (const project of spaces.projects()) {
      if (!spaces.has(project) || spaces.get(project).own) continue;
      const folder = folderOf(project);
      const url = folder ? await remoteFor(folder) : null;
      if (url) out.push({ project, url });
    }
    return out;
  }

  /**
   * One machine's feed of each Space here: its client made once — the machine at its address asked who it is, the
   * device asked whether it is still let in —, then each Space's feed, a page more while it says there is more, each
   * call bound by `timeoutMs`. A Space the store will not write (deleted meanwhile) is said and left; a machine that fails rests.
   * @param {import("./machines/index.js").Machine} m @param {{ project: string, url: string }[]} projects
   */
  async function feedFrom(m, projects) {
    const machine = { id: m.machine.id, name: m.machine.name || m.name };
    try {
      const client = await /** @type {NonNullable<typeof machines>} */ (machines).clientOf(m, { agents: true, timeoutMs });
      for (const { project, url } of projects)
        for (let page = 0; page < PAGES && !stopped; page++) {
          const since = JSON.stringify(spaces.fedFrom(project, machine.id));
          const got = await client.get(`/spaces/machine-feed?remote=${encodeURIComponent(url)}&since=${encodeURIComponent(since)}`, { timeoutMs });
          const fed = Array.isArray(got?.spaces) ? got.spaces : [];
          const past = Number(got?.past) > 0 ? Number(got.past) : 0;
          const key = `${machine.id} ${project}`;
          if ((pastSaid.get(key) ?? 0) !== past) {
            if (past) log("warn", `space: ${machine.name} has ${past} more Space${past === 1 ? "" : "s"} of ${url} than one feed carries: ${past === 1 ? "it is" : "they are"} not fed here, and no row here closes as gone from ${machine.name}'s Spaces meanwhile`);
            pastSaid.set(key, past);
          }
          try {
            // As it came: an answer with no list of Spaces names none, and closes none; one cut by its limit closes none
            // of the Spaces it left out.
            spaces.machineFed(project, { machine, spaces: got?.spaces, past });
          } catch (/** @type {any} */ e) {
            log("warn", `space: what ${machine.name} fed the Space of ${project} was not written (${String(e?.message || e).slice(0, 160)})`);
            break;
          }
          if (!fed.some((/** @type {any} */ s) => s?.more === true)) break;
        }
      if (resting.delete(machine.id)) log("info", `space: ${machine.name} feeds its Spaces here again`);
    } catch (/** @type {any} */ e) {
      const words = String(e?.message || e).slice(0, 300);
      if (resting.get(machine.id)?.words !== words) log("warn", `space: ${machine.name} fed no Space here (${words}); it is asked again in ${Math.round(backOffMs / 60_000) || 1} min`);
      resting.set(machine.id, { until: now() + backOffMs, words });
    }
  }

  /** One pull: every machine kept for the agents that is not resting, each Space here with a remote, in parallel by machine. */
  async function pullOnce() {
    const kept = (machines?.list() || []).filter((m) => m.device?.scope === "agent" && (resting.get(m.machine.id)?.until ?? 0) <= now());
    if (!kept.length) return;
    const projects = await withRemotes();
    if (!projects.length) return;
    await Promise.all(kept.map((m) => feedFrom(m, projects)));
  }

  /** The next pull, `everyMs` after this one ends. */
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => void pull().finally(arm), everyMs);
    timer.unref?.();
  }

  /** A pull now, once the one under way has ended: what it wrote is read by the next. */
  async function pull() {
    while (running) await running.catch(() => {});
    running = pullOnce()
      .catch((/** @type {any} */ e) => log("warn", `space: the machines' feeds were not read (${String(e?.message || e).slice(0, 160)})`))
      .finally(() => (running = null));
    return running;
  }

  return {
    /** The pulls begin: one now, then every `everyMs`. */
    start() {
      if (started || stopped) return;
      started = true;
      void pull().finally(arm);
    },
    /** No pull more; one under way ends with its calls. */
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    pull,
  };
}

/** @typedef {ReturnType<typeof createSpaceMachines>} SpaceMachines */
