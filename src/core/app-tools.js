// @ts-check
// An app's tools (the owner's of 11-05): commands an app offers the agents of its Space, each with a line on what it
// does and the arguments an agent fills — on no row, as a button is, and pressed by no person. They are in no chat's
// tool list: an agent finds them through the space tool's `app` action (`"tools": true` lists an app's, `"tool"` runs
// one), so a chat's tools stay the same bytes whatever apps its Space keeps. Each runs as a button's command does — no
// shell, each argument one part of its argv, checked first — once the person keeps the version that declares it: its
// command, its arguments' bounds and its effect are part of the Keep (core/dashboard-sources.js `grantOf`), and a
// script it runs is pinned as a button's is. Its description and its arguments' lines are words, so no part of it.
// Pure: no I/O.

/** How many tools an app may declare, how many arguments one takes, and how long their lines may be. */
export const TOOLS_MAX = 12;
export const TOOL_ARGS_MAX = 6;
export const TOOL_ABOUT_MAX = 300;
export const ARG_ABOUT_MAX = 200;
/** The most parts of a tool's command, and how long one part, or one value an agent fills, may be. */
const ARGV_MAX = 40;
const PART_MAX = 1000;
/** How many choices an argument may offer. */
const CHOICES_MAX = 30;
/**
 * What a tool does: `reads` only reads — an agent runs it in any mode, unasked; `writes` changes files or programs on
 * this machine — judged by its chat's mode, as a command is; `sends` leaves this machine — an agent's run of it always
 * asks the person. `writes` where it says nothing.
 */
