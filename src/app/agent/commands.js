// @ts-check
// A long command in the background for a coding agent (HarnessV4_Background_Plan, E34): Filament runs it, the agent goes
// on working, and the command's end comes back to it whole — beside the result of its next tool call while its turn
// runs (the registry's door, as a sub-agent's report goes in), else in a turn Filament sends the chat by itself (the wake
// of HarnessV4_Four_Plan E21), or with the person's next message after a Stop. Never sealed (BG-D2): the agent that
// started a command almost always needs its output, and an envelope would only add a round trip. Filament's own loop
// has bash_background for the same work.
import { ENV_WORDS, TIMED_OUT_CEILING_MS, onShellsChange, runningShells, runningShellsOf, shellNow, startCommandShell, stopShell, tellLater } from "../../adapters/tools/hands.js";
import { SHELL } from "../../adapters/tools/shell.js";
import { redactSecrets } from "../../core/redact.js";
import { listed } from "../../core/text.js";
import { TOOL_TEXT } from "./prompt.js";
import { COMMAND_MACHINE_FIELDS } from "./tools.js";
import { AGENTS_CHAT_THERE, NOT_OFFERED_THERE, createRemoteCommands, onMachine, thereForm, thereReply } from "./remote-commands.js";

export const BACKGROUND_COMMAND = "background_command";
/** The most of a command's output its end says (BG-D2): past it, the file with all of it. */
export const TAIL_LINES = 80;
export const TAIL_CHARS = 8000;
/** How long a start waits for a command that ends at once (a typo, a missing program): its answer is then the end. */
export const START_GRACE_MS = 1500;

/** The owner's words of 10-24 (BG-D7): use it for any command that can take more than a minute. */
export const BACKGROUND_COMMAND_TOOL = Object.freeze({
  name: BACKGROUND_COMMAND,
  description: `Run a command that can take more than a minute (a test suite, a build, an install, a long script) in the background through Filament while you keep working, instead of in the foreground or with your own shell's background option. It answers at once with the command's id, and runs in ${SHELL.name} in your project folder. ${ENV_WORDS} When the command ends, its result comes back to you whole (its exit code, how long it ran, the last lines of its output and the file with all of it): beside the result of your next tool call while your turn runs, or as a message from Filament once your turn has ended. Do not sleep or poll for it: go on with other work, or end your turn if only waiting is left. Before you start a server or a watcher, list to see whether one runs already.`,
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: `The command to start, as ${SHELL.name} runs it.` },
      description: { type: "string", description: "What it does, in a few words." },
      id: { type: "string", description: "A command you started: alone, its output so far; with stop: true, stops it (its result then never comes)." },
      stop: { type: "boolean", description: "With id: stop the command. Its result then never comes." },
      list: { type: "boolean", description: "true, alone: this chat's commands still running, each with its id." },
    },
  },
});
/**
 * The tool as a plain chat's agent is offered it where this Filament keeps a machine for its agents (the remote-agents
 * plan's c-tools), as its agent tool takes machine there: machine and cwd after its own.
 */
export const BACKGROUND_COMMAND_MACHINE_TOOL = Object.freeze({
  ...BACKGROUND_COMMAND_TOOL,
  description: `${BACKGROUND_COMMAND_TOOL.description} ${TOOL_TEXT.commandMachine}`,
  input_schema: { ...BACKGROUND_COMMAND_TOOL.input_schema, properties: { ...BACKGROUND_COMMAND_TOOL.input_schema.properties, ...COMMAND_MACHINE_FIELDS } },
});
/** A command with cwd and no machine: here it runs in the project folder. */
const CWD_HERE = "Not run: cwd names a folder on another machine, with machine: here a command runs in your project folder — cd in the command itself.";
/** A command on another machine this chat's switch or a rule of it refuses here: its mode is a ceiling there too. */
const REFUSED_HERE = "Not run: this chat's permission mode, or a rule of it, refuses this command — on another machine as here.";
/** The answer that settles a command's ask there once this chat's switch moves to read-only: a Deny. */
const READ_ONLY_DENY = Object.freeze({ outcome: /** @type {const} */ ("answered"), answers: { permission: { chosen: ["deny"] } }, reason: "this chat is read-only now" });

