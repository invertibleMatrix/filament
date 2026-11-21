// @ts-check
// Filament's memory, written down as it goes (the owner's of 11-17: a chat window reached 13 GB and the server's floor
// climbed to 1.9 GB over a day, and all anyone had was a sampler run by hand): each minute the app reads its
// processes' memory (Electron's `app.getAppMetrics()`), and every ten minutes it writes one line of it, always — the
// curve is the evidence — to `memory.log` beside `server.log`, a file of its own so the server's output never rotates
// it away. Each process's private memory now and its most since the last line (the spikes are peaks, not floors), the
// windows named, and the server's own census (src/services/memory-log.js), posted over its port, with its age: the last
// one a server sent before it hung is the one that matters. A server that ends writes a line at once, its last numbers
// in it. A Filament the app attached to, or one run from a terminal, posts none, and the line says so. Plain Node:
// main.js hands it Electron's.

/** How often the processes are read, ms. */
export const SAMPLE_EVERY_MS = 60_000;
/** Every how many readings a line is written: ten minutes. */
export const LINE_EVERY = 10;
/** A census older than this is marked stale in the line, ms: the server stopped posting (hung, or ended). */
export const CENSUS_STALE_MS = 3 * SAMPLE_EVERY_MS;

/**
 * One process as `app.getAppMetrics()` gives it, as far as this reads it. Memory in KB; `privateBytes` is Windows'.
 * @typedef {{ pid: number, type: string, name?: string, serviceName?: string, memory?: { workingSetSize?: number, peakWorkingSetSize?: number, privateBytes?: number } }} ProcessMetric
 */

/** A window the app holds, named, with its page's process. @typedef {{ name: string, pid: number }} NamedWindow */

/** What was seen of a process last: MB now, its most since the last line, when, and which measure it is. @typedef {{ mb: number, peakMB: number, at: number, measure: "private" | "working set" }} Seen */

/** @param {number} kb */
const mbOfKB = (kb) => Math.round((Number(kb) || 0) / 1024);

/**
 * The sampler. `metrics` reads the processes, `windows` names the windows' pages' processes, `write` takes a line.
 * `sample()` reads once (main calls it each minute) and writes the first reading's line and every `LINE_EVERY`th
 * after; `serverStarted(pid)` names the app's own server's process (its fork's pid); `heard(census)` keeps what that
 * server posted; `serverEnded(code)` writes its last line at once and forgets it; `lastOf(pid)` is what was seen of a
 * process last, for a crash's line (lib/renderer-watch.js). A reading that fails writes a line that says so.
 * @param {{ metrics: () => ProcessMetric[], windows: () => NamedWindow[], write: (line: string) => void, now?: () => number }} o
 */
export function createMemorySampler({ metrics, windows, write, now = Date.now }) {
  /** @type {Map<number, Seen>} */
  const last = new Map();
  /** The app's own server: its process and the last census it posted. @type {{ pid: number, census: any, at: number } | null} */
  let server = null;
  let readings = 0;
  const iso = () => new Date(now()).toISOString();
  /** @param {ProcessMetric} p */
  const seenOf = (p) => (p.memory?.privateBytes != null ? { mb: mbOfKB(p.memory.privateBytes), measure: /** @type {const} */ ("private") } : { mb: mbOfKB(p.memory?.workingSetSize ?? 0), measure: /** @type {const} */ ("working set") });
  /**
   * What each process is: the app itself, Filament's server (by its pid, else by Electron's name for it), a window
   * (named: every window on one process), the GPU, another.
   * @param {ProcessMetric} p @param {Map<number, string[]>} named
   */
  const kindOf = (p, named) => {
    if (p.type === "Browser") return { kind: "app" };
    if (server?.pid ? p.pid === server.pid : p.type === "Utility" && /filament server/i.test(`${p.name || ""} ${p.serviceName || ""}`)) return { kind: "server" };
    if (named.has(p.pid)) return { kind: "window", name: /** @type {string[]} */ (named.get(p.pid)).join(" + ") };
    if (p.type === "GPU") return { kind: "gpu" };
    return { kind: String(p.type || "other").toLowerCase(), ...(p.name ? { name: String(p.name) } : {}) };
  };
  /** The server's census as a line says it: with its age, stale past `CENSUS_STALE_MS`; absent where none was heard. */
  const censusNow = () => {
    if (!server?.census) return "absent: no census heard from this server (one the app attached to, or none posted yet)";
    const ageS = Math.round((now() - server.at) / 1000);
    return { ...server.census, ageS, ...(ageS * 1000 > CENSUS_STALE_MS ? { stale: true } : {}) };
  };
  return {
    sample() {
      /** @type {ProcessMetric[]} */
      let read;
      /** @type {NamedWindow[]} */
      let named;
      try {
        read = metrics() || [];
        named = windows() || [];
      } catch (e) {
        write(JSON.stringify({ at: iso(), error: `the processes could not be read: ${/** @type {any} */ (e)?.message || e}` }));
        return;
      }
      const t = now();
      const alive = new Set();
      for (const p of read) {
        alive.add(p.pid);
        const s = seenOf(p);
        last.set(p.pid, { ...s, peakMB: Math.max(s.mb, last.get(p.pid)?.peakMB ?? 0), at: t });
      }
      for (const pid of [...last.keys()]) if (!alive.has(pid)) last.delete(pid);
      if (readings++ % LINE_EVERY !== 0) return;
      /** @type {Map<number, string[]>} */
      const byPid = new Map();
      for (const w of named) if (w.pid > 0) byPid.set(w.pid, [...(byPid.get(w.pid) || []), w.name]);
      const procs = read.map((p) => {
        const seen = last.get(p.pid);
        return { ...kindOf(p, byPid), pid: p.pid, mb: seen?.mb ?? 0, peakMB: seen?.peakMB ?? 0, wsMB: mbOfKB(p.memory?.workingSetSize ?? 0) };
      });
      const total = procs.reduce((a, p) => a + p.mb, 0);
      write(JSON.stringify({ at: iso(), totalMB: total, procs, server: censusNow() }));
      // The most since the last line starts again from what each is now.
      for (const [pid, s] of last) last.set(pid, { ...s, peakMB: s.mb });
    },
    /** The app's own server started, as this process. @param {number} pid */
    serverStarted(pid) {
      server = { pid: Number(pid) || 0, census: null, at: 0 };
    },
    /** What the server posted of itself. @param {unknown} census */
    heard(census) {
      if (!census || typeof census !== "object") return;
      server = { pid: server?.pid ?? 0, census, at: now() };
    },
    /** The app's own server ended: its last line now — its exit, what was seen of it, its last census — and it is forgotten. @param {number | null} code */
    serverEnded(code) {
      const pid = server?.pid ?? 0;
      write(JSON.stringify({ at: iso(), serverEnded: { exitCode: code ?? null, pid, last: pid ? (last.get(pid) ?? null) : null, census: censusNow() } }));
      server = null;
    },
    /** @param {number} pid @returns {Seen | null} */
    lastOf(pid) {
      return last.get(pid) ?? null;
    },
  };
}
