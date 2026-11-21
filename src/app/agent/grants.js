// @ts-check
// What a team's brief lets its worker run without anyone's answer (HarnessV3-TaskGraph-v2 TG2-D44): its `check` — the
// commands that prove the task done, which Filament runs itself once the worker reports (TG2-D45) — and its `may_run`,
// the others the task needs. In the worker's own git worktree a command they cover runs at once. No mode changes
// meaning; only the moment of the yes moves, to the brief, where the task is decided: the grants are the lead's, as its
// yes to each call is (TG2-D41).
//
// A grant covers its command as written, or followed by more words: `npm test` covers `npm test -- --grep money`, never
// `npm testify`. A check's part of one word (`pytest`) covers only itself, and may_run takes no bare program name. A
// command of parts (`&&`, `;`, `|`) is covered when each part is a grant's or only reads by the switch's reader
// (`| tail -20`), and one at least is a grant's; a `cd` into the folder it already runs in counts for nothing (the
// rules' `staysPut`), and so do `2>&1` and output thrown away. Any other redirect, or a substitution, is covered by no
// grant, as by no allow rule. No grant covers an install — the worktree links the developer's installed packages, so an
// install changes theirs — a step that cannot be undone (core/signs.js `oneWayOf`), or a command that reaches the
// developer's folder. A grant turns the gate's own ask into a run and nothing more: a deny rule, an ask rule, read-only
// and the fence still win, and it covers commands only, never a change to a file. A saved agent's card may carry such
// commands too (HarnessV4_Tasks decision 21, AG-267), which hold wherever it works in its own copy, whoever called it,
// beside a team's brief's. A chat's own always-allow (d-allow, chat-always.js) is read the same way, from exact entries
// (`exact`): the command as written and no more words after it. The words the lead and the worker read of grants are
// here. Pure.
import { UNCOVERABLE, asksFirst, commandMarks, commandSegments, describeRule, ruleFor, staysPut } from "./rules.js";
import { oneWayOf } from "../../core/signs.js";
import { listed, sentence } from "../../core/text.js";

/**
 * A launch's grants as it keeps them, each command trimmed, in its order: its brief's check and may_run, and `card`, its
 * card's own commands (AG-267), where it has any; `exact`: commands that cover only themselves, as written — what a
 * chat keeps always allowed (d-allow), no brief's. @typedef {{ check: string[], mayRun: string[], card?: string[], exact?: string[] }} Grants
 */
/** A command a brief lets run: as written and, unless `exact`, followed by more words. @typedef {{ text: string, exact: boolean }} Grant */

/** How many commands a check may be — the words say "one to five". */
export const CHECK_MAX = 5;

/**
 * Redirects that change nothing a grant could miss: a descriptor's copy (`2>&1`, `>&2`) and output thrown away
 * (`>/dev/null`, `&>/dev/null`, cmd's `2>nul`, PowerShell's `*>$null`).
 */
const HARMLESS = /(?<=^|\s)(?:\d?>&\d|[\d&*]?>\s*(?:\/dev\/null|nul|\$null))(?=[\s|;&]|$)/gi;
/** A command as a grant reads it: its harmless redirects read past, its blanks one blank. @param {string} command */
export const plain = (command) => String(command).replace(HARMLESS, " ").trim().replace(/\s+/g, " ");