/** A command as its words show it: one line, at most 200 characters. @param {string} command */
const shown = (command) => {
  const one = String(command).replace(/\s+/g, " ").trim();
  return one.length > 200 ? `${one.slice(0, 199)}…` : one;
};
/** How long, in words: "4 s", "5 min 43 s", "1 h 2 min". @param {number} ms */
export const tookWords = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
/** A terminal's colour codes and title sequences: never words. */
const ESCAPES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
/**
 * The newest of a command's output as its end says it (BG-D2, case 12): colour codes gone, each line as its last redraw
 * left it (a progress bar's \r), the trailing blank lines dropped, then at most TAIL_LINES lines and TAIL_CHARS
 * characters from the end. `whole`: nothing of it was left out — not by the rolling tail the shell keeps, nor here.
 * @param {string} out  what the shell kept of it @param {number} produced  how many characters it printed in all
 */
export const tailOf = (out, produced) => {
  const lines = String(out)
    .replace(ESCAPES, "")
    .split(/\r?\n/)
    .map((l) => l.slice(l.lastIndexOf("\r") + 1));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  /** @type {string[]} */
  const kept = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < TAIL_LINES; i--) {
    const l = lines[i];
    if (chars + l.length + 1 > TAIL_CHARS) {
      // A last line longer than the whole budget is shown by its end, where the error is.
      if (!kept.length) kept.unshift(`…${l.slice(-(TAIL_CHARS - 1))}`);
      break;
    }
    kept.unshift(l);
    chars += l.length + 1;
  }
  return { text: kept.join("\n"), lines: kept.length, whole: kept.length === lines.length && kept[0] === lines[0] && produced <= String(out).length };
};

/**
 * A command's end as the agent reads it (BG-D2): which command, its code, how long it ran, then the newest of its
 * output, and the file with all of it where the output was cut. `agent`: the sub-agent that started it, for the
 * session's agent told of it once that sub-agent's run is over (h1) — null where the one told started it.
 * @param {import("../../adapters/tools/hands.js").ShellNow} end @param {string | null} [agent]
 */
export const endText = (end, agent = null) => {
  // One on another machine says which, and how it ended there where it did not exit on its own.
  const how = end.why ? `ended (${end.why})` : end.code == null ? "ended without an exit code" : `exited with code ${end.code}`;
  const took = tookWords((end.endedAt ?? Date.now()) - end.startedAt);
  const head = agent
    ? `[Filament: background command ${end.id}${end.machine ? ` on ${end.machine}` : ""}, started by sub-agent ${agent.replace(/^subagent:/, "")}, ended: \`${shown(end.command)}\` ${how} after ${took}.]`
    : `[Filament: your background command ${end.id}${end.machine ? ` on ${end.machine}` : ""} ended — \`${shown(end.command)}\` ${how} after ${took}.]`;
  return [head, ...outputLines(end, "")].join("\n");
};
/**
 * The newest of a command's output in lines: none, all of it, or its last lines and the file with the rest.
 * @param {import("../../adapters/tools/hands.js").ShellNow} s @param {string} sofar  " so far" for one still running
 * @returns {string[]}
 */
const outputLines = (s, sofar) => {
  const t = tailOf(s.out, s.produced);
  if (!t.text.trim()) return [`It printed nothing${sofar}.`];
  if (t.whole) return [`Its output${sofar}:`, t.text];
  return [`The last ${t.lines} line${t.lines === 1 ? "" : "s"} of its output${sofar}:`, t.text, ...(s.logPath ? [`All of its output${sofar}: ${s.logPath}`] : [])];
};

/**
 * Where a call stands (the AgentToolCtx's part it reads): the session, the agent's folder, and the chat's switch —
 * `permit`, which may ask; `judgeNow`, what it would answer now; `rulesAsk`, the rule of it that asks first for a call;
 * `modeNow`, its mode now, which a command on another machine is judged in there. `machines`: the agent is offered
 * machine (the remote-agents plan's c-tools), whose ask there `askPerson` puts to the person; `signal`, the call's own.
 * `agent`: the sub-agent whose call it is (`subagent:<id>`, h1), whose commands are its own; none for the session's agent.
 * @typedef {{ chain: string | null, cwd: string, permit?: ((calls: { name: string, input: any }[], what: string) => Promise<{ asked: boolean }>) | null,
 *   judgeNow?: ((calls: { name: string, input: any }[]) => "run" | "ask" | "refuse") | null, machines?: boolean,
 *   modeNow?: (() => string | null) | null,
 *   rulesAsk?: ((calls: { name: string, input: any }[]) => string | null) | null,
 *   askPerson?: ((form: import("../../adapters/agents/asks.js").AskForm, o: { signal?: AbortSignal | null, again?: (() => any) | null }) => Promise<any>) | null,
 *   signal?: AbortSignal | null, agent?: string | null }} CommandCtx
 */

