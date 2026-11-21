// @ts-check
// A Space's dashboards, run with no AI (HarnessV4_Space_Plan S2, SG-D6..D9, SG-D18..D23). Which dashboards a Space
// shows — those kept in it, and the drafts its chats published that read by themselves (SG-D18). A kept one's sources
// read: its command, exactly as the Keep granted it, run in the project's folder with no shell, the environment an MCP
// server gets, 60 s and 1 MB at most; its output read into rows by the live version's paths, kept in memory with when
// (SG-D22). A source fails on its own, keeps its last good rows, and stops after three failures in a row until it is
// read again by hand. Its kept watches look in the background at their every and write in What happened through the
// store; their first look only learns. A paused or taken-out dashboard runs nothing, and while Pause all is on (S6-D4) no
// watch looks. In a project the person archived (s-itself, 11-12: the store's `archived`, the one rule the routines and
// every watcher source ask) nothing of one is read by itself — no watch looks, and a read nobody pressed for answers its
// rows as last read —, and a chat's agent reads, presses and runs nothing of it; the person's own press reads and runs
// still, as their Run now runs a routine. Each change of a source is said on the events bus, which an open Space and the
// dashboard's own page follow. A Keep pins the bytes of the project's scripts its commands run, by a hash — and of the code beside each, in
// its folder, which is what it imports (services/script-pins.js) —: one changed since is not run — with the app's
// secrets or without — until the person keeps it again.
import { statSync } from "node:fs";
import { CONTENT_JSON, runsItself } from "../core/artifacts.js";
import {
  FAILS_TO_STOP,
  ROW_KEY,
  actionKept,
  actionOnRow,
  answerTypes,
  argsAsSchema,
  argvWords,
  everyWords,
  fillAction,
  filled,
  grantOf,
  grantScriptParts,
  grantsAny,
  pythonArgv,
  rowKey,
  rowsFrom,
  sameGrant,
  scriptParts,
  sourceKept,
  toolWords,
  watchKeyOf,
  watchKept,
  watchNews,
  watchRuleWords,
} from "../core/dashboard-sources.js";
import { laneFeedOf, laneLines, statusLine, taskCards, taskFeedOf } from "../core/space-feeds.js";
import { verdictOf } from "../core/second-look.js";
import { hiddenIn, hider } from "../core/app-secrets.js";
import { HOOK_ROWS_MAX, hookRow } from "../core/app-hooks.js";
import { appToolKept, fillAppTool } from "../core/app-tools.js";
import { listFolder } from "./source-folder.js";
import { hashOf, pinsOf, scriptsChanged } from "./script-pins.js";
import { UNTITLED_CHAT } from "../core/space.js";
import { ARCHIVED_AGENT, ARCHIVED_ROW } from "../core/routines.js";
import { CUT_WORDS } from "./app-runs.js";

/** How long after Filament starts the kept watches take their first look. */
export const WATCH_FIRST_MS = 10_000;
/** How much of what a button said its run's answer carries whole, for Hand to an agent… (S5d): its last characters. */
const HAND_OUTPUT_CHARS = 2000;
/** How many runs of its buttons a dashboard or an app keeps, and how much of what each said. */
export const JOBS_KEPT = 10;
export const JOB_LOG_MAX = 200_000;
/** The longest an app's tool may run for an agent (the review of 11-05): a tail that follows forever holds no turn. */
export const TOOL_RUN_MS = 10 * 60_000;
/** How often a run going is written again while it says something (services/app-runs.js): a restart keeps up to then. */
export const RUN_KEEP_MS = 5_000;
/** How a button's run ends where its Space was deleted while it ran: its press's answer and its run say so. */
export const SPACE_GONE_WORDS = "its Space was deleted, which stopped it";
/** Where its app was taken out of its Space while it ran, and kept in no other. */
export const TAKEN_OUT_WORDS = "it was taken out of its Space, which stopped it";
/** Where its app was deleted while it ran. */
export const APP_GONE_WORDS = "its app was deleted, which stopped it";
/**
 * What a chat's agent is told of a read, a press or a tool's run it asks for in a project the person archived (s-itself,
 * 11-12): the routines' words to it (app/routines.js `runNow`), and what runs it still.
 */
export const ARCHIVED_PRESS = `${ARCHIVED_AGENT}. Their own press runs it still`;

/**
 * A file's hash read again only once its size or its time of change moved: what a Space's list shows of its scripts at
 * every look, where a big program of the project would be hashed each time. Whether one runs is judged on its bytes
 * (`fresh`), which each such judging — a run's, a Keep's — keeps for the looks after it: bytes that changed while its
 * size and time did not are seen as they are from then on, never a Keep's pins against a hash from before them (found
 * by the review of 10-31: the look held such a script after its Keep, until the file was touched).
 * @returns {((file: string) => string | null) & { fresh: (file: string) => string | null }}
 */
const hashLooked = () => {
  /** @type {Map<string, { size: number, mtimeMs: number, hash: string | null }>} */
  const seen = new Map();
  /** @param {string} file @param {boolean} bytes */
  const of = (file, bytes) => {
    let st;
    try {
      st = statSync(file);
    } catch {
      seen.delete(file);
      return null;
    }
    const was = seen.get(file);
    if (!bytes && was && was.size === st.size && was.mtimeMs === st.mtimeMs) return was.hash;
    const hash = hashOf(file);
    seen.set(file, { size: st.size, mtimeMs: st.mtimeMs, hash });
    return hash;
  };
  return Object.assign((/** @type {string} */ file) => of(file, false), { fresh: (/** @type {string} */ file) => of(file, true) });
};
/**
 * Why a command does not run: its scripts are not as the Keep pinned them — changed since, gone or new —, or its Keep
 * has no record of them (`unrecorded`): an earlier Filament kept it, which recorded none — or, of 10-30, recorded them
 * and lost them at its next start.
 * @param {string[]} paths @param {string} kind  "app" or "dashboard" @param {boolean} [unrecorded]
 */
export const scriptsWords = (paths, kind, unrecorded = false) => {
  const what = kind === "app" ? "app" : "dashboard";
  return unrecorded
    ? `the ${what} was kept by an earlier Filament, which kept no record of the scripts it runs: nothing runs ${paths.join(", ")} until you keep it again`
    : `${paths.join(", ")} changed since ${paths.length > 1 ? "they were" : "it was"} kept: nothing runs ${paths.length > 1 ? "them" : "it"} until you keep the ${what} again`;
};

/**
 * A version's status tiles that read one of its own sources: what Your Space's At a glance shows of it (S5b). A tile
 * of Filament's feeds or of a sample table is no row Filament read for it.
 * @param {any} content @returns {any[]}
 */
const statusTiles = (content) =>
  // An app's glance (phase 3) is its status lines: it draws no tiles of Filament's.
  [...(Array.isArray(content?.tiles) ? content.tiles : []), ...(Array.isArray(content?.glance) ? content.glance : [])].filter(
    (/** @type {any} */ t) => t?.kind === "status" && typeof t.from === "string" && !!content.sources && Object.prototype.hasOwnProperty.call(content.sources, t.from),
  );

/**
 * @typedef {{ rows: Record<string, unknown>[], at: number, error: string | null, errorAt: number, fails: number,
 *   stopped: boolean, more?: true }} SourceState  a source as last read: its last good rows and when, its last failure in
 *   words and when — a hold lets go of the words, never of when (`staleRows`) —, how many failures in a row, whether it
 *   stopped for them; `more`, where that read stopped at its most
 *   (a folder's): its rows are of the first ones
 * @typedef {{ ok: true, state: SourceState } | { ok: false, error: string, off?: "held" | "archived" }} ReadAnswer  a source's read:
 *   its state as it stands, or why it read nothing — `off` "held" where a script it runs waits for the person's Keep,
 *   "archived" where its project is archived and the person did not press for it
 * @typedef {import("../core/dashboard-sources.js").RunCommand} RunCommand
 * @typedef {import("../core/dashboard-sources.js").RunAction} RunAction
 * @typedef {(o: { chainId: string, cwd: string, about: import("../core/second-look.js").LookAbout, why: string, description: string, model: string }) =>
 *   { ok: true, chain: string, agent: string } | { ok: false, error: string }} StartLook  a second look started in a
 *   chat (app/second-look.js), on the model the person chose
 * @typedef {{ start: (o: { chainId: string, cwd: string, about: import("../core/second-look.js").CheckAbout, why: string, description: string, model: string }) =>
 *   { ok: true, chain: string, agent: string } | { ok: false, error: string },
 *   ended: (chain: string, agent: string) => Promise<{ status: string, report: string, error: string | null }> }} CheckDoor
 *   a button's check (S5d): the Reviewer started in a chat after a run, on the model the person chose, and its end, with
 *   no clock (app/second-look.js)
 * @typedef {(chainId: string) => { model: string, why: string } | null} LookModel  the model the Reviewer would run on in
 *   a chat where the person names none, and why (app/agent/subagents.js `selfModel`): what a button's sheet shows them
 *   before anything starts, theirs to change
 * @typedef {import("../core/dashboard-sources.js").Tool} Tool
 * @typedef {{ chain: string, name?: string | null, byName: string }} Presser  the chat whose agent pressed a button
 *   (HarnessV4_AgentsSpace_Plan SA-D4): a helper's own name, and how What happened names it
 * @typedef {{ id: string, action: string, label: string, key: string, state: "running" | "done" | "failed" | "stopped",
 *   startedAt: number, endedAt: number | null, said: string, by: string | null, byChain?: string | null, log: string }} Job  a
 *   button's run, as an app's page reads it (`filament.jobs`): its last line said, and what it said on stdout and stderr as
 *   it came; who pressed it — a chat's agent by its name then (`by`) and its chat (`byChain`, by which another chat's agent
 *   reads it: app/agent/space-dashboard.js), none for the person's. A run kept before it kept its chat has none.
 * @typedef {{ id: string, action: string, state?: Job["state"], chunk?: string }} JobNews  a run started or ended
 *   (`state`), or a piece of what it said (`chunk`)
 * @typedef {{ read: (project: string, tool: Tool, signal?: AbortSignal) => Promise<import("../core/dashboard-sources.js").CommandOut>,
 *   act: (project: string, tool: Tool, args: Record<string, unknown>, signal?: AbortSignal) => Promise<import("../core/dashboard-sources.js").ActionOut>,
 *   check: (project: string, tools: { connection: string, name: string, reads: boolean }[]) => Promise<{ connection: string, name: string, reads: boolean, ok: boolean, words: string }[]>,
 *   schema: (project: string, tool: Tool) => Promise<any> }} ToolDoor
 *   a connection's tools for a project's Space (app/space-tools.js, S4a): `schema`, a tool's input schema or null
 */

/**
 * Whether a source's rows are older than its last failed read — whose words a hold lets go of, never its moment
 * (`heldRead`): no button runs on them, and they are drawn as of their read.
 * @param {SourceState} st
 */
const staleRows = (st) => st.errorAt > 0 && st.errorAt >= st.at;

/** A button's check, where nothing wired it. @type {CheckDoor} */
const NO_CHECKS = {
  start: () => ({ ok: false, error: "checks are not wired in this Filament" }),
  ended: async () => ({ status: "gone", report: "", error: "checks are not wired in this Filament" }),
};
/** A connection's tools, where nothing wired them. */
const NO_TOOLS = "a connection's tools are not wired in this Filament";
/** @type {ToolDoor} */
const UNWIRED = {
  read: async () => ({ ok: false, error: NO_TOOLS }),
  act: async () => ({ ok: false, error: NO_TOOLS, said: "" }),
  check: async (_p, tools) => tools.map((t) => ({ ...t, ok: false, words: NO_TOOLS })),
  schema: async () => null,
};

