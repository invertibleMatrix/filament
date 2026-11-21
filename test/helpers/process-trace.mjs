// @ts-check
// A trace of every process the suite starts, for the day a test fails only under the full suite's load
// (HarnessV4_Tasks C15): who started what, how each ended, and which ids each taskkill named. Not a test, and loaded
// by nothing: it is run by hand, two ways.
//
//   Trace a run (every Node process the run starts loads this file and appends to the trace file):
//     FILAMENT_PROCESS_TRACE=<file> NODE_OPTIONS=--import=file:///<this file> node --test "test/*.test.js"
//   NODE_OPTIONS' --import loads it in every worker thread too, so git()'s processes, started on the threads of
//   src/adapters/git/spawn-pool.js, are traced as their thread starts them; loaded any other way (on the main thread
//   alone) it sees none of them — the pool tells them on its channel, SPAWN_CHANNEL, instead.
//   Read it:
//     node test/helpers/process-trace.mjs <file>
//
// What the reading says, and why it is asked: a process ended from outside shows exit 1 on Windows, as a Node that
// threw does, and Windows hands a dead process's id to a new one within seconds under the suite's load (seen: 4 to
// 10 s). So a taskkill aimed at an id whose process has already ended can end a stranger. The reading lists each
// taskkill that named an id after its process had exited, each that named a process some other test started, every
// child that exited 1 without its own parent's kill, and every test file that started and never reached its end.
// Nothing here changes what a process does.
import cp from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = (/** @type {unknown} */ f) => String(f ?? "").split(/[\\/]/).pop() || "";
const LOG = process.env.FILAMENT_PROCESS_TRACE;
const reading = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (LOG && !reading) {
  const put = (/** @type {Record<string, unknown>} */ o) => {
    try {
      appendFileSync(LOG, `${JSON.stringify({ t: Date.now(), by: process.pid, ...o })}\n`);
    } catch {}
  };
  put({ k: "start", ppid: process.ppid, script: base(process.argv[1]), arg: base(process.argv[2]) });
  process.on("exit", (code) => put({ k: "end", code }));
  /** The ids a taskkill line names. @param {unknown[]} args */
  const named = (args) => args.map(String).filter((a, i, all) => /^\d+$/.test(a) && /^\/pid$/i.test(all[i - 1] || ""));
  for (const name of ["spawn", "execFile", "exec", "fork"]) {
    const orig = /** @type {any} */ (cp)[name];
    /** @type {any} */ (cp)[name] = function (/** @type {any} */ file, /** @type {any[]} */ ...rest) {
      const child = orig.call(this, file, ...rest);
      try {
        const args = Array.isArray(rest[0]) ? rest[0] : [];
        const kill = /taskkill/i.test(String(file)) ? named(args) : null;
        put({ k: "spawn", pid: child?.pid ?? null, file: base(String(file).slice(0, 200)), a: args.slice(0, 3).map((/** @type {unknown} */ a) => base(a).slice(0, 60)), ...(kill ? { kill } : {}) });
        child?.on?.("exit", (/** @type {unknown} */ code, /** @type {unknown} */ signal) => put({ k: "exit", pid: child.pid, code, signal }));
      } catch {}
      return child;
    };
  }
  syncBuiltinESMExports();
}

if (reading) {
  /** @type {any[]} */
  const rows = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).sort((a, b) => a.t - b.t);
  const t0 = rows[0]?.t || 0;
  const at = (/** @type {number} */ t) => `${((t - t0) / 1000).toFixed(2)} s`;
  const spawns = rows.filter((r) => r.k === "spawn" && r.pid);
  const exitOf = (/** @type {any} */ s) => rows.find((r) => r.k === "exit" && r.by === s.by && r.pid === s.pid && r.t >= s.t) || null;
  /** What a traced Node process is: its test file, or its script. @param {number} pid @param {number} t */
  const who = (pid, t) => {
    const s = rows.filter((r) => r.k === "start" && r.by === pid && r.t <= t + 50).at(-1);
    return s ? s.arg || s.script || "node" : "?";
  };
  const what = (/** @type {any} */ s) => `${s.file} ${(s.a || []).join(" ")}`.trim().slice(0, 70);
  /** Whether process `pid` is `top` or was started under it, as far as the trace saw. @returns {boolean} */
  const under = (/** @type {number} */ pid, /** @type {number} */ top, /** @type {number} */ t, depth = 0) => {
    if (pid === top) return true;
    if (depth > 12) return false;
    const parent = spawns.filter((s) => s.pid === pid && s.t <= t).at(-1)?.by ?? rows.filter((r) => r.k === "start" && r.by === pid && r.t <= t + 50).at(-1)?.ppid;
    return parent != null && under(parent, top, t, depth + 1);
  };
  const kills = spawns.filter((r) => r.kill?.length);
  console.log(`${rows.length} lines; ${spawns.length} processes started by a traced Node; ${kills.length} taskkills`);
  let late = 0;
  let foreign = 0;
  for (const k of kills)
    for (const id of k.kill.map(Number)) {
      const own = spawns.filter((s) => s.pid === id && s.by === k.by && s.t <= k.t).at(-1);
      const ended = own ? exitOf(own) : null;
      if (own && ended && ended.t < k.t) {
        late++;
        console.log(`  AFTER ITS EXIT ${at(k.t)}: ${who(k.by, k.t)} named ${id}, its ${what(own)}, ${k.t - ended.t} ms after that had exited (${ended.signal || ended.code})`);
      }
      // The newest process started on that id by a process outside the killer's own tree, still running when the
      // taskkill began.
      const other = spawns.filter((s) => s.pid === id && s.t <= k.t + 2000 && !under(s.by, k.by, s.t)).at(-1);
      const gone = other ? exitOf(other) : null;
      if (other && (!own || other.t > own.t) && (!gone || gone.t >= k.t)) {
        foreign++;
        console.log(`  A STRANGER'S ${at(k.t)}: ${who(k.by, k.t)} named ${id}; ${who(other.by, other.t)} had started ${what(other)} on it${gone ? `, which ended ${gone.t - k.t} ms later (${gone.signal || gone.code})` : ""}`);
      }
    }
  console.log(`taskkills that named an id after its process had exited: ${late}; that named a stranger's running process: ${foreign}`);
  const ones = spawns.map((s) => ({ s, e: exitOf(s) })).filter(({ s, e }) => e && e.code === 1 && !e.signal && !kills.some((k) => k.by === s.by && k.kill.map(Number).includes(s.pid) && k.t >= s.t && k.t <= e.t + 2000));
  console.log(`children that exited 1 with no signal and no kill of their parent's: ${ones.length} (a git or rg that found nothing is among them)`);
  for (const { s, e } of ones) console.log(`  ${at(e.t)}: ${what(s)}, started by ${who(s.by, s.t)}, ${e.t - s.t} ms old`);
  // A test file that started and never said its end did not end by itself.
  const files = rows.filter((r) => r.k === "start" && /\.test\.js$/.test(r.arg || ""));
  const cut = files.filter((f) => !rows.some((r) => r.k === "end" && r.by === f.by && r.t >= f.t));
  console.log(`test files that started and never reached their end: ${cut.length}`);
  for (const f of cut) console.log(`  ${f.arg} (pid ${f.by}), started at ${at(f.t)}`);
}