/**
 * The sub-agents whose run hears its own commands' ends now (`attendCommands`), by session and sub-agent: each takes an
 * end into that run, `back` its way to the session's agent should the run end before it heard it.
 * @type {Map<string, (end: { id: string, command: string, code: number | null, text: string, back: () => void }) => void>}
 */
const hearing = new Map();
/** @param {import("../../adapters/tools/hands.js").ShellOwner} owner */
const hearingKey = (owner) => `${owner.session}\n${owner.agent ?? ""}`;
/**
 * The run of the sub-agent that started a command, where one hears its commands now: what someone else's stop of it —
 * the person's, the session's agent's — is said into (the bug hunt of 11-08: its run's wait for the command ended on
 * the stop with nothing heard, and it reported as though the command never ran), ahead of the stop, so the wait wakes
 * with it. Null for the session's agent's own, or a sub-agent whose run is over.
 * @param {import("../../adapters/tools/hands.js").ShellOwner} owner  who started it
 */
const starterHears = (owner) => (owner.agent !== null ? hearing.get(hearingKey(owner)) || null : null);
/** The most of a command its run's wait names it by. */
const WHY_CHARS = 60;
/**
 * How long a sub-agent's run waits for its own commands once its turn ended (the bug hunt of 11-08, T1 #3: a server or a
 * watcher never ends by itself, and held its run and whoever waited on its report for good): the hour Filament gives a
 * command its timeout sent to the background. A test suite or a build ends well within it; past it the run lets go.
 */
export const COMMANDS_HELD_MS = TIMED_OUT_CEILING_MS;

/**
 * A sub-agent's own background commands while its run lasts (h1, the owner's of 11-08: "nothing is lost, and Filament
 * sees everything"), as a turn's door into the registry is read (agent-inbox.js `AgentTurn`): the end of each command
 * it started goes into its run whole — beside its next tool call while it works, else as its next prompt in the same
 * run, as the main agent's goes into the chat's turn — and its run owes them, so it neither ends nor sends its report
 * while one of them still runs, for `heldMs` of waiting at most (COMMANDS_HELD_MS): past it the run lets go of them,
 * which run on — a stop could end a server its launcher wanted —, and the record says so. Once its run is over, what it
 * never heard and every later end go to the session's agent, the sub-agent named (`deliver`).
 * @param {import("../../adapters/tools/hands.js").ShellOwner} owner  the sub-agent, `subagent:<id>` of its session
 * @param {{ emit: (evt: any) => void, note: (text: string) => void, heldMs?: number }} o  `emit`: an event on its run;
 *   `note`: the record's line
 * @returns {import("../agent-inbox.js").AgentTurn}
 */
