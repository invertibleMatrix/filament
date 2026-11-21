// @ts-check
// A sub-agent on another machine (the remote-agents plan's s-launch): the agent tool's `machine` sends its task to a
// machine this Filament is paired with, as the agents' device kept for it (services/machines `{ agents: true }`), and its
// report comes back as a local sub-agent's does — the registry (subagents.js) keeps the run with its local ones, delivers
// the report, waits on it and stops it; this file is the other machine's side of it. It finds the folder there — one the
// launch names, else the project's clone there matched by its git remote —, says the sub-agent where it runs (`whereWords`),
// starts a chat there and sends it each message as a turn, following the turn's events to its end (`turn`) — a machine
// that does not answer ends nothing there, and is asked on (`UNREACHABLE_AFTER_MS`, the review of 11-11). Every call
// goes with the device token alone, pinned to that machine's certificate (`clientOf`): nothing of this Filament's own
// keys or house key goes there, and that machine fences what the device may do (http/admin/remote.js AGENT_ROUTES).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { remoteOf, cloneOf } from "../../adapters/git/inspect.js";
import { git, repoOf } from "../../adapters/git/snapshot.js";
import { BACK_PREFIX, bundleSnapshot, digestOf, importBack } from "../../adapters/git/send.js";
import { CliError, EXIT } from "../../services/machines/client.js";
import { clip, headBytes } from "../../core/text.js";
import { unnoticed } from "../../core/notices.js";

/** How long a machine has to say who it is before it counts as not answering: a launch is refused, a list says so. */
export const ANSWER_MS = 5000;
/** Control characters, which no line of another machine's words keeps. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
/** How long a field another machine sends may be where a list here says it, in characters. */
const FIELD_CHARS = 100;
/** How long another machine's error or end may be where this Filament's own words say it, in characters. */
const ERROR_CHARS = 300;
/**
 * A field another machine sends — a name, a path, a branch, a model —, as a list here says it: one line of `n`
 * characters at most, with no notice of Filament's in it. @param {unknown} s @param {number} [n]
 */
const fieldThere = (s, n = FIELD_CHARS) => clip(unnoticed(s).replace(CONTROLS, " "), n);
/**
 * Another machine's words where this Filament's own notice holds them — an error, how a run or a command ended there —:
 * one line of `n` characters at most, every bracket a parenthesis, so none opens or closes a notice.
 * @param {unknown} s @param {number} n
 */
export const wordsThere = (s, n) =>
  clip(
    String(s ?? "")
      .replace(CONTROLS, " ")
      .replace(/[[［]/g, "(")
      .replace(/[\]］]/g, ")"),
    n,
  );
/** How much of a sub-agent's report from another machine is kept, in UTF-8 bytes. */
const REPORT_BYTES = 64 * 1024;
/**
 * A sub-agent's report as its machine sent it, kept as data: REPORT_BYTES at most — its end says how much more was left
 * out — and no notice of Filament's in it. @param {unknown} text
 */
const reportThere = (text) => {
  const all = unnoticed(text);
  const kept = headBytes(all, REPORT_BYTES);
  if (kept === all) return all;
  const kb = (/** @type {number} */ b) => Math.ceil(b / 1024).toLocaleString("en-US");
  return `${kept}\n\n(Its report goes on past here: its first ${kb(REPORT_BYTES)} KB of ${kb(Buffer.byteLength(all))} KB are kept.)`;
};
/**
 * A report from another machine inside this Filament's words: fenced, its fence longer than any run of backticks in it,
 * so nothing in it closes the fence or the notice around it — that machine's words, never Filament's.
 * @param {string} machine @param {string} text
 */
export const fencedThere = (machine, text) => {
  const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) || []).map((r) => r.length + 1)));
  return `As ${machine} sent it, between the fences — its words, not Filament's:\n${fence}text\n${text}\n${fence}`;
};
/**
 * A model's name as another machine says its chat runs on it, kept where it reads as one: a single word, its
 * context's size in brackets at its end at most (`opus[1m]`).
 */
const MODEL_NAME = /^[^\s[\]]{1,100}(?:\[[^\s[\]]{1,16}\])?$/u;
/**
 * How often a turn whose stream dropped is read again from its run's events while its machine answers; and the first
 * wait after a read it did not answer, twice as long after each one more, `FOLLOW_MAX_MS` at most.
 */
const FOLLOW_MS = 1000;
/** The longest wait between two reads of a turn whose machine does not answer, until it is said unreachable. */
export const FOLLOW_MAX_MS = 30_000;
/**
 * How long a machine may not answer as its sub-agent's turn is read before the turn is said unreachable (the review of
 * 11-11): the waits between the reads it did not answer, summed — five minutes of a network gap, a sleep, a restart
 * there. A gap alone never ends the turn there nor stops it: past this it is asked on, `UNREACHABLE_AGAIN_MS` apart,
 * until that machine answers or the turn is stopped here.
 */
export const UNREACHABLE_AFTER_MS = 5 * 60_000;
/** How long apart a machine whose turn is said unreachable is asked again. */
export const UNREACHABLE_AGAIN_MS = 60_000;
/** How long a machine's list of its models is waited for: a machine that went silent holds no list_models or launch long. */
const MODELS_MS = 20_000;
/** How many reads in a row that fail end a read that is no turn's own: the asks there while a call of its turn waits, a turn an answer there resumed looked for. */
const FOLLOW_TRIES = 5;
/**
 * A sub-agent's turn whose machine has not answered for `UNREACHABLE_AFTER_MS`, as its state is said — to the agent
 * that launched it, on its card —: nothing is known of it but that. @param {string} machine
 */
export const unreachableWords = (machine) => `unreachable: it may still be running on ${machine}`;
/**
 * How long a turn's stream may say nothing at all before it counts as dropped and its run's events are read instead: a
 * network that loses its packets without a word holds a socket open for good. The other Filament pings every 15 s of
 * silence (its reply's heartbeat, `agentHeartbeatMs`; its runs' streams, runs.js HEARTBEAT_MS): three pings missed.
 */
export const STREAM_IDLE_MS = 45_000;
/** How often a turn the chat there refuses as busy is sent again, and how long apart: a stop sent there is settling. */
const BUSY_TRIES = 10;
const BUSY_MS = 500;
/**
 * How long apart the asks there are read while the chat's own ask waits — for one answered there by the person at that
 * machine, and for the pause, which that machine marks a moment after its run ended —: soon at first, then every 5 s.
 * @param {number} k  the reads so far
 */
const asksMs = (k) => Math.min(1000 * 2 ** k, 5000);
/** How many reads of the asks there a pause has to show in before nothing counts as waiting. */
const PAUSE_TRIES = 5;
/** The reason an ask shown here is let go of where it was answered on its machine (`onAsk`'s signal). */
export const ANSWERED_THERE = "answered-there";
/** The tool a project's first copy to a machine is asked by, on the card of the sub-agent it goes for (cp-place). */
export const SEND_COPY = "send a copy";

/**
 * The other machine's chat a sub-agent runs in, as its record keeps it: the machine, the folder there, the chat once
 * started (null before its first turn), the model and effort it was launched on there (null for that chat's own), the
 * mode its launch fixed (`fixed`: read-only for a kind that reads, or the launching turn's own; else each message goes
 * in the sending chat's mode as it stands), the mode the chat there took (`mode`, as far as that machine's grants let
 * it: their device's Without asking or Full control for Full access; `modeless` where that machine's Filament takes
 * none), the model of the chat that sent it (`prefer`, the first chosen there where neither its launch nor that machine
 * names one: `unnamed`), the model so chosen (`pick`, `modelThere`) until a run there takes it, the run of its newest
 * turn there once its events name it — where that turn's asks are answered —, and how many blocks of its user
 * messages the chat there has read (`held`, the registry's): a turn refused before its run began read none, and the
 * next one carries them — the brief and task, until one began. `copy`: the copy made there for it (cp-place), its id
 * there, its project, the commit it was checked out at and how long that machine keeps what is changed in it (`keeps`,
 * `CopyThere`); none where it works in a folder of the person's there.
 * @typedef {{ machine: { id: string, name: string }, cwd: string, chat: string | null, model: string | null, effort: string | null, fixed?: string | null, mode?: string | null, modeless?: boolean, prefer?: string | null, unnamed?: boolean, pick?: string | null, run?: string | null, held?: number, copy?: { id: string, project: string, commit: string, keeps?: number } | null, stopOwed?: boolean }} RemoteChat
 */
/**
 * Where a launch on another machine runs, read before anything starts: the machine, its system (its /api/state's), the
 * folder, the clone there, the folder named there as that machine read it (`folder`: whether it is there, in git, and
 * this project's clone; null where it was not read — none named, or a Filament there from before) and what this chat's
 * folder is in git (`here`, null outside git). A launch that names no folder there works in a copy of its own (cp-place):
 * `pending` until its first message goes, the folder here it is a copy of; then `copy` (`copyPlace`), and `cwd` in it;
 * `repo`, the repository here it was sent from, which its change comes back into where that machine sends it back
 * (`back`, cp-back); `keeps`, how long that machine says it keeps what is changed there after its chat last worked in
 * the copy, in milliseconds — none from one that says none, which keeps it only until a newer launch takes the copy.
 * @typedef {{ id: string, folder: string, project: string, commit: string, repo: string, back: boolean, files: number, left: { path: string, why: string }[], reused: boolean, keeps?: number }} CopyThere
 * @typedef {{ machine: { id: string, name: string }, cwd: string, system: any, remote: string | null,
 *   clone: { path: string, head: string | null, branch: string | null, dirty: boolean | null } | null,
 *   folder?: { gone: boolean, git: boolean, same: boolean } | null,
 *   here: { head: string | null, branch: string | null, dirty: boolean | null, pushed: boolean } | null,
 *   pending?: { from: string } | null, copy?: CopyThere | null }} RemotePlace
 */
/**
 * What the chat there waits on the person for, as its GET /sessions/:id/asks lists it (http/admin/sessions.js `Ask`): its
 * own turn's permission or question (`from` "chat", its id the paused run's), its coding agent's, or a call of one of its
 * sub-agents (`from` its id).
 * @typedef {{ id: string, kind: string, from: string, runId: string | null, tool: string, question: string, command?: string,
 *   options: { id: string, label: string }[], words: boolean }} RemoteAsk
 */
/**
 * The person's answer to it here, as that machine's answer route takes it: their press of Allow or Deny (`allow`), or a
 * choice of its options, and their words with it.
 * @typedef {{ allow?: boolean, choice?: string, words?: string }} RemoteAnswer
 */