export const TOOL_EFFECTS = Object.freeze(/** @type {const} */ (["reads", "writes", "sends"]));
/** A tool's name and an argument's: as an agent writes it in a call. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ARG_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** An argument's place in a command's part. */
const ARG_PLACE = /\{args\.([A-Za-z0-9_]+)\}/g;
/** A group that repeats, holding a repeat: (\w+\s?)+, (a*)*, (x+){2,}. */
const NESTED_REPEAT = /\([^()]*(?:[+*]|\{\d+,\d*\})[^()]*\)\s*(?:[+*]|\{\d+,\d*\})/;
/** A button's placeholders, which a tool has no row or form to fill. */
const BUTTON_PLACE = /\{(row|ask)\./;

/**
 * @typedef {{ about: string, required: boolean, choices: string[] | null, pattern: string }} ToolArg  an argument as kept:
 *   its line, whether a run needs it, its choices or the pattern its value must match
 * @typedef {{ description: string, args: Record<string, ToolArg>, command: string[], effect: "reads" | "writes" | "sends" }} AppTool
 *   a tool as kept
 * @typedef {{ command: string[], args: { name: string, required: boolean, choices: string[] | null, pattern: string }[],
 *   effect: "reads" | "writes" | "sends" }} GrantTool  what a Keep lets a tool do: its command, its arguments' bounds and
 *   its effect — its words are not in it
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * What is wrong with one argument, as the words after its name; "" where nothing is.
 * @param {unknown} a
 */
function argFault(a) {
  if (!isObject(a)) return 'is no object: {"description":"The run\'s id","required":true,"pattern":"^[0-9]+$"}';
  if (typeof a.description !== "string" || !a.description.trim() || a.description.length > ARG_ABOUT_MAX) return `has no description: what an agent puts there, ${ARG_ABOUT_MAX} characters at most`;
  if (a.required != null && typeof a.required !== "boolean") return "has required that is neither true nor false";
  if (a.choices != null && (!Array.isArray(a.choices) || !a.choices.length || a.choices.length > CHOICES_MAX || a.choices.some((c) => typeof c !== "string" || !c || c.length > 200 || c.startsWith("-"))))
    return `has choices that are no list of words (${CHOICES_MAX} at most, none starting with "-")`;
  if (a.pattern != null) {
    if (typeof a.pattern !== "string" || !a.pattern || a.pattern.length > 200) return "has a pattern that is no pattern (200 characters at most)";
    try {
      new RegExp(a.pattern);
    } catch {
      return `has ${JSON.stringify(a.pattern)}, which is no pattern`;
    }
    // A repeat inside a repeat can take a value of a few dozen letters forever, on the server's one thread, as an
    // agent's call is judged (found by the review of 11-05).
    if (NESTED_REPEAT.test(a.pattern)) return `has ${JSON.stringify(a.pattern)}, a repeat inside a repeat, which can run forever on a long value: write it with one`;
  }
  return "";
}

/**
 * What is wrong with one tool, as the words after its name; "" where nothing is.
 * @param {unknown} t
 */
function toolFault(t) {
  if (!isObject(t)) return 'is no object: a tool is {"description":"The last lines of a CI run\'s log","args":{"run":{"description":"The run\'s id","required":true}},"command":["node","tools/ci-log.mjs","{args.run}"],"effect":"reads"}';
  if (typeof t.description !== "string" || !t.description.trim() || t.description.length > TOOL_ABOUT_MAX) return `has no description: what it does and gives back, for the agents that use it, ${TOOL_ABOUT_MAX} characters at most`;
  const args = t.args ?? {};
  if (!isObject(args) || Object.keys(args).length > TOOL_ARGS_MAX) return `has args that are no object of named arguments (${TOOL_ARGS_MAX} at most)`;
  for (const [name, a] of Object.entries(args)) {
    if (!ARG_NAME.test(name)) return `has the argument "${name.slice(0, 40)}": a name of letters, digits and _, a letter first`;
    const fault = argFault(a);
    if (fault) return `has the argument ${name}, which ${fault}`;
  }
  const argv = t.command;
  if (!Array.isArray(argv) || !argv.length) return 'has no command: a list of the program and its arguments, ["node","tools/ci-log.mjs","{args.run}"] — no shell runs it';
  if (argv.length > ARGV_MAX) return `has ${argv.length} parts to its command: ${ARGV_MAX} at most`;
  const bad = argv.findIndex((x) => typeof x !== "string" || x.length > PART_MAX || /[\0\r\n]/.test(x));
  if (bad >= 0) return `has a command whose part ${bad + 1} is no line of text (${PART_MAX} characters at most)`;
  if (!argv[0].trim() || /\{/.test(argv[0])) return "has a command with no program first: the program is written out, never an argument";
  const button = argv.find((p) => BUTTON_PLACE.test(p));
  if (button) return `has ${JSON.stringify(button.slice(0, 60))}: a tool runs on no row and asks no form — its arguments go in as {args.<name>}`;
  const used = new Set(argv.flatMap((p) => [...p.matchAll(ARG_PLACE)].map((m) => m[1])));
  const unknown = [...used].find((n) => !Object.prototype.hasOwnProperty.call(args, n));
  if (unknown) return `has {args.${unknown}}, an argument its args do not have${Object.keys(args).length ? ` (${Object.keys(args).join(", ")})` : ""}`;
  const unused = Object.keys(args).find((n) => !used.has(n));
  if (unused) return `takes ${unused}, which its command does not use: put {args.${unused}} where it goes`;
  if (t.effect != null && !TOOL_EFFECTS.includes(t.effect))
    return `has the effect ${JSON.stringify(t.effect)}: give "reads" (it only reads), "writes" (it changes files or programs on this machine) or "sends" (it leaves this machine)`;
  return "";
}

/**
 * The tools a publish declares (`tools`: each by its name), as kept, or what is wrong, in words.
 * @param {unknown} v
 * @returns {{ ok: true, tools: Record<string, AppTool> | null } | { ok: false, error: string }}
 */
export function appToolsOf(v) {
  if (v == null) return { ok: true, tools: null };
  if (!isObject(v) || !Object.keys(v).length || Object.keys(v).length > TOOLS_MAX)
    return { ok: false, error: `tools is an object of each tool the app offers its Space's agents, by its name, ${TOOLS_MAX} at most: {"ci_log":{"description":"The last lines of a CI run's log","args":{"run":{"description":"The run's id","required":true}},"command":["node","tools/ci-log.mjs","{args.run}"],"effect":"reads"}}` };
  /** @type {Record<string, AppTool>} */
  const out = {};
  for (const [name, t] of Object.entries(v)) {
    if (!TOOL_NAME.test(name)) return { ok: false, error: `the tool "${name.slice(0, 40)}" needs a name of lowercase letters, digits and _, a letter first (40 at most)` };
    const fault = toolFault(t);
    if (fault) return { ok: false, error: `the tool ${name} ${fault}` };
    out[name] = appToolKept(t);
  }
  return { ok: true, tools: out };
}

/** A tool as kept, its defaults filled. @param {any} t @returns {AppTool} */
export function appToolKept(t) {
  /** @type {Record<string, ToolArg>} */
  const args = {};
  for (const [name, a] of Object.entries(isObject(t?.args) ? t.args : {}))
    args[name] = { about: String(a?.description ?? a?.about ?? "").trim(), required: a?.required === true, choices: Array.isArray(a?.choices) ? a.choices.map(String) : null, pattern: typeof a?.pattern === "string" ? a.pattern : "" };
  return {
    description: String(t?.description ?? "").trim(),
    args,
    command: Array.isArray(t?.command) ? t.command.map(String) : [],
    effect: TOOL_EFFECTS.includes(t?.effect) ? t.effect : "writes",
  };
}

/** What a Keep lets a tool do (`grantOf`). @param {any} t @returns {GrantTool} */
export function grantToolOf(t) {
  const k = appToolKept(t);
  return { command: k.command, args: Object.entries(k.args).map(([name, a]) => ({ name, required: a.required, choices: a.choices, pattern: a.pattern })), effect: k.effect };
}

/**
 * A tool's arguments as JSON Schema, as an agent reads them when it lists the app's tools: each a string, its line,
 * its choices or its pattern, and the ones a run needs.
 * @param {AppTool} k
 */
export function appToolSchema(k) {
  const props = Object.fromEntries(
    Object.entries(k.args).map(([name, a]) => [name, { type: "string", description: a.about, ...(a.choices ? { enum: a.choices } : {}), ...(a.pattern ? { pattern: a.pattern } : {}) }]),
  );
  const required = Object.entries(k.args).filter(([, a]) => a.required).map(([name]) => name);
  return { type: "object", properties: props, ...(required.length ? { required } : {}), additionalProperties: false };
}

/**
 * A tool's command filled with an agent's arguments: each value one part's, checked first — a value that starts with
 * "-", is no line of text or longer than 1000 characters, is none of its choices or does not match its pattern, a
 * needed one left out, an argument the tool does not take: refused in words. A part whose argument is left out is left
 * out whole, so a flag and its value go in one part ("--lines={args.lines}").
 * @param {AppTool} k @param {unknown} given  the call's `args`
 * @returns {{ ok: true, argv: string[] } | { ok: false, error: string }}
 */
export function fillAppTool(k, given) {
  const args = isObject(given) ? given : {};
  const names = Object.keys(k.args);
  const odd = Object.keys(args).find((n) => !names.includes(n));
  if (odd) return { ok: false, error: `it takes no argument ${odd.slice(0, 40)}: ${names.length ? `its arguments are ${names.join(", ")}` : "it takes none"}` };
  /** @type {Record<string, string>} */
  const values = {};
  for (const [name, a] of Object.entries(k.args)) {
    const raw = Object.hasOwn(args, name) ? args[name] : undefined;
    const v = raw == null ? "" : typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : null;
    if (v == null) return { ok: false, error: `${name} is no word or number` };
    if (!v.trim()) {
      if (a.required) return { ok: false, error: `${name} is needed: ${a.about}` };
      values[name] = "";
      continue;
    }
    if (v.startsWith("-")) return { ok: false, error: `${name} is “${v.slice(0, 40)}”: a value may not start with “-”` };
    if (/[\0\r\n]/.test(v) || v.length > PART_MAX) return { ok: false, error: `${name} is no line of text (${PART_MAX} characters at most)` };
    if (a.choices && !a.choices.includes(v)) return { ok: false, error: `“${v.slice(0, 60)}” is none of ${name}'s choices (${a.choices.join(", ")})` };
    if (a.pattern && !new RegExp(a.pattern).test(v)) return { ok: false, error: `${name} is “${v.slice(0, 60)}”, which does not match its pattern ${a.pattern}` };
    values[name] = v;
  }
  /** @type {string[]} */
  const argv = [];
  for (const part of k.command) {
    let left = false;
    const filled = part.replace(ARG_PLACE, (_m, n) => {
      if (!values[n]) left = true;
      return values[n] || "";
    });
    if (!left) argv.push(filled);
  }
  return { ok: true, argv };
}
