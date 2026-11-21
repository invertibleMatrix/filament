// @ts-check
// The chat-command grammars: each command typed as the newest message of a chat. Parsing only — what a command does
// lives with the service that answers it. A parser that takes a command word parses a renamed command the same way.

/** A command word turned into the anchored, case-insensitive pattern that matches it at the head of a message. */
const commandPattern = (cmd) =>
  new RegExp(`^${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+([\\s\\S]*))?$`, "i");

/**
 * The first line of a message, and its argument text when it starts with `command`; null when it does not.
 * @param {unknown} text
 * @param {string} command
 * @returns {{ first: string, rest: string } | null}
 */
const headOf = (text, command) => {
  const first = String(text || "")
    .trim()
    .split(/\n/)[0]
    .trim();
  const m = commandPattern(command).exec(first);
  return m ? { first, rest: String(m[1] || "").trim() } : null;
};

/**
 * `/compact` typed as the newest message of a chat Filament runs: Compact now, by the session's own way. What follows
 * the word is kept, for the answer to say it was not passed on.
 * @param {unknown} text
 * @returns {{ raw: string, rest: string } | null}
 */
export function parseCompactCommand(text) {
  const head = headOf(text, "/compact");
  return head ? { raw: head.first, rest: head.rest } : null;
}

/**
 * @typedef {{ action: "set", text: string }
 *   | { action: "slice", text: string }
 *   | { action: "accept" | "show" | "done" | "abandon" | "go" | "hold" | "help" }
 *   | { action: "unknown", arg: string }} GoalCommand
 */

/**
 * `/goal …` — the goal layer (WP-I). `/goal <text>` proposes a goal (the text may run over several lines), `/goal accept`,
 * `/goal slice <text>`, `/goal status` (or a bare `/goal`), `/goal done`, `/goal abandon`, `/goal go`, `/goal hold`,
 * `/goal help`. `go` and `hold` alone, as the whole line (core/goal-drive.js): "/goal continue the migration" is a goal.
 * @param {unknown} text
 * @param {string} [command]
 * @returns {(GoalCommand & { raw: string, command: string }) | null}
 */
export function parseGoalCommand(text, command = "/goal") {
  const cmd = String(command || "/goal").trim() || "/goal";
  const whole = String(text || "").trim();
  const [firstLine, ...more] = whole.split(/\n/);
  const m = commandPattern(cmd).exec(firstLine.trim());
  if (!m) return null;
  const restFirst = String(m[1] || "").trim();
  const tail = more.join("\n").trim();
  const out = (fields) => ({ ...fields, raw: firstLine.trim(), command: cmd });
  const a0 = (restFirst.split(/\s+/)[0] || "").toLowerCase();
  const afterWord = restFirst.replace(/^\S+\s*/, "").trim();
  if (!restFirst && !tail) return out({ action: "show" });
  if (a0 === "status" || a0 === "show") return out({ action: "show" });
  if (a0 === "help" || a0 === "?") return out({ action: "help" });
  if (a0 === "accept" || a0 === "activate" || a0 === "start") return out({ action: "accept" });
  if (a0 === "done" || a0 === "finish" || a0 === "finished" || a0 === "complete") return out({ action: "done" });
  if (a0 === "abandon" || a0 === "drop" || a0 === "cancel" || a0 === "clear") return out({ action: "abandon" });
  const alone = !afterWord && !tail;
  if (alone && (a0 === "go" || a0 === "resume" || a0 === "continue" || a0 === "drive")) return out({ action: "go" });
  if (alone && (a0 === "hold" || a0 === "pause")) return out({ action: "hold" });
  if (a0 === "slice") {
    const t = [afterWord, tail].filter(Boolean).join("\n");
    return t ? out({ action: "slice", text: t }) : out({ action: "unknown", arg: "slice (needs the slice's text)" });
  }
  // `/goal <text>`: the wish, as typed.
  return out({ action: "set", text: [restFirst, tail].filter(Boolean).join("\n") });
}


