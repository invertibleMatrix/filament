// @ts-check
// The runs of a Space's buttons, kept on disk (the owner's of 10-29, "finish the space work fully"): a restart no longer
// loses what an app's or a dashboard's buttons did and said. Each run is a file of its own,
// `<dataDir>/app-runs/<name>/<id>.json` — written as it starts, every few seconds while it says something, and as it
// ends —, the newest `kept` of each kept and the older ones removed. A run still going when Filament stopped is read
// back stopped, in words that say so, with what it said until then.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isArtifactName } from "../core/artifacts.js";

/** What a run a restart cut says it ended with. */
export const CUT_WORDS = "Filament stopped while it ran: what it said until then is kept.";
/** A run's id, as the runner makes it: its file's name. */
const RUN_ID = /^j[0-9a-z]{1,40}$/;
const STATES = new Set(["running", "done", "failed", "stopped"]);

/** @typedef {import("./dashboard-runner.js").Job} Job */

/** Whether a file's words are a run as the runner keeps it. @param {any} j @returns {j is Job} */
const isRun = (j) =>
  !!j && typeof j === "object" && typeof j.id === "string" && RUN_ID.test(j.id) && typeof j.action === "string" && STATES.has(j.state) && Number.isFinite(j.startedAt) && typeof j.log === "string";

/**
 * @param {{ dir: string | null, kept: number, log?: (level: string, msg: string) => void, now?: () => number }} o
 *   `dir`: where the runs are kept (none: kept nowhere, as the tests' runners are); `kept`: how many of each one's newest
 */
export function createAppRuns({ dir, kept, log = () => {}, now = () => Date.now() }) {
  /** @param {string} name */
  const folderOf = (name) => join(/** @type {string} */ (dir), name);
  /** A run's file written whole (tmp, then rename); its folder. @param {string} name @param {{ at: number, run: Job }} kept */
  const write = (name, kept) => {
    const home = folderOf(name);
    mkdirSync(home, { recursive: true });
    const file = join(home, `${kept.run.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(kept));
    renameSync(tmp, file);
    return home;
  };
  return {
    /**
     * Every one's kept runs, the oldest first: a run that was going is read back stopped (`CUT_WORDS`), ended when its
     * file was last written — and written so, so `cut` names it to this load alone.
     * @returns {{ runs: Map<string, Job[]>, cut: { name: string, run: Job }[] }}
     */
    load() {
      /** @type {Map<string, Job[]>} */
      const out = new Map();
      /** @type {{ name: string, run: Job }[]} */
      const cut = [];
      if (!dir || !existsSync(dir)) return { runs: out, cut };
      for (const name of readdirSync(dir)) {
        if (!isArtifactName(name)) continue;
        /** @type {Job[]} */
        const list = [];
        try {
          for (const f of readdirSync(folderOf(name))) {
            // A write a stop cut between its tmp and its rename leaves the tmp: no one writes it now (found reviewing
            // the Space work: they stayed for good).
            if (/^j[0-9a-z]{1,40}\.json\.\d+\.tmp$/.test(f) && !f.endsWith(`.${process.pid}.tmp`)) {
              rmSync(join(folderOf(name), f), { force: true });
              continue;
            }
            if (!f.endsWith(".json") || !RUN_ID.test(f.slice(0, -5))) continue;
            try {
              const raw = JSON.parse(readFileSync(join(folderOf(name), f), "utf8"));
              const j = raw?.run;
              if (!isRun(j)) continue;
              const at = Number(raw.at) || j.startedAt;
              if (j.state !== "running") {
                list.push(j);
                continue;
              }
              /** @type {Job} */
              const stopped = { ...j, state: "stopped", endedAt: at, said: CUT_WORDS };
              list.push(stopped);
              cut.push({ name, run: stopped });
              try {
                write(name, { at, run: stopped });
              } catch (/** @type {any} */ e) {
                log("warn", `app runs: ${name}/${f} could not be written stopped (${e?.message || e}); the next Filament says it cut again`);
              }
            } catch (/** @type {any} */ e) {
              log("warn", `app runs: ${name}/${f} could not be read (${e?.message || e}); it is left out`);
            }
          }
        } catch {}
        if (list.length) out.set(name, list.sort((a, b) => a.startedAt - b.startedAt).slice(-kept));
      }
      return { runs: out, cut };
    },

    /**
     * A run written whole, and the one's runs past the newest `kept` removed.
     * @param {string} name @param {Job} run @param {readonly string[]} keep  the ids of its runs that stay
     */
    save(name, run, keep) {
      if (!dir || !isArtifactName(name) || !RUN_ID.test(run.id)) return;
      try {
        const home = write(name, { at: now(), run });
        const stays = new Set(keep.map((id) => `${id}.json`));
        for (const f of readdirSync(home)) if (f.endsWith(".json") && !stays.has(f)) rmSync(join(home, f), { force: true });
      } catch (/** @type {any} */ e) {
        log("warn", `app runs: ${name}'s run ${run.id} could not be kept (${e?.message || e}); it shows until Filament stops`);
      }
    },

    /** Every run of one deleted, forgotten with it. @param {string} name */
    drop(name) {
      if (!dir || !isArtifactName(name)) return;
      try {
        rmSync(folderOf(name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (/** @type {any} */ e) {
        log("warn", `app runs: ${name}'s runs could not be forgotten (${e?.message || e})`);
      }
    },
  };
}

/** @typedef {ReturnType<typeof createAppRuns>} AppRuns */