export function attendCommands(owner, { emit, note, heldMs = COMMANDS_HELD_MS }) {
  const key = hearingKey(owner);
  /** @typedef {{ id: string, command: string, code: number | null, text: string, back: () => void }} Heard */
  /** The ends it has not heard, the oldest first. @type {Heard[]} */
  const pending = [];
  /** What the newest take handed out, until the next: `unheard` puts it back. @type {Heard[]} */
  let handed = [];
  /** Who waits for an end to be heard. @type {Set<() => void>} */
  const bell = new Set();
  const ring = () => {
    for (const w of [...bell]) w();
  };
  /** Who waits for its commands to end, each its way to stop hearing them. @type {Set<() => void>} */
  const owing = new Set();
  let closed = false;
  /** Its run waited `heldMs` for its commands: it owes them no more. */
  let letGo = false;
  /** Its commands that still run. */
  const running = () => runningShellsOf(owner.session).filter((s) => s.agent === owner.agent);
  /** @param {Heard} end */
  const hear = (end) => {
    // One handed in as its run closed is the session's agent's, as what it never heard is.
    if (closed) return end.back();
    pending.push(end);
    ring();
  };
  hearing.set(key, hear);
  return {
    call: async (name) => ({ text: `Not run: Filament has no ${name} tool for this session.`, isError: true }),
    take() {
      handed = pending.splice(0);
      // Drawn as the shells' row (BG-D10), as a main agent's ends are.
      if (handed.length) {
        emit({ type: "shell-exit", shells: handed.map((d) => ({ id: d.id, command: d.command, code: d.code })) });
        note(`agent: ${handed.length === 1 ? "a background command's end" : `${handed.length} background commands' ends`} delivered to the sub-agent, whole`);
      }
      return handed.map((d) => d.text);
    },
    unheard() {
      pending.unshift(...handed.splice(0));
    },
    owes() {
      if (closed || letGo || !running().length) return null;
      const since = Date.now();
      return new Promise((resolve) => {
        const off = onShellsChange((session) => {
          if (session !== owner.session || running().length) return;
          stop();
          resolve(undefined);
        });
        // Its bound: what still runs is let go of, and the wait ends with nothing owed.
        const timer = setTimeout(() => {
          stop();
          const now = running();
          letGo = true;
          if (now.length) note(`agent: the sub-agent's run waited ${tookWords(Date.now() - since)} for its background command${now.length === 1 ? "" : "s"} ${now.map((s) => s.id).join(", ")} and ends without ${now.length === 1 ? "it: it runs on, its end" : "them: they run on, their ends"} going to the session's agent`);
          resolve(undefined);
        }, heldMs);
        timer.unref?.();
        const stop = () => {
          off();
          clearTimeout(timer);
          owing.delete(stop);
        };
        owing.add(stop);
      });
    },
    why() {
      const now = running();
      if (!now.length) return null;
      const one = shown(now[0].command);
      return now.length === 1 ? `waiting for its background command “${one.length > WHY_CHARS ? `${one.slice(0, WHY_CHARS - 1)}…` : one}” to end` : `waiting for its ${now.length} background commands to end`;
    },
    arrival: () =>
      pending.length
        ? Promise.resolve(undefined)
        : new Promise((resolve) => {
            const w = () => {
              bell.delete(w);
              resolve(undefined);
            };
            bell.add(w);
          }),
    waiting: () => null,
    spentUsd: () => 0,
    close() {
      if (closed) return;
      closed = true;
      if (hearing.get(key) === hear) hearing.delete(key);
      for (const stop of [...owing]) stop();
      // What its run ended before it heard is the session's agent's, as every later end is.
      const back = pending.splice(0);
      for (const d of back) d.back();
      if (back.length) note(`agent: ${back.length === 1 ? "a background command's end" : `${back.length} background commands' ends`} never reached the sub-agent (its run ended first) and ${back.length === 1 ? "goes" : "go"} to the session's agent`);
      ring();
    },
  };
}

/**
 * The background commands of the coding agents' sessions (BG3). `registry`: the sub-agents' registry, read at each end
 * (it is built after the tools), whose door hands an end into the running turn. `machines`: the machines this Filament
 * is paired with, where a command on another runs (remote-commands.js); `agentsChat`, whether another machine's agents
 * started a chat — none of its commands runs on another machine.
 * @param {{ registry?: () => { commandEnd?: (chainId: string, r: { id: string, command: string, code: number | null, text: string, back?: (() => void) | null }) => { ok: boolean } } | null, log?: (level: string, msg: string) => void, graceMs?: number,
 *   machines?: import("../../services/machines/index.js").Machines | null, agentsChat?: (chain: string) => boolean }} [o]
 */
export function createBackgroundCommands({ registry = () => null, log = () => {}, graceMs = START_GRACE_MS, machines = null, agentsChat = () => false } = {}) {
  const remote = machines ? createRemoteCommands({ machines }) : null;
  /**
   * A command's end to the agent that started it (BG-D3, BG-D4): into its running turn, whole; else — no turn reads
   * Filament's inbox now, or the one that took it ended before it read it — told as a shell's exit is, in these words:
   * with the chat's next turn, and the chat woken where no turn runs. A sub-agent's goes into its own run while that
   * lasts (h1, `attendCommands`); after, to the session's agent the same way, the sub-agent named.
   * @param {string} chain @param {import("../../adapters/tools/hands.js").ShellOwner} owner @param {import("../../adapters/tools/hands.js").ShellNow} end
   */
  const deliver = (chain, owner, end) => {
    const command = shown(end.command);
    const hear = owner.agent !== null ? hearing.get(hearingKey(owner)) : null;
    if (hear) {
      hear({ id: end.id, command, code: end.code, text: endText(end), back: () => toSession(chain, owner, end) });
      log("info", `background commands: ${end.id} in ${chain} ended (code ${end.code ?? "none"}) — into ${owner.agent}'s run`);
      return;
    }
    toSession(chain, owner, end);
  };
  /**
   * The end to the session's agent, a sub-agent's named. @param {string} chain
   * @param {import("../../adapters/tools/hands.js").ShellOwner} owner @param {import("../../adapters/tools/hands.js").ShellNow} end
   */
  const toSession = (chain, owner, end) => {
    const text = endText(end, owner.agent);
    const command = shown(end.command);
    const later = () => tellLater(owner, { id: end.id, command, code: end.code, text });
    /** @type {{ ok: boolean } | null | undefined} */
    let r = null;
    try {
      r = registry()?.commandEnd?.(chain, { id: end.id, command, code: end.code, text, back: later });
    } catch (/** @type {any} */ e) {
      log("warn", `background commands: ${end.id}'s end could not go into ${chain}'s running turn (${e?.message || e})`);
    }
    if (!r?.ok) later();
    log("info", `background commands: ${end.id} in ${chain} ended (code ${end.code ?? "none"}) — ${r?.ok ? "into the running turn" : "told with the chat's next turn"}`);
  };

  return {
    /**
     * One call of the tool: start a command, or read or stop one started before.
     * @param {any} args @param {CommandCtx} ctx @returns {Promise<{ text: string, isError?: boolean }>}
     */
    async call(args, ctx) {
      const chain = ctx.chain;
      if (!chain) return { text: "Not run: this session is no chat of Filament's, so no turn could hear the command's end.", isError: true };
      // A sub-agent's commands are its own (h1): it reads and stops them alone, as a shell's rule says, and hears their ends.
      const owner = { session: chain, agent: ctx.agent ?? null };
      const id = String(args?.id ?? "").trim();
      const command = typeof args?.command === "string" ? args.command : "";
      if (args?.list === true) return id || command.trim() || args?.stop === true ? { text: "Not run: list goes alone — no command, id or stop with it.", isError: true } : { text: listText(chain, owner.agent) };
      if (id && command.trim()) return { text: "Not run: give command to start one, or id to read or stop one — not both.", isError: true };
      if (args?.stop === true && !id) return { text: "Not run: stop needs the id of the command to stop.", isError: true };
      if (id) return args?.stop === true ? stopOne(id, owner) : readOne(id, owner);
      if (!command.trim()) return { text: "Not run: command is required — the command to start in the background.", isError: true };
      if (!ctx.cwd) return { text: "Not run: Filament does not know this session's folder, so it has nowhere to run the command.", isError: true };
      const machine = onMachine(args);
      // Where machine is offered, cwd without it is refused; elsewhere it is no field of the tool's, and goes unread.
      if (!machine && args?.cwd != null && String(args.cwd).trim() && remote && ctx.machines && !agentsChat(chain)) return { text: CWD_HERE, isError: true };
      const calls = [{ name: "bash_background", input: { command } }];
      if (machine) {
        // On another machine (the remote-agents plan's c-tools): offered where the agent's agent tool takes machine, and
        // this chat's switch a ceiling — read-only or a deny rule refuses it here, an ask or a review rule asks on this
        // chat's card first (`rulesAsk`) —; its mode judges it there (`modeNow`), capped by that machine's grants, its ask
        // on this chat's card too.
        const why = !remote || !ctx.machines ? NOT_OFFERED_THERE : agentsChat(chain) ? AGENTS_CHAT_THERE : !ctx.judgeNow || !ctx.askPerson ? "Not run: no turn of this chat runs now to judge the call." : ctx.judgeNow(calls) === "refuse" ? REFUSED_HERE : null;
        if (why) return { text: why, isError: true };
      } else {
        // Judged as the bash call it is, by the chat's switch (BG-D5): read-only refuses, Edit asks, Full access runs.
        if (!ctx.permit) return { text: "Not run: no turn of this chat runs now to judge the call.", isError: true };
        try {
          await ctx.permit([{ name: "bash", input: { command } }], `run in the background: ${shown(command)}`);
        } catch (/** @type {any} */ e) {
          return { text: `Not run: ${String(e?.message || e)}.`, isError: true };
        }
      }
      // An end that comes before the start answers is the start's answer (case 8); after it, it is delivered.
      /** @type {import("../../adapters/tools/hands.js").ShellNow | null} */
      let early = null;
      let starting = true;
      /** @param {import("../../adapters/tools/hands.js").ShellNow} end */
      const onEnd = (end) => {
        if (starting) early = end;
        else deliver(chain, owner, end);
      };
      /** @type {import("../../adapters/tools/hands.js").ShellNow} */
      let s;
      /** Whether one there still waits on the person's press. */
      let waits = () => false;
      try {
        // Its ask there is the person's to answer by a press on this chat's card; this chat's switch moving to read-only
        // denies it, and moving elsewhere waits on.
        /** @type {import("./remote-commands.js").AskHere} */
        const ask = async (q, gone) => {
          const form = thereForm(q, { tool: BACKGROUND_COMMAND });
          const again = () => (ctx.judgeNow?.(calls) === "refuse" ? READ_ONLY_DENY : null);
          const r = thereReply(await /** @type {NonNullable<CommandCtx["askPerson"]>} */ (ctx.askPerson)(form, { signal: ctx.signal ? AbortSignal.any([ctx.signal, gone]) : gone, again }));
          return r === "switched" ? null : r;
        };
        // There, its start answers as soon as an ask waits (`early`): this call ends then, and the ask waits on (the owner's
        // of 11-10: an agent's call that waited on the card timed out on its side, and its ask there was cut with it).
        if (machine && remote) {
          const r = await remote.start({ machine, cwd: args?.cwd ?? null, command }, { folder: ctx.cwd, owner, ask, rule: ctx.rulesAsk?.(calls) ?? null, signal: ctx.signal ?? null, onEnd, log: true, early: true, mode: ctx.modeNow?.() ?? null });
          waits = r.waits;
          s = shellNow(r.id, owner);
        } else s = startCommandShell(command, ctx.cwd, owner, { onEnd });
      } catch (/** @type {any} */ e) {
        const said = String(e?.message || e);
        return { text: machine ? (/^Not run\b/.test(said) ? said : `Not run: ${said}`) : `Not run: the command could not start (${said}).`, isError: true };
      }
      const until = Date.now() + graceMs;
      while (!early && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      starting = false;
      if (early) return { text: endText(early) };
      log("info", `background commands: ${s.id} started in ${chain}${s.machine ? ` on ${s.machine}` : ""}`);
      let now = s;
      try {
        now = shellNow(s.id, owner);
      } catch {}
      const on = s.machine ? ` on ${s.machine}` : "";
      return {
        text: [
          `Started background command ${s.id}${on}: \`${shown(command)}\`, in ${s.cwd}.${s.machine ? ` Filament on ${s.machine} stops it ${tookWords(TIMED_OUT_CEILING_MS)} after it started there.` : ""}${waits() ? ` It waits for the person's press on this chat's permission card before it runs there: their Allow runs it, and their Deny, or a wait that is cut, ends it in words.` : ""} Go on with your work: when it ends, its result reaches you whole — beside the result of your next tool call while your turn runs, or as a message from Filament once your turn has ended. Don't sleep or poll for it.`,
          `Its output so far: ${BACKGROUND_COMMAND}({ id: "${s.id}" }). Stop it: ${BACKGROUND_COMMAND}({ id: "${s.id}", stop: true }).`,
          ...(tailOf(now.out, now.produced).text.trim() ? outputLines(now, " so far") : []),
        ].join("\n"),
      };
    },
  };
}

/**
 * A running command as the page shows it (HarnessV4_Background_Plan E38-D2): its command in one line, its folder, when
 * it started, the agent that started it (null for the chat's own), its newest line of output — colours and a progress
 * bar's redraws out, "" for none yet — and the file with all of its output, where one is kept; `machine`, the machine it
 * runs on, where that is another (the remote-agents plan's c-tools).
 * @typedef {{ id: string, command: string, cwd: string, startedAt: number, agent: string | null, line: string, logPath: string | null, machine?: string }} CommandRow
 */
/** The newest line a row shows: at most this many characters, its end kept. */
const LINE_CHARS = 160;
/** @param {import("../../adapters/tools/hands.js").RunningShell} s @returns {CommandRow} */
export const commandRow = (s) => {
  const last = tailOf(s.out, s.produced).text.split("\n").at(-1)?.trim() || "";
  return { id: s.id, command: shown(s.command), cwd: s.cwd, startedAt: s.startedAt, agent: s.agent, line: last.length > LINE_CHARS ? `…${last.slice(-(LINE_CHARS - 1))}` : last, logPath: s.logPath, ...(s.machine ? { machine: s.machine } : {}) };
};
/** A chat's running commands, the oldest first. @param {string} chain @returns {CommandRow[]} */
export const commandsOf = (chain) => runningShellsOf(chain).map(commandRow).sort((a, b) => a.startedAt - b.startedAt);
/** Every chat's running commands, each chat with one at least: the five-second holders read (E38-D4). */
export const allCommands = () => [...runningShells()].map(([chainId, list]) => ({ chainId, commands: list.map(commandRow).sort((a, b) => a.startedAt - b.startedAt) }));
/**
 * A chat's commands as its agent's wait waits for them, beside its sub-agents (agent-inbox.js; the gap of 11-10: a
 * wait with only `npm install` running answered "Nothing to wait for"): those whose end reaches the session's agent —
 * its own, and a sub-agent's whose run no longer hears its own (h1) — still running, the oldest first; and the moment
 * one of them runs no more, its end handed in first, or stopped and gone. One that exited and still drains its output
 * runs on here: its end is on its way. @param {string} chain @returns {import("../agent-inbox.js").WaitedCommands}
 */
export const waitedCommands = (chain) => {
  /** @param {string} id */
  const over = (id) => {
    try {
      return shellNow(id, { session: chain, agent: null }).endedAt != null;
    } catch {
      return true;
    }
  };
  return {
    running: () => commandsOf(chain).filter((r) => !starterHears({ session: chain, agent: r.agent })),
    ended(ids) {
      /** @type {() => void} */
      let off = () => {};
      /** @type {Promise<string[]>} */
      const ended = new Promise((resolve) => {
        off = onShellsChange((session) => {
          if (session !== chain || !ids.some(over)) return;
          off();
          resolve(ids.filter(over));
        });
      });
      return { ended, off };
    },
  };
};
/** Commands as a wait names them: each by its id and its command, cut short. @param {readonly CommandRow[]} rows */
export const commandsNamed = (rows) => `the background command${rows.length === 1 ? "" : "s"} ${listed(rows.map((r) => `${r.id} (\`${r.command.length > WHY_CHARS ? `${r.command.slice(0, WHY_CHARS - 1)}…` : r.command}\`)`))}`;
/**
 * A chat's commands that run, as its record keeps them (`shellsRunning` in its meta), written at each start and end:
 * what the next start of Filament tells the chat it no longer follows (`tellStoppedCommands`). The meta is plain text
 * in the archive: a command's secrets are redacted before it is kept. @param {string} chain
 */
export const runningRecord = (chain) => runningShellsOf(chain).map((s) => ({ id: s.id, command: redactSecrets(shown(s.command)), startedAt: s.startedAt, agent: s.agent }));
/**
 * As Filament starts: each chat whose commands ran as it last stopped is told, with its next turn — never woken for
 * it —, that Filament no longer follows them, and the record goes. Filament's own stop ends them; one that died
 * abruptly may have left them running, so the words ask the agent to look before it starts one again. Each is told,
 * however many: past the shells' cap on what waits untold too (hands.js `tellLater`'s `capped`). Answers how many
 * were told.
 * @param {{ shellsRunning: () => { id: string, shells: any[] }[], mergeMeta: (chainId: string, patch: Record<string, any>) => any }} archive
 * @param {number} [now]
 */
export function tellStoppedCommands(archive, now = Date.now()) {
  let n = 0;
  for (const { id, shells } of archive.shellsRunning()) {
    for (const s of shells) {
      if (!s?.id) continue;
      const command = shown(String(s.command || ""));
      const since = Number(s.startedAt) > 0 ? `, started ${tookWords(now - Number(s.startedAt))} ago,` : "";
      const text = `[Filament: background command ${s.id} (\`${command}\`)${since} was running when Filament last stopped: Filament no longer follows it, and its result will not come. A clean stop of Filament ends its commands, but a stop cut short may have left this one running — look (its port, its process) before you start it again.]`;
      tellLater({ session: id, agent: typeof s.agent === "string" ? s.agent : null }, { id: String(s.id), command, code: null, text }, { wake: false, capped: false });
      n++;
    }
    archive.mergeMeta(id, { shellsRunning: undefined });
  }
  return n;
}
/**
 * The person's Stop on a chat's running command (E38-D3): it stops with what it started, and the agent that started it
 * is told with its next turn — never woken for it —, since it may be counting on the result. Refused in words where the
 * chat has no such command running.
 * @param {string} chain @param {string} id
 * @returns {Promise<{ ok: true, command: CommandRow } | { ok: false, error: string }>}
 */