// The settings commands (HarnessV3 Step 2 D9): fixed words, no config. `/set <name> <value>` takes the
// rest of the line as the value (a string knob can carry spaces; lists and JSON are typed as JSON).
/** @typedef {{ verb: "set" | "unset" | "settings", name: string, valueText: string, arg: string }} SettingsCommand */
/** @param {unknown} text @returns {SettingsCommand | null} */
export function parseSettingsCommand(text) {
  const whole = String(text || "").trim();
  const first = whole.split(/\n/)[0].trim();
  const m = /^\/(set|unset|settings)\b\s*([\s\S]*)$/i.exec(first);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const rest = m[2].trim();
  if (verb === "set") {
    const s = /^(\S+)\s*([\s\S]*)$/.exec(rest);
    if (!s) return { verb: "set", name: "", valueText: "", arg: "" };
    return { verb: "set", name: s[1], valueText: s[2].trim(), arg: rest };
  }
  if (verb === "unset") return { verb: "unset", name: rest.split(/\s+/)[0] || "", valueText: "", arg: rest };
  return { verb: "settings", name: "", valueText: "", arg: rest };
}

/** `/team …` (commands/team.js): the rest of the first line is the argument — a team's name may have spaces. */
export function parseTeamCommand(text) {
  const first = String(text || "").trim().split(/\n/)[0].trim();
  const m = /^\/teams?(?:\s+(.*))?$/i.exec(first);
  return m ? { arg: String(m[1] || "").trim() } : null;
}

/** `/graph …` (commands/graph.js): this session's task graph, shown; the rest of the first line is the argument. */
export function parseGraphCommand(text) {
  const head = headOf(text, "/graph");
  return head ? { arg: head.rest } : null;
}

/** `/autofit …`: the manual context-fit command — bare (fit with the 85% margin), `status` (the numbers, nothing
 *  written), or a margin 30–95 (`/autofit 70`). Parsing only; the engine lives in the sessions service. */
export function parseAutofitCommand(text, command = "/autofit") {
  const cmd = String(command || "/autofit").trim() || "/autofit";
  const head = headOf(text, cmd);
  if (!head) return null;
  const rest = head.rest.trim();
  return { rest, raw: head.first, command: cmd };
}

/**
 * @typedef {{ action: "launch", prompt: string, as: string | null, start: string | null, model: string | null, provider: string | null, effort: string | null, view: string | null, may: string | null, changes: string | null, worktree: boolean | null, workspace: "auto" | "patch" | "worktree" | "folder" | null, pause: boolean, inform: boolean, wait: boolean | null }
 *   | { action: "ask", id: string, prompt: string, changes: string | null, wait: boolean | null }
 *   | { action: "show" | "stop", id: string }
 *   | { action: "send", id: string }
 *   | { action: "apply", id: string }
 *   | { action: "changes", id: string }
 *   | { action: "list" | "help" }
 *   | { action: "unknown", arg: string }} SubagentCommand
 */

/**
 * The options `/subagent` takes before its task, always `key=value`: a bare word is the task's ("wait for the tests").
 * A value with spaces goes in quotes: `model="Kimi K3"` (HarnessV4_Tasks E23-D1).
 */
const SUBAGENT_OPTION = /^(as|start|model|provider|effort|view|may|changes|worktree|workspace|pause|inform|wait)=("[^"\n]*"|\S+)$/i;
/** What names a sub-agent's model and effort: a follow-up runs on its launch's (E23-D5). */
const SUBAGENT_MODEL_OPTIONS = Object.freeze(["model", "provider", "effort"]);
/** `type=` is no option: read as one it would open the task, and the launch would run as something else. */
const SUBAGENT_TYPE = /^type=\S+$/i;
/** `memory=` is no option now (the owner's of 11-09): memory's brief opens every sub-agent's task where the chat's
 *  memory is on. Read as the task's first word it would reach the sub-agent as an instruction, so it is said. */