/**
 * @param {{ spaces: import("./spaces.js").SpaceStore, artifacts: import("./artifacts.js").ArtifactStore,
 *   folderOf: (project: string) => string | null, projectOfChain: (chain: string) => string | null,
 *   events?: { publish: (topic: string, payload: any) => any } | null, log?: (level: string, msg: string) => void,
 *   now?: () => number, run: RunCommand, act?: RunAction, startLook?: StartLook, checks?: CheckDoor, lookModel?: LookModel,
 *   modelProblem?: (model: string) => string | null, tools?: ToolDoor, firstMs?: number,
 *   runs?: Pick<import("./app-runs.js").AppRuns, "load" | "save"> & Partial<Pick<import("./app-runs.js").AppRuns, "drop">> | null, secrets?: Pick<import("./app-secrets.js").AppSecrets, "values" | "list" | "set" | "clear"> | null,
 *   fetch?: (f: import("../core/dashboard-sources.js").Fetch, o: { secrets: Record<string, string>, signal?: AbortSignal }) => Promise<import("../core/dashboard-sources.js").CommandOut>,
 *   filament?: (project: string, what: string, signal?: AbortSignal) => Promise<import("../core/dashboard-sources.js").CommandOut>,
 *   uv?: () => string, hooks?: import("./app-hooks.js").AppHooks | null, base?: () => string | null,
 *   apart?: (chain: string) => boolean }} deps
 *   `folderOf`: a project's folder, where its commands run; `projectOfChain`: the project of the chat that published a
 *   version; `run`: how a source's command runs, `act` a button's (adapters/tools/source-command.js; the tests' stand-ins);
 *   `startLook`: a button's second look, the Reviewer in a chat (S3b); `checks`: an agent's check of what a button did
 *   (S5d) — each only as the person asks, on the model they chose (the owner's word of 10-31); `lookModel`: the one
 *   their sheet shows first; `modelProblem`: why a model cannot run an agent now, null where it can — a check asked on
 *   one that cannot is refused before the button runs; `tools`: a connection's tools, read and called (S4a); `runs`:
 *   where its buttons' runs are kept across a restart (services/app-runs.js; none: until Filament stops); `secrets`: an
 *   app's secrets as the person typed them
 *   (services/app-secrets.js), which its commands get in their environment and which are hidden in what they say;
 *   `fetch`: an app's address read, its secrets filled (adapters/tools/source-fetch.js); `filament`: Filament's own rows
 *   for a project, as JSON (core's FILAMENT_READS); `uv`: uv's path, which runs a Python read (more reads, 10-29);
 *   `hooks`: each kept app's hooks' tokens (services/app-hooks.js), and `base` where Filament reaches itself
 *   (`selfAddress`), which their addresses name (phase 4); `apart`: whether a chat's words are none of another chat's
 *   agent's to read (core/space.js `readerNames`): a refusal to another chat's agent names who pressed so
 */