export async function stopByPerson(chain, id) {
  const s = runningShellsOf(chain).find((x) => x.id === id);
  if (!s) return { ok: false, error: `“${String(id).slice(0, 40)}” is not running in this chat: it ended, or it was stopped.` };
  const row = commandRow(s);
  const owner = { session: chain, agent: s.agent };
  const text = `[Filament: background command ${id} (\`${row.command}\`)${row.machine ? ` on ${row.machine}` : ""} was stopped by the person after ${tookWords(Date.now() - s.startedAt)}.]`;
  const later = () => tellLater(owner, { id, command: row.command, code: null, text }, { wake: false });
  // A sub-agent's run that hears its commands hears it as it stops (`starterHears`); else the agent's next turn does.
  const into = starterHears(owner);
  into?.({ id, command: row.command, code: null, text, back: later });
  try {
    await stopShell(id, { session: chain, agent: null });
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `It could not be stopped: ${String(e?.message || e)}.` };
  }
  if (!into) later();
  return { ok: true, command: row };
}

/**
 * The chat's commands still running, as `list` answers: each its id, its command, its folder, how long it has run and
 * its newest line of output — whichever agent of the chat started it, named where it is not the caller (the bug hunt of
 * 11-08: a sub-agent read the session's agent's as its own), and a sub-agent told it reads and stops its own alone, as
 * the shells' rule says. @param {string} chain @param {string | null} agent  the caller, `subagent:<id>`; null for the session's agent
 */