/** Flags between a program and the subcommand that installs, with their values: `npm --prefix web ci`. */
const FLAGS = String.raw`(?:\s+--?[\w-]+(?:[= ][^\s-]\S*)?)*`;
/** A program, under any path and with its Windows suffix, then one of its subcommands. @param {string} programs @param {string} subs */
const installing = (programs, subs) => new RegExp(String.raw`(?:^|[\s/\\])(?:${programs})(?:\.(?:cmd|exe|bat))?${FLAGS}\s+(?:${subs})(?=\s|$)`, "i");
/** A program that installs with no subcommand at all (`yarn`, `bundle`), its flags aside. @param {string} programs */
const installingBare = (programs) => new RegExp(String.raw`^(?:sudo\s+)?(?:${programs})(?:\.(?:cmd|exe|bat))?${FLAGS}$`, "i");
/** The commands that install, uninstall or update packages, by their shape. A list, not a proof. */
const INSTALLS = Object.freeze([
  installing("npm|pnpm|bun", String.raw`install|i|add|ci|update|up|upgrade|uninstall|un|remove|rm|link|ln|rebuild|prune|dedupe|audit\s+fix`),
  installing("yarn", "install|add|upgrade|up|remove|link|global"),
  installingBare("yarn|bundle"),
  installing("pip|pip3", "install|uninstall|download"),
  installing("uv", String.raw`pip\s+(?:install|uninstall|sync)|add|remove|sync|tool\s+install`),
  installing("poetry", "add|install|remove|update"),
  installing("pipx", "install"),
  installing("conda|mamba", "install|create|update|remove"),
  installing("cargo", "install|add|remove|update"),
  installing("go", "install|get"),
  installing("gem", "install"),
  installing("bundle", "install|add|update"),
  installing("composer", "install|require|update|remove"),
  installing("apt|apt-get", "install|remove|purge|upgrade|dist-upgrade"),
  installing("brew", "install|uninstall|upgrade|reinstall"),
  installing("choco|winget|scoop", "install|uninstall|upgrade|update"),
  installing("dnf|yum", "install|remove|update|upgrade"),
  installing("pacman", String.raw`-[SRU]\w*`),
  installing("snap", "install|remove|refresh"),
  installing("dotnet", String.raw`add|tool\s+install`),
  installing("deno", "install|add"),
]);
/** Whether a part of a command installs packages. @param {string} command */
export const installs = (command) => commandSegments(plain(command)).some((part) => INSTALLS.some((re) => re.test(part)));

/** A list of non-empty strings. @param {unknown} v */
const textList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.trim() !== "");
/** A command as the words name it. @param {string} c */
const q = (c) => `\`${c}\``;
/** Commands as the words list them: `a`, `b`. @param {readonly string[]} list */
const named = (list) => list.map(q).join(", ");

/**
 * The brief's grants, as its launch keeps them: its check and its may_run, each command trimmed — null where it gives
 * neither.
 * @param {any} input  a brief `checkBrief` passed
 * @returns {Grants | null}
 */
export function grantsOf(input) {
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map((s) => String(s).trim()) : []);
  const check = list(input?.check);
  const mayRun = list(input?.may_run);
  return check.length || mayRun.length ? { check, mayRun } : null;
}

/**
 * A launch's grants: its card's commands (AG-267) beside its brief's — null where neither gives any.
 * @param {readonly unknown[] | null | undefined} card  the card's `mayRun` @param {Grants | null} brief
 * @returns {Grants | null}
 */
export function withCardRuns(card, brief) {
  const own = (Array.isArray(card) ? card : []).map((c) => String(c).trim()).filter(Boolean);
  if (!own.length) return brief;
  return { check: brief?.check ?? [], mayRun: brief?.mayRun ?? [], card: own };
}

/**
 * What makes a brief's command none a shell runs as written, read outside its quotes: a parenthesis — a subshell, or
 * words about the command, `node --test (its own test file)` — or a comma before more words, a list of commands
 * (`git diff, git status`). A grant of either covers nothing the worker types (TG2-D44; seen in the Phase 1 drive).
 * @param {string} command @returns {"paren" | "list" | null}
 */
const notACommand = (command) => {
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"') i++;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
    else if (c === "(" || c === ")") return "paren";
    else if (c === "," && /^\s+\S/.test(command.slice(i + 1))) return "list";
  }
  return null;
};

/** A mark that cuts a command, or redirects it, where the shell reads it. */
const CUTS = /[;|&<>\r\n]/;
/**
 * A command with the marks its quotes hold blanked, and those a backslash makes letters (HarnessV3-TaskGraph-v2 TG2-D63's
 * drive): `node -e "a; b"` is one command, and a `;`, `|`, `&`, `<` or `>` in quotes is its program's text, not the
 * shell's. A substitution is the shell's even in double quotes, so it stays.
 * @param {string} command
 */
