// @ts-check
// The observation bus (HarnessV3-Memory MD-22, M5-4): what happens while agents work, told to memory as it happens.
// In-process and bounded: a producer pushes and never waits, and the observers read the events off the request path,
// in order. Full, it drops the oldest and says so in the log (M5-D6). The producers are the harness loop's tool calls,
// a proxied client's tool-result legs and a sub-agent's report (M7-D17); the observers are the pitfall miner and the
// learner's findings line, which reads a report off the bus's own line.
import { NO_PROJECT_ID } from "../../core/project-id.js";
import { clip } from "../../core/text.js";
import { redactSecrets } from "../../core/redact.js";
import { simpleCommands, commandParts, shapeOfWords, targetOf, commandOf, triggerTool } from "./triggers.js";
import { commandWords } from "./permissions.js";

/** How many events the bus holds before it drops the oldest. */
export const BUS_LIMIT = 1000;

/**
 * A tool call's result, as a producer tells it: where (project, session, turn), the call (its id, tool and input), and
 * how it ended (the error's words for a failure). `conversation` is the model context that made the call when it is not
 * the session's own: a sub-agent's id (HarnessV3-Memory M7-3). Its calls are its session's, on the turn that started
 * it, but a failure in one conversation is never paired with a call that worked in another.
 * @typedef {{ type: "tool.result", project: string | null, chain: string | null, turn: number | null, conversation?: string | null, id?: string, tool: string, input: any, ok: boolean, exitCode?: number | null, error?: string | null, background?: boolean }} ToolResult  `background`: a command that went on in the background, not ended
 */

/**
 * A sub-agent's exchange that ended done (HarnessV3-Memory M7-D17): where (its session, the turn that launched it; the
 * project is the session's), who (its id, type and model, and the model as its calls sent it — `sentModel`, which
 * Memory settings may exclude), its task, the calls it made (each tool, its input in brief, whether it failed) and its
 * report.
 * @typedef {{ type: "subagent.report", chain: string, turn: number | null, id: string, agentType: string, model: string, sentModel?: string, task: string, report: string, calls: { tool: string, input: string, ok: boolean }[] }} SubagentReport
 */