const listText = (chain, agent) => {
  const rows = commandsOf(chain);
  if (!rows.length) return "None of this chat's background commands runs now.";
  const now = Date.now();
  const whose = (/** @type {string | null} */ a) => (a === agent ? "" : a ? `, started by sub-agent ${a.replace(/^subagent:/, "")}` : ", started by the session's agent");
  const line = (/** @type {CommandRow} */ r) => `- ${r.id}: \`${r.command}\`${r.machine ? ` on ${r.machine}` : ""} in ${r.cwd}, running for ${tookWords(now - r.startedAt)}${whose(r.agent)}${r.line ? ` — its newest line: ${r.line}` : ""}`;
  const others = agent !== null && rows.some((r) => r.agent !== agent);
  const how = others
    ? `Read one of yours: ${BACKGROUND_COMMAND}({ id }). Stop one of yours: ${BACKGROUND_COMMAND}({ id, stop: true }). Another agent's are its own to read and stop.`
    : `Read one: ${BACKGROUND_COMMAND}({ id }). Stop one: ${BACKGROUND_COMMAND}({ id, stop: true }).`;
  return [`${rows.length === 1 ? "One background command runs" : `${rows.length} background commands run`} in this chat now, the oldest first:`, ...rows.map(line), how].join("\n");
};