export const unquoted = (command) => {
  let quote = "";
  let out = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && quote !== "'" && i + 1 < command.length) {
      const next = command[++i];
      out += `${c}${CUTS.test(next) ? " " : next}`;
    } else if (quote) {
      if (c === quote) quote = "";
      out += quote && CUTS.test(c) ? " " : c;
    } else {
      if (c === "'" || c === '"') quote = c;
      out += c;
    }
  }
  return out;
};

/**
 * Why one command of a brief's check or may_run grants nothing, in the words the lead reads — or null. A check's parts
 * are joined by `&&` alone: after any other mark a part can fail and the check still pass, since a check passes or
 * fails by its exit code (TG2-D45). A may_run entry is one command, and more than a program's name. Either is a
 * command as the worker types it, never words about one (`notACommand`). A card's command is one as a may_run entry is,
 * named alone (`card`): the Agents page's words. A worker's report's checked (HarnessV3-TaskGraph-v2 TG2-D63) is read
 * as a check is, in the words the worker reads. A command task's run (HarnessV3-TaskGraph-v2 V2-3) is read as a check is
 * too: Filament runs it, and a run passes or fails by its exit code.
 * @param {"check" | "may_run" | "checked" | "run"} field @param {string} command @param {boolean} [card]
 */
function commandProblem(field, command, card = false) {
  const shown = String(command).trim();
  const text = plain(shown);
  const worker = field === "checked";
  const run = field === "run";
  const is = card ? q(shown) : worker ? `report's checked: ${q(shown)}` : `${field}'s ${q(shown)}`;
  const uses = worker ? "your worktree uses the developer's folder's" : run ? "Filament's copies of the folder use its" : "a worker's worktree uses your folder's";
  if (installs(shown)) return `${is} installs packages, and ${uses} installed ones: leave it out — what the task needs installed, the developer installs`;
  const once = oneWayOf(shown);
  if (once) return `${is} is a step that cannot be undone (${once}): leave it out — such a step never runs without a yes`;
  // Its marks and redirects as the shell reads them: what its quotes hold is its program's (`unquoted`).
  const bare = unquoted(text);
  const parts = commandSegments(bare);
  if (field === "may_run" && parts.length > 1) return `${is} is more than one command: give each its own entry`;
  const mark = field !== "may_run" ? commandMarks(bare).find((m) => m !== "&&") : null;
  if (mark) return `${is} joins its parts with ${mark === "\n" ? "a line break" : mark}, where a part can fail and the ${run ? "run" : "check"} still pass: join parts with && alone, or give each command its own entry — Filament ${run ? "keeps the end of a run's output" : "shows the end of a check's output"} itself`;
  if (parts.some((p) => UNCOVERABLE.test(p))) return run ? `${is} redirects or substitutes: name the command alone — Filament keeps the end of its output itself` : `${is} redirects or substitutes, which no grant covers: name the command alone`;
  const not = notACommand(shown);
  if (not === "paren") return `${is} is no command as a shell runs it — a parenthesis there starts a subshell: write the command itself, as the worker types it (\`npm test\`, \`node --test test/parse.test.js\`)`;
  if (not === "list") return `${is} is a list of commands: give each its own entry, as the worker types it`;
  if (field === "may_run" && !text.includes(" ")) return `${is} is a bare program name, which would let the worker run anything with it: name the command and its first words, as \`npm test\` or \`node --test\``;
  return null;
}

/**
 * Why a card's commands (AG-267) cannot be saved, in the Agents page's words — or null: each one command as the agent
 * types it, as a brief's may_run entry is, and never an install, a step that cannot be undone or a bare program name.
 * @param {readonly string[]} list
 */
export function cardRunsProblem(list) {
  for (const c of list) {
    const why = commandProblem("may_run", c, true);
    if (why) return why;
  }
  return null;
}

/**
 * Why a graph task's check cannot be kept (HarnessV3-TaskGraph-v2 V2-1), read from its commands alone, in the words the
 * planner reads — or null: each as a brief's check's command is (TG2-D44). @param {readonly string[]} list
 */