const SUBAGENT_MEMORY = /^memory=\S+$/i;
const SUBAGENT_SWITCHES = new Set(["worktree", "pause", "inform", "wait"]);
/** What `workspace=` takes: the words of `subagents.workspace`. */
const SUBAGENT_WORKSPACES = Object.freeze(["auto", "patch", "worktree", "folder"]);
/** @type {Readonly<Record<string, boolean>>} */
const SWITCH_WORDS = Object.freeze({ on: true, yes: true, true: true, off: false, no: false, false: false });
const SUBAGENT_ID = /^sa_[0-9a-f]{8}$/i;
/** `/btw <question>` (HarnessV4_Tasks E15 step 5, BW-16): a side question — `/subagent start=ask <question>` by its
 *  shorter name. Its command says which word was typed. */
export const BTW_WORD = "/btw";

/**
 * `/subagent …` — launch a sub-agent from a chat Filament runs and follow it. `/subagent [as=<tag>] [start=ask|job|review]
 * [model=<m>] [provider=<p>] [effort=<e>] [view=<v>] [may=<read|copy|edit>] [changes=<running|turn|uncommitted|since:<ref>>]
 * [worktree=on|off] [workspace=auto|patch|worktree|folder] [pause=on] [inform=on] [wait=on|off] <task>` launches (the task may run over
 * several lines); `/subagent` or `/subagent list` lists this session's; `/subagent <id>` (or `status <id>`) shows one;
 * `stop <id>`; `send <id>` passes a report kept aside on to the session's agent; `changes <id>` shows what its own
 * worktree changed and `apply <id>` brings that into the session's folder; `ask <id> [changes=…] [wait=on|off]
 * <follow-up>` continues its conversation; `help`. The switches' words are read here; the other values are checked where they
 * are used. `/btw <question>` is the launch `start=ask <question>`, every word after it the question's; with none it
 * is not understood, and its `command` says which word that was.
 * @param {unknown} text
 * @param {string} [command]
 * @returns {(SubagentCommand & { raw: string, command: string }) | null}
 */