/**
 * Whether an ask there is the person's: the chat's own and its coding agent's, and a sub-agent's call — a sub-agent's
 * question or plan is its lead's, the agent there. @param {RemoteAsk} a
 */
const personsAsk = (a) => a.from === "chat" || a.from === "coding-agent" || a.kind === "permission";
/** An answer as the answer route takes it. @param {RemoteAnswer} a */
const answerBody = (a) => ({ ...(typeof a.allow === "boolean" ? { allow: a.allow } : {}), ...(a.choice ? { choice: a.choice } : {}), ...(a.words ? { words: a.words } : {}) });

/** How a run that was stopped ends (runs.js): a stop is no failure. */
const STOPPED = Object.freeze(["aborted", "stopped"]);
/**
 * What a run's end there says, where it is neither done nor stopped, in words: Filament there restarted while it ran
 * (runs.js reads a run an earlier process left open as `unknown`), it reached its budget, it failed — with its own words
 * where it gave some. @param {string} ended @param {string} name @param {unknown} said
 */
const endWords = (ended, name, said) => {
  const why =
    ended === "unknown"
      ? `Filament on ${name} restarted while it ran, and its turn there was cut`
      : ended === "budget-stopped"
        ? `it reached its budget on ${name}`
        : ended === "paused"
          ? `it stopped to ask the person on ${name}, and nobody here is asked`
          : ended === "error" || !ended
            ? `it failed on ${name}`
            : `its turn on ${name} ended ${wordsThere(ended, 40)}`;
  return said ? `${why}: ${wordsThere(said, ERROR_CHARS)}` : why;
};
/** A commit as a person reads it. @param {string | null | undefined} sha */
const short = (sha) => (sha ? String(sha).slice(0, 10) : "no commit yet");
/** A clone's branch as words. @param {string | null | undefined} branch */
const onBranch = (branch) => (branch ? `branch ${branch}` : "a detached HEAD");
/**
 * The models a machine's GET /models says answer there: those it marks answering, where it marks any; else every one
 * but an effort's variant. @param {any} j @returns {any[]}
 */
const answering = (j) => {
  /** @type {any[]} */
  const all = (Array.isArray(j?.models) ? j.models : []).filter((x) => x && typeof x === "object");
  const said = all.some((x) => "answers" in x);
  return all.filter((x) => (said ? x.answers === true : x.source !== "effort-variant"));
};
/**
 * The model a sub-agent's chat on another machine runs on where neither its launch nor that machine names one — a new
 * chat's model there is its person's pick in their window, which that machine's server does not keep —: the model of
 * the chat that sent it where it answers there, else the first that answers there; null where none does.
 * @param {any} j  that machine's GET /models @param {string | null | undefined} prefer
 */
export const modelThere = (j, prefer) => {
  const names = answering(j).map((x) => String(x.id ?? "")).filter((n) => MODEL_NAME.test(n) && unnoticed(n) === n);
  return (prefer && names.includes(prefer) ? prefer : names[0]) ?? null;
};
/**
 * Whether a machine takes what `what` names from this Filament's agents, as its GET /state says it (`takes`,
 * http/admin/remote.js AGENT_TAKES): one from before that list says nothing, and takes none of it.
 * @param {{ state?: any }} client @param {string} what
 */
export const takes = (client, what) => Array.isArray(client?.state?.takes) && client.state.takes.includes(what);
/**
 * What tells a repository from another of its folder's name on the machine a copy of it goes to, which keeps its store
 * and its copies by it (the review of 11-11: two repositories named alike shared them there): the root commit its
 * HEAD's first parents lead back to — one commit where its history has several roots, the same in every clone of it,
 * whatever its folder is called; a shallow clone's is the commit its history is cut at, so it keeps a store of its
 * own. A repository with no commit yet has none: a digest of its folder's path here stands for it, until its first
 * commit makes it another. → 40 hex digits. @param {string} repo  the repository's top folder
 */
export const repoKeyOf = async (repo) => {
  const r = await git(["rev-list", "--first-parent", "--max-parents=0", "HEAD"], { cwd: repo });
  const root = r.code === 0 ? r.out.trim().split("\n")[0].trim() : "";
  if (/^[0-9a-f]{40}$/.test(root)) return root;
  return createHash("sha256")
    .update(`folder:${process.platform === "win32" ? repo.toLowerCase() : repo}`)
    .digest("hex")
    .slice(0, 40);
};
/** How many of a machine's clones of the project a list of the machines names; the rest are counted. */
const CLONES_SAID = 3;
/** How many of a machine's GPUs, coding agents and grants a list of the machines names, and of its models list_models. */
const GPUS_SAID = 4;
const AGENTS_SAID = 8;
const GRANTS_SAID = 8;
const MODELS_SAID = 60;
/**
 * The last line of the machines' list: the skill Filament ships for one check on several machines at once
 * (src/skills/run-everywhere), which is on nowhere until the person turns it on, so the agent learns of it here.
 */
export const RUN_EVERYWHERE_LINE = "To run one check on several of them at once (the suite, a build, a screenshot), load the skill run-everywhere with the skill tool first: it says how each run reaches this commit and how to report what passed where.";
/** A number another machine sends, where it is one. @param {unknown} x */
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** The first `n` of a list another machine sends, as fields, and how many more it named. @param {unknown} list @param {number} n */
const firstOf = (list, n) => {
  const all = Array.isArray(list) ? list : [];
  return { said: all.slice(0, n).map((x) => fieldThere(x)), more: Math.max(0, all.length - n) };
};
/** A list's words and how many more it left out. @param {{ said: string[], more: number }} l @param {string} sep */
const andMore = (l, sep) => `${l.said.join(sep)}${l.more ? `${sep}and ${l.more} more` : ""}`;
/** Bytes as GB, whole from 10 up: "64", "7.5". @param {number} b */
const gb = (b) => {
  const g = b / 1024 ** 3;
  return String(g >= 10 ? Math.round(g) : Math.round(g * 10) / 10);
};
/**
 * A GPU as a list of the machines says it: its name and its figures, each as that machine sent it where it is a
 * number. @param {any} g  as that machine sent it (machine-caps.js `Gpu`)
 */
const gpuWords = (g) => {
  const [memory, used, busy] = [num(g?.memoryBytes), num(g?.usedBytes), num(g?.busyPercent)];
  return g?.kind === "apple"
    ? `${fieldThere(g.name)}'s, sharing the machine's memory`
    : [fieldThere(g?.name), memory != null ? `${gb(memory)} GB` : "", used != null ? `${gb(used)} GB used` : "", busy != null ? `${busy}% busy` : ""].filter(Boolean).join(", ");
};
/**
 * What a machine has to work with now, as a list of the machines says it in one line: its CPUs and their load, its
 * memory free, its GPUs. @param {import("../../services/machine-caps.js").MachineCaps} caps
 */
const capsWords = (caps) => {
  const c = caps.cpu || {};
  const [count, load1, busy] = [num(c.count), num(c.load1), num(c.busyPercent)];
  const load = load1 != null ? `, load ${load1}` : busy != null ? `, ${busy}% busy` : "";
  const cpus = `${count ?? "?"} CPU${count === 1 ? "" : "s"}${c.model ? ` (${fieldThere(c.model)})` : ""}${load}`;
  const [free, total] = [num(caps.memory?.freeBytes), num(caps.memory?.totalBytes)];
  const memory = free != null && total != null ? `${gb(free)} of ${gb(total)} GB memory free` : "";
  const all = Array.isArray(caps.gpus) ? caps.gpus : [];
  // A machine knows NVIDIA's GPUs by nvidia-smi alone, and Apple Silicon's: an AMD's or Intel's is not ruled out.
  const gpus = `GPU: ${all.length ? `${all.slice(0, GPUS_SAID).map(gpuWords).join("; ")}${all.length > GPUS_SAID ? `; and ${all.length - GPUS_SAID} more` : ""}` : "none nvidia-smi sees"}`;
  return [cpus, memory, gpus].filter(Boolean).join(" · ");
};
/** A clone as a list of the machines names it. @param {{ path: string, branch: string | null, dirty: boolean | null }} x */
const cloneWords = (x) => `${fieldThere(x.path)} on ${x.branch ? fieldThere(x.branch) : "a detached HEAD"}${x.dirty === true ? " (uncommitted changes)" : x.dirty === false ? " (clean)" : ""}`;
/**
 * A machine's clones of this chat's project, as a list of the machines says them: null where it did not say.
 * @param {{ path: string, branch: string | null, dirty: boolean | null }[] | null} clones
 */