export function checkCommandsProblem(list) {
  for (const c of list) {
    const why = commandProblem("check", c);
    if (why) return why;
  }
  return null;
}

/**
 * Why a brief's check and may_run cannot launch its worker, read from the brief alone, in the words the lead reads —
 * or null. `member`: the team's member its role names, whose card says what it may do — one that reads changes
 * nothing, so it has no worktree to run them in, and one in a copy keeps nothing, so it has no change to check.
 * @param {any} input @param {{ tag: string, may: string }} member
 */
export function grantsProblem(input, member) {
  const i = input && typeof input === "object" ? input : {};
  if (i.check != null && !(textList(i.check) && i.check.length <= CHECK_MAX)) return "check must be one to five commands, the ones that prove the task done";
  if (i.may_run != null && !textList(i.may_run)) return "may_run must be a list of non-empty strings";
  const g = grantsOf(i);
  if (!g) return null;
  if (member.may === "read") return `check and may_run are for a worker that runs commands in its own worktree, and ${member.tag} changes nothing`;
  if (g.check.length && member.may === "copy") return `check is for a worker whose change is kept, and ${member.tag} works in its own copy, where nothing it changes is kept: give its commands in may_run`;
  for (const c of g.check) {
    const why = commandProblem("check", c);
    if (why) return why;
  }
  for (const c of g.mayRun) {
    const why = commandProblem("may_run", c);
    if (why) return why;
  }
  return null;
}

/**
 * Why a brief's grants cannot hold in the session that launches its worker, in the words the lead reads — or null: a
 * command that names the developer's folder (`names`), where the worker runs it in its own worktree, or one a deny or
 * an ask rule of the session's speaks for. A brief lifts no rule: an ask rule's command would run without the yes the
 * rule asks for, Filament's own run of the check among them. A graph task's check (V2-1) is read so too, in its words:
 * `lift` "a check", and `runs` where it runs.
 * @param {Grants} grants
 * @param {{ folder: string, names: (command: string) => boolean, rules: readonly import("./rules.js").Rule[], lift?: string, runs?: string }} o
 */
export function grantsRefusal(grants, { folder, names, rules, lift = "a brief", runs = "the worker runs it in its own worktree" }) {
  const hit = grantsHit(grants, { names, rules });
  return hit ? refusalWords(hit, { folder, lift, runs }) : null;
}

/**
 * @typedef {{ field: "check" | "may_run", command: string } & ({ names: true } | { verdict: "deny" | "ask", rule: string })} GrantsHit
 *   the first command of a brief's grants the session speaks against: one that names the developer's folder, or one a
 *   deny or an ask rule of the session's speaks for, the rule as it reads
 * @typedef {{ readOnly: true } | { shape: string } | { hit: GrantsHit, folder: string }} CheckBar  what keeps Filament from
 *   running a check in a session: the session is read-only, a command is no check (`checkCommandsProblem`'s words), or
 *   the session's folder or rules speak against one
 */

/**
 * The command of a brief's grants the session speaks against (`grantsRefusal`), or null.
 * @param {Grants} grants @param {{ names: (command: string) => boolean, rules: readonly import("./rules.js").Rule[] }} o
 * @returns {GrantsHit | null}
 */
export function grantsHit(grants, { names, rules }) {
  for (const [field, list] of /** @type {const} */ ([["check", grants.check], ["may_run", grants.mayRun]]))
    for (const command of list) {
      if (names(command)) return { field, command, names: true };
      const hit = ruleFor(rules, "bash", { command });
      if (hit?.verdict === "deny") return { field, command, verdict: "deny", rule: describeRule(hit.rule) };
      if (asksFirst(hit)) return { field, command, verdict: "ask", rule: describeRule(/** @type {any} */ (hit).rule) };
    }
  return null;
}

/**
 * A hit of `grantsHit` in the words the lead or the planner reads (`grantsRefusal`).
 * @param {GrantsHit} hit @param {{ folder: string, lift?: string, runs?: string }} o
 */