/** A command Filament no longer keeps, in words the agent can act on. @param {string} id */
const gone = (id) =>
  `No background command "${id}" in this chat: it ended more than 5 minutes ago (its result reached you then), it was stopped, or Filament restarted since.`;

/** Its output so far, or its end (BG-D9). @param {string} id @param {import("../../adapters/tools/hands.js").ShellOwner} owner */
const readOne = async (id, owner) => {
  /** @type {import("../../adapters/tools/hands.js").ShellNow} */
  let s;
  try {
    s = shellNow(id, owner);
  } catch {
    return { text: gone(id), isError: true };
  }
  if (!s.running) return { text: endText(s) };
  return { text: [`[${id} is still running${s.machine ? ` on ${s.machine}` : ""}, for ${tookWords(Date.now() - s.startedAt)}: \`${shown(s.command)}\`.]`, ...outputLines(s, " so far")].join("\n") };
};

/** Stop it: its result never comes (BG-D6, case 9). @param {string} id @param {import("../../adapters/tools/hands.js").ShellOwner} owner */
const stopOne = async (id, owner) => {
  /** @type {import("../../adapters/tools/hands.js").ShellNow} */
  let s;
  try {
    s = shellNow(id, owner);
  } catch {
    return { text: gone(id), isError: true };
  }
  if (!s.running) return { text: `${id} had already ended, so there was nothing to stop.\n${endText(s)}` };
  // The session's agent stopping a sub-agent's: that sub-agent's run, waiting on it, hears it (`starterHears`).
  const by = owner.agent === null ? runningShellsOf(owner.session).find((x) => x.id === id)?.agent ?? null : null;
  const into = by ? starterHears({ session: owner.session, agent: by }) : null;
  const command = shown(s.command);
  into?.({ id, command, code: null, text: `[Filament: background command ${id} (\`${command}\`) was stopped by the session's agent after ${tookWords(Date.now() - s.startedAt)}.]`, back: () => {} });
  try {
    await stopShell(id, owner);
  } catch (/** @type {any} */ e) {
    return { text: `Not stopped: ${String(e?.message || e)}.`, isError: true };
  }
  return { text: [`Stopped background command ${id} (\`${shown(s.command)}\`)${s.machine ? ` on ${s.machine}` : ""} after ${tookWords(Date.now() - s.startedAt)}: its result will not come.`, ...outputLines(s, " before the stop")].join("\n") };
};