export function createDashboardRunner({ spaces, artifacts, folderOf, projectOfChain, events = null, log = () => {}, now = () => Date.now(), run, act = async () => ({ ok: false, error: "buttons are not wired in this Filament", said: "" }), startLook = () => ({ ok: false, error: "second looks are not wired in this Filament" }), checks = NO_CHECKS, lookModel = () => null, modelProblem = () => null, tools = UNWIRED, firstMs = WATCH_FIRST_MS, runs: runStore = null, secrets: secretStore = null, fetch: fetchRead = async () => ({ ok: false, error: "fetching is not wired in this Filament" }), filament: filamentRead = async () => ({ ok: false, error: "Filament's own rows are not wired in this Filament" }), uv = () => "uv", hooks: hookStore = null, base: baseOf = () => null, apart = () => false }) {
  /** Each dashboard's sources as last read, by its name, then the source's. @type {Map<string, Map<string, SourceState>>} */
  const states = new Map();
  /** The kept scripts' hashes as the Space's list last looked at them. */
  const looked = hashLooked();
  /**
   * The reads under way, so two asks share one run — and its answer —, each with its stop: a dashboard paused, taken out
   * or kept again meanwhile stops its reads, and what they read is let be.
   * @type {Map<string, { p: Promise<ReadAnswer>, stop: AbortController }>}
   */
  const reading = new Map();
  /** A dashboard's reads under way, stopped. @param {string} name */
  const stopReads = (name) => {
    for (const [key, r] of reading)
      if (key.startsWith(`${name}\n`)) {
        r.stop.abort();
        // The next ask runs anew, not on the read stopped.
        reading.delete(key);
      }
  };
  /** The watches' timers. @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  /** @type {Set<(name: string, source: string) => void>} */
  const followers = new Set();
  /**
   * The buttons running now, by dashboard: one at a time each (S3); `by`, the chat whose agent pressed it
   * (HarnessV4_AgentsSpace_Plan SA-D4), its tab saying so.
   * `why`: what stopped it where no one pressed Stop — its Space deleted (`reschedule`), its app taken out (`change`) or
   * deleted (`forget`), Filament stopping (`stop`) —, which its run and its press's answer say. `ended`: once its run is
   * written as it ended.
   * @type {Map<string, { label: string, action: string, abort: AbortController, by: Presser | null, why: string | null, ended: Promise<void> }>}
   */
  const acting = new Map();
  /** The deleted ones (`forget`): a run of one that ends after is kept nowhere. Names are never made again. @type {Set<string>} */
  const forgotten = new Set();
  const loaded = runStore?.load();
  /** Each one's runs of its buttons, the newest last, `JOBS_KEPT` at most: those kept from before a restart too. @type {Map<string, Job[]>} */
  const jobs = loaded?.runs || new Map();
  /** @type {Set<(name: string, e: JobNews) => void>} */
  const jobFollowers = new Set();
  let jobSeq = 0;
  /**
   * Who pressed a button, as `reader` reads it — a chat's agent, or the person (null): another chat whose words are none
   * of that agent's is "an untitled chat" (core/space.js `readerNames`).
   * @param {Presser} p @param {{ chain: string } | null | undefined} reader
   */
  const presserFor = (p, reader) => (reader && p.chain !== reader.chain && apart(p.chain) ? UNTITLED_CHAT : p.byName);
  /** When each run going was last kept, so what it says is written every `RUN_KEEP_MS`, not at each piece. @type {Map<string, number>} */
  const keptAt = new Map();
  /** A run kept on disk as it stands, with the one's others that stay. @param {string} name @param {Job} job */
  const keepRun = (name, job) => {
    if (forgotten.has(name)) return;
    keptAt.set(job.id, now());
    runStore?.save(name, job, (jobs.get(name) || []).map((j) => j.id));
  };
  /** @param {string} name @param {JobNews} e */
  const tellJob = (name, e) => {
    for (const f of [...jobFollowers])
      try {
        f(name, e);
      } catch {}
  };
  /** The checks this Filament waits on, by their agent (S5d): a restart's cut ones are the Spaces' others. @type {Set<string>} */
  const awaiting = new Set();
  let started = false;

  /** A version's content, or null where it does not read. @param {string} name @param {number} v */
  const contentOf = (name, v) => {
    try {
      return JSON.parse(String(artifacts.file(name, v, CONTENT_JSON) || ""));
    } catch {
      return null;
    }
  };
  /**
   * A tool button's call as its sheet shows it (S4a): its args from the row as the tool's schema takes them, and which
   * fields go where it takes no text; as filled where its server cannot say.
   * @param {string} project @param {Tool} tool @param {Record<string, unknown>} args
   */
  const toolSheet = async (project, tool, args) => {
    const schema = await tools.schema(project, tool).catch(() => null);
    return { ...tool, args: /** @type {Record<string, unknown>} */ (argsAsSchema(args, schema)), asks: answerTypes(tool.args, schema) };
  };
  /** Where a dashboard is kept: its project and record, or null. @param {string} name */
  const keptOf = (name) => spaces.keptDashboards().find((k) => k.d.name === name) || null;
  /**
   * Why a kept one's command waits for the person's Keep, or null where it runs: a script of the project it runs that
   * is not as its Keep pinned it — judged on the script's bytes where it is about to run (`looked.fresh`, which the
   * looks after it see); a look, which runs nothing, judges by `looked`, as the Space's list does.
   * @param {string} name @param {string[]} parts  the command's parts that may name a script (core's scriptParts)
   * @param {string} project @param {(file: string) => string | null} [hash]
   */
  const heldOf = (name, parts, project, hash = looked.fresh) => {
    const d = keptOf(name)?.d;
    const changed = scriptsChanged(d?.scripts, parts, folderOf(project), hash);
    return changed.length ? scriptsWords(changed, artifacts.get(name)?.type || "", !!d && d.scripts === undefined) : null;
  };
  /**
   * The scripts a source of a kept one runs that wait for the person's Keep, as a look sees them — a page's, the
   * board's, a press's —: its rows, read before, are not read again until then.
   * @param {string} name @param {unknown} raw  the source as its version says it, if it has it @param {string} project
   */
  const sourceChanged = (name, raw, project) => (raw ? scriptsChanged(keptOf(name)?.d.scripts, scriptParts(sourceKept(raw)), folderOf(project), looked) : []);
  /** Why a source of a kept one waits for the person's Keep, as a look sees it, or null. @param {string} name @param {unknown} raw @param {string} project */
  const sourceHeld = (name, raw, project) => (raw ? heldOf(name, scriptParts(sourceKept(raw)), project, looked) : null);
  // A run the last Filament's stop cut says so in What happened, as every run that ends does (found driving it); the
  // store names each to one load alone.
  for (const { name, run: cut } of loaded?.cut || []) {
    const k = keptOf(name);
    if (k) spaces.dashboardSaid(k.project, `“${cut.label}” on ${artifacts.get(name)?.title || name} was running when Filament stopped: it was cut, and what it said until then is kept.`);
  }

  /**
   * A kept dashboard's live version (SG-D19): the newest whose grant is the one kept — a version that changed only
   * tiles or words is live at once —, its content, and whether the newest is a draft beside it (SG-D20).
   * @param {string} name
   */
  function liveOf(name) {
    const k = keptOf(name);
    const a = artifacts.get(name);
    if (!k || !a || !runsItself(a.type)) return null;
    const newest = a.versions.length;
    for (let v = newest; v >= 1; v--) {
      const content = contentOf(name, v);
      if (content && sameGrant(grantOf(content), k.d.grant)) return { ...k, v, content, draft: v !== newest, title: a.title };
      if (v <= k.d.v) break;
    }
    return null;
  }

  /**
   * An app's secrets for its commands (the Space Apps plan of 10-29): those its kept grant names and the person typed,
   * as their environment, and what hides each value in what they say — none where it names none.
   * @param {string} name
   */
  function sealedFor(name) {
    const named = keptOf(name)?.d.grant?.secrets || [];
    const typed = named.length && secretStore ? secretStore.values(name) : {};
    /** @type {Record<string, string>} */
    const env = Object.fromEntries(named.filter((n) => typeof typed[n] === "string").map((n) => [n, typed[n]]));
    return { env, hide: hider(env) };
  }

  /**
   * One source read once, by its kind, with no AI: a connection's tool through the project's server (S4a); an address
   * fetched with the app's secrets; a folder of the project listed; Filament's own rows; a Python script through uv or
   * a command, in the project's folder with the app's secrets in their environment (more reads, 10-29) — one whose
   * scripts wait for a Keep `read` held. Each stops on `signal`: its dashboard paused, taken out or kept again.
   * @param {import("../core/dashboard-sources.js").Source} s @param {string} project
   * @param {Record<string, string>} env @param {AbortSignal} signal @returns {Promise<import("../core/dashboard-sources.js").CommandOut>}
   */
  async function readOnce(s, project, env, signal) {
    if (s.tool) return tools.read(project, s.tool, signal);
    if (s.fetch) return fetchRead(s.fetch, { secrets: env, signal });
    if (s.filament) return filamentRead(project, s.filament, signal);
    const folder = folderOf(project);
    if (!folder) return { ok: false, error: "its project has no folder to read in" };
    if (s.folder) return listFolder(s.folder, folder, signal);
    if (!s.python) return run(s.command, folder, signal, env);
    const argv = pythonArgv(s.python, uv());
    const ran = await run(argv, folder, signal, env);
    if (ran.ok) return ran;
    // Its failure in its own words: the script's, not uv's path.
    if (/ was not found on this computer$/.test(ran.error)) return { ok: false, error: "uv, which runs its Python, was not found on this computer: Filament's memory engine brings it, or install uv" };
    return { ok: false, error: ran.error.startsWith(argv[0]) ? `python ${s.python.script}${ran.error.slice(argv[0].length)}` : ran.error };
  }

  /**
   * Whether a version of a dashboard may read its sources now: kept, not paused, and the grant the same as kept; else
   * why, and `off` — a draft or paused —, which its page's buttons say in their own words.
   * @param {string} name @param {number} v
   */
  function mayRead(name, v) {
    const k = keptOf(name);
    if (!k) return { ok: /** @type {const} */ (false), error: "it is not kept in a Space: nothing reads until it is", off: "draft" };
    if (k.d.paused) return { ok: /** @type {const} */ (false), error: "it is paused", off: "paused" };
    const content = contentOf(name, v);
    if (!content || !sameGrant(grantOf(content), k.d.grant)) return { ok: /** @type {const} */ (false), error: `v${v} is a draft: nothing it names reads until it is kept`, off: "draft" };
    return { ok: /** @type {const} */ (true), project: k.project, content };
  }

  /** @param {string} name @param {string} source */
  const stateOf = (name, source) => states.get(name)?.get(source) || null;
  /** @param {string} name @param {string} source @param {SourceState} s */
  const setState = (name, source, s) => {
    const m = states.get(name) || new Map();
    m.set(source, s);
    states.set(name, m);
    const k = keptOf(name);
    for (const f of [...followers])
      try {
        f(name, source);
      } catch {}
    if (k) events?.publish("space", { type: "space", project: k.project, dashboard: name });
  };

  /**
   * A source that waits for the person's Keep, answered so, `off` "held": what failed before the wait is past — its
   * failures, said once, and the row in Needs you they wrote (`sourceRead`) —; its last good rows stay, as old as they
   * were (`errorAt` stays: `staleRows`), so a script put back as kept, with no Keep, offers no button on them until it
   * reads well (found by the review of 10-31).
   * @param {string} name @param {string} source @param {string} project @param {string} why  as `heldOf` says it
   * @returns {ReadAnswer}
   */
  const heldRead = (name, source, project, why) => {
    const st = stateOf(name, source);
    if (st && (st.error || st.fails || st.stopped)) setState(name, source, { ...st, error: null, fails: 0, stopped: false });
    try {
      spaces.sourceRead(project, name, source);
    } catch (/** @type {any} */ e) {
      log("warn", `dashboards: ${name}'s ${source} could not be said in Needs you (${e?.message || e})`);
    }
    return { ok: false, error: why, off: "held" };
  };

  /**
   * One source of a version read now, or its rows as last read where they are younger than `maxAge`. A source stopped
   * by its failures reads only when `force`d (Read again). Two asks at once share one run — but `after`, a read that
   * must begin after now (a button's run ended: its check reads what it changed), waits for one under way and runs anew.
   * One whose scripts wait for a Keep is held, `off` "held" as a paused one is: nothing runs, and no failure counts.
   * `by`: who pressed for this read — "you", the person (Refresh, Read again, a button's sheet or its run); "agent", a
   * chat's agent; none, nobody: a watch's look, its page's ask at its every, a Space's read that finds its rows old. In
   * an archived project (s-itself, 11-12) the person's alone reads: nobody's answers its rows as last read, as old as
   * they are — or why there are none —, and an agent's is refused, `off` "archived"; nothing runs for either.
   * @param {string} name @param {number} v @param {string} source
   * @param {{ force?: boolean, maxAge?: number, after?: boolean, by?: "you" | "agent" | null }} [o]
   * @returns {Promise<ReadAnswer>}
   */
  async function read(name, v, source, { force = false, maxAge, after = false, by = null } = {}) {
    const may = mayRead(name, v);
    if (!may.ok) return { ok: false, error: may.error };
    const raw = may.content?.sources?.[source];
    if (!raw) return { ok: false, error: `v${v} has no source ${source}` };
    if (by !== "you" && spaces.archived(may.project)) {
      const last = by ? null : stateOf(name, source);
      return last ? { ok: true, state: last } : { ok: false, error: by ? ARCHIVED_PRESS : ARCHIVED_ROW, off: "archived" };
    }
    const s = sourceKept(raw);
    // Its scripts not as its Keep pinned them (the bug hunt of 10-30): no failure of it — neither Read again nor an
    // agent's fix mends it, the person's Keep does (found in the owner's Space of 10-31: three held reads stopped each
    // source, and each wrote a row in Needs you). Looked at as the Space's list does — rows younger than their every
    // run nothing —; judged on their bytes where it runs.
    const held = heldOf(name, scriptParts(s), may.project, looked);
    if (held) return heldRead(name, source, may.project, held);
    const had = stateOf(name, source);
    const age = maxAge ?? s.every;
    // A failure is a read too: the source is tried again at its every, not at each page that asks — nothing retries in
    // a loop.
    const last = had ? Math.max(had.at, had.errorAt) : 0;
    if (had && !force && (had.stopped || (last && now() - last < age))) return { ok: true, state: had };
    const key = `${name}\n${source}`;
    const going = reading.get(key);
    // A read begun before a button's run ended may hold the rows from before it (found by the Hunter on S5d): waited
    // for, this one is asked anew, a read begun after it — whether it may read, what it reads and how, as they are then:
    // paused, taken out or kept again meanwhile, it runs nothing (found by the review of 10-31: it ran as first asked,
    // with the secrets of a Keep since).
    if (after && going) {
      await going.p.catch(() => {});
      return read(name, v, source, { force: true, maxAge, after: true, by });
    }
    if (going) return going.p;
    const stop = new AbortController();
    /** @type {Promise<ReadAnswer>} */
    const p = (async () => {
      // On their bytes as it runs, with no wait between: a script changed while it waited for a read under way, or
      // since the look above, runs not (found by the review of 10-31: the look stood before the wait alone).
      const onBytes = heldOf(name, scriptParts(s), may.project);
      if (onBytes) return heldRead(name, source, may.project, onBytes);
      const sealed = sealedFor(name);
      const ran = await readOnce(s, may.project, sealed.env, stop.signal);
      // Its secrets hidden in a failure's words before any of them is kept. What it said is read first, and hidden in
      // each text as it is made into rows (`rowsFrom`'s `hide`) and in the rows after: hidden before it was parsed, a
      // secret of digits an answer wrote as a number spoiled its JSON (found by the review of 10-29).
      const got = !sealed.hide.any || ran.ok ? ran : { ok: /** @type {const} */ (false), error: sealed.hide.text(ran.error) };
      const prev = stateOf(name, source) || { rows: [], at: 0, error: null, errorAt: 0, fails: 0, stopped: false };
      // Paused, taken out or kept again while it ran: nothing of what it read is kept, and it is no failure.
      if (stop.signal.aborted) return { ok: /** @type {const} */ (true), state: prev };
      const parsed = got.ok ? rowsFrom(got.out, s, sealed.hide.text) : got;
      // And in what was read from it: JSON's escapes and a feed's entities, undone, may spell a secret again; a number
      // too, whose digits are one.
      const rows = !sealed.hide.any ? parsed : parsed.ok ? { ok: /** @type {const} */ (true), rows: parsed.rows.map((r) => hiddenIn(r, sealed.hide.text)) } : { ok: /** @type {const} */ (false), error: sealed.hide.text(parsed.error) };
      /** @type {SourceState} */
      const next = rows.ok
        ? { rows: rows.rows, at: now(), error: null, errorAt: 0, fails: 0, stopped: false, ...(got.ok && got.more ? { more: /** @type {const} */ (true) } : {}) }
        : { ...prev, error: rows.error, errorAt: now(), fails: prev.fails + 1, stopped: prev.fails + 1 >= FAILS_TO_STOP };
      if (!rows.ok) log("warn", `dashboards: ${name}'s ${source} was not read (${rows.error})${next.stopped ? `; it stops after ${FAILS_TO_STOP} failures until it is read again` : ""}`);
      setState(name, source, next);
      // Needs you (S5a): a row once it stops on its failures — Read again failing too says its newest failure and moment
      // there (found by the Hunter on S5a: the row kept its first words) —; gone once it reads well.
      try {
        if (!rows.ok && next.stopped && (!prev.stopped || force)) spaces.sourceStopped(may.project, { dashboard: name, title: liveOf(name)?.title || name, source, error: String(rows.error) });
        else if (rows.ok) spaces.sourceRead(may.project, name, source);
      } catch (/** @type {any} */ e) {
        log("warn", `dashboards: ${name}'s ${source} could not be said in Needs you (${e?.message || e})`);
      }
      return { ok: /** @type {const} */ (true), state: next };
    })();
    reading.set(key, { p, stop });
    try {
      return await p;
    } finally {
      if (reading.get(key)?.p === p) reading.delete(key);
    }
  }

  /** Every watch's timer stopped. */
  const clear = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
  /** @param {() => void} fn @param {number} ms */
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    timers.add(t);
  };

  /**
   * One look of one watch (SG-D9): its source read when older than the watch's every, and what is new written. A
   * dashboard paused, taken out or changed meanwhile is let be.
   * @param {string} name @param {string} key
   */
  async function look(name, key) {
    // The watches set again while this one read (a Keep, a Pause, Put back): theirs is the next look, not this one's.
    const round = rounds;
    // Pause all (S6-D4): no watch looks until Resume, which sets the watches again.
    if (spaces.pausedSince()) return;
    const live = liveOf(name);
    if (!live || live.d.paused) return;
    // Its project archived (s-itself, 11-12): no watch of it looks until the person brings it back, which sets the
    // watches again (`reschedule`).
    if (spaces.archived(live.project)) return;
    const raw = (Array.isArray(live.content.watch) ? live.content.watch : []).find((/** @type {any} */ w) => watchKeyOf(watchKept(w)) === key);
    if (!raw) return;
    const w = watchKept(raw);
    const r = await read(name, live.v, w.from, { maxAge: w.every });
    // Paused or taken out while it read: let be (Resume and Put back start its watches again).
    const still = liveOf(name);
    if (!still || still.d.paused) return;
    // A failed read keeps the rows last read well, which the tab still shows: the watch looks at them, as it had not
    // where a page's read brought them (a look at rows it saw already writes nothing).
    if (r.ok && r.state.at) {
      const news = watchNews(still.d.seen[key] || null, r.state.rows, w, now());
      try {
        // To Needs you (S5a): a row each, saying the rule that brought it.
        spaces.watchSaw(still.project, name, key, news.seen, news.lines, still.title, { to: w.to, why: `a watch of ${still.title}: ${watchRuleWords(w)}`, more: news.more });
      } catch (/** @type {any} */ e) {
        log("warn", `dashboards: ${name}'s watch could not write in ${w.to === "needs-you" ? "Needs you" : "What happened"} (${e?.message || e})`);
      }
    }
    if (started && round === rounds) later(() => void look(name, key), w.every);
  }

  /** How many times the watches were set: a look started before the last time sets no timer of its own. */
  let rounds = 0;
  /**
   * The watches as the Spaces keep them now: each kept, unpaused dashboard's, a timer each — none under Pause all, and
   * none for a project the person archived.
   */
  function schedule() {
    rounds++;
    clear();
    if (!started || spaces.pausedSince()) return;
    for (const { project, d } of spaces.keptDashboards()) {
      if (d.paused || !d.grant || spaces.archived(project)) continue;
      // A timer per watch, once each: a key twice would look twice at the first of them.
      for (const key of new Set(d.grant.watch.map(watchKeyOf))) later(() => void look(d.name, key), firstMs);
    }
  }

  /**
   * The dashboards a Space shows (SG-D18): those kept in it, and the drafts — published by one of its chats, reading by
   * themselves, neither kept nor taken out — each with what its tab draws. `all`: the artifacts as listed once for
   * several Spaces (`shownIn`).
   * @param {string} project @param {any[]} [all]
   */
  function shown(project, all = artifacts.list()) {
    const doc = spaces.get(project);
    const known = new Map(doc.dashboards.map((d) => [d.name, d]));
    /** @type {any[]} */
    const out = [];
    for (const a of all) {
      if (!runsItself(a.type)) continue;
      let d = known.get(a.name);
      const newest = a.versions.length;
      // Taken out, it stays out until a chat publishes a later version, which shows it again as a draft.
      if (d?.state === "removed") {
        if (newest <= d.v) continue;
        d = undefined;
      }
      // A chat of this project published it — or the person added it here with no chat (Import app…, 10-29); none of
      // its chats did, its content is not read.
      if (!d && !a.versions.some((v) => (v.by.chain ? projectOfChain(v.by.chain) === project : v.by.project === project))) continue;
      const content = contentOf(a.name, newest);
      if (!content) continue;
      const grant = grantOf(content);
      if (!d && (!grantsAny(grant) || keptOf(a.name))) continue;
      const live = d ? liveOf(a.name) : null;
      // The scripts its Keep pinned that changed since — every one, where an earlier Filament kept it, which pinned none
      // (`unrecorded`) —: nothing runs them until Keep… again, which its bar offers.
      const changed = d?.state === "kept" && d.grant ? scriptsChanged(d.scripts, grantScriptParts(d.grant), folderOf(project), looked) : [];
      const sources = Object.fromEntries(
        Object.keys(live?.content?.sources || {}).map((s) => {
          const st = stateOf(a.name, s);
          return [s, st ? { at: st.at, error: st.error, errorAt: st.errorAt, fails: st.fails, stopped: st.stopped, rows: st.rows.length, ...(st.more ? { more: true } : {}) } : null];
        }),
      );
      out.push({
        name: a.name,
        title: a.title,
        // A dashboard, whose tiles Filament draws, or an app, whose own page draws what it reads.
        type: a.type,
        v: newest,
        state: d ? "kept" : "draft",
        keptV: d?.v ?? null,
        liveV: live?.v ?? null,
        // The version each shown one copies, where Back to vN made it (10-29): a broken one's line goes back past it.
        from: a.versions[newest - 1]?.by?.from ?? null,
        liveFrom: live ? (a.versions[live.v - 1]?.by?.from ?? null) : null,
        draft: !d || (live ? live.draft : true),
        paused: d?.paused === true,
        // Paused by a chat's agent, with its line (HarnessV4_AgentsSpace_Plan SA-D3); a button running now, and who pressed it.
        pausedBy: d?.paused ? (d.pausedBy ?? null) : null,
        running: acting.has(a.name) ? { label: acting.get(a.name)?.label || "", action: acting.get(a.name)?.action || "", by: acting.get(a.name)?.by?.byName || null, ...(acting.get(a.name)?.by ? { byChain: acting.get(a.name)?.by?.chain } : {}) } : null,
        keptAt: d?.at ?? null,
        grant: d?.grant ?? null,
        newest: grant,
        // The newest version's own words of what it reads and watches, which its Keep sheet says; and each of its
        // watches' last look.
        reads: { sources: content.sources || {}, watch: Array.isArray(content.watch) ? content.watch : [], actions: content.actions || {}, lanes: content.lanes ?? null, tasks: content.tasks ?? null, ...(content.hooks ? { hooks: content.hooks } : {}), ...(content.tools ? { tools: content.tools } : {}), ...(Array.isArray(content.glance) ? { glance: content.glance.map((/** @type {any} */ t) => String(t.title)) } : {}) },
        // What the version that reads feeds into the Space (S4c), which What it may do says: a draft's may differ.
        fed: live ? { lanes: live.content?.lanes ?? null, tasks: live.content?.tasks ?? null } : null,
        looks: grant.watch.map((w) => d?.seen?.[watchKeyOf(w)]?.at ?? null),
        sources,
        updatedAt: a.updatedAt,
        // Your Space's At a glance (S5b): whether it shows there, and how many status tiles of its live version read one
        // of its own sources — what it would show.
        glance: d?.glance === true,
        statuses: statusTiles(live?.content).length,
        // Its sends buttons agents may press without asking you (10-29), which What it may do ticks.
        allowed: d?.state === "kept" ? [...(d.allowed || [])] : [],
        changed,
        ...(changed.length && d?.scripts === undefined ? { unrecorded: /** @type {const} */ (true) } : {}),
      });
    }
    return out.sort((x, y) => (x.state === y.state ? y.updatedAt - x.updatedAt : x.state === "kept" ? -1 : 1));
  }

  /** @param {number} status @param {string} error */
  const no = (status, error) => ({ ok: /** @type {const} */ (false), status, error });
  /** A column's values in a source's rows as last read, each once: a field's choices from another source. @param {string} name */
  const choicesIn = (name) => (/** @type {{ source: string, column: string }} */ f) =>
    [...new Set((stateOf(name, f.source)?.rows || []).map((r) => r[f.column]).filter((v) => v != null && v !== "").map(String))].slice(0, 200);

  /**
   * A button of a dashboard kept in this Space, pressed on a row as Filament read it (SG-D11) — never the page's words —,
   * or why it may not run: not kept here, paused, no such button, its scripts changed since the Keep, its rows not read,
   * stale or not to be read again until a Keep, the row gone, a row it is not on.
   * @param {string} project @param {string} name @param {string} action @param {string} key
   */
  function pressed(project, name, action, key) {
    const live = liveOf(name);
    if (!live || live.project !== project) return no(409, "it is not kept in this Space: its buttons run once it is");
    if (live.d.paused) return no(409, "it is paused: resume it to press its buttons");
    const raw = live.content?.actions?.[action];
    if (!raw) return no(404, `v${live.v} has no button ${action}`);
    const a = actionKept(raw);
    const held = a.tool ? null : heldOf(name, scriptParts(a), project);
    if (held) return no(409, held);
    // Rows whose source waits for a Keep are as read before it: nothing reads them again — nor what the run changed,
    // which its check reads (found by the review of 10-31: a held read let go of the failure that made them stale).
    const from = sourceHeld(name, live.content?.sources?.[a.on], project);
    if (from) return no(409, `${a.on} can't be read again: ${from}`);
    const st = stateOf(name, a.on);
    if (!st || !st.at) return no(409, `${a.on} has not been read yet: read it first`);
    if (staleRows(st)) return no(409, `Read it again first: these rows are ${Math.max(1, Math.round((now() - st.at) / 60_000))} min old`);
    const row = st.rows.find((r) => rowKey(r) === key);
    if (!row) return no(409, `that row is no longer in ${a.on}: read it again`);
    if (!actionOnRow(a, row)) return no(409, `${a.label} is not on that row`);
    return { ok: /** @type {const} */ (true), live, a, row };
  }
  /**
   * The chat that made a version — the newest up to it a chat made —, where it is a chat of this project: a second look
   * and a check run there. Null where there is none.
   * @param {string} project @param {string} name @param {number} v
   */
  const madeIn = (project, name, v) => {
    const made = (artifacts.get(name)?.versions || []).slice(0, v).reverse().find((x) => x.by?.chain)?.by.chain || null;
    return made && projectOfChain(made) === project ? made : null;
  };
  /**
   * The model a Space's second look and check start on first, where its Space has one (the owner's of 11-04): its own,
   * else Settings › Space's; null where neither names one — the Reviewer's own then.
   * @param {string} project @returns {{ model: string, why: string } | null}
   */
  const spaceLook = (project) => {
    const on = typeof spaces.runsOn === "function" ? spaces.runsOn(project) : null;
    // One that cannot run now gives way to the Reviewer's own, which the sheet offered before (found by the review of 11-04).
    if (!on?.model || modelProblem(on.model)) return null;
    return { model: on.model, why: on.from === "space" ? "this Space's model" : "every Space's model, from Settings › Space" };
  };
  /** A row's columns as words, its key aside. @param {Record<string, unknown>} r */
  const colsOf = (r) => Object.fromEntries(Object.entries(r).filter(([c]) => c !== ROW_KEY).map(([c, v]) => [c, String(v ?? "")]));

  /**
   * A button's check (HarnessV4_Space_Plan S5d, SG-D25): after it ran and ended done, the Reviewer — read-only — in the
   * chat that made the version shown, on the model the person chose, told what the button is for, what ran and what it
   * said, the row before and the rows its source read again after, and what its author said to look for (`verify`). No
   * clock: its verdict lands as it ends — in What happened, and in Needs you where it says it did not work —, whether
   * the sheet stays open or not.
   * @param {string} project @param {string} name
   * The rows after are its source read again once the button ended; `unread`, why they could not be — the check is told
   * so, and looks for itself.
   * @param {{ a: import("../core/dashboard-sources.js").Action, row: Record<string, unknown>, live: { v: number, title: string },
   *   key: string, ran: string, said: string, last: string, folder: string, model: string, unread?: string }} o
   * @returns {{ chain: string, agent: string } | { error: string }}  where it runs, for the sheet to follow; or why none
   */
  function checkRun(project, name, { a, row, live, key, ran, said, last, folder, model, unread = "" }) {
    const made = madeIn(project, name, live.v);
    if (!made) return { error: `the chat that made ${live.title} is gone` };
    const rows = unread ? [] : stateOf(name, a.on)?.rows || [];
    const after = rows.find((r) => rowKey(r) === key) || null;
    /** @type {import("../core/second-look.js").CheckAbout} */
    const about = {
      label: a.label, dashboard: live.title, says: filled(a.says, row), ran, ...(a.tool ? { tool: a.tool.connection } : {}), folder, said,
      verify: a.verify ? filled(a.verify, row) : "", before: colsOf(row), after: after ? colsOf(after) : null, rows: rows.filter((r) => r !== after).map(colsOf),
      ...(unread ? { unread } : {}),
    };
    const what = a.label.replace(/\s*…$/, "");
    const r = checks.start({ chainId: made, cwd: folder, about, why: `you asked an agent to check what “${what}” did on “${live.title}”`, description: `Check: ${what} on ${live.title}`, model });
    if (!r.ok) return { error: r.error };
    log("info", `dashboards: ${name}'s “${a.label}” is checked by ${r.agent} in ${r.chain}`);
    // Kept under way, so a restart that cuts it says so (`start`; found by the Hunter on S5d).
    const facts = { dashboard: name, title: live.title, label: a.label, ran, said: last };
    awaiting.add(r.agent);
    try {
      spaces.checkStarted(project, { agent: r.agent, chain: r.chain, ...facts });
    } catch (/** @type {any} */ e) {
      log("warn", `dashboards: ${name}'s check could not be kept under way (${e?.message || e})`);
    }
    void checks.ended(r.chain, r.agent).then(
      (end) => {
        awaiting.delete(r.agent);
        const v = end.status === "done" ? verdictOf(end.report) : null;
        // Its Space deleted meanwhile: the verdict has nowhere to land (found by the Hunter on apps: it threw, unheard).
        try {
          spaces.checkSaid(project, { ...facts, agent: r.agent, ...(v || { verdict: /** @type {const} */ ("none"), reason: end.status === "stopped" ? "" : end.error || `it ended ${end.status}`, stopped: end.status === "stopped" }) });
        } catch (/** @type {any} */ e) {
          log("warn", `dashboards: ${name}'s check ended, and its Space could not be told (${e?.message || e})`);
          return;
        }
        events?.publish("space", { type: "space", project, dashboard: name });
      },
      (/** @type {any} */ e) => {
        awaiting.delete(r.agent);
        log("warn", `dashboards: ${name}'s check could not land (${e?.message || e})`);
      },
    );
    return { chain: r.chain, agent: r.agent };
  }

  /**
   * An app's secrets, for its sheet (the Space Apps plan of 10-29): each one its newest version or its Keep names,
   * with its line, whether it is set and when, and whether its commands get it now — the Keep names it —; never a
   * value. Refused for an app this Space does not show.
   * @param {string} project @param {string} name
   */
  function secretsOf(project, name) {
    const d = shown(project).find((x) => x.name === name);
    if (!d) return no(404, `there is no app ${name} in this Space`);
    const a = artifacts.get(name);
    const declared = /** @type {Record<string, string>} */ ((a && contentOf(name, a.versions.length)?.secrets) || {});
    const handed = keptOf(name)?.d.grant?.secrets || [];
    const set = secretStore?.list(name) || {};
    const names = [...new Set([...Object.keys(declared), ...handed])];
    return { ok: /** @type {const} */ (true), secrets: names.map((n) => ({ name: n, about: String(declared[n] || ""), set: !!set[n], at: set[n]?.at ?? null, handed: handed.includes(n) })) };
  }

  /**
   * A kept app's hooks (phase 4), as What it may do shows them: each its Keep grants, with its builder's line, its
   * address — `withAddress`: the person's sheet alone, never an agent's read — and when that was made, and how many
   * records its collection keeps. One not kept here takes nothing. Refused for an app this Space does not show.
   * @param {string} project @param {string} name @param {{ withAddress?: boolean }} [o]
   */
  function hooksOf(project, name, { withAddress = false } = {}) {
    const d = shown(project).find((x) => x.name === name);
    if (!d) return no(404, `there is no app ${name} in this Space`);
    const k = keptOf(name);
    const granted = k && k.project === project ? k.d.grant?.hooks || [] : [];
    // Made at its Keep; made here too where the file that kept them was lost.
    const tokens = granted.length && hookStore ? hookStore.ensure(name, granted) : {};
    const words = /** @type {Record<string, string>} */ ((liveOf(name)?.content ?? contentOf(name, d.v))?.hooks || {});
    const base = baseOf();
    return {
      ok: /** @type {const} */ (true),
      hooks: granted.map((h) => {
        const kept = artifacts.data.list(name, h);
        const t = tokens[h];
        return {
          name: h,
          about: String(words[h] || ""),
          records: kept.ok ? kept.records.length : 0,
          at: t?.at ?? null,
          paused: !!k?.d.paused,
          ...(withAddress ? { address: t && base ? `${base}/hook/${encodeURIComponent(name)}/${t.token}` : null } : {}),
        };
      }),
    };
  }

  return {
    read,
    mayRead,
    liveOf,
    shown,
    /**
     * Several Spaces' `shown` at once, the artifacts listed once (the left bar's rows of each Space's apps, asked at every
     * Space's change: the owner's idea of 10-29). @param {string[]} projects @returns {Record<string, any[]>}
     */
    shownIn: (projects) => {
      const all = projects.length ? artifacts.list() : [];
      return Object.fromEntries(projects.map((p) => [p, shown(p, all)]));
    },
    /**
     * A Space's asks settled against its dashboards as shown (E42 SA-D7): one kept — there or anywhere —, resumed, or
     * whose version moved on or that was taken out, goes to Done today by itself. → the rows that went.
     * @param {string} project
     */
    asksSettle: (project) => spaces.asksSettle(project, shown(project)),
    /**
     * What a button's sheet shows as it opens (screen 10): its sentence and its command with the row's values, each
     * field still its placeholder — the sheet fills them as they are typed —, its fields with their choices now, where it
     * runs; or why it may not run, a row's value against its check included. `skeptic`: who would look at it, should the
     * person ask — the chat it runs in, and the model it would run on, with why —; nothing starts as it opens (the
     * owner's word of 10-31). Null where the chat that made the version is gone, which `checkOff` says.
     * @param {string} project @param {string} name @param {string} action @param {string} key
     */
    async sheet(project, name, action, key) {
      let p = pressed(project, name, action, key);
      if (!p.ok) return p;
      // A field's choices from another source: that source read where it was not yet, or is older than its every (found
      // by the Hunter on S4a: read once, its choices were served however old) — younger, its rows as read.
      for (const f of p.a.ask) if (f.from) await read(name, p.live.v, f.from.source, { by: "you" });
      p = pressed(project, name, action, key);
      if (!p.ok) return p;
      const { a, row, live } = p;
      const pre = fillAction(a, row, {}, choicesIn(name), { rowOnly: true });
      if (!pre.ok) return no(409, pre.error);
      const made = madeIn(project, name, live.v);
      return {
        ok: /** @type {const} */ (true),
        label: a.label,
        title: live.title,
        says: filled(a.says, row),
        command: pre.argv,
        // A tool's button (S4a): the call, its args filled from the row as its schema takes them, each field still its
        // placeholder; `asks`, the fields whose answer goes where the schema takes no text, so the sheet shows it so.
        tool: a.tool ? await toolSheet(project, a.tool, pre.args || {}) : null,
        folder: folderOf(project),
        ask: a.ask.map((f) => ({ name: f.name, label: f.label, required: f.required, choices: f.choices || (f.from ? choicesIn(name)(f.from) : null) })),
        secondLook: a.secondLook,
        // What it does (10-29): a keeps button runs as pressed, with no sheet.
        effect: a.effect,
        // Its check (S5d): what its author said to look for, and why none could run ("" one can).
        verify: a.verify ? filled(a.verify, row) : "",
        checkOff: made ? "" : `the chat that made ${live.title} is gone`,
        // Its Space's model first, where one is set (the owner's of 11-04): what its agents run on by themselves.
        skeptic: made ? { chain: made, ...(spaceLook(project) || lookModel(made) || { model: "", why: "" }) } : null,
        running: acting.get(name)?.label ?? null,
      };
    },
    /**
     * A button run (SG-D11): pressed again on the row as Filament read it, its command filled and checked, run in the
     * project's folder with no clock on it — one at a time on a dashboard —, then a line in What happened and its
     * source read again. A refusal says why; a command that ran and failed says what it said. `check` (S5d): the person
     * asked an agent to check it, on the model they chose — once it ran and ended done (`checkRun`); the answer says
     * where, or why there is none. One asked with no model, or on one that cannot run now, is refused before anything
     * runs (the owner's word of 10-31: no agent starts on a model the person did not choose).
     * `by` (HarnessV4_AgentsSpace_Plan SA-D4): a chat's agent pressed it, which its tab and What happened say; `expect`,
     * what its chat's gate judged — the command and the tool's args —, so a row read again since, which fills it
     * otherwise, runs nothing. `signal`: the agent's turn, whose stop stops this run while it runs, and nothing after.
     * In an archived project an agent's press is refused (s-itself, 11-12): the person's runs still.
     * @param {string} project @param {string} name @param {string} action @param {string} key @param {Record<string, unknown>} answers
     * @param {{ check?: { model: string } | null, by?: Presser | null, expect?: { argv: string[], args: Record<string, unknown> | null } | null, signal?: AbortSignal | null }} [o]
     */
    async act(project, name, action, key, answers, { check = null, by = null, expect = null, signal = null } = {}) {
      if (by && spaces.archived(project)) return no(409, ARCHIVED_PRESS);
      const p = pressed(project, name, action, key);
      if (!p.ok) return p;
      const { a, row, live } = p;
      const checkOn = check ? String(check.model || "").trim() : "";
      if (check && !checkOn) return no(400, "choose the model the check runs on");
      const cannot = checkOn ? modelProblem(checkOn) : null;
      if (cannot) return no(409, `the check cannot run on "${checkOn}": ${cannot}`);
      const busy = acting.get(name);
      if (busy) return no(409, `${busy.label} is running on ${live.title}${busy.by ? `, pressed by ${presserFor(busy.by, by)}` : ""}: wait for it, or stop it`);
      const fill = fillAction(a, row, answers, choicesIn(name));
      if (!fill.ok) return no(400, fill.error);
      if (expect && JSON.stringify({ argv: fill.argv, args: fill.args || null }) !== JSON.stringify(expect))
        return no(409, "the row changed since the press was judged: read the dashboard again, and press it anew");
      const folder = folderOf(project);
      if (!folder && !a.tool) return no(409, "its project has no folder to run in");
      if (signal?.aborted) return no(409, "its turn was stopped before it was pressed");
      const abort = new AbortController();
      /** @type {() => void} */
      let ended = () => {};
      const mine = { label: a.label, action, abort, by, why: /** @type {string | null} */ (null), ended: new Promise((/** @type {(v: void) => void} */ r) => (ended = r)) };
      acting.set(name, mine);
      // The turn's stop stops this run while it runs, and nothing after (found reviewing the Space work: it was heard
      // until the read after the run, and stopped the person's next press).
      const onStop = () => abort.abort();
      signal?.addEventListener("abort", onStop, { once: true });
      // Its run, which an app's page follows as it goes: its output as it comes, then how it ended.
      /** @type {Job} */
      const job = { id: `j${now().toString(36)}${(++jobSeq).toString(36)}`, action, label: a.label, key, state: "running", startedAt: now(), endedAt: null, said: "", by: by?.byName ?? null, ...(by ? { byChain: by.chain } : {}), log: "" };
      const runs = jobs.get(name) || [];
      runs.push(job);
      jobs.set(name, runs.slice(-JOBS_KEPT));
      keepRun(name, job);
      tellJob(name, { id: job.id, action, state: "running" });
      // Its secrets (10-29): in its command's environment, and hidden in what it says before its log or its page has any.
      const sealed = sealedFor(name);
      const told = sealed.hide.stream((chunk) => {
        job.log = (job.log + chunk).slice(-JOB_LOG_MAX);
        tellJob(name, { id: job.id, action, chunk });
        if (now() - (keptAt.get(job.id) || 0) >= RUN_KEEP_MS) keepRun(name, job);
      });
      const onData = (/** @type {string} */ chunk) => told.push(chunk);
      // Its tab shows it running, with Stop — an agent's press too (SA-D3).
      events?.publish("space", { type: "space", project, dashboard: name });
      let got;
      try {
        // A tool's button calls it through the project's server (S4a); a command runs in the project's folder.
        got = a.tool ? await tools.act(project, a.tool, fill.args || {}, abort.signal) : await act(fill.argv, /** @type {string} */ (folder), abort.signal, onData, sealed.env);
        if (sealed.hide.any) got = { ...got, said: sealed.hide.text(got.said), ...(got.ok ? {} : { error: sealed.hide.text(got.error) }) };
      } finally {
        told.end();
        signal?.removeEventListener("abort", onStop);
        acting.delete(name);
        if (!got) {
          job.state = "failed";
          job.endedAt = now();
          keepRun(name, job);
          keptAt.delete(job.id);
          tellJob(name, { id: job.id, action, state: job.state });
          ended();
        }
      }
      const last = got.said.split(/\r?\n/).filter((l) => l.trim()).at(-1)?.trim().slice(0, 300) || "";
      job.state = got.ok ? "done" : got.error === "you stopped it" ? "stopped" : "failed";
      job.endedAt = now();
      // Stopped where no one pressed Stop — its Space deleted meanwhile (found by the Hunter on apps), its app taken out
      // or deleted, Filament stopping —: said so, not as the person's stop.
      const why = !got.ok && got.error === "you stopped it" ? mine.why : null;
      job.said = got.ok ? last : why || got.error;
      // A tool's call says nothing as it goes: what it said, whole, once it ended.
      if (!job.log && got.said) job.log = got.said.slice(-JOB_LOG_MAX);
      keepRun(name, job);
      keptAt.delete(job.id);
      tellJob(name, { id: job.id, action, state: job.state });
      ended();
      // A tool's call stopped once sent: its server was told to cancel it, and what it did before that stays done.
      const stoppedWords = !got.ok && got.sent ? `you stopped it; ${a.tool?.connection} was told to cancel the call, and what it did before that stays done` : !got.ok && got.sent === false ? "you stopped it before it was called" : "you stopped it";
      const outcome = got.ok ? last || "done" : why || (got.error === "you stopped it" ? stoppedWords : `it failed: ${got.error}`);
      // A tool's line says the args it was sent, as its schema took them.
      const sent = a.tool ? got.args || fill.args : undefined;
      const ran = a.tool ? toolWords(a.tool, sent) : argvWords(fill.argv);
      // An agent's press is the chat's own line (SA-D4), its stop the chat's too.
      const outcomeBy = by && !got.ok && got.error === "you stopped it" ? outcome.replace(/^you stopped it/, "it was stopped") : outcome;
      // A Space deleted meanwhile has no What happened to say it in: its press is answered all the same (found by the
      // Hunter on apps — it was answered 404 after its command ran, and nothing after the line was done).
      try {
        if (by) spaces.dashboardSaid(project, `Pressed “${a.label}” on ${live.title}: ${ran} — ${outcomeBy}`, { kind: "agent", chain: by.chain, ...(by.name ? { name: by.name } : {}) });
        else spaces.dashboardSaid(project, `You ran “${a.label}” on ${live.title}: ${ran} — ${outcome}`);
      } catch (/** @type {any} */ e) {
        log("warn", `dashboards: ${name}'s ${action} ended, and its Space could not be told (${e?.message || e})`);
      }
      log(got.ok ? "info" : "warn", `dashboards: ${name}'s ${action} ${got.ok ? "ran" : `failed (${got.error})`}`);
      const endedAt = now();
      // One stopped by its Space, its app or Filament going reads nothing again: nothing shows it now.
      const again = why ? null : await read(name, live.v, a.on, { force: true, after: true, by: by ? "agent" : "you" });
      // Its check (S5d), on its rows read again: only where it ended done — a failure says itself. Where they could not
      // be read again, the check is told so, never shown the rows from before as after (found by the Hunter on S5d).
      const unread = !again ? "" : !again.ok ? again.error : again.state.error ? again.state.error : again.state.at < endedAt ? "its read was stopped" : "";
      const checked = got.ok && checkOn ? checkRun(project, name, { a, row, live, key, ran, said: got.said, last, folder: folder || "", model: checkOn, unread }) : null;
      events?.publish("space", { type: "space", project, dashboard: name });
      // `outcome`: its end in What happened's words, which a stopped one's sheet says too.
      // `output`: what it said, its last characters, for Hand to an agent… (S5d).
      // `job`: its run's id, which an agent reads its log by (the Space Apps plan of 10-29).
      return { ok: /** @type {const} */ (true), done: got.ok, said: last, output: got.said.slice(-HAND_OUTPUT_CHARS), ran, error: got.ok ? null : got.error, outcome, argv: fill.argv, job: job.id, ...(a.tool ? { args: sent } : {}), ...(checked ? { check: checked } : {}) };
    },
    /**
     * A button's second look (S3b, SG-D12): the Reviewer, read-only, starts as the person asks for it on its sheet — never
     * as it opens (the owner's word of 10-31) —, on the model they chose: in the chat that made the version shown (the
     * newest up to it a chat made), a chat of this project, in the project's folder, told the command with the row's
     * values, the button's sentence, the row and its source's other rows. Run never waits for it.
     * @param {string} project @param {string} name @param {string} action @param {string} key @param {string} model
     */
    async lookAt(project, name, action, key, model) {
      const p = pressed(project, name, action, key);
      if (!p.ok) return p;
      const { a, row, live } = p;
      if (!a.secondLook) return no(409, `${a.label} asks for no second look`);
      const on = String(model || "").trim();
      if (!on) return no(400, "choose the model the Reviewer runs on");
      const pre = fillAction(a, row, {}, choicesIn(name), { rowOnly: true });
      if (!pre.ok) return no(409, pre.error);
      const made = madeIn(project, name, live.v);
      if (!made) return no(409, `the chat that made ${live.title} is gone`);
      const folder = folderOf(project) || "";
      const why = `you asked for a second look at the button “${a.label}” of the dashboard “${live.title}”`;
      const others = (stateOf(name, a.on)?.rows || []).filter((r) => r !== row).map(colsOf);
      const about = { command: a.tool ? toolWords(a.tool, (await toolSheet(project, a.tool, pre.args || {})).args) : argvWords(pre.argv), ...(a.tool ? { tool: a.tool.connection } : {}), folder, why, button: { label: a.label, dashboard: live.title, says: filled(a.says, row), row: colsOf(row), rows: others } };
      const r = startLook({ chainId: made, cwd: folder, about, why, description: `Second look: ${a.label.replace(/\s*…$/, "")} on ${live.title}`, model: on });
      return r.ok ? { ok: /** @type {const} */ (true), chain: r.chain, agent: r.agent } : no(409, r.error);
    },
    /**
     * What a project's kept dashboards reach out through (HarnessV4_Space_Plan S4b, the Connections sheet), as kept:
     * each connection a source reads or a button calls, by dashboard — its title, the sources, the buttons' labels —;
     * each program a command runs, with the dashboards that run it; and the folder they run in.
     * @param {string} project
     */
    usesOf(project) {
      /** @type {Record<string, { name: string, title: string, reads: string[], presses: string[] }[]>} */
      const connections = {};
      /** Each program, by the dashboards that run it — each once, by its name: two may share a title (found by the Hunter on S4b). @type {Map<string, Map<string, string>>} */
      const programs = new Map();
      for (const k of spaces.keptDashboards().filter((x) => x.project === project && x.d.grant)) {
        const live = liveOf(k.d.name);
        const title = live?.title || artifacts.get(k.d.name)?.title || k.d.name;
        /** @type {Record<string, any>} */
        const labels = live?.content?.actions || {};
        /** @param {string} c */
        const use = (c) => {
          const list = (connections[c] ||= []);
          let u = list.find((x) => x.name === k.d.name);
          if (!u) list.push((u = { name: k.d.name, title, reads: [], presses: [] }));
          return u;
        };
        /** @param {string[]} argv */
        const ran = (argv) => {
          const program = String(argv[0] || "").split(/[\\/]/).pop() || "";
          if (!program) return;
          const by = programs.get(program) || new Map();
          by.set(k.d.name, title);
          programs.set(program, by);
        };
        const g = /** @type {import("../core/dashboard-sources.js").Grant} */ (k.d.grant);
        for (const [s, x] of Object.entries(g.sources)) "tool" in x && x.tool ? use(x.tool.connection).reads.push(s) : ran(/** @type {any} */ (x).command || []);
        for (const [a, x] of Object.entries(g.actions)) "tool" in x && x.tool ? use(x.tool.connection).presses.push(String(labels[a]?.label || a)) : ran(/** @type {any} */ (x).command || []);
      }
      return { connections, programs: [...programs].map(([program, by]) => ({ program, by: [...by.values()] })), folder: folderOf(project) };
    },
    /**
     * What a project's kept dashboards feed into its Space (S4c): each one's lines on the lanes — a branch's row, its
     * words and tone — and its cards on the board, each with the dashboard's buttons that fit its row; from the rows
     * Filament read itself, never a draft's sample rows. A paused one feeds nothing. A source older than its every is
     * read as the Space is read, as a tab reads its own; what it read last stands meanwhile, `stale` where its last
     * read failed — a stale card offers no button then, as its tab's rows offer none (found by the Hunter on S4c: they
     * were refused when pressed), and names its `source` to read again. A task source that never read says why in its
     * count (`error`) rather than putting nothing on the board in silence. `held`: its source waits for the person's
     * Keep, so its rows are stale until then, and Read again mends nothing (found by the review of 10-31).
     * @param {string} project
     */
    feeds(project) {
      /** @type {{ dashboard: string, title: string, branch: string, words: string, tone: string, at: number, stale: boolean, held?: true }[]} */
      const lanes = [];
      /** @type {{ dashboard: string, title: string, source: string, key: string, task: string, line: string, column: string, at: number, stale: boolean, held?: true, presses: { name: string, label: string }[] }[]} */
      const tasks = [];
      /** @type {{ dashboard: string, title: string, count: number, more: number, done: number, error?: string, held?: true }[]} */
      const counts = [];
      for (const k of spaces.keptDashboards().filter((x) => x.project === project && !x.d.paused && x.d.grant)) {
        const live = liveOf(k.d.name);
        if (!live) continue;
        const lf = laneFeedOf(live.content.lanes);
        const tf = taskFeedOf(live.content.tasks);
        /** @param {string} source @returns {{ rows: Record<string, unknown>[], at: number, stale: boolean, held: boolean } | { error: string, held: boolean } | null} */
        const rowsOf = (source) => {
          const raw = live.content.sources?.[source];
          if (!raw) return null;
          void read(k.d.name, live.v, source).catch(() => {});
          const held = sourceHeld(k.d.name, raw, project);
          const st = stateOf(k.d.name, source);
          if (st && st.at) return { rows: st.rows, at: st.at, stale: !!held || staleRows(st), held: !!held };
          if (held) return { error: held, held: true };
          return st?.error ? { error: String(st.error), held: false } : null;
        };
        const lr = lf ? rowsOf(lf.from) : null;
        if (lf && lr && "rows" in lr)
          for (const l of laneLines(lf, lr.rows)) lanes.push({ dashboard: k.d.name, title: live.title, branch: l.branch, words: l.words, tone: l.tone, at: lr.at, stale: lr.stale, ...(lr.held ? { held: /** @type {const} */ (true) } : {}) });
        const tr = tf ? rowsOf(tf.from) : null;
        if (tf && tr && "error" in tr) counts.push({ dashboard: k.d.name, title: live.title, count: 0, more: 0, done: 0, error: tr.error, ...(tr.held ? { held: /** @type {const} */ (true) } : {}) });
        else if (tf && tr && "rows" in tr) {
          const buttons = tr.stale ? [] : Object.entries(live.content.actions || {}).map(([name, raw]) => ({ name, a: actionKept(raw) })).filter((b) => b.a.on === tf.from);
          const { cards, more, done } = taskCards(tf, tr.rows);
          for (const c of cards)
            tasks.push({ dashboard: k.d.name, title: live.title, source: tf.from, key: c.key, task: c.title, line: c.line, column: c.column, at: tr.at, stale: tr.stale, ...(tr.held ? { held: /** @type {const} */ (true) } : {}), presses: buttons.filter((b) => actionOnRow(b.a, c.row)).map((b) => ({ name: b.name, label: b.a.label })) });
          counts.push({ dashboard: k.d.name, title: live.title, count: cards.length, more, done });
        }
      }
      return { lanes, tasks, counts };
    },
    /**
     * Your Space's At a glance (S5b, S5-D7): each kept dashboard switched there, with its project, its status tiles as
     * its tab says them, from the rows Filament read — `stale` where its last read failed since, `read` false while
     * nothing was read yet —; a paused one says so and reads nothing. A source older than its every is read as the page
     * is, as its tab reads its own; what it read last stands meanwhile. `projects`: every kept dashboard of these, switched
     * there or not — the tiles of the projects a Space of your own shows (HarnessV4_SpacesPlugins_Plan A7). `held`: its
     * source waits for the person's Keep — what it read before stale until then, and none read never "Reading…" (found
     * by the review of 10-31).
     * @param {{ projects?: ReadonlySet<string> }} [o]
     * @returns {{ project: string, name: string, title: string, paused: boolean,
     *   tiles: { title: string, from: string, line: import("../core/space-feeds.js").StatusLine | null, read: boolean, at: number, stale: boolean, error: string | null, held?: true }[] }[]}
     */
    glance({ projects } = {}) {
      return spaces
        .keptDashboards()
        .filter((k) => !!k.d.grant && (projects ? projects.has(k.project) : k.d.glance === true))
        .map((k) => {
          const live = liveOf(k.d.name);
          const title = live?.title || artifacts.get(k.d.name)?.title || k.d.name;
          if (k.d.paused || !live) return { project: k.project, name: k.d.name, title, paused: k.d.paused, tiles: [] };
          // Its project archived (s-itself, 11-12): nothing reads it by itself, so its line is as of its last read, and
          // one never read says why — never "Reading…".
          const still = spaces.archived(k.project);
          const tiles = statusTiles(live.content).map((t) => {
            const from = String(t.from);
            void read(k.d.name, live.v, from).catch(() => {});
            const held = !!sourceHeld(k.d.name, live.content.sources[from], k.project);
            const st = stateOf(k.d.name, from);
            const got = st && st.at ? st : null;
            return {
              title: String(t.title || ""),
              from,
              line: got ? statusLine(t, got.rows) : null,
              read: !!got,
              at: got?.at || 0,
              stale: !!got && (held || still || staleRows(got)),
              error: st?.error ?? (still && !got && !held ? ARCHIVED_ROW : null),
              ...(held ? { held: /** @type {const} */ (true) } : {}),
            };
          });
          return { project: k.project, name: k.d.name, title, paused: false, tiles };
        });
    },
    /**
     * A kept dashboard of a project's Space shown on Your Space's At a glance, or not (S5b): refused where it is not
     * kept there.
     * @param {string} project @param {string} name @param {boolean} on
     */
    setGlance(project, name, on) {
      const a = artifacts.get(name);
      spaces.dashboardGlance(project, name, on, a?.title || name);
    },
    /**
     * What Keep's sheet says of each connection's tool a dashboard's newest version names (S4a): its sources' — which
     * must only read — and its buttons'. Asked as the sheet opens; nothing is called. Refused where the dashboard is not
     * one this Space shows. `kept`: What it may do — the tools the kept grant names, which run now, not a draft's
     * beside it.
     * @param {string} project @param {string} name @param {{ kept?: boolean }} [o]
     */
    async toolsOf(project, name, { kept = false } = {}) {
      const d = shown(project).find((x) => x.name === name);
      if (!d) return no(404, `${name} is no dashboard of this Space`);
      /** @type {{ connection: string, name: string, reads: boolean, of: string }[]} */
      const named = [];
      const g = kept ? keptOf(name)?.d.grant || null : null;
      if (kept && !g) return no(409, `${d.title} is not kept in this Space`);
      if (g) {
        for (const [s, x] of Object.entries(g.sources)) if ("tool" in x && x.tool) named.push({ connection: x.tool.connection, name: x.tool.name, reads: true, of: `source:${s}` });
        for (const [b, x] of Object.entries(g.actions)) if ("tool" in x && x.tool) named.push({ connection: x.tool.connection, name: x.tool.name, reads: false, of: `action:${b}` });
      } else {
        const content = contentOf(name, d.v) || {};
        for (const [s, raw] of Object.entries(content.sources || {})) {
          const k = sourceKept(raw);
          if (k.tool) named.push({ connection: k.tool.connection, name: k.tool.name, reads: true, of: `source:${s}` });
        }
        for (const [b, raw] of Object.entries(content.actions || {})) {
          const k = actionKept(raw);
          if (k.tool) named.push({ connection: k.tool.connection, name: k.tool.name, reads: false, of: `action:${b}` });
        }
      }
      if (!named.length) return { ok: /** @type {const} */ (true), tools: [] };
      const checked = await tools.check(project, named.map(({ connection, name: tool, reads }) => ({ connection, name: tool, reads })));
      return { ok: /** @type {const} */ (true), tools: checked.map((c, i) => ({ ...c, of: named[i].of })) };
    },
    /**
     * Stop the button running on a dashboard. `by`: a chat's agent, which stops its own chat's press alone
     * (HarnessV4_AgentsSpace_Plan AS3); the person stops any.
     * @param {string} project @param {string} name @param {{ by?: { chain: string } | null }} [o]
     */
    stopAct(project, name, { by = null } = {}) {
      const live = liveOf(name);
      const busy = live && live.project === project ? acting.get(name) : null;
      if (!busy) return no(409, "nothing of it is running");
      if (by && busy.by?.chain !== by.chain) return no(403, `“${busy.label}” was pressed by ${busy.by ? presserFor(busy.by, by) : "the person"}: ${busy.by ? "that chat or " : ""}the person stops it`);
      busy.abort.abort();
      return { ok: /** @type {const} */ (true), label: busy.label };
    },
    /**
     * A button as an agent's press would run it now (HarnessV4_AgentsSpace_Plan SA-D4): pressed on the row as Filament read
     * it, its command — or its tool call — filled with the agent's answers and each value checked, for the chat's gate to
     * judge before it runs (`expect` is what `act` then runs alone); or why it may not run, as the sheet refuses — and
     * in an archived project, where the person's own press alone runs (s-itself, 11-12).
     * @param {string} project @param {string} name @param {string} action @param {string} key @param {Record<string, unknown>} answers
     */
    pressOf(project, name, action, key, answers) {
      if (spaces.archived(project)) return no(409, ARCHIVED_PRESS);
      const p = pressed(project, name, action, key);
      if (!p.ok) return p;
      const { a, row, live } = p;
      const fill = fillAction(a, row, answers, choicesIn(name));
      if (!fill.ok) return no(400, fill.error);
      const folder = folderOf(project);
      if (!folder && !a.tool) return no(409, "its project has no folder to run in");
      return {
        ok: /** @type {const} */ (true),
        label: a.label,
        title: live.title,
        says: filled(a.says, row),
        argv: fill.argv,
        tool: a.tool ? { connection: a.tool.connection, name: a.tool.name } : null,
        args: fill.args || null,
        folder: folder || "",
        secondLook: a.secondLook,
        // What it does (10-29): a sends button asks the person whatever the chat's mode, unless they let agents press it.
        effect: a.effect,
        allowed: (keptOf(name)?.d.allowed || []).includes(action),
        expect: { argv: fill.argv, args: fill.args || null },
      };
    },
    /**
     * A kept app's tool as an agent's call would run it now (the owner's of 11-05): its command filled with the agent's
     * arguments, each checked, for the chat's gate to judge before it runs (`expect` is what `useTool` then runs alone);
     * or why it may not run — not kept here, paused, its project archived (s-itself, 11-12: a tool is an agent's alone),
     * no such tool, a script it runs changed since the Keep, an argument its checks refuse.
     * @param {string} project @param {string} name @param {string} tool @param {unknown} args
     */
    toolOf(project, name, tool, args) {
      const live = liveOf(name);
      if (!live || live.project !== project) return no(409, "it is not kept in this Space: its tools run once it is");
      if (live.d.paused) return no(409, "it is paused: nothing of it runs until the person resumes it");
      if (spaces.archived(project)) return no(409, ARCHIVED_PRESS);
      // Its own tools alone: "constructor" is none (found by the review of 11-05).
      const raw = live.content?.tools && Object.hasOwn(live.content.tools, tool) ? live.content.tools[tool] : null;
      if (!raw) {
        const has = Object.keys(live.content?.tools || {});
        return no(404, `v${live.v} has no tool ${String(tool).slice(0, 40)}${has.length ? `: its tools are ${has.join(", ")}` : ": it offers none"}`);
      }
      const k = appToolKept(raw);
      const held = heldOf(name, scriptParts(k), project);
      if (held) return no(409, held);
      const fill = fillAppTool(k, args);
      if (!fill.ok) return no(400, fill.error);
      const folder = folderOf(project);
      if (!folder) return no(409, "its project has no folder to run in");
      return { ok: /** @type {const} */ (true), title: live.title, tool, description: k.description, argv: fill.argv, folder, effect: k.effect, expect: { argv: fill.argv } };
    },
    /**
     * A kept app's tool run by an agent of its Space (the owner's of 11-05), as its chat's gate let it: filled again from
     * the kept version — `expect`, what the gate judged, so a version kept since runs nothing it did not judge —, run in
     * the project's folder with the app's secrets in its environment and hidden in what it says, kept as one of its runs.
     * One that writes or sends says so in What happened; one that reads says nothing there. No row is read again after it.
     * @param {string} project @param {string} name @param {string} tool @param {unknown} args
     * @param {{ by?: Presser | null, expect?: { argv: string[] } | null, signal?: AbortSignal | null }} [o]
     */
    async useTool(project, name, tool, args, { by = null, expect = null, signal = null } = {}) {
      const t = this.toolOf(project, name, tool, args);
      if (!t.ok) return t;
      if (expect && JSON.stringify(t.argv) !== JSON.stringify(expect.argv)) return no(409, "the tool changed since its call was judged: list its tools again, and call it anew");
      if (signal?.aborted) return no(409, "its turn was stopped before it ran");
      const label = `${tool} (a tool)`;
      // One run at a time per app, a button's or a tool's; its Stop, its app taken out and Filament's stop reach it as
      // a button's run (found by the review of 11-05), and so does its time.
      const busy = acting.get(name);
      if (busy) return no(409, `${busy.label} is running on ${t.title}${busy.by ? `, run by ${presserFor(busy.by, by)}` : ""}: wait for it, or stop it`);
      const abort = new AbortController();
      /** @type {() => void} */
      let ended = () => {};
      const mine = { label, action: tool, abort, by, why: /** @type {string | null} */ (null), ended: new Promise((/** @type {(v: void) => void} */ r) => (ended = r)) };
      acting.set(name, mine);
      const onStop = () => abort.abort();
      signal?.addEventListener("abort", onStop, { once: true });
      const timer = setTimeout(() => {
        mine.why = `it ran past ${TOOL_RUN_MS / 60_000} min, the most a tool's run may take`;
        abort.abort();
      }, TOOL_RUN_MS);
      timer.unref?.();
      /** @type {Job} */
      const job = { id: `j${now().toString(36)}${(++jobSeq).toString(36)}`, action: tool, label, key: "", state: "running", startedAt: now(), endedAt: null, said: "", by: by?.byName ?? null, ...(by ? { byChain: by.chain } : {}), log: "" };
      const runs = jobs.get(name) || [];
      runs.push(job);
      jobs.set(name, runs.slice(-JOBS_KEPT));
      keepRun(name, job);
      tellJob(name, { id: job.id, action: tool, state: "running" });
      const sealed = sealedFor(name);
      const told = sealed.hide.stream((chunk) => {
        job.log = (job.log + chunk).slice(-JOB_LOG_MAX);
        tellJob(name, { id: job.id, action: tool, chunk });
      });
      /** @type {import("../core/dashboard-sources.js").ActionOut | undefined} */
      let got;
      try {
        got = await act(t.argv, t.folder, abort.signal, (/** @type {string} */ chunk) => told.push(chunk), sealed.env);
        if (sealed.hide.any) got = { ...got, said: sealed.hide.text(got.said), ...(got.ok ? {} : { error: sealed.hide.text(got.error) }) };
        // Stopped where no one pressed Stop — its time, its app taken out, Filament stopping —: said so.
        if (!got.ok && got.error === "you stopped it" && mine.why) got = { ...got, error: mine.why };
      } finally {
        told.end();
        clearTimeout(timer);
        signal?.removeEventListener("abort", onStop);
        acting.delete(name);
        if (!got) {
          job.state = "failed";
          job.endedAt = now();
          keepRun(name, job);
          tellJob(name, { id: job.id, action: tool, state: job.state });
          ended();
        }
      }
      const last = got.said.split(/\r?\n/).filter((l) => l.trim()).at(-1)?.trim().slice(0, 300) || "";
      job.state = got.ok ? "done" : got.error === "you stopped it" ? "stopped" : "failed";
      job.endedAt = now();
      job.said = got.ok ? last : got.error;
      if (!job.log && got.said) job.log = got.said.slice(-JOB_LOG_MAX);
      keepRun(name, job);
      keptAt.delete(job.id);
      tellJob(name, { id: job.id, action: tool, state: job.state });
      ended();
      const ran = argvWords(t.argv);
      // A tool that writes or sends changed something: What happened says the chat ran it. One that reads, nothing.
      if (t.effect !== "reads")
        try {
          spaces.dashboardSaid(project, `Ran the tool ${tool} of ${t.title}: ${ran} — ${got.ok ? last || "done" : got.error === "you stopped it" ? "it was stopped" : `it failed: ${got.error}`}`, { kind: "agent", ...(by ? { chain: by.chain, ...(by.name ? { name: by.name } : {}) } : {}) });
        } catch (/** @type {any} */ e) {
          log("warn", `dashboards: ${name}'s tool ${tool} ended, and its Space could not be told (${e?.message || e})`);
        }
      log(got.ok ? "info" : "warn", `dashboards: ${name}'s tool ${tool} ${got.ok ? "ran" : `failed (${got.error})`}`);
      events?.publish("space", { type: "space", project, dashboard: name });
      return { ok: /** @type {const} */ (true), done: got.ok, title: t.title, said: last, output: got.said, ran, error: got.ok ? null : got.error, job: job.id, effect: t.effect };
    },
    /**
     * The rows a kept one's button is on now, by their keys, as last read (the Space Apps plan of 10-29): an agent's press
     * that names no row runs on the one, where there is one alone. Its refusal as a press's where it may not run now.
     * @param {string} project @param {string} name @param {string} action
     */
    rowsOn(project, name, action) {
      const live = liveOf(name);
      if (!live || live.project !== project) return no(409, "it is not kept in this Space: its buttons run once it is");
      if (live.d.paused) return no(409, "it is paused: resume it to press its buttons");
      // As its press is refused there (`pressOf`): "read it first" would send the agent to a read that is refused too.
      if (spaces.archived(project)) return no(409, ARCHIVED_PRESS);
      const raw = live.content?.actions && Object.hasOwn(live.content.actions, action) ? live.content.actions[action] : null;
      if (!raw) return no(404, `v${live.v} has no button ${action}`);
      const a = actionKept(raw);
      // As a press is refused (`pressed`): a source that waits for a Keep is not read again — "read it first" would send
      // the agent to a read that is held too (found by the review of 10-31).
      const from = sourceHeld(name, live.content?.sources?.[a.on], project);
      if (from) return no(409, `${a.on} can't be read again: ${from}`);
      const st = stateOf(name, a.on);
      if (!st || !st.at) return no(409, `${a.on} has not been read yet: read it first`);
      return { ok: /** @type {const} */ (true), label: a.label, source: a.on, keys: st.rows.filter((r) => actionOnRow(a, r)).map((r) => rowKey(r)) };
    },
    /**
     * A kept one's `sends` button an agent may press without asking you, or asks again (the Space Apps plan of 10-29): the
     * person's alone. Refused where it is not kept in this Space, has no such button, or the button does not send.
     * @param {string} project @param {string} name @param {string} action @param {boolean} on
     */
    allow(project, name, action, on) {
      const k = keptOf(name);
      const title = artifacts.get(name)?.title || name;
      if (!k || k.project !== project) return no(409, `${title} is not kept in this Space: keep it first`);
      const g = k.d.grant?.actions[action];
      if (!g) return no(404, `${title} has no button ${action}`);
      if (g.effect !== "sends") return no(409, `${action} does not send: ${g.effect === "keeps" ? "it runs as it is pressed" : "an agent's press of it is judged as its chat's mode says"}`);
      const label = String(liveOf(name)?.content?.actions?.[action]?.label || action);
      const d = spaces.dashboardAllow(project, name, action, on, { title, label });
      events?.publish("space", { type: "space", project, dashboard: name });
      return { ok: /** @type {const} */ (true), allowed: [...(d.allowed || [])] };
    },
    secretsOf,
    /**
     * A secret's value typed in its sheet (`value`), or forgotten (null): one the app names alone. The person's alone —
     * the space tool has no way to it.
     * @param {string} project @param {string} name @param {string} secret @param {unknown} value
     */
    setSecret(project, name, secret, value) {
      const all = secretsOf(project, name);
      if (!all.ok) return all;
      const title = artifacts.get(name)?.title || name;
      if (!all.secrets.some((x) => x.name === secret)) return no(404, `${title} has no secret ${secret}`);
      if (!secretStore) return no(409, "secrets are not wired in this Filament");
      if (value === null) {
        secretStore.clear(name, secret);
        return { ok: /** @type {const} */ (true), secrets: secretsOf(project, name).secrets || [] };
      }
      const got = secretStore.set(name, secret, value);
      if (!got.ok) return no(400, got.error);
      return { ok: /** @type {const} */ (true), secrets: secretsOf(project, name).secrets || [] };
    },
    hooksOf,
    /**
     * A hook's new address (New address in What it may do): the old one stops at once. The person's alone.
     * @param {string} project @param {string} name @param {string} hook
     */
    hookRenew(project, name, hook) {
      const all = hooksOf(project, name);
      if (!all.ok) return all;
      const title = artifacts.get(name)?.title || name;
      if (!all.hooks.some((x) => x.name === hook)) return no(404, `${title} takes no POSTs into ${hook}: its Keep grants no such hook`);
      if (!hookStore) return no(409, "hooks are not wired in this Filament");
      hookStore.renew(name, hook);
      return hooksOf(project, name, { withAddress: true });
    },
    /**
     * The hook a POST's address opens (http/hooks.js): one a Keep grants an app shown kept, not paused. Unknown — the
     * app or its token — is one refusal, so an address cannot be guessed at piece by piece.
     * @param {string} name @param {string} token
     * @returns {{ ok: true, hook: string } | { ok: false, status: number, error: string }}
     */
    hookAt(name, token) {
      const k = keptOf(name);
      const hook = k && artifacts.get(name) && hookStore ? hookStore.find(name, token) : null;
      if (!k || !hook || !(k.d.grant?.hooks || []).includes(hook)) return no(404, "no hook has this address: copy it again from the app's What it may do");
      if (k.d.paused) return no(409, `${artifacts.get(name)?.title || name} is paused: it takes nothing until it is resumed`);
      return { ok: true, hook };
    },
    /**
     * A POST kept as one record of its hook's collection (core's hookRow); the oldest let go past HOOK_ROWS_MAX, in the
     * same change. → its record's id.
     * @param {string} name @param {string} hook @param {{ type: string, text: string, headers: Record<string, unknown> }} post
     * @returns {{ ok: true, id: string | number } | { ok: false, status: number, error: string }}
     */
    hookPost(name, hook, post) {
      const r = hookRow({ at: now(), ...post });
      if (!r.ok) return r;
      const had = artifacts.data.list(name, hook);
      if (!had.ok) return had;
      const over = had.records.length + 1 - HOOK_ROWS_MAX;
      const got = artifacts.data.change(name, hook, { set: [r.row], ...(over > 0 ? { delete: had.records.slice(0, over).map((x) => x.id) } : {}) }, "hook");
      if (!got.ok) return got;
      return { ok: true, id: got.done.set[0].id };
    },
    /**
     * One dashboard of a Space as an agent reads it whole (HarnessV4_AgentsSpace_Plan AS1, case 9): as the Space shows
     * it, the version that reads — a kept one's live version, else the newest, a draft — and its content, and each of its
     * sources as last read; a source older than its every is read first, as its tab reads its own. `held`: each of its
     * sources that waits for the person's Keep, by the scripts it runs that do — its rows as read before (found by the
     * review of 10-31: they read as current, each with its buttons). Null for one the Space does not show.
     * @param {string} project @param {string} name
     */
    async seeOf(project, name) {
      const first = shown(project).find((x) => x.name === name);
      if (!first) return null;
      const live = first.state === "kept" ? liveOf(name) : null;
      const reads = !!live && !live.d.paused && live.project === project;
      if (reads && live) await Promise.all(Object.keys(live.content.sources || {}).map((s) => read(name, live.v, s).catch(() => null)));
      const d = shown(project).find((x) => x.name === name) || first;
      const v = live?.v ?? d.v;
      const content = live?.content ?? contentOf(name, d.v) ?? {};
      /** @type {Record<string, SourceState | null>} */
      const states = Object.fromEntries(Object.keys(content.sources || {}).map((s) => [s, reads ? stateOf(name, s) : null]));
      /** @type {Record<string, string[]>} */
      const held = Object.fromEntries(
        Object.entries(reads ? content.sources || {} : {}).flatMap(([s, raw]) => {
          const changed = sourceChanged(name, raw, project);
          return changed.length ? [[s, changed]] : [];
        }),
      );
      // Its buttons' runs since Filament started, the newest first: how the last build went, as its page shows it.
      const runs = (jobs.get(name) || []).map(({ log, ...j }) => j).reverse();
      // Its secrets (10-29): which are set — never a value.
      const sealed = secretsOf(project, name);
      // Its hooks (phase 4): what POSTs into which collection, and how many it keeps — never an address.
      const hooked = hooksOf(project, name);
      return { d, v, content, states, held, reads, runs, secrets: sealed.ok ? sealed.secrets : [], hooks: hooked.ok ? hooked.hooks : [] };
    },
    /**
     * A dashboard kept in a project's Space at its newest version (SG-D7): what that version grants, kept, and the bytes
     * of the scripts its commands run (`pinsOf`); a command kept, no read yet. Refused where it is not a dashboard of
     * that Space's or reads nothing by itself.
     * `ready`: called once all of that is checked, before it is kept: the person's row makes the project's Space there,
     * where it has none (by need, 11-12: http/admin/spaces.js `byNeed`). Kept with none, the store refuses it there.
     * @param {string} project @param {string} name @param {number} v  the version the person kept, as their sheet showed it
     * @param {{ ready?: () => void }} [o]
     */
    keep(project, name, v, { ready } = {}) {
      const a = artifacts.get(name);
      if (!a || !runsItself(a.type)) return { ok: /** @type {const} */ (false), status: 404, error: `There is no dashboard or app ${name}.` };
      if (v !== a.versions.length) return { ok: /** @type {const} */ (false), status: 409, error: `${a.title} has a newer version (v${a.versions.length}) than the one you looked at: look at it, then keep it.` };
      const content = contentOf(name, v);
      if (!content) return { ok: /** @type {const} */ (false), status: 500, error: `v${v} of ${a.title} could not be read.` };
      const grant = grantOf(content);
      if (!grantsAny(grant)) return { ok: /** @type {const} */ (false), status: 400, error: `${a.title} reads nothing by itself: there is nothing to keep.` };
      // One this Space shows alone — a draft one of its chats published, or one kept here —: what it runs, it runs in
      // this project's folder.
      if (!shown(project).some((x) => x.name === name)) return { ok: /** @type {const} */ (false), status: 404, error: `${a.title} is no dashboard of this Space: a chat of this project publishes one.` };
      ready?.();
      // Its scripts' bytes as they are now: one changed after is not run until it is kept again. The looks after it see
      // those bytes (`looked.fresh`).
      const d = spaces.keepDashboard(project, { name, v, grant, scripts: pinsOf(grantScriptParts(grant), folderOf(project), looked.fresh), title: a.title });
      // Its hooks' addresses (phase 4): one made for each new hook, the others the same, so a copied one keeps working.
      hookStore?.ensure(name, grant.hooks || []);
      stopReads(name);
      states.delete(name);
      schedule();
      return { ok: /** @type {const} */ (true), dashboard: d };
    },
    /**
     * A kept one paused or going on, or taken out: paused or out, its reads under way stop and what they read is let be.
     * `by`: a chat's agent that pauses it, with its line (HarnessV4_AgentsSpace_Plan SA-D3; `spaces.dashboardChange`).
     * @param {string} project @param {string} name
     * @param {{ paused?: boolean, removed?: boolean, by?: { chain: string, name?: string | null, byName: string, line: string } | null }} o
     */
    change(project, name, o) {
      const a = artifacts.get(name);
      // Taken out of this Space alone: one it does not show is refused before anything stops — a record of it here
      // would list it in Add to this Space…, and another Space's reads of it would stop (found by the Hunter on S2).
      if (o.removed && !shown(project).some((x) => x.name === name))
        throw Object.assign(new Error(`There is no dashboard "${String(a?.title || name).slice(0, 80)}" in this Space.`), { status: 404 });
      spaces.dashboardChange(project, name, { ...o, title: a?.title || name, v: a?.versions.length || 0 });
      if (o.paused || o.removed) stopReads(name);
      if (o.removed) states.delete(name);
      // Taken out, and kept in no other Space: its button running stops with it (found reviewing the Space work: it ran
      // on, out of Now, and its Stop answered that nothing ran).
      const x = o.removed ? acting.get(name) : null;
      if (x && !keptOf(name)) {
        x.why = TAKEN_OUT_WORDS;
        x.abort.abort();
      }
      schedule();
    },
    /** One taken out of a project's Space put back as it was (`spaces.dashboardBack`). @param {string} project @param {string} name */
    putBack(project, name) {
      const a = artifacts.get(name);
      spaces.dashboardBack(project, name, a?.title || name);
      stopReads(name);
      states.delete(name);
      schedule();
    },
    /**
     * The dashboards taken out of a project's Space and still out — no later version shows them again —, the newest
     * first, five at most: what Add to this Space… puts back, a kept one as it was kept (`keptV`), else as a draft.
     * @param {string} project
     * @returns {{ name: string, title: string, keptV: number | null, at: number }[]}
     */
    gone(project) {
      return spaces
        .get(project)
        .dashboards.filter((d) => d.state === "removed")
        .flatMap((d) => {
          const a = artifacts.get(d.name);
          return a && runsItself(a.type) && a.versions.length <= d.v ? [{ name: d.name, title: a.title, keptV: d.was?.v ?? null, at: d.at }] : [];
        })
        .sort((x, y) => y.at - x.at)
        .slice(0, 5);
    },
    /**
     * What the kept dashboards watch (S6, When something arrives): a project's, or every project's with null — each
     * watch's rule and where it writes in words, how often, its last look and its next; a paused dashboard's has no next,
     * nor has one whose project is archived (`archived`: s-itself, 11-12), which looks at nothing until it is brought back.
     * @param {string | null} project
     * @returns {{ project: string, dashboard: string, title: string, key: string, rule: string, to: string, every: string,
     *   paused: boolean, last: number | null, nextAt: number | null, archived?: true }[]}
     */
    watches(project) {
      return spaces
        .keptDashboards()
        .filter((k) => k.d.grant && (project == null || k.project === project))
        .flatMap(({ project: p, d }) => {
          const title = artifacts.get(d.name)?.title || d.name;
          const archived = spaces.archived(p);
          const seen = new Set();
          return /** @type {import("../core/dashboard-sources.js").Grant} */ (d.grant).watch.flatMap((w) => {
            const key = watchKeyOf(w);
            if (seen.has(key)) return [];
            seen.add(key);
            const last = d.seen?.[key]?.at ?? null;
            // The grant keeps a watch's rule, not its words: the rule is what it watches for.
            const rule = watchRuleWords(/** @type {import("../core/dashboard-sources.js").Watch} */ ({ ...w, rule: w.rule === "new" ? "new" : "changes", says: "" }));
            return [{ project: p, dashboard: d.name, title, key, rule, to: w.to === "needs-you" ? "Needs you" : "What happened", every: everyWords(w.every), paused: d.paused, last, nextAt: d.paused || archived || spaces.pausedSince() || !last ? null : last + w.every, ...(archived ? { archived: /** @type {const} */ (true) } : {}) }];
          });
        });
    },
    /**
     * Pause all switched (S6-D4): the watches stop, or are set again — their first look a little after, nothing made up.
     * `by`: an agent's, with its line (HarnessV4_AgentsSpace_Plan SA-D3).
     * @param {boolean} on @param {{ chain: string, byName: string, line: string } | null} [by]
     * @returns {number | null}  the moment it is paused since
     */
    pauseAll(on, by = null) {
      const since = spaces.pauseAll(on, by);
      schedule();
      return since;
    },
    /**
     * Its buttons' runs (an app's page, `filament.jobs`) — those kept from before a restart too —: the newest first, each
     * without its log.
     * @param {string} name @returns {Omit<Job, "log">[]}
     */
    jobsOf(name) {
      return (jobs.get(name) || []).map(({ log, ...j }) => j).reverse();
    },
    /**
     * Every button running now, in every Space (the left bar's Now): its project, its dashboard or app, its label, who
     * pressed it and since when.
     * @returns {{ project: string, name: string, title: string, label: string, action: string, by: string | null, startedAt: number }[]}
     */
    running() {
      return [...acting].flatMap(([name, x]) => {
        const k = keptOf(name);
        const job = (jobs.get(name) || []).findLast((j) => j.state === "running" && j.action === x.action);
        return k ? [{ project: k.project, name, title: artifacts.get(name)?.title || name, label: x.label, action: x.action, by: x.by?.byName ?? null, startedAt: job?.startedAt ?? now() }] : [];
      });
    },
    /** One run, with what it said (`filament.job`), or null. @param {string} name @param {string} id @returns {Job | null} */
    jobOf(name, id) {
      const j = (jobs.get(name) || []).find((x) => x.id === id);
      return j ? { ...j } : null;
    },
    /** Told of each run as it starts and ends, and of what it says as it comes. @param {(name: string, e: JobNews) => void} fn */
    followJobs(fn) {
      jobFollowers.add(fn);
      return () => void jobFollowers.delete(fn);
    },
    /** Be told when a dashboard's source changed; the returned function stops it. @param {(name: string, source: string) => void} fn */
    follow(fn) {
      followers.add(fn);
      return () => void followers.delete(fn);
    },
    /**
     * The kept watches begin, each its first look a little after the start; a check a restart cut ends with its line —
     * no check outlives the Filament that waited on it.
     */
    start() {
      started = true;
      try {
        for (const project of spaces.checksCut((agent) => awaiting.has(agent))) events?.publish("space", { type: "space", project });
      } catch (/** @type {any} */ e) {
        log("warn", `dashboards: the checks a restart cut could not be said (${e?.message || e})`);
      }
      schedule();
    },
    /**
     * The kept watches set again: a Space deleted or brought back (10-29) takes its own with it, or back, and so does a
     * project archived or brought back (s-itself, 11-12: http/admin/memory.js). A button running where nothing keeps its
     * dashboard any more — its Space deleted — stops with it (found by the Hunter on apps).
     */
    reschedule() {
      for (const [name, x] of acting)
        if (!keptOf(name)) {
          x.why = SPACE_GONE_WORDS;
          x.abort.abort();
        }
      schedule();
    },
    /**
     * A dashboard or app deleted (server.js): its button running stops, said so, and its runs are forgotten with it, on
     * disk too (found reviewing the Space work: it ran on with its secrets, its Stop answered that nothing ran, and its
     * runs stayed).
     * @param {string} name
     */
    forget(name) {
      forgotten.add(name);
      const x = acting.get(name);
      if (x) {
        x.why = APP_GONE_WORDS;
        x.abort.abort();
      }
      stopReads(name);
      states.delete(name);
      jobs.delete(name);
      runStore?.drop?.(name);
      schedule();
    },
    /**
     * Nothing runs any more: the watches end, and a button running is stopped — its command's tree with it —, its run
     * said cut as the next Filament would say it (found reviewing the Space work: it ran on past Filament's stop, and a
     * second press could run beside it). Resolves once each has ended and is kept as it ended.
     * @returns {Promise<void>}
     */
    stop() {
      started = false;
      clear();
      const ending = [...acting.values()].map((x) => {
        x.why = CUT_WORDS;
        x.abort.abort();
        return x.ended;
      });
      return Promise.all(ending).then(() => {});
    },
  };
}

/** @typedef {ReturnType<typeof createDashboardRunner>} DashboardRunner */