export function refusalWords(hit, { folder, lift = "a brief", runs = "the worker runs it in its own worktree" }) {
  const is = `${hit.field}'s ${q(hit.command)}`;
  if ("names" in hit) return `${is} names your folder (${folder}): ${runs}, where the same files are at the same paths — use paths relative to the folder`;
  if (hit.verdict === "deny") return `${is} is refused by this session's rule ${hit.rule}: leave it out`;
  return `${is} asks first by this session's rule ${hit.rule}, which ${lift} does not lift: leave it out`;
}

/**
 * Why the commands a worker's report names in checked cannot be its task's check (HarnessV3-TaskGraph-v2 TG2-D63), in
 * the words its report call's error says — or null: each read as a task's check is (V2-1) — never an install, a step that
 * cannot be undone, parts that hide a failure, the developer's folder named (`names`; the worker's worktree lies in it),
 * or a command a deny or an ask rule of the session's speaks for. A read-only session is no refusal here: Filament runs
 * no check there, and its end says so.
 * @param {readonly string[]} list
 * @param {{ folder: string, names: (command: string) => boolean, rules: readonly import("./rules.js").Rule[] }} o
 */
export function checkedRefusal(list, { folder, names, rules }) {
  for (const command of list) {
    const own = commandProblem("checked", command);
    if (own) return own;
    const is = `report's checked: ${q(command)}`;
    if (names(command)) return `${is} names the developer's folder (${folder}): Filament runs it in your worktree, where the same files are at the same paths — use paths relative to your worktree`;
    const hit = ruleFor(rules, "bash", { command });
    if (hit?.verdict === "deny") return `${is} is refused by this session's rule ${describeRule(hit.rule)}: leave it out`;
    if (asksFirst(hit)) return `${is} asks first by this session's rule ${describeRule(/** @type {any} */ (hit).rule)}, and Filament runs checked without asking: leave it out`;
  }
  return null;
}

/**
 * Why a command task's run cannot be kept in this session (HarnessV3-TaskGraph-v2 V2-3), in the words its planner reads —
 * or null: each command, its item filled in, read as a check's is — never an install, a step that cannot be undone,
 * parts that hide a failure, a redirect or a substitution, the developer's folder named (`names`: Filament runs it in a
 * copy), or a command a deny or an ask rule of the session's speaks for: Filament runs a command task without asking.
 * @param {readonly string[]} list
 * @param {{ folder: string, names: (command: string) => boolean, rules: readonly import("./rules.js").Rule[] }} o
 */
export function runRefusal(list, { folder, names, rules }) {
  for (const command of list) {
    const own = commandProblem("run", command);
    if (own) return own;
    const is = `run's ${q(command)}`;
    if (names(command)) return `${is} names your folder (${folder}): Filament runs it in a copy of the folder, where the same files are at the same paths — use paths relative to the folder`;
    const hit = ruleFor(rules, "bash", { command });
    if (hit?.verdict === "deny") return `${is} is refused by this session's rule ${describeRule(hit.rule)}: leave it out`;
    if (asksFirst(hit)) return `${is} asks first by this session's rule ${describeRule(/** @type {any} */ (hit).rule)}, and Filament runs a command task without asking: leave it out`;
  }
  return null;
}

/**
 * The grants a launch's commands make: each part of a check's — one of one word only itself — each may_run entry, and
 * each of its card's commands, as a may_run entry; an exact entry (d-allow) only itself.
 * @param {Grants} grants @returns {Grant[]}
 */
const grantList = ({ check, mayRun, card = [], exact = [] }) => [
  ...check.flatMap((c) => commandSegments(plain(c)).map((text) => ({ text, exact: !text.includes(" ") }))),
  ...[...mayRun, ...card].map((m) => ({ text: plain(m), exact: false })),
  ...exact.map((e) => ({ text: plain(e), exact: true })),
];
/**
 * Whether a grant covers one part of a command: as written, or followed by more words. The rules read a command
 * without case, and so does a grant.
 * @param {Grant} g @param {string} part
 */