const clonesWords = (clones) => {
  if (!clones) return "its clones of this project unsaid";
  if (!clones.length) return "no clone of this project";
  if (clones.length === 1) return `clone of this project at ${cloneWords(clones[0])}`;
  const more = clones.length - CLONES_SAID;
  return `clones of this project: ${clones.slice(0, CLONES_SAID).map(cloneWords).join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
};
/**
 * Two paths as one folder on the machine whose `platform` (its GET /state's) names them: Windows names a folder in
 * either separator, and Windows and macOS in any case; Linux, or a machine that says not, in its own case alone.
 * @param {string} a @param {string} b @param {unknown} platform
 */
const sameFolder = (a, b, platform) => {
  const k = (/** @type {string} */ p) => String(p || "").replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return k(a) === k(b) || ((platform === "win32" || platform === "darwin") && k(a).toLowerCase() === k(b).toLowerCase());
};

/** A pause of `ms`, which `signal` ends sooner. @param {number} ms @param {AbortSignal} signal @returns {Promise<void>} */
const pause = (ms, signal) =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

/** How much of a copy one part carries, before its base64 (the other machine takes 8 MB at most: transfers.js). */
export const PART_BYTES = 4 * 1024 ** 2;
/** How many times a send cut short is taken up again before it is given up. */
const SEND_TRIES = 4;
/**
 * How long the other machine may take a whole copy in: its sha-256 read, its objects indexed and walked (send.js
 * `TAKE_MS` each), a large project's minutes. A wait cut before asks again, and waits on the take under way.
 */
const COMMIT_MS = 2 * 3600_000;
/** How long the other machine may take to check a copy out: a large project's files written. */
const PLACE_MS = 30 * 60_000;
/** The refusals a send is given up on at once: what it sent is refused, not cut short. */
const REFUSED_FOR_GOOD = Object.freeze([400, 403, 413, 422, 429]);
/** The most a capture coming back from a copy there may weigh: what a sub-agent changed, generated files and all. */
export const BACK_MAX_BYTES = 2 * 1024 ** 3;
/**
 * Why what changed in a copy there did not come back (`takeBack`): "gone", its copy there went and what it changed with
 * it; "refused", the same would be refused again until it changes there; "cut", a try in a while may bring it.
 * @typedef {"gone" | "refused" | "cut"} BackFailure
 */
/** @param {BackFailure} kind @param {string} words */
const backFailed = (kind, words) => Object.assign(new Error(words), { kind });

/**
 * What the person is asked before a project's first copy goes to a machine: the machine, the project, how many files
 * and bytes go, which of them are in no commit of the project (`untracked`), and what stays here,
 * each with why (adapters/git/send.js `leftOutWhy`).
 * @typedef {{ machine: string, project: string, files: number, bytes: number, untracked: string[], left: { path: string, why: string }[] }} SendAsk
 */

/**
 * The projects each machine was sent a copy of with the person's yes (cp-send's first-send card), kept in `file`: asked
 * once per project and machine. A project is its repository's folder here, compared as Windows compares one.
 * @param {string | null} file
 */
export function sendsKept(file) {
  /** @type {Record<string, string[]>} */
  let kept = {};
  try {
    if (file) kept = JSON.parse(readFileSync(file, "utf8")) || {};
  } catch {}
  const key = (/** @type {string} */ repo) => (process.platform === "win32" ? repo.toLowerCase() : repo);
  return {
    /** @param {string} machine @param {string} repo */
    has: (machine, repo) => Array.isArray(kept[machine]) && kept[machine].includes(key(repo)),
    /** @param {string} machine @param {string} repo */
    add(machine, repo) {
      kept[machine] = [...new Set([...(Array.isArray(kept[machine]) ? kept[machine] : []), key(repo)])];
      if (!file) return;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, JSON.stringify(kept, null, 1), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      } catch {}
    },
  };
}

/**
 * @param {{ machines: import("../../services/machines/index.js").Machines | null, wait?: (ms: number, signal: AbortSignal) => Promise<void> }} deps
 *   `wait`: the pause between two reads of a turn whose stream dropped, and between two tries of a send (tests shorten it)
 */
export function createRemoteAgents({ machines, wait = pause }) {
  /** The machines kept for this Filament's agents, their tokens aside. */
  const kept = () => (machines ? machines.list().filter((m) => m.device.scope === "agent") : []);
  /** The kept ones, named for a refusal's words. */
  const keptWords = () => {
    const all = kept();
    return all.length ? `the machines this Filament's agents may work on: ${all.map((m) => m.name).join(", ")}` : "no machine is kept for this Filament's agents: pair one in Settings › Remote access, and let its agents work there";
  };
  /**
   * The agents' machine `which` names — by its name, its id or its address —, else refused in words that list the kept.
   * @param {string} which
   */
  const machineOf = (which) => {
    const m = machines?.find(String(which), { agents: true }) ?? null;
    if (!m) throw new Error(`no machine "${which}" for this Filament's agents — ${keptWords()}`);
    return m;
  };
  /**
   * Why a machine refused or did not answer, in words that name it: its agents' grant switched off there (its 403
   * says `grant: "agents"`), the device revoked, or nobody at its address.
   * @param {import("../../services/machines/remotes.js").Machine} m @param {any} e
   */
  const refusedWords = (m, e) => {
    if (e?.body?.grant === "agents") return `${m.name} lets this Filament's agents work there no more: its grant is switched off there — switch it on in Settings › Remote access on ${m.name}`;
    return wordsThere(e?.message || e, ERROR_CHARS);
  };
  /**
   * A client of the machine's admin API as this Filament's agents' device, once it says it is the machine kept and
   * still knows the device; else refused in its words, `grant` set where its agents' grant is off there.
   * @param {import("../../services/machines/remotes.js").Machine} m @param {number} [timeoutMs]
   */
  const clientOf = async (m, timeoutMs = ANSWER_MS) => {
    if (!machines) throw new Error("this Filament keeps no machines");
    try {
      return await machines.clientOf(m, { agents: true, timeoutMs });
    } catch (/** @type {any} */ e) {
      // It answered, and its agents' grant is off there: `grant`, for a list that says so.
      throw Object.assign(new Error(refusedWords(m, e)), { grant: e?.body?.grant === "agents" });
    }
  };

  /**
   * What this chat's folder is in git, for the sync a sub-agent there is told: its remote, HEAD, branch, whether it is
   * dirty, and whether its HEAD is on a remote-tracking branch of that remote — the one its clone there is matched by —:
   * pushed, so the other machine can fetch it; one on a fork's alone is not (the review of 11-10). Null outside git.
   * @param {string} folder
   */
  const hereOf = async (folder) => {
    if (!folder) return null;
    const c = await cloneOf(folder).catch(() => null);
    if (!c?.ok) return null;
    const on = c.head && c.remote ? await git(["for-each-ref", "--contains", c.head, "--count=1", "--format=%(refname)", `refs/remotes/${c.remote.name}/`], { cwd: folder }).catch(() => null) : null;
    return { remote: c.remote?.url ?? null, head: c.head, branch: c.branch, dirty: c.dirty, pushed: !!on && on.code === 0 && !!on.out.trim() };
  };

  return {
    /** Whether any machine is kept for this Filament's agents. */
    any: () => kept().length > 0,
    /**
     * The machines kept for this Filament's agents, as `list_machines` answers, for the agent to choose where a task
     * runs: each one's name, whether it answers now (asked in parallel, each for ANSWER_MS at most), its system and
     * architecture, and the grants it gives them there; then what it has to work with now (GET /machine/caps: its CPUs
     * and their load, its memory free, its GPU), the coding agents signed in there, how many models answer there, and its
     * clones of this chat's project, found by `folder`'s git remote — none said where it has none.
     * @param {{ folder?: string | null }} [o]  `folder`: this chat's
     * @returns {Promise<string>}
     */
    async machinesText({ folder = null } = {}) {
      const all = kept();
      if (!all.length) return "No machine is kept for this Filament's agents: pair one in Settings › Remote access, and let its agents work there.";
      const remote = folder ? ((await remoteOf(folder).catch(() => null))?.url ?? null) : null;
      const lines = await Promise.all(
        all.map(async (m) => {
          try {
            const c = await clientOf(m);
            /** @param {string} path @returns {Promise<any>} */
            const ask = (path) => c.get(path, { timeoutMs: ANSWER_MS }).catch(() => null);
            const [me, caps, models, clones] = await Promise.all([ask("/remote/me"), ask("/machine/caps"), ask("/models"), remote ? ask(`/clones?remote=${encodeURIComponent(remote)}`) : null]);
            // Full control says so in words: a sub-agent there runs as that machine's person's own chat.
            const grants = firstOf(me?.device?.grants && typeof me.device.grants === "object" ? Object.keys(me.device.grants).filter((k) => me.device.grants[k] === true).map((k) => (k === "full" ? "full control" : k)) : [], GRANTS_SAID);
            const sys = c.state?.system;
            const coders = firstOf(caps?.codingAgents, AGENTS_SAID);
            const agents = Array.isArray(caps?.codingAgents) ? (caps.codingAgents.length ? `coding agents signed in: ${andMore(coders, ", ")}` : "no coding agent signed in") : "";
            const n = models ? answering(models).length : null;
            const work = [agents, n === null ? "its models unsaid" : `${n || "no"} model${n === 1 ? " answers" : "s answer"}`, remote ? clonesWords(Array.isArray(clones?.clones) ? clones.clones : null) : ""].filter(Boolean).join(" · ");
            return [
              `- ${m.name}: answers · ${[sys?.os, sys?.arch].filter(Boolean).map((x) => fieldThere(x, 40)).join(" ") || "its system unsaid"} · grants on there: ${grants.said.length ? andMore(grants, ", ") : "none"}`,
              `  ${caps?.cpu ? capsWords(caps) : "its CPUs, memory, GPU and coding agents unsaid"}`,
              `  ${work}`,
            ].join("\n");
          } catch (/** @type {any} */ e) {
            return `- ${m.name}: ${e?.grant ? "answers · its agents' grant is off there" : `does not answer now (${e?.message || e})`}`;
          }
        }),
      );
      return [`Machines this Filament's agents may work on (${all.length}):`, ...lines, `Launch a sub-agent there with machine: "<its name>" — its report comes back here.`, RUN_EVERYWHERE_LINE].join("\n");
    },
    /**
     * The models that answer on the machine `which` names, as `list_models` with `machine` answers: its GET /models,
     * which gives this Filament's agents those that can run a chat there, by name and label alone. `model` narrows them
     * to those whose name or label holds it; `provider`, which names one of this machine's providers, narrows nothing
     * there, and the answer says so.
     * @param {string} which @param {{ model?: string | null, provider?: string | null }} [o] @returns {Promise<string>}
     */
    async modelsText(which, { model = null, provider = null } = {}) {
      const m = machineOf(which);
      const c = await clientOf(m);
      /** @type {any} */
      let j;
      try {
        j = await c.get("/models", { timeoutMs: MODELS_MS });
      } catch (e) {
        throw new Error(`${m.name} did not list its models: ${refusedWords(m, e)}`);
      }
      const all = answering(j);
      const want = String(model ?? "").trim();
      const like = want.toLowerCase();
      const list = like ? all.filter((x) => `${x?.id ?? ""}\n${x?.label ?? ""}`.toLowerCase().includes(like)) : all;
      const unnarrowed = String(provider ?? "").trim() ? [`provider narrows nothing on ${m.name}: its models are listed by name alone.`] : [];
      if (!all.length) return [`No model answers on ${m.name} now.`, ...unnarrowed].join("\n");
      if (!list.length) return [`No model that answers on ${m.name} is named like "${want.slice(0, 80)}": list_models with machine and no model lists all ${all.length}.`, ...unnarrowed].join("\n");
      const more = list.length - MODELS_SAID;
      return [
        `Models that answer on ${m.name} (${like ? `${list.length} of ${all.length}, named like "${want.slice(0, 80)}"` : list.length}) — name one as model, with machine "${m.name}":`,
        ...list.slice(0, MODELS_SAID).map((x) => `- ${fieldThere(x?.id)}${x?.label ? ` (${fieldThere(x.label)})` : ""}`),
        ...(more > 0 ? [`- and ${more} more, not listed here`] : []),
        ...unnarrowed,
      ].join("\n");
    },
    /**
     * A copy of the project this chat's folder is in sent to the machine `which` names, for a sub-agent there to work
     * in (the remote plan's cp-send): its snapshot less what stays here (adapters/git/send.js `bundleSnapshot`), as a
     * bundle of what changed since a commit that machine's mirror of it holds — the whole tree the first time —, in
     * parts, a send cut short — the link, a restart there — taken up again from where that machine says it stands
     * (`SEND_TRIES`), one it took already answered as taken; one built on a commit that machine no longer holds goes
     * whole (`lacks`). `signal` stops it between any two parts. The first copy of a project to a machine goes only on the
     * person's yes (`ask`, the card; `sent` keeps it); a no sends nothing. A machine whose Filament takes no copy, or
     * that has no git, is refused in words. → the commit there, the folder of this chat in the project (`sub`), and what
     * stayed here.
     * @param {string} which
     * @param {{ folder: string, ask: (o: SendAsk) => Promise<boolean>, sent: ReturnType<typeof sendsKept>, signal?: AbortSignal | null, partBytes?: number }} o
     * @returns {Promise<{ machine: { id: string, name: string }, project: string, repo: string, named: { repo?: string }, commit: string, sub: string, files: number, bytes: number, left: { path: string, why: string }[] }>}
     *   `named`: what tells its repository apart there (`repoKeyOf`), as it went with the send; empty where that machine takes none
     */
    async sendCopy(which, { folder, ask, sent, signal = null, partBytes = PART_BYTES }) {
      const m = machineOf(which);
      const c = await clientOf(m);
      if (!takes(c, "transfer")) throw new Error(`${m.name} takes no copy of a project yet: update Filament there, or name a folder there with cwd`);
      const found = await repoOf(folder);
      const repo = found.repo;
      if (!repo) throw new Error(`no copy of this folder is sent: ${found.error || "it is in no git repository"}`);
      const project = basename(repo);
      // Beside its folder's name, for that machine to tell it from another repository of that name; one whose Filament
      // takes none yet is sent the name alone.
      const named = takes(c, "repo") ? { repo: await repoKeyOf(repo) } : {};
      const stop = signal ?? new AbortController().signal;
      /** @param {any} e */
      const words = (e) => refusedWords(m, e);
      const stopped = () => new Error(`the copy of ${project} was not sent to ${m.name}: its send was stopped`);
      /** @param {boolean} whole  a bundle of the whole tree, whatever that machine holds */
      const once = async (whole) => {
        /** @type {string[]} */
        let haves = [];
        if (!whole)
          try {
            const h = await c.get(`/transfers/haves?project=${encodeURIComponent(project)}${named.repo ? `&repo=${named.repo}` : ""}`, { signal: stop });
            haves = Array.isArray(h?.haves) ? h.haves.map(String) : [];
          } catch (e) {
            if (stop.aborted) throw stopped();
            throw new Error(`${m.name} did not say what it holds of ${project}: ${words(e)}`);
          }
        const b = await bundleSnapshot(folder, { machine: m.machine.id, project, haves, signal });
        if (!b.ok) throw new Error(`no copy of ${project} was made to send: ${b.error}`);
        try {
          if (!sent.has(m.machine.id, repo)) {
            const yes = await ask({ machine: m.name, project, files: b.files, bytes: b.bytes, untracked: b.untracked, left: b.left });
            if (!yes) throw Object.assign(new Error(`no copy of ${project} went to ${m.name}: the person said no`), { said: true });
            sent.add(m.machine.id, repo);
          }
          const out = { machine: { id: m.machine.id, name: m.name }, project, repo, named, commit: b.commit, sub: b.sub, files: b.files, bytes: b.bytes, left: b.left };
          if (b.unchanged || !b.file) return out;
          const fh = await open(b.file, "r");
          try {
            /** @type {{ id: string, have: number } | null} */
            let t = null;
            let tries = 0;
            let moves = 0;
            for (;;) {
              if (stop.aborted) throw stopped();
              try {
                if (!t) {
                  const opened = await c.post("/transfers", { project, ...named, bytes: b.bytes, sha256: b.sha256 }, { signal: stop });
                  // Taken there already: a commit whose answer did not come, asked again.
                  if (opened?.done?.commit) return { ...out, commit: String(opened.done.commit) };
                  t = { id: String(opened?.id), have: Number(opened?.have) || 0 };
                }
                const tr = t;
                while (tr.have < b.bytes) {
                  if (stop.aborted) throw stopped();
                  const buf = Buffer.alloc(Math.min(partBytes, b.bytes - tr.have));
                  const { bytesRead } = await fh.read(buf, 0, buf.length, tr.have);
                  const part = await c.post(`/transfers/${encodeURIComponent(tr.id)}/part`, { offset: tr.have, data: buf.subarray(0, bytesRead).toString("base64") }, { timeoutMs: 120_000, signal: stop });
                  tr.have = Number(part?.have);
                }
                const done = await c.post(`/transfers/${encodeURIComponent(tr.id)}/commit`, {}, { timeoutMs: COMMIT_MS, signal: stop });
                return { ...out, commit: String(done?.commit || b.commit) };
              } catch (/** @type {any} */ e) {
                if (stop.aborted) throw stopped();
                const status = Number(e?.status) || 0;
                // Where it stands there, said with a refusal of a part from elsewhere: taken up from there.
                if (t && status === 409 && Number.isSafeInteger(e?.body?.have) && ++moves <= SEND_TRIES * 4) {
                  t.have = e.body.have;
                  continue;
                }
                // A bundle built on a commit that machine no longer holds: the whole tree, once.
                if (status === 422 && e?.body?.lacks === true && !whole) throw Object.assign(new Error("again whole"), { whole: true });
                if (REFUSED_FOR_GOOD.includes(status) || ++tries >= SEND_TRIES) throw new Error(`the copy of ${project} did not reach ${m.name}: ${words(e)}`);
                // Cut short, slow, or gone there (a restart: 404): opened again, from what came already.
                t = null;
                await wait(1000 * tries, stop);
              }
            }
          } finally {
            await fh.close();
          }
        } finally {
          if (b.dir) await rm(b.dir, { recursive: true, force: true }).catch(() => {});
        }
      };
      try {
        return await once(false);
      } catch (/** @type {any} */ e) {
        if (e?.whole) return once(true);
        throw e;
      }
    },
    /**
     * Where a launch on the machine `which` runs, refused in words before anything starts: a machine not kept, one that
     * does not answer, one whose agents' grant is off; then the folder — `cwd`, a path there, which that machine reads
     * itself (GET /clones `named`: there, in git, this project's clone or a subfolder of one); else, for a sub-agent's
     * launch (`copy`) where that machine takes a copy and this chat's folder is in git, a copy of its own, sent as its
     * first message goes (`pending`, `copyPlace`), no folder of the person's there touched; else the clone there of this
     * chat's repository, found by its remote (GET /clones), the one on this chat's branch first, then a clean one, then
     * the first the machine lists.
     * @param {string} which @param {{ cwd?: string | null, folder: string, copy?: boolean }} o  `folder`: this chat's
     * @returns {Promise<RemotePlace>}
     */
    async place(which, { cwd = null, folder, copy = false }) {
      const m = machineOf(which);
      const c = await clientOf(m);
      const here = await hereOf(folder);
      const remote = here?.remote ?? (folder ? (await remoteOf(folder).catch(() => null))?.url ?? null : null);
      const asked = String(cwd || "").trim();
      if (copy && !asked && here && takes(c, "transfer") && takes(c, "copy"))
        return { machine: { id: m.machine.id, name: m.name }, system: c.state?.system ?? null, remote, here: { head: here.head, branch: here.branch, dirty: here.dirty, pushed: here.pushed }, cwd: "", clone: null, pending: { from: folder } };
      /** @type {{ path: string, head: string | null, branch: string | null, dirty: boolean | null }[]} */
      let clones = [];
      /** The folder named, as that machine read it; undefined where it read none. @type {any} */
      let named;
      /** Why that machine's fence keeps the folder named from this Filament's agents, where it does. */
      let kept = "";
      if (remote)
        try {
          const j = await c.get(`/clones?remote=${encodeURIComponent(remote)}${asked ? `&cwd=${encodeURIComponent(asked)}` : ""}`);
          clones = j?.clones || [];
          named = j && typeof j === "object" && "named" in j ? j.named : undefined;
          kept = typeof j?.refused === "string" ? j.refused : "";
        } catch (e) {
          if (!cwd) throw new Error(`${m.name} did not say which clones of ${remote} it keeps: ${refusedWords(m, e)}`);
        }
      const base = { machine: { id: m.machine.id, name: m.name }, system: c.state?.system ?? null, remote, here: here ? { head: here.head, branch: here.branch, dirty: here.dirty, pushed: here.pushed } : null };
      // Its fence keeps that folder from this Filament's agents: said so, never read as a Filament from before's answer
      // and its clone taken (the swarm's review of 11-10).
      if (asked && kept) throw new Error(`${m.name} keeps ${wordsThere(asked, 400)} from this Filament's agents: ${wordsThere(kept, ERROR_CHARS)}`);
      if (asked) {
        // As that machine read it: its clone where it is this project's, else none; a Filament there from before read
        // none, and the clone it listed at that path is taken.
        const read = named && typeof named === "object" ? named : null;
        const clone = read
          ? read.same && read.path
            ? { path: String(read.path), head: read.head ?? null, branch: read.branch ?? null, dirty: read.dirty ?? null }
            : null
          : (clones.find((x) => sameFolder(x.path, asked, c.state?.platform)) ?? null);
        return { ...base, cwd: asked, clone, folder: read ? { gone: read.gone === true, git: read.git === true, same: read.same === true } : null };
      }
      if (!remote) throw new Error(`this chat's folder (${folder || "none"}) has no git remote to find its clone on ${m.name} by: name a folder there with cwd`);
      if (!clones.length) throw new Error(`${m.name} keeps no clone of ${remote} in the folders of its projects and chats: name a folder there with cwd, or clone it there`);
      const rank = (/** @type {typeof clones[number]} */ x) => (here?.branch && x.branch === here.branch ? 2 : 0) + (x.dirty === false ? 1 : 0);
      const clone = clones.map((x, i) => ({ x, i })).sort((a, b) => rank(b.x) - rank(a.x) || a.i - b.i)[0].x;
      return { ...base, cwd: clone.path, clone };
    },
    /**
     * A launch's copy made there (cp-place), its place `pending`: the folder here sent (`sendCopy`, the person's yes on
     * a project's first copy to that machine) and checked out there into a copy of its own, idle one taken again, its
     * installs kept (POST /transfers/place). → the place, `cwd` this chat's folder in the copy; refused in words.
     * @param {RemotePlace} p
     * @param {{ ask: (o: SendAsk) => Promise<boolean>, sent: ReturnType<typeof sendsKept>, signal?: AbortSignal | null }} o
     * @returns {Promise<RemotePlace>}
     */
    async copyPlace(p, { ask, sent, signal = null }) {
      if (!p.pending) return p;
      const out = await this.sendCopy(p.machine.id, { folder: p.pending.from, ask, sent, signal });
      const m = machineOf(p.machine.id);
      const c = await clientOf(m);
      /** @type {any} */
      let placed;
      try {
        placed = await c.post("/transfers/place", { project: out.project, ...out.named, commit: out.commit }, { timeoutMs: PLACE_MS, ...(signal ? { signal } : {}) });
      } catch (e) {
        if (signal?.aborted) throw new Error(`the copy of ${out.project} on ${m.name} was not made: its launch was stopped`);
        throw new Error(`${m.name} did not check the copy of ${out.project} out: ${refusedWords(m, e)}`);
      }
      const folder = String(placed?.folder || "");
      if (!folder || !placed?.copy) throw new Error(`${m.name} named no folder for the copy of ${out.project}`);
      // Its folder as that machine names one: its own separator.
      const sep = folder.includes("\\") ? "\\" : "/";
      const cwd = out.sub ? `${folder.replace(/[\\/]+$/, "")}${sep}${out.sub.split("/").join(sep)}` : folder;
      const keeps = Number(placed.keeps);
      const copy = { id: String(placed.copy), folder, project: out.project, commit: out.commit, repo: out.repo, back: takes(c, "back"), files: out.files, left: out.left, reused: placed.reused === true, ...(Number.isFinite(keeps) && keeps > 0 ? { keeps } : {}) };
      // This folder as it stood when it went: a follow-up of a launch stopped before its copy was made sends it later.
      const h = await hereOf(p.pending.from).catch(() => null);
      const here = h ? { head: h.head, branch: h.branch, dirty: h.dirty, pushed: h.pushed } : p.here;
      return { ...p, here, cwd, pending: null, copy };
    },
    /**
     * What a sub-agent changed in its copy on the machine `which` names, brought into this repository (cp-back): captured
     * there on the commit sent (`base`, POST /transfers/back) without what this repository holds of it (`haves`: those
     * it still holds alone are named, and a capture that builds on one it lost since is asked for again whole), read in
     * parts — a part cut short read again, a capture gone there (a restart: 404) asked for again, `SEND_TRIES` at most —,
     * its sha-256 checked, then taken in checked (adapters/git/send.js `importBack`). While a turn of its chat still runs
     * in the copy that machine captures nothing (409 `runs`): asked again, then cut short. `signal` stops it between any
     * two parts. → the capture's commit (`base` where nothing changed there) and what stayed there; refused in words, its
     * `kind` a `BackFailure`.
     * @param {string} which
     * @param {{ copy: string, chat: string, repo: string, base: string, haves?: readonly string[], signal?: AbortSignal | null }} o
     * @returns {Promise<{ commit: string, unchanged: boolean, left: { path: string, why: string }[] }>}
     */
    async takeBack(which, { copy, chat, repo, base, haves = [], signal = null }) {
      const m = machineOf(which);
      /** @type {any} */
      let c;
      try {
        c = await clientOf(m);
      } catch (/** @type {any} */ e) {
        throw backFailed("cut", `what changed in its copy on ${m.name} did not come back: ${refusedWords(m, e)}`);
      }
      if (!takes(c, "back")) throw backFailed("refused", `${m.name} sends no change back yet: update Filament there`);
      const stop = signal ?? new AbortController().signal;
      const stopped = () => backFailed("cut", `what changed in its copy on ${m.name} was not brought here: ${stop.reason?.name === "TimeoutError" ? "it took longer than it may" : "it was stopped"}`);
      /** @param {any} e */
      const lost = (e) => {
        const status = Number(e?.status) || 0;
        return backFailed(status === 404 || status === 410 ? "gone" : REFUSED_FOR_GOOD.includes(status) ? "refused" : "cut", `what changed in its copy on ${m.name} did not come back: ${refusedWords(m, e)}`);
      };
      const here = async (/** @type {string} */ sha) => (await git(["cat-file", "-e", `${sha}^{commit}`], { cwd: repo })).code === 0;
      // Beside the copy sent, only a commit this repository still holds is named: that machine leaves out of its bundle
      // what a named one carries, and one git pruned here since would leave the bundle built on nothing (the review of
      // 11-11).
      /** @type {string[]} */
      let held = [];
      for (const h of [base, ...haves]) if (/^[0-9a-f]{40}$/.test(h) && !held.includes(h) && (h === base || (await here(h)))) held.push(h);
      let tries = 0;
      for (;;) {
        if (stop.aborted) throw stopped();
        /** @type {any} */
        let cap;
        try {
          cap = await c.post("/transfers/back", { copy, chat, haves: held }, { timeoutMs: COMMIT_MS, signal: stop });
        } catch (/** @type {any} */ e) {
          if (stop.aborted) throw stopped();
          const status = Number(e?.status) || 0;
          // A 503 is that machine's store busy a moment (or no capture there, which its `takes` rules out): asked again.
          if (REFUSED_FOR_GOOD.includes(status) || status === 404 || status === 410 || ++tries >= SEND_TRIES) throw lost(e);
          await wait(1000 * tries, stop);
          continue;
        }
        const commit = String(cap?.commit || "");
        if (!/^[0-9a-f]{40}$/.test(commit)) throw backFailed("refused", `${m.name} named no capture of its copy`);
        const left = (Array.isArray(cap?.left) ? cap.left : []).slice(0, 200).map((/** @type {any} */ l) => ({ path: fieldThere(l?.path, 300), why: fieldThere(l?.why, 200) }));
        if (cap.unchanged === true) return { commit: base, unchanged: true, left };
        // Held here already, said there: one of the commits this side named, else asked again without it where this
        // repository no longer has it.
        if (!cap.id) {
          if (cap.had === true && held.includes(commit) && (await here(commit))) return { commit, unchanged: false, left };
          if (held.length > 1 && ++tries < SEND_TRIES) {
            held = [base];
            continue;
          }
          throw backFailed("refused", `${m.name} sent no capture of its copy to read`);
        }
        const bytes = Number(cap.bytes);
        const sha256 = String(cap.sha256 || "").toLowerCase();
        if (!Number.isSafeInteger(bytes) || bytes <= 0 || !/^[0-9a-f]{64}$/.test(sha256)) throw backFailed("refused", `${m.name} said no size or sha-256 for the capture of its copy`);
        if (bytes > BACK_MAX_BYTES) throw backFailed("refused", `what changed in its copy on ${m.name} weighs ${(bytes / 1024 ** 3).toFixed(1)} GB as a bundle, past the ${BACK_MAX_BYTES / 1024 ** 3} GB one may bring here: it stays in that copy`);
        // One a crash leaves is swept by a later send, by its name (send.js `sweepLeft`).
        const dir = await mkdtemp(join(tmpdir(), BACK_PREFIX));
        try {
          const file = join(dir, "back.bundle");
          const fh = await open(file, "w");
          let have = 0;
          let fails = 0;
          let gone = false;
          try {
            while (have < bytes) {
              if (stop.aborted) throw stopped();
              try {
                const part = await c.get(`/transfers/back/${encodeURIComponent(String(cap.id))}?offset=${have}`, { timeoutMs: 120_000, signal: stop });
                const buf = Buffer.from(String(part?.data || ""), "base64");
                if (Number(part?.offset) !== have || !buf.length || have + buf.length > bytes) throw new Error(`${m.name} sent a part of the capture from elsewhere`);
                await fh.write(buf, 0, buf.length, have);
                have += buf.length;
                fails = 0;
              } catch (/** @type {any} */ e) {
                if (stop.aborted) throw stopped();
                // Gone there (a restart, or kept past its while): asked for again.
                if (Number(e?.status) === 404) {
                  gone = true;
                  break;
                }
                if (++fails >= SEND_TRIES) throw lost(e);
                await wait(1000 * fails, stop);
              }
            }
          } finally {
            await fh.close();
          }
          if (gone) {
            if (++tries >= SEND_TRIES) throw backFailed("cut", `what changed in its copy on ${m.name} did not come back: its capture there went before it was read`);
            continue;
          }
          if ((await digestOf(file)).sha256 !== sha256) throw backFailed("refused", `what came back from its copy on ${m.name} is not what it said it sent: its sha-256 differs`);
          const took = await importBack(repo, file, { base });
          // Built on a commit this repository lost since it was named: asked for again on the copy sent alone, whole.
          if (!took.ok && took.lacks && held.length > 1 && ++tries < SEND_TRIES) {
            held = [base];
            continue;
          }
          if (!took.ok) throw backFailed(took.again ? "cut" : "refused", `what came back from its copy on ${m.name} was not taken here: ${took.error}`);
          return { commit: took.commit, unchanged: false, left };
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
    /**
     * What a sub-agent on another machine is told first, ahead of its task: where it runs — the machine, its system and
     * shell, the folder, its branch and HEAD —, where the agent that launched it works, and how to bring its folder to
     * that work: nothing at the same commit, a fetch where that commit is pushed, and where it is not, that it cannot.
     * A patch of the uncommitted changes rides beside it where the launch asks for one (`changes`). `back`: what it
     * changes in its own copy comes back to this machine (cp-back), said so.
     * @param {RemotePlace} p @param {{ changes?: boolean, back?: boolean }} [o]
     */
    whereWords(p, { changes = false, back = false } = {}) {
      const sys = p.system || {};
      const shell = sys.shell?.name ? `; your commands run in ${sys.shell.name}` : "";
      const facts = [sys.os, sys.arch].filter(Boolean).join(", ");
      const runs = `Where you run: on ${p.machine.name}${facts ? ` (${facts}${sys.release ? `, release ${sys.release}` : ""})` : ""}${shell}, in ${p.cwd}`;
      // A copy of its own (cp-place): the folder as it stood here, uncommitted work in it; no sync, no install yet.
      const k = p.copy;
      if (k) {
        const h = p.here;
        const stood = h ? ` (${onBranch(h.branch)} at ${short(h.head)}${h.dirty ? ", with its uncommitted changes" : ""})` : "";
        const held = k.left.length ? ` Held back there, so not here: ${andMore(firstOf(k.left.map((l) => `${l.path} (${l.why})`), 8), "; ")}.` : "";
        return [
          `${runs}: a copy of ${k.project} made for you, as its folder stands on the machine that launched you${stood} — the files git sees there, new ones included. Its HEAD is that folder as it stood, its history only the copies sent before, not the project's: \`git diff\` shows what you change. What .gitignore leaves out (dependencies, builds) was not sent: install them before you build or test${k.reused ? " — an earlier launch's may be here already" : ""}.${held}`,
          back
            ? `What you change here goes back to the machine that launched you as each of your turns ends — the files as you leave them, committed or not, less what .gitignore leaves out, a secret's file, a file over 100 MB and a repository made inside this one, which stay here — for the agent that launched you to apply: say in your report what you changed. A link that leads out of this folder, or a junction, keeps all of it from going back: make none, and take away one you made before your turn ends. It is no clone of the person's: never push from it.`
            : `Your changes stay in this copy on ${p.machine.name}: say in your report what you changed. It is no clone of the person's: commit or push from it only where your task says to.`,
          `Sync: none — this copy is that folder as it stands now.${changes ? " The patch below shows the changes your task names: this copy holds them already." : ""}`,
        ].join("\n");
      }
      const c = p.clone;
      const at = c ? `, the clone there of ${p.remote}, on ${onBranch(c.branch)} at ${short(c.head)}${c.dirty ? ", with uncommitted changes" : ""}` : "";
      const h = p.here;
      const launcher = h ? `The agent that launched you works on another machine, on ${onBranch(h.branch)} at ${short(h.head)}${h.dirty ? ", with uncommitted changes" : ""}${p.remote ? ` of ${p.remote}` : ""}.` : "The agent that launched you works on another machine, in a folder outside git.";
      const patch = changes ? " The patch below carries its uncommitted changes alone." : "";
      const f = p.folder;
      const sync = !h
        ? "Sync: there is nothing to sync by — its folder is in no git repository."
        : !c && f?.gone
          ? `Sync: none — this folder is not there yet: make it, and work from what your task gives you.${patch}`
          : !c && f && !f.git
            ? `Sync: none — this folder is in no git repository there, so nothing of the work at ${short(h.head)} is in it: work from what your task gives you.${patch}`
            : !c && f && !f.same
              ? `Sync: none — this folder is a clone of another repository, not ${p.remote}: nothing of the work at ${short(h.head)} is in it.${patch}`
              : !c
                ? `Sync: Filament could not read this folder's git state — check its branch and HEAD yourself before you start; theirs is ${short(h.head)}.${patch}`
                : c.head && c.head === h.head
                  ? `Sync: none — this folder is at the same commit.${patch}`
                  : h.pushed
                    ? // Their commit itself, never a branch's tip; the person's clone moved only clean on that branch, by a
                      // fast-forward to it (the swarm's review of 11-10).
                      h.branch && h.branch === c.branch && c.dirty === false
                      ? `Sync: run \`git fetch\`, then \`git merge --ff-only ${h.head}\` on ${h.branch} to reach ${short(h.head)} before you start; where that is no fast-forward, work in a worktree of it beside this folder (\`git worktree add --detach "<folder>" ${h.head}\`), never a merge here.${patch}`
                      : `Sync: their work is ${short(h.head)}${h.branch ? ` on ${h.branch}` : ""}, and this folder is the person's: run \`git fetch\`, then work in a worktree of that commit beside it (\`git worktree add --detach "<folder>" ${h.head}\`), never a checkout, pull or merge here.${patch}`
                    : `Sync: their commit ${short(h.head)} is not pushed, so you cannot fetch it: work from this folder as it is.${changes ? " The patch below carries their uncommitted changes alone, not the commits." : ""}`;
      return [`${runs}${at}. Your changes stay on ${p.machine.name}: say in your report what you changed, and commit or push only where your task says to.`, launcher, sync].join("\n");
    },
    /**
     * Stop the chat's turn there, as best it can be: a turn a restart here cut goes on there else, and refuses the
     * next message as busy. Its words where the stop could not be sent, else null. @param {RemoteChat} remote
     * @returns {Promise<string | null>}
     */
    async stop(remote) {
      if (!remote.chat) return null;
      try {
        await (await clientOf(machineOf(remote.machine.id))).post(`/sessions/${encodeURIComponent(remote.chat)}/stop`, {});
        return null;
      } catch (/** @type {any} */ e) {
        return wordsThere(e?.message || e, ERROR_CHARS);
      }
    },
    /**
     * One message to the sub-agent's chat on its machine: the chat started there at its first (POST /sessions, in its
     * folder, on its model and effort, in the mode of the chat that sent it) — on a model that answers there where none is
     * named (`modelThere`) —, the message sent as a turn and followed to its run's end — read again from the
     * run's events, by its id, where the stream drops. `signal` stops it there: the chat's Stop. Ends as turn.js's host
     * finish says a run ended: its last round's words are the report. A machine that refuses the device mid-run —
     * revoked, its grant off — ends it, failed, in words that say why. One that does not answer ends nothing (the
     * review of 11-11): the turn goes on there whether or not it is heard here, so its run is asked for again, further
     * apart each time (`FOLLOW_MS` to `FOLLOW_MAX_MS`), said unreachable past `UNREACHABLE_AFTER_MS` (`onAway`) and
     * asked on `UNREACHABLE_AGAIN_MS` apart — followed from where it stopped once that machine answers, or ended as
     * that machine says it ended. Nothing is stopped there but by `signal`, whose stop is owed where it could not be
     * known to land (`stopOwed`).
     * What the chat there asks the person (`personsAsk`) goes to `onAsk`, one ask at a time, and the person's answer goes
     * there (the remote-agents plan's s-asks); unanswered, it waits there — until it is answered there, or the stop. A
     * call of what runs in its turn — a sub-agent's, its coding agent's — waits in place while its run goes on
     * (`watch`); the chat's own ask pauses its turn, whose run ends `paused`, and the answer's reply is the turn it
     * resumes, read as the next run (`settleOwn`). A pause that still waits there from a turn stopped here as it waited is
     * the person's to answer before this message goes, which would answer it else.
     * @param {RemoteChat} remote @param {{ content: any[], signal: AbortSignal, title?: string, mode?: string | null,
     *   onEvent?: (e: any) => void, onAsk?: ((ask: RemoteAsk, signal: AbortSignal) => Promise<RemoteAnswer | null>) | null,
     *   onChat?: () => void, onAway?: (away: { ms: number, why: string } | null) => void }} o
     *   `content`: the message's blocks, words and pictures or documents carried whole; `mode`: the permission mode of
     *   the chat that sends it, now — the chat there starts in it, and takes a change of it with the message; `onAsk`: an
     *   ask shown to the person, resolved with their answer — null where its signal let it go unanswered (the stop,
     *   `ANSWERED_THERE`); `onChat`: its chat there is made, before its message goes — for the caller to keep it, so a
     *   restart here before its run begins still finds the chat to stop; `onAway`: its machine has not answered for
     *   `UNREACHABLE_AFTER_MS` (how long, and what the last read said), then null once it answers again
     * @returns {Promise<import("./subagents.js").HostFinish>}
     */
    async turn(remote, { content, signal, title = "", mode = null, onEvent = () => {}, onAsk = null, onChat = () => {}, onAway = () => {} }) {
      // Its newest turn's run, once this one's events name it: none, where it is refused before it began.
      remote.run = null;
      const m = machineOf(remote.machine.id);
      const client = await clientOf(m);
      const had = !!remote.chat;
      if (!remote.chat) {
        if (!remote.cwd) throw new Error(`no folder on ${m.name} to start its chat in: its copy there was not made`);
        // A Filament there from before agents could set a chat's mode names none it takes (its /state's `takes`): its chat
        // starts in that machine's own mode, as it did then — never where it was to read alone, which that mode may not.
        const moded = !!mode && takes(client, "mode");
        if (mode && !moded) {
          if (mode === "read-only") throw new Error(`${m.name} runs a Filament from before a chat's mode could be sent there, so its chat cannot start read-only: update Filament on ${m.name}`);
          remote.modeless = true;
        }
        const settings = { ...(remote.effort ? { model: { effort: remote.effort } } : {}), ...(moded ? { loop: { permissions: mode } } : {}) };
        const made = await client.post("/sessions", { cwd: remote.cwd, ...(title ? { title } : {}), ...(remote.model ? { model: remote.model } : {}), ...(Object.keys(settings).length ? { settings } : {}) });
        remote.chat = String(made?.id || "") || null;
        if (!remote.chat) throw new Error(`${m.name} started no chat`);
        if (!remote.modeless) remote.mode = mode;
        if (!remote.model && typeof made?.model === "string" && MODEL_NAME.test(made.model) && unnoticed(made.model) === made.model) remote.model = made.model;
        // A name there that does not read as one is still that machine's model: none at all, and one is chosen.
        if (!remote.model && !made?.model) remote.unnamed = true;
        onChat();
      }
      // Neither its launch nor that machine names its model: one that answers there, set on the chat with each message
      // until a run there takes it (`pick`).
      if (remote.unnamed && !remote.model && !remote.pick) {
        /** @type {any} */
        let j;
        try {
          j = await client.get("/models", { timeoutMs: MODELS_MS });
        } catch (e) {
          throw new Error(`${m.name} names no model for a new chat, and did not list its models: ${refusedWords(m, e)}`);
        }
        remote.pick = modelThere(j, remote.prefer);
        if (!remote.pick) throw new Error(`no model answers on ${m.name} now, and its sub-agent's chat there needs one`);
      }
      const picked = remote.model ? null : remote.pick || null;
      // The sending chat's mode changed since the chat there took one: the change goes with the message.
      // Only where that machine takes a mode (its /state's `takes`): a Filament there from before refuses one.
      const moved = had && mode && !remote.modeless && mode !== remote.mode && takes(client, "mode") ? mode : null;
      const patch = { ...(picked ? { model: { name: picked } } : {}), ...(moved ? { loop: { permissions: moved } } : {}) };
      const chat = `/sessions/${encodeURIComponent(remote.chat)}`;
      /**
       * A stop sent to the chat's turn there: why it did not reach that machine (`why`, null where it did), and whether
       * a turn there took it (`took`: that machine says how the stop landed, and says nothing where none ran).
       * @returns {Promise<{ why: string | null, took: boolean }>}
       */
      const stopSent = () =>
        client.post(`${chat}/stop`, {}, { timeoutMs: 15_000 }).then(
          (/** @type {any} */ j) => ({ why: null, took: j?.stopped != null }),
          (/** @type {any} */ e) => ({ why: wordsThere(e?.message || e, ERROR_CHARS), took: false }),
        );
      /** A stop sent to the chat's turn there: null once that machine took it, else why it did not. @returns {Promise<string | null>} */
      const stopThere = () => stopSent().then((s) => s.why);
      // A stop that did not reach that machine before goes first: the turn it was for may still run there, and would hold
      // this message off as busy (the swarm's review of 11-10).
      if (had && remote.stopOwed && !(await stopThere())) delete remote.stopOwed;
      /** The run's events as they came, each once by its number: its id, its newest number, each round's words, its end. */
      const seen = { run: /** @type {string | null} */ (null), n: 0, end: /** @type {any} */ (null), words: /** @type {Map<number, string>} */ (new Map()), rounds: 0, tools: 0 };
      let said = "";
      /** @type {string | null} */
      let failed = null;
      // Whether this message went there: a run read before it is the resume of a pause before it, and is not its turn's.
      let sent = false;
      // A pause answered there whose resumed turn could not be found there.
      let lost = false;
      // The turn is over: nothing more is shown.
      let over = false;
      /** A run of the chat's begins there — the turn an answer resumed —: read from its start, its words alone the report. */
      const nextRun = () => {
        Object.assign(seen, { run: null, n: 0, end: null, words: new Map() });
        said = "";
        failed = null;
      };
      /** @param {any} e */
      const onRun = (e) => {
        if (!e || typeof e !== "object") return;
        if (e.runId && !seen.run) {
          seen.run = String(e.runId);
          if (sent) remote.run = seen.run;
        }
        if (e.runId && String(e.runId) !== seen.run) return;
        const n = Number(e.n) || 0;
        if (n && n <= seen.n) return;
        if (n) seen.n = n;
        if (e.type === "round-start") seen.rounds = Math.max(seen.rounds, Number(e.round) || 0);
        else if (e.type === "tool-start") seen.tools++;
        else if (e.type === "round-text") seen.words.set(Number(e.round) || 0, `${seen.words.get(Number(e.round) || 0) ? `${seen.words.get(Number(e.round) || 0)}\n` : ""}${String(e.text || "")}`);
        else if (e.type === "run-end") seen.end = e;
        // What runs in its turn asks the person, or an ask of it ended: the asks there, read again.
        if (e.type === "subagent-ask" || e.type === "subagent-ask-end" || e.type === "ask-end" || (e.type === "ask" && e.waits === true)) watch();
        onEvent(e);
      };
      /** The reply now read — the message's, an answer's —, let go of once its run ended, and at the stop. */
      let reading = new AbortController();
      /** @type {ReturnType<typeof stopSent> | null} */
      let stopping = null;
      /** Why the stop did not reach that machine, where it did not. @type {string | null} */
      let unstopped = null;
      /** The stop reached that machine and found no turn there, and none was found after: one may begin there yet. */
      let unseen = false;
      /** Something that starts a turn there went: the message, or an answer that resumes one. */
      let began = false;
      const onStop = () => {
        stopping = stopSent();
        reading.abort();
      };
      /**
       * That machine's silence as this turn is read: a read it did not answer is waited out — `FOLLOW_MS`, then twice as
       * long after each one more, `FOLLOW_MAX_MS` at most — and ends nothing; past `UNREACHABLE_AFTER_MS` of such waits
       * the turn is said unreachable (`onAway`) and that machine asked `UNREACHABLE_AGAIN_MS` apart from then.
       */
      const gap = { ms: 0, next: FOLLOW_MS, said: false };
      /** A read that machine did not answer, waited out. @param {any} e  what the read said */
      const unanswered = async (e) => {
        if (!gap.said && gap.ms >= UNREACHABLE_AFTER_MS) {
          gap.said = true;
          onAway({ ms: gap.ms, why: wordsThere(e?.message || e, ERROR_CHARS) });
        }
        const ms = gap.said ? UNREACHABLE_AGAIN_MS : gap.next;
        gap.ms += ms;
        gap.next = Math.min(FOLLOW_MAX_MS, gap.next * 2);
        await wait(ms, signal);
      };
      /** That machine answered a read: it is back, said where it was said unreachable. */
      const answered = () => {
        if (gap.said) onAway(null);
        Object.assign(gap, { ms: 0, next: FOLLOW_MS, said: false });
      };
      /** Whether a failed read is that machine not answering — nothing came, or its Filament answered that it cannot now (5xx) — and no refusal of this Filament's agents. @param {any} e */
      const silent = (e) => !(e instanceof CliError) || Number(/** @type {any} */ (e).status) >= 500;
      if (signal.aborted) onStop();
      else signal.addEventListener("abort", onStop, { once: true });
      /** Each event of a reply that is a turn of the chat's. @param {string} event @param {any} d */
      const onReply = (event, d) => {
        const type = d?.type || event;
        if (type === "filament_run") {
          onRun(d?.event);
          // Its run ended: the reply has said all it says, and the stream is let go of.
          if (seen.end) reading.abort();
        } else if (type === "content_block_delta" && d?.delta?.type === "text_delta") said += String(d.delta.text || "");
        else if (type === "error") failed = wordsThere(d?.error?.message || "the turn failed", ERROR_CHARS);
      };
      /**
       * A request whose reply is a turn of the chat's — the message, an answer that resumes its turn —, read as it comes.
       * → its refusal where it was refused busy before its run began, for the caller to send again or not.
       * @param {string} path @param {any} body @param {string} what  what is sent, for a refusal's words
       * @returns {Promise<CliError | null>}
       */
      const streamed = async (path, body, what) => {
        reading = new AbortController();
        began = true;
        try {
          await client.stream(path, body, onReply, { signal: reading.signal, idleMs: STREAM_IDLE_MS });
        } catch (/** @type {any} */ e) {
          if (reading.signal.aborted && e?.name === "AbortError") return null;
          if (e instanceof CliError && e.code === EXIT.busy && !seen.run) return e;
          // Refused before its turn ran (a field it took no more): said as the machine said it.
          if (e instanceof CliError) throw new Error(`${m.name} refused ${what}: ${refusedWords(m, e)}`);
          // Dropped, or silent past STREAM_IDLE_MS: its run's events are read on (`follow`), where its run began. Dropped
          // before its run's first event, the message may have begun one there all the same: one its chat's live state names
          // is followed; with none, a stop goes, owed where it does not reach it, so no turn runs on there unseen (the
          // swarm's review of 11-10). A machine that does not answer the question is asked again, as `follow` asks: its
          // silence alone says nothing of a turn there (the review of 11-11).
          if (!seen.run) {
            /** @type {any} */
            let live = null;
            while (!signal.aborted) {
              try {
                live = await client.get(`${chat}/live-state`, { timeoutMs: 15_000 });
                answered();
                break;
              } catch (x) {
                if (!silent(x)) break;
                await unanswered(x);
              }
            }
            if (signal.aborted) return null;
            const now = live?.live?.requestId ? String(live.live.requestId) : null;
            if (now) {
              seen.run = now;
              if (sent) remote.run = now;
              return null;
            }
            if (await stopThere()) remote.stopOwed = true;
            throw new Error(`${m.name} stopped answering before a turn of its sub-agent was seen to begin there (${wordsThere(e?.message || e, ERROR_CHARS)}), and none runs there now`);
          }
        }
        return null;
      };
      /**
       * The run's events read again from where they stopped, by its id, until its end: the stream dropped, or ended while
       * its run went on. A read that machine does not answer is waited out and made again (`unanswered`), for as long as
       * it takes: the run goes on there meanwhile, and its events are kept there to read from where this side stopped —
       * or its end, as that machine says it ended.
       */
      const follow = async () => {
        while (!seen.end && seen.run && !signal.aborted) {
          try {
            const page = await client.get(`/runs/${encodeURIComponent(seen.run)}/events?since=${seen.n}`, { timeoutMs: 15_000 });
            answered();
            for (const e of Array.isArray(page?.events) ? page.events : []) onRun(e);
            if (!seen.end && page?.run?.endedAt != null && !page?.events?.length) seen.end = { type: "run-end", status: String(page.run.status || "done"), summary: page.run.summary || {} };
          } catch (/** @type {any} */ e) {
            if (!silent(e)) throw new Error(`${m.name} refused this Filament's agents as their sub-agent worked: ${refusedWords(m, e)}`);
            await unanswered(e);
            continue;
          }
          if (!seen.end) await wait(FOLLOW_MS, signal);
        }
        // Its run ended: a call of it shown here waits no more.
        if (shown && shown.ask.from !== "chat") shown.ctrl.abort();
      };

      /** The ask shown to the person here now, one at a time. @type {{ ask: RemoteAsk, ctrl: AbortController } | null} */
      let shown = null;
      /** The calls of what runs in its turn shown here once already, by id. */
      const once = new Set();
      /** The person's asks waiting there now. @returns {Promise<RemoteAsk[]>} */
      const asksThere = async () => {
        const j = await client.get(`${chat}/asks`, { timeoutMs: 15_000 });
        return (Array.isArray(j?.asks) ? j.asks : []).filter(personsAsk);
      };
      /**
       * An ask shown to the person here (`onAsk`), let go of at the stop and where it waits no more there. → their
       * answer, or null. @param {RemoteAsk} ask @returns {Promise<RemoteAnswer | null>}
       */
      const show = async (ask) => {
        const ctrl = new AbortController();
        const s = { ask, ctrl };
        shown = s;
        const end = () => ctrl.abort();
        signal.addEventListener("abort", end, { once: true });
        try {
          const a = await /** @type {NonNullable<typeof onAsk>} */ (onAsk)(ask, ctrl.signal);
          return ctrl.signal.aborted ? null : a;
        } catch {
          return null;
        } finally {
          signal.removeEventListener("abort", end);
          if (shown === s) shown = null;
        }
      };
      /** A read of the asks there for `watch` under way, and whether another is due once it ends. @type {Promise<void> | null} */
      let looking = null;
      let lookAgain = false;
      /** The reads of the asks there that failed in a row. */
      let unread = 0;
      /**
       * What runs in the chat's turn there waits in place for the person while its run goes on — a sub-agent's call, its
       * coding agent's —: each is shown here in turn, once, and the person's answer sent there; one no longer listed there
       * — answered there, ended — is let go of here. The chat's own ask ends its run, and is `settleOwn`'s.
       */
      const watch = () => {
        if (!onAsk || over || signal.aborted) return;
        if (looking) {
          lookAgain = true;
          return;
        }
        looking = (async () => {
          do {
            lookAgain = false;
            const inRun = (await asksThere().catch(() => null))?.filter((a) => a.from !== "chat");
            // Not read: read again a moment on, a few times, as no event of it may come again (the swarm's review of 11-10).
            if (!inRun && !over && !signal.aborted && ++unread < FOLLOW_TRIES)
              void wait(FOLLOW_MS, signal).then(
                () => watch(),
                () => {},
              );
            if (inRun) unread = 0;
            if (!inRun || over) continue;
            const was = shown;
            if (was && was.ask.from !== "chat" && !inRun.some((a) => a.id === was.ask.id)) was.ctrl.abort(ANSWERED_THERE);
            const next = shown ? null : inRun.find((a) => !once.has(a.id));
            if (!next) continue;
            once.add(next.id);
            void show(next).then(async (a) => {
              if (a)
                await client.post(`${chat}/asks/${encodeURIComponent(next.id)}/answer`, answerBody(a)).catch((/** @type {any} */ e) => {
                  // Answered there meanwhile (409): nothing more to do. Else it is the person's to answer again.
                  if (!(e instanceof CliError && e.code === EXIT.busy)) once.delete(next.id);
                });
              watch();
            });
          } while (lookAgain && !over && !signal.aborted);
        })().finally(() => {
          looking = null;
          // An ask heard after the loop's last look and before this: its event is past, so it is read now or never.
          if (lookAgain) watch();
        });
      };
      const TICK = Symbol("tick");
      /**
       * The chat's own ask there, the paused run `paused`'s, the person's to answer: shown here until they answer, it is
       * answered there or lapses, or the stop, the asks there read the while (`asksMs`) — for its pause, which shows a
       * moment after its run ended, and for an answer there. Their answer goes there, and its reply is the turn it resumes,
       * read as the next run; one answered there resumed a turn there, read where it is found (`resumedThere`).
       * → false where no turn of it was there to read. @param {string} paused
       */
      const settleOwn = async (paused) => {
        /** @type {Promise<RemoteAnswer | null> | null} */
        let answer = null;
        for (let k = 0; !signal.aborted; k++) {
          /** @type {RemoteAsk[] | null} */
          let all = null;
          try {
            all = await asksThere();
            answered();
          } catch (/** @type {any} */ e) {
            if (!silent(e)) throw new Error(`${m.name} refused this Filament's agents as their sub-agent asked: ${refusedWords(m, e)}`);
            // Its ask waits there whether or not that machine is heard: read again, as its run's events are (`follow`),
            // this read not counted.
            await unanswered(e);
            k--;
            continue;
          }
          const own = all?.find((a) => a.from === "chat" && a.id === paused) ?? null;
          if (all && !own) {
            // Its pause shows a moment after its run ended: read again, a few times.
            if (!answer && k < PAUSE_TRIES) {
              await wait(asksMs(k), signal);
              continue;
            }
            if (shown?.ask.id === paused) shown.ctrl.abort(ANSWERED_THERE);
            return resumedThere(paused, all);
          }
          if (own && !answer) {
            // One ask shows at a time: a call of what runs in its turn shown here now is let go of, unanswered, and
            // shows again once this one's answer goes (`once` forgets it) — else its ask here would never settle.
            const was = shown;
            if (was && was.ask.from !== "chat") {
              once.delete(was.ask.id);
              was.ctrl.abort();
            }
            answer = show(own);
          }
          const tick = new AbortController();
          const got = await Promise.race([answer ?? new Promise(() => {}), wait(asksMs(k), AbortSignal.any([signal, tick.signal])).then(() => TICK)]);
          tick.abort();
          if (got === TICK) continue;
          // Let go of unanswered: at the stop it ends; else it waits there, to be answered there or stopped.
          if (!got) {
            answer = new Promise(() => {});
            continue;
          }
          nextRun();
          // What its answer let wait shows again while the turn it resumes runs.
          watch();
          for (let tries = 1; !signal.aborted; tries++) {
            const busy = await streamed(`${chat}/asks/${encodeURIComponent(paused)}/answer`, { ...answerBody(/** @type {RemoteAnswer} */ (got)), stream: true, runEvents: true }, "the person's answer");
            if (!busy) break;
            // Refused 409: the turn that paused holds the chat a moment past its end — sent again —, or it was answered there.
            const still = await asksThere().then((x) => x.some((a) => a.id === paused), () => true);
            if (!still) return resumedThere(paused, []);
            if (tries >= BUSY_TRIES) throw new Error(`${m.name} refused the person's answer: ${refusedWords(m, busy)}`);
            await wait(BUSY_MS, signal);
          }
          await follow();
          return true;
        }
        return false;
      };
      /**
       * The turn a pause answered there resumed: where it paused again (its own ask, by its run), the turn after the
       * paused run's (the live state's `next`) — running or ended before it was looked for, never a newer one that runs
       * there now —, else where it runs there now, read from its start as the next run. → false where none is found.
       * @param {string} paused @param {RemoteAsk[]} all  the asks there, as last read
       */
      const resumedThere = async (paused, all) => {
        for (let tries = 0; tries < FOLLOW_TRIES && !signal.aborted; tries++) {
          const again = all.find((a) => a.from === "chat" && a.id !== paused)?.runId ?? null;
          /** @type {any} */
          let live = null;
          if (!again)
            try {
              live = await client.get(`${chat}/live-state?after=${encodeURIComponent(paused)}`, { timeoutMs: 15_000 });
              answered();
            } catch (x) {
              // Not answered: nothing is known of a turn there, which is looked for again once that machine answers —
              // never read as none (the review of 11-11).
              if (silent(x)) {
                await unanswered(x);
                tries--;
                continue;
              }
            }
          const now = live?.live?.requestId && String(live.live.requestId) !== paused ? String(live.live.requestId) : null;
          const past = typeof live?.next === "string" && live.next && live.next !== paused ? live.next : null;
          const run = again || past || now;
          if (run) {
            nextRun();
            seen.run = run;
            if (sent) remote.run = run;
            await follow();
            return true;
          }
          await wait(FOLLOW_MS, signal);
          all = await asksThere().catch(() => []);
        }
        lost = !signal.aborted;
        return false;
      };
      /** While its run ends paused on the chat's own ask: the person's to answer, and the turn it resumes read (`settleOwn`). */
      const settlePauses = async () => {
        while (onAsk && seen.end?.status === "paused" && seen.run && !signal.aborted) if (!(await settleOwn(seen.run))) return;
      };
      try {
        // A pause that still waits there, of a turn stopped here as it waited: this message would answer it there. Where
        // that machine does not say what waits there, nothing goes.
        /** @param {any} e @returns {never} */
        const unsaid = (e) => {
          throw new Error(`the message was not sent: ${m.name} did not say whether its sub-agent's chat there waits on the person, whose answer the message would be taken for (${refusedWords(m, e)}) — send it again once ${m.name} answers`);
        };
        const before = had && onAsk ? ((await asksThere().catch(unsaid)).find((a) => a.from === "chat") ?? null) : null;
        if (before && (await settleOwn(before.id))) await settlePauses();
        if (!signal.aborted) {
          sent = true;
          lost = false;
          nextRun();
          // A call of what ran in its turn there that still waits — a sub-agent of it working on past that turn's end,
          // let go of here then — shows again, as no event of it may come.
          if (had) watch();
          // Busy there — the turn a stop was sent to (`stop`, a restart here) is settling —: sent again, for a while.
          for (let tries = 1; !signal.aborted; tries++) {
            const busy = await streamed(`${chat}/turns`, { content, stream: true, runEvents: true, sendAsIs: true, ...(Object.keys(patch).length ? { settingsPatch: patch } : {}) }, "the message");
            if (!busy) break;
            if (tries >= BUSY_TRIES) throw new Error(`${m.name} refused the message: ${refusedWords(m, busy)}`);
            await wait(BUSY_MS, signal);
          }
          await follow();
          // Its model and mode once a run there took them with the message: one stopped or refused before carries them again.
          if (seen.run) {
            if (picked) {
              remote.model = picked;
              delete remote.pick;
              delete remote.unnamed;
            }
            if (moved) remote.mode = moved;
          }
          await settlePauses();
        }
      } catch (/** @type {any} */ e) {
        if (signal.aborted) throw e;
        // That machine refused this Filament's agents as its run went on there (their device revoked, their grant off):
        // the run is sent a stop, owed where it does not reach it, and what it said by then comes back with why, as a
        // turn here that failed keeps its words (the swarm's review of 11-10). One that only did not answer never
        // comes here: its turn is read on (`unanswered`).
        if (seen.run && !seen.end && (await stopThere())) remote.stopOwed = true;
        if (!seen.run || !seen.words.size) throw e;
        failed = wordsThere(e?.message || e, ERROR_CHARS);
      } finally {
        over = true;
        signal.removeEventListener("abort", onStop);
        reading.abort();
        /** @type {{ ctrl: AbortController } | null} */ (shown)?.ctrl.abort();
        const stop = stopping ? await /** @type {ReturnType<typeof stopSent>} */ (stopping) : null;
        unstopped = stop?.why ?? null;
        if (unstopped) remote.stopOwed = true;
        // The stop reached that machine and found no turn to stop, while this side sent what starts one and saw none
        // end: sent ahead of the turn — its message still on its way there, its run not yet registered —, it stopped
        // nothing, and that turn would run on unseen, said stopped (the review of 11-11). The chat's live state is read
        // once: a turn that runs there is stopped again; with none seen, or where either does not reach that machine,
        // the stop is owed, and goes before anything else is asked of its chat.
        else if (stop && !stop.took && began && !seen.end) {
          const live = await client.get(`${chat}/live-state`, { timeoutMs: 15_000 }).catch(() => null);
          const again = live?.live?.requestId ? await stopSent() : null;
          if (again?.why) unstopped = again.why;
          else if (!again?.took) unseen = true;
          if (!again?.took) remote.stopOwed = true;
        }
      }
      const end = seen.end;
      const s = end?.summary || {};
      const last = [...seen.words.keys()].sort((a, b) => a - b).at(-1);
      // Its words are that machine's: kept as data, never a notice of this Filament's (`reportThere`).
      const report = reportThere(String(last !== undefined ? seen.words.get(last) : said).trim());
      // A reply that ended with no run of Filament's there (its words alone) is done as it said.
      const ended = end ? String(end.status || "") : "done";
      // Done, or stopped, as its run there ended; any other end failed, in words that say what happened there.
      const status = signal.aborted || STOPPED.includes(ended) ? "aborted" : failed || lost || ended !== "done" ? "failed" : "done";
      const gone = `what it asked on ${m.name} waits no more there — answered there, or lapsed —, and no turn of it runs there to follow: a follow-up asks it what it did`;
      const stoppedHere = unstopped
        ? `stopped here, and the stop did not reach ${m.name} (${unstopped}): its turn there may still run, and is sent a stop again before its next message`
        : unseen
          ? `stopped here before a turn of it was seen on ${m.name}, where the stop found none: its message may still start one there, and a stop is sent again before anything else is asked of its chat`
          : `stopped on ${m.name}`;
      const error = status === "done" ? null : signal.aborted ? stoppedHere : status === "aborted" ? `stopped on ${m.name}, by someone there` : String(failed || (lost ? gone : endWords(ended, m.name, s.error)));
      return { status, error, report, convo: null, rounds: Number(s.rounds) || seen.rounds, toolCalls: Number(s.toolCalls) || seen.tools, tokensIn: Number(s.inputTokens) || 0, tokensOut: Number(s.outputTokens) || 0, spentUsd: 0, roundIds: [] };
    },
  };
}

/** @typedef {ReturnType<typeof createRemoteAgents>} RemoteAgents */
