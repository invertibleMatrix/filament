// @ts-check
// What this machine has to work with now, for another machine's agents to choose where a task runs (the remote-agents
// plan's p-caps): its CPUs and their load, its memory free, its GPU — NVIDIA's as nvidia-smi says it, Apple Silicon's,
// which shares the machine's memory — and nothing of whose machine it is: no folder, no user, no environment, no key.
// GET /api/machine/caps answers it (http/admin/system.js), to another machine's agents' device too (remote.js
// AGENT_ROUTES), with the coding agents signed in here beside it.
import { execFile } from "node:child_process";
import { arch as osArch, cpus as osCpus, freemem, loadavg, totalmem } from "node:os";

/** How long nvidia-smi has to answer before the GPU counts as unsaid. */
export const GPU_TIMEOUT_MS = 2000;
/** How long nvidia-smi's answer is kept: a list of machines asked twice in a row runs it once. */
export const GPU_KEPT_MS = 5000;
/** How long Windows' CPUs are watched for how busy they are: it keeps no load average (os.loadavg is all zeros there). */
export const SAMPLE_MS = 250;
/** What nvidia-smi is asked: each GPU's name, its memory and what of it is used, in MiB, and how busy it is, in %. */
export const NVIDIA_ARGS = Object.freeze(["--query-gpu=name,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"]);
const MIB = 1024 * 1024;

/**
 * A GPU as the facts say it: its maker's kind, its name, and for NVIDIA's its memory, what of it is used and how busy it
 * is (null where nvidia-smi said "[N/A]"); Apple Silicon's has no memory of its own (`unified`): it is the machine's.
 * @typedef {{ kind: "nvidia", name: string, memoryBytes: number | null, usedBytes: number | null, busyPercent: number | null }
 *   | { kind: "apple", name: string, unified: true }} Gpu
 */
/**
 * What this machine has now (`MachineCaps`): its CPUs — how many, their model, the load average over the last minute
 * where the system keeps one, else how busy they were a moment ago, in % —, its memory free and all of it, its GPUs.
 * @typedef {{ cpu: { count: number, model: string | null, load1: number | null, busyPercent: number | null },
 *   memory: { freeBytes: number, totalBytes: number }, gpus: Gpu[] }} MachineCaps
 */

/** A number nvidia-smi printed, or null where it printed none ("[N/A]", "[Not Supported]"). @param {string | undefined} s */
const numberOf = (s) => {
  const n = Number(String(s ?? "").trim());
  return String(s ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * The GPUs nvidia-smi's answer to NVIDIA_ARGS names, one a line: `name, total MiB, used MiB, busy %`. A line without a
 * name says nothing. @param {string} out @returns {Gpu[]}
 */
export function nvidiaGpus(out) {
  return String(out || "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((s) => s.trim()))
    .filter((p) => p[0])
    .map(([name, total, used, busy]) => {
      const t = numberOf(total);
      const u = numberOf(used);
      return { kind: "nvidia", name, memoryBytes: t === null ? null : t * MIB, usedBytes: u === null ? null : u * MIB, busyPercent: numberOf(busy) };
    });
}

/**
 * A program's output, or null where it is not here, failed or took past `timeoutMs`.
 * @param {string} file @param {readonly string[]} args @param {number} timeoutMs @returns {Promise<string | null>}
 */
const runOut = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    try {
      execFile(file, [...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });

/**
 * How busy the CPUs were between two readings of their times, in %: what they spent on anything but idle. Null where no
 * time passed. @param {{ times: Record<string, number> }[]} a @param {{ times: Record<string, number> }[]} b
 */
export const busyBetween = (a, b) => {
  const sum = (/** @type {{ times: Record<string, number> }[]} */ cs) => cs.reduce((t, c) => ({ all: t.all + Object.values(c.times).reduce((x, y) => x + y, 0), idle: t.idle + c.times.idle }), { all: 0, idle: 0 });
  const x = sum(a);
  const y = sum(b);
  const all = y.all - x.all;
  return all > 0 ? Math.round((100 * (all - (y.idle - x.idle))) / all) : null;
};

/**
 * This machine's caps, read anew at each `read` but for the GPU's, kept GPU_KEPT_MS. Everything is Node's own by default;
 * a test hands in a system of its own.
 * @param {{ platform?: string, arch?: string, cpus?: () => { model: string, times: Record<string, number> }[],
 *   load?: () => number[], free?: () => number, total?: () => number,
 *   run?: (file: string, args: readonly string[], timeoutMs: number) => Promise<string | null>,
 *   wait?: (ms: number) => Promise<void>, now?: () => number }} [o]
 *   `run`: a program's output, or null where it is not here or failed (nvidia-smi's)
 */
export function createMachineCaps({
  platform = process.platform,
  arch = osArch(),
  cpus = osCpus,
  load = loadavg,
  free = freemem,
  total = totalmem,
  run = runOut,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
} = {}) {
  /** @type {{ at: number, gpus: Promise<Gpu[]> } | null} */
  let gpusKept = null;
  /** The GPUs, NVIDIA's first; else Apple Silicon's, the chip's own; else none said (an AMD's or Intel's among them). @returns {Promise<Gpu[]>} */
  const gpusNow = async () => {
    const nvidia = nvidiaGpus((await run("nvidia-smi", NVIDIA_ARGS, GPU_TIMEOUT_MS)) || "");
    if (nvidia.length) return nvidia;
    if (platform === "darwin" && arch === "arm64") return [{ kind: "apple", name: cpus()[0]?.model?.trim() || "Apple Silicon", unified: true }];
    return [];
  };
  /** How loaded the CPUs are: the system's load average where it keeps one, else a moment of them watched. */
  const loadNow = async () => {
    if (platform !== "win32") return { load1: Math.round((load()[0] || 0) * 100) / 100, busyPercent: null };
    const first = cpus();
    await wait(SAMPLE_MS);
    return { load1: null, busyPercent: busyBetween(first, cpus()) };
  };
  return {
    /** @returns {Promise<MachineCaps>} */
    async read() {
      const t = now();
      if (!gpusKept || t - gpusKept.at >= GPU_KEPT_MS) gpusKept = { at: t, gpus: gpusNow().catch(() => []) };
      const [l, gpus] = await Promise.all([loadNow(), gpusKept.gpus]);
      const cs = cpus();
      return { cpu: { count: cs.length, model: cs[0]?.model?.trim() || null, ...l }, memory: { freeBytes: free(), totalBytes: total() }, gpus };
    },
  };
}