const covers = (g, part) => {
  const p = part.toLowerCase();
  const t = g.text.toLowerCase();
  return p === t || (!g.exact && p.startsWith(`${t} `));
};

/**
 * The grants that cover a command a worker in its own worktree asks to run — each once, in the order its parts used
 * them — or null where its brief's do not: each part a grant's, one that only reads or a cd that stays put, one at
 * least a grant's, and none an install, a step that cannot be undone, a redirect or a substitution; nor the command
 * one of more than one line, nor one that reaches the developer's folder (`outside`, the fence's reading: by its path,
 * or climbing out of the worktree). What a chat keeps always allowed is read by it too, as exact entries (chat-always.js `keptFor`).
 * @param {Grants} grants @param {string} command @param {string} name  the hand: bash, bash_background or powershell
 * @param {{ at: import("./rules.js").CommandPlace, readsOnly: (part: string) => { ok: boolean } | null, outside: (command: string) => boolean }} place
 *   `at`: where the command runs — the worktree — and its shell; `readsOnly`: the switch's reader, on one part
 * @returns {string[] | null}
 */
export function grantFor(grants, command, name, { at, readsOnly, outside }) {
  const list = grantList(grants);
  if (!list.length || installs(command) || oneWayOf(command) || outside(command)) return null;
  // A second line is a second command to its shell, and `plain` reads a line break as a blank: `npm test` covered
  // "npm test⏎node evil.js" as its words followed by more (found by d-allow's builder, 11-12). No grant covers a
  // command of more than one line: it asks.
  if (/[\r\n]/.test(String(command).trim())) return null;
  /** @type {string[]} */
  const used = [];
  for (const part of commandSegments(plain(command))) {
    if (UNCOVERABLE.test(part)) return null;
    if (staysPut(part, name, at)) continue;
    const g = list.find((x) => covers(x, part));
    if (g) {
      if (!used.includes(g.text)) used.push(g.text);
      continue;
    }
    if (!readsOnly(part)?.ok) return null;
  }
  return used.length ? used : null;
}

/** The grants a call ran on, as the record says them: "grant `npm test`", "grants `npx tsc` and `npm test`". @param {readonly string[]} used */
export const grantWords = (used) => `${used.length > 1 ? "grants" : "grant"} ${listed(used.map(q))}`;

/**
 * Whose grants a call ran on, as the record says them after "ran on": "its card's grant `npm test`", "its brief's
 * grants `npx tsc` and `npm test`", or both — a command the card and the brief both name is the card's.
 * @param {Grants} grants @param {readonly string[]} used  `grantFor`'s answer
 */
export function grantedBy(grants, used) {
  const mine = new Set((grants.card ?? []).map((c) => plain(c).toLowerCase()));
  const card = used.filter((u) => mine.has(u.toLowerCase()));
  const brief = used.filter((u) => !mine.has(u.toLowerCase()));
  return [card.length ? `its card's ${grantWords(card)}` : "", brief.length ? `its brief's ${grantWords(brief)}` : ""].filter(Boolean).join(" and ");
}

/** A check's commands in the order Filament runs them: `npm run build`, then `npm test`. @param {readonly string[]} check */
const inOrder = (check) => check.map(q).join(", then ");

/**
 * What the launch's answer says of a brief's grants, after "in the background.": what the worker may run in its own
 * worktree, and the check Filament runs once it reports — or, where it shares the developer's folder, that they do
 * nothing there. "" for a brief that gives none.
 * @param {Grants | null} grants @param {boolean} tree  the worker works in a worktree of its own
 */
export function launchWords(grants, tree) {
  if (!grants) return "";
  const { check, mayRun } = grants;
  if (!tree) {
    const fields = check.length && mayRun.length ? "check and may_run do" : check.length ? "check does" : "may_run does";
    return ` Its brief's ${fields} nothing here: it works in your folder, not a worktree of its own, so its commands ask as any do${check.length ? ", and Filament runs no check" : ""}.`;
  }
  return ` It may run without asking, in its worktree: ${named([...new Set([...check, ...mayRun])])}${check.length ? `; Filament runs its check — ${inOrder(check)} — once it reports` : ""}.`;
}