export function parseSubagentCommand(text, command = "/subagent") {
  const cmd = String(command || "/subagent").trim() || "/subagent";
  const whole = String(text || "").trim();
  const [firstLine, ...more] = whole.split(/\n/);
  const tail = more.join("\n").trim();
  const btw = commandPattern(BTW_WORD).exec(firstLine.trim());
  if (btw) {
    const question = [String(btw[1] || "").trim(), tail].filter(Boolean).join("\n");
    const typed = { raw: firstLine.trim(), command: BTW_WORD };
    if (!question) return { action: "unknown", arg: BTW_WORD, ...typed };
    return { action: "launch", prompt: question, as: null, start: "ask", model: null, provider: null, effort: null, view: null, may: null, changes: null, worktree: null, workspace: null, pause: false, inform: false, wait: null, ...typed };
  }
  const m = commandPattern(cmd).exec(firstLine.trim());
  if (!m) return null;
  const rest = String(m[1] || "").trim();
  /** @param {SubagentCommand} fields */
  const out = (fields) => ({ ...fields, raw: firstLine.trim(), command: cmd });
  const words = rest.split(/\s+/).filter(Boolean);
  const a0 = (words[0] || "").toLowerCase();
  if (!rest && !tail) return out({ action: "list" });
  if (a0 === "help" || a0 === "?") return out({ action: "help" });
  if (a0 === "list" && words.length === 1 && !tail) return out({ action: "list" });
  if (SUBAGENT_ID.test(a0) && words.length === 1 && !tail) return out({ action: "show", id: a0 });
  if (a0 === "status" || a0 === "show" || a0 === "stop" || a0 === "send" || a0 === "apply" || a0 === "changes") {
    const id = (words[1] || "").toLowerCase();
    if (!SUBAGENT_ID.test(id) || words.length !== 2 || tail) return out({ action: "unknown", arg: `${a0} (needs a sub-agent's id, sa_…, and nothing after it)` });
    if (a0 === "send") return out({ action: "send", id });
    if (a0 === "apply") return out({ action: "apply", id });
    if (a0 === "changes") return out({ action: "changes", id });
    return out({ action: a0 === "stop" ? "stop" : "show", id });
  }
  // Options and flags lead; the task is everything after them, its own spacing and lines kept.
  let task = rest;
  /** @type {{ as: string | null, start: string | null, model: string | null, provider: string | null, effort: string | null, view: string | null, may: string | null, changes: string | null, worktree: boolean | null, workspace: "auto" | "patch" | "worktree" | "folder" | null, pause: boolean, inform: boolean, wait: boolean | null }} */
  const o = { as: null, start: null, model: null, provider: null, effort: null, view: null, may: null, changes: null, worktree: null, workspace: null, pause: false, inform: false, wait: null };
  let asking = null;
  if (a0 === "ask") {
    const id = (words[1] || "").toLowerCase();
    if (!SUBAGENT_ID.test(id)) return out({ action: "unknown", arg: "ask (needs a sub-agent's id, sa_…, then the follow-up)" });
    asking = id;
    task = task.replace(/^\S+\s+\S+\s*/, "");
  }
  for (;;) {
    // One word, or an option whose value is in quotes.
    const w = /^(\w+="[^"\n]*"|\S+)\s*/.exec(task);
    if (w && !asking && SUBAGENT_TYPE.test(w[1])) return out({ action: "unknown", arg: `${w[1]} (type= is not an option: as=reviewer asks the Reviewer, who only reads, and may=read holds any launch to reading)` });
    if (w && SUBAGENT_MEMORY.test(w[1])) return out({ action: "unknown", arg: `${w[1]} (memory= is not an option: memory's brief opens every sub-agent's task while this chat's memory is on)` });
    const kv = w ? SUBAGENT_OPTION.exec(w[1]) : null;
    if (!w || !kv) break;
    const key = kv[1].toLowerCase();
    if (SUBAGENT_SWITCHES.has(key)) {
      const on = SWITCH_WORDS[kv[2].toLowerCase()];
      if (on === undefined) return out({ action: "unknown", arg: `${w[1]} (${key}= takes on or off)` });
      if (key === "worktree") o.worktree = on;
      else if (key === "wait") o.wait = on;
      else o[/** @type {"pause" | "inform"} */ (key)] = on;
    } else if (key === "workspace") {
      // Where it edits (the owner's plan of 11-09 for big repos): one of the four, as `subagents.workspace` takes.
      const where = kv[2].replace(/^"([^"]*)"$/, "$1").trim().toLowerCase();
      if (!SUBAGENT_WORKSPACES.includes(where)) return out({ action: "unknown", arg: `${w[1]} (workspace= takes ${SUBAGENT_WORKSPACES.join(", ")})` });
      o.workspace = /** @type {"auto" | "patch" | "worktree" | "folder"} */ (where);
    } else {
      const value = kv[2].replace(/^"([^"]*)"$/, "$1").trim();
      o[/** @type {"as" | "start" | "model" | "provider" | "effort" | "view" | "may" | "changes"} */ (key)] = value || null;
    }
    task = task.slice(w[0].length);
  }
  const prompt = [task.trim(), tail].filter(Boolean).join("\n");
  const naming = SUBAGENT_MODEL_OPTIONS.filter((k) => o[/** @type {"model" | "provider" | "effort"} */ (k)] != null);
  if (asking && naming.length) return out({ action: "unknown", arg: `ask (a follow-up runs on the model and the effort its launch gave it: leave ${naming.map((k) => `${k}=`).join(", ")} out, or launch a new sub-agent)` });
  if (asking) return prompt ? out({ action: "ask", id: asking, prompt, changes: o.changes, wait: o.wait }) : out({ action: "unknown", arg: "ask (needs the follow-up after the id)" });
  // A start may bring its own question (`start=catchup`): whether this one does is the command's to say.
  if (!prompt && !o.start) return out({ action: "unknown", arg: `${rest} (no task after the options)` });
  return out({ action: "launch", prompt, ...o });
}