export class ObservationBus {
  /** @type {any[]} */
  #queue = [];
  /** @type {((e: any) => any)[]} */
  #observers = [];
  #running = false;
  /** Events dropped because the bus was full. */
  dropped = 0;
  /**
   * @param {{ log?: (level: string, msg: string) => void, limit?: number }} [o]
   */
  constructor({ log = () => {}, limit = BUS_LIMIT } = {}) {
    this.log = log;
    this.limit = limit;
  }
  /** An observer: told every event, in the order they were pushed. @param {(e: any) => any} fn */
  on(fn) {
    this.#observers.push(fn);
  }
  /** An event, queued; the producer never waits. @param {any} event */
  push(event) {
    if (this.#queue.length >= this.limit) {
      this.#queue.shift();
      this.dropped++;
      if (this.dropped === 1 || this.dropped % 100 === 0)
        this.log("warn", `memory: the observation bus is full (${this.limit} events); the oldest are dropped (${this.dropped} so far)`);
    }
    this.#queue.push(event);
    if (this.#running) return;
    this.#running = true;
    setImmediate(() => void this.#drain());
  }
  async #drain() {
    try {
      while (this.#queue.length) {
        const e = this.#queue.shift();
        for (const fn of this.#observers)
          try {
            await fn(e);
          } catch (err) {
            this.log("warn", `memory: an observer failed on a ${e?.type ?? "?"} event (${String(/** @type {any} */ (err)?.message || err).slice(0, 160)})`);
          }
      }
    } finally {
      this.#running = false;
    }
  }
  /** Resolves once every event pushed so far has been told to every observer. */
  async settled() {
    while (this.#running || this.#queue.length) await new Promise((r) => setImmediate(r));
  }
  /** Memory closes: what waits is dropped, and no observer hears again. */
  stop() {
    this.#queue.length = 0;
    this.#observers.length = 0;
  }
}

const spaced = (/** @type {string} */ s) => String(s ?? "").replace(/\s+/g, " ").trim();
const same = (/** @type {string} */ a, /** @type {string} */ b) => a.toLowerCase() === b.toLowerCase();
// An environment name that holds a secret, as the config's own check names them.
const SECRET_NAME = /key|token|secret|passw|credential|auth/i;
/** Whether text carries what looks like a secret: a known key's shape, or a secret-named variable set. @param {string} text */
export const carriesSecret = (text) => redactSecrets(text) !== text || [...text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=\S/g)].some((m) => SECRET_NAME.test(m[1]));

// The commands that only set up the environment of the ones after them in the same call: a variable set (`export`,
// PowerShell's `$env:X = 1`), a script sourced, a toolchain picked, the console's code page. `cd` is not one: a client
// whose shell keeps its folder between calls runs the bare command in the right place (M5-D14).
const SETUP_HEADS = new Set(["source", ".", "export", "nvm", "fnm", "volta", "conda", "workon", "pyenv", "rbenv", "asdf", "mise", "chcp", "ulimit", "umask"]);
/** Whether a simple command only sets up the ones after it. @param {string} simple */
function setsUp(simple) {
  const { words } = commandParts(simple);
  return !words.length || words[0].startsWith("$") || SETUP_HEADS.has(commandWords(words).word);
}

/**
 * What a call that worked did that one that failed did not (M5-4), when that is all that differs → the failed
 * command's shape, what it runs when the shape does not say (`targetOf`: `npm run migrate` is `migrate`, M5-D31), the
 * right way (what the worked call adds), and the two commands as the claim shows them; null when the calls differ in
 * any other way. Two ways count (M5-D14):
 * - the same simple commands, one of them run with setup before it: an environment, a wrapper (`env -u X npm test`,
 *   `CI=1 npm test`, `sudo apt install`); or, when the command was not there to run (`missing`), a runner (`npx jest`,
 *   `python -m pytest`). The command stays whole, on a word's boundary;
 * - one command, run after a command that only sets up its environment (`source .venv/bin/activate && pytest`).
 * An addition after the command (an argument, a flag) is not one: it may only narrow what ran, or force it. Nor is
 * another command first that is more than setup (`npm install && …`, `cd web && …`).
 * @param {string} failed @param {string} worked @param {{ missing?: boolean }} [o]
 * @returns {{ shape: string, args: string, unless: string, failed: string, worked: string } | null}
 */
export function fixOf(failed, worked, { missing = false } = {}) {
  const a = simpleCommands(failed).map(spaced);
  const b = simpleCommands(worked).map(spaced);
  if (!a.length) return null;
  if (a.length === 1 && b.length === 2 && same(a[0], b[1]) && setsUp(b[0])) {
    const words = commandParts(a[0]).words;
    const shape = shapeOfWords(words);
    return shape ? { shape, args: targetOf(words), unless: b[0], failed: a[0], worked: spaced(worked) } : null;
  }
  if (a.length !== b.length) return null;
  const changed = a.flatMap((x, i) => (same(x, b[i]) ? [] : [i]));
  if (changed.length !== 1) return null;
  const [i] = changed;
  const at = b[i].length - a[i].length;
  if (at <= 1 || !same(b[i].slice(at), a[i]) || b[i][at - 1] !== " ") return null;
  const unless = b[i].slice(0, at).trim();
  if (!missing && spaced(commandParts(b[i]).setup) !== unless) return null;
  const words = commandParts(a[i]).words;
  const shape = shapeOfWords(words);
  return shape ? { shape, args: targetOf(words), unless, failed: a[i], worked: b[i] } : null;
}

/** Whether a failed call's command was not there to run: exit 127 (9009 on Windows' cmd), or a shell saying so. @param {{ exitCode: number | null, error: string }} f */
export const commandMissing = (f) =>
  f.exitCode === 127 || f.exitCode === 9009 || /command not found|: not found\b|is not recognized as (?:an internal or external command|the name of a cmdlet)/i.test(f.error);

// The words that tell what went wrong.
const TELLS = /\b(error|errors|failed|failure|fatal|cannot|can't|could not|not found|not recognized|no such|denied|refused|missing|invalid|unknown|exception)\b/i;
// What a shell's result says about the output rather than in it: the exit code, and the shell hand's own notes.
const NOT_OUTPUT = /^(?:(?:command )?exit(?:ed)?(?: with)? (?:code|status)\b|\(no output\)$|Full output \(|\[Showing |\[Filament[:\]])/i;
/**
 * The line of a failed call's output that says what went wrong: the first that tells, else the first that is not a
 * script's echo (npm's `> pkg test`). The loop's `Error: ` before the output, and what is not output, are not lines.
 * @param {string} text
 */
export function errorLine(text) {
  const lines = String(text ?? "")
    .replace(/^Error: /, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOT_OUTPUT.test(l));
  return lines.find((l) => TELLS.test(l)) || lines.find((l) => !l.startsWith(">")) || lines[0] || "";
}

/**
 * The pitfall miner (M5-4), the bus's first observer. A shell call that failed, then a call of the same turn that ran
 * the same command set up another way and worked (`fixOf`), is a pitfall seen: the failed command's shape and what it
 * runs, with the setup as its right way. Filed through `brain.fileSeen`: an inferred claim, which another session's
 * sighting arms (M5-D2). A command that worked unchanged clears its failures: it failed for another reason (the code,
 * since fixed). Nothing is mined from a session that does not learn (`mayLearn`), one with no project, a call read
 * already (a resent leg), or a call whose words carry a secret.
 */
export class PitfallMiner {
  /** The failed shell calls of each recent turn, newest last. @type {Map<string, { command: string, exitCode: number | null, error: string }[]>} */
  #failed = new Map();
  /** The calls read, by id, so a resend is read once. @type {Set<string>} */
  #read = new Set();
  /**
   * @param {{ brain: () => any, mayLearn?: (chainId: string) => boolean, onFiled?: (projectId: string) => void, log?: (level: string, msg: string) => void }} o
   *   `brain`: the brain now (memory reopens); `onFiled`: a claim was added for a project (the curator's queue)
   */
  constructor({ brain, mayLearn = () => true, onFiled = () => {}, log = () => {} }) {
    this.brain = brain;
    this.mayLearn = mayLearn;
    this.onFiled = onFiled;
    this.log = log;
  }
  /** @param {ToolResult} e */
  async observe(e) {
    if (e?.type !== "tool.result" || triggerTool(e.tool) !== "bash" || !e.project || e.project === NO_PROJECT_ID || !e.chain) return;
    const command = commandOf(e.input);
    if (!command || (e.id && this.#read.has(e.id))) return;
    if (e.id) {
      this.#read.add(e.id);
      if (this.#read.size > 512) this.#read.delete(/** @type {string} */ (this.#read.values().next().value));
    }
    const key = `${e.project}\0${e.conversation ?? e.chain}\0${e.turn ?? ""}`;
    const list = this.#failed.get(key) || [];
    this.#failed.delete(key);
    // A command that went on in the background has not ended: it neither failed nor worked yet.
    if (e.background) {
      // kept as it was
    } else if (!e.ok) list.push({ command, exitCode: e.exitCode ?? null, error: String(e.error ?? "") });
    else {
      for (let i = list.length - 1; i >= 0; i--) if (same(spaced(list[i].command), spaced(command))) list.splice(i, 1);
      await this.#mine(e, list, command);
    }
    if (!list.length) return;
    this.#failed.set(key, list.slice(-8));
    if (this.#failed.size > 64) this.#failed.delete(/** @type {string} */ (this.#failed.keys().next().value));
  }
  /** A call that worked, against the turn's failures, newest first: the first it fixes is filed, and leaves the list. */
  async #mine(/** @type {ToolResult} */ e, /** @type {{ command: string, exitCode: number | null, error: string }[]} */ list, /** @type {string} */ command) {
    for (let i = list.length - 1; i >= 0; i--) {
      const fix = fixOf(list[i].command, command, { missing: commandMissing(list[i]) });
      if (!fix) continue;
      const [was] = list.splice(i, 1);
      if (carriesSecret(`${was.command}\n${command}`) || !this.mayLearn(/** @type {string} */ (e.chain))) return;
      const brain = this.brain();
      if (!brain) return;
      const why = clip(redactSecrets(errorLine(was.error)), 120);
      const exit = was.exitCode != null ? `exit ${was.exitCode}` : "an error";
      const text = `\`${fix.failed}\` failed here (${exit}${why ? `: ${why}` : ""}); \`${fix.worked}\` worked.`;
      const r = await brain.fileSeen({ projectId: e.project, chainId: e.chain, turnId: e.turn, text, trigger: { tool: "bash", shape: fix.shape, args: fix.args, unless: fix.unless } });
      this.log("info", `memory: a pitfall seen in session ${e.chain}: \`${fix.shape}\` worked as \`${clip(fix.unless, 60)} …\` (i${r.id}, ${r.filed})`);
      if (r.filed === "added") this.onFiled(/** @type {string} */ (e.project));
      return;
    }
  }
}