/**
 * A brief's grants with its team's check (the plan's p6): the team's command joins its check — once — so the member that
 * edits runs it without asking and Filament runs it when it reports, as a brief's check is.
 * @param {Grants | null} brief @param {string | null | undefined} check  the team's
 * @returns {Grants | null}
 */
export function withTeamCheck(brief, check) {
  const c = String(check ?? "").trim();
  if (!c) return brief;
  return { ...(brief || { mayRun: [] }), check: [...new Set([...(brief?.check ?? []), c])], mayRun: brief?.mayRun ?? [] };
}

/**
 * Why a team's check is not given to a member that changes files (the plan's p6), as its lead reads it after the check
 * is named: what the session says of it — the team's is no brief's to leave out — or, for a command no check may be,
 * why, in a graph task's check's words.
 * @param {CheckBar} bar
 */
export function teamCheckWhy(bar) {
  if ("readOnly" in bar) return "this session is read-only, so Filament runs no check in it";
  if ("shape" in bar) return `Filament runs no such check (${bar.shape})`;
  const { hit, folder } = bar;
  if ("names" in hit) return `it names your folder (${folder}), and Filament runs it in a copy of the folder, where the same files are at the same paths`;
  return hit.verdict === "deny" ? `this session's rule ${hit.rule} refuses it` : `this session's rule ${hit.rule} asks first, and Filament runs a check without asking`;
}

/**
 * What a lead hears where a launch of its team's member went without its team's check (the plan's p6): the check, and
 * why (`teamCheckWhy`). @param {{ check: string, why: string }} u @param {string} [who]  the worker
 */
export const uncheckedWords = ({ check, why }, who = "it") => `Your team's check ${q(check)} is not given to ${who}: ${sentence(why)}`;

/**
 * Filament's note to an agent in its own worktree whose brief or card grants commands, ahead of its brief, after the
 * worktree's note: what it may run there without waiting for anyone's answer — each as written or followed by more
 * words; a check with a part of one word as written only — and that Filament runs its check when it reports. A graph
 * task's worker (V2-1) has its task's check, and — under the session's agent, no lead's — reports to the agent. A team's
 * worker given its team's check (`team`, `withTeamCheck`) is told its team gives it.
 * @param {Grants} grants @param {{ task?: boolean, agent?: boolean, team?: string | null }} [o]
 */
export function grantsNote({ check, mayRun, card = [] }, { task = false, agent = false, team = null } = {}) {
  const entries = [...mayRun, ...card];
  const all = [...new Set([...check, ...entries])];
  const shut = all.filter((c) => !entries.includes(c) && commandSegments(plain(c)).some((p) => !p.includes(" ")));
  const open = all.filter((c) => !shut.includes(c));
  const runs = [open.length ? `each as written, or followed by more words: ${named(open)}` : "", shut.length ? `${open.length ? "and " : ""}as written only: ${named(shut)}` : ""].filter(Boolean).join("; ");
  const checked = check.length ? ` When you report, Filament runs your check — ${inOrder(check)} — in your worktree before ${agent ? "the agent" : "your lead"} hears of it; if it fails, its output comes back to you.` : "";
  const teams = team && check.includes(team);
  const brief = check.some((c) => !teams || c !== team) || mayRun.length;
  const given = task ? "your task" : "your lead's brief";
  const by = [card.length ? "your card" : "", teams ? "your team" : "", brief ? given : ""].filter(Boolean);
  const who = by.length > 1 ? `${listed(by)} let` : `${by[0] || given} lets`;
  // Whether anything else is asked depends on who started the agent (you are asked; nobody is, for one the main agent
  // called or that started by itself), so the note names the mode, which is true for each (AG-268).
  return `[Filament: ${who} you run these commands in your worktree without waiting for anyone's answer — ${runs}. Anything else follows the session's mode and the developer's rules, as it would without these.${checked}]`;
}
