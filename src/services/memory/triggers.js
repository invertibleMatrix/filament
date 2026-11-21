// @ts-check
// Triggers (HarnessV3-Memory M5-1, M5-2): the moment a claim is said, a tool call of a given shape. A pitfall is a claim
// with a trigger (M5-D1): the user's "don't run npm test bare here" stays a rule, and it also rides on the very call
// that would repeat the mistake. A trigger names the call's tool (every shell is "bash": one history whichever shell
// ran it, as for learned permissions, TL-D5), its shape, `args`, the words that make a call of that shape the mistaken
// one (`git push --force` is `git push` with `--force`; none: every call of the shape), and `unless`, the right way
// when one is known: a call that holds it is not reminded.
import { SUBCOMMAND_TOOLS, commandWords } from "./permissions.js";

/** @typedef {{ tool: string, shape: string, args: string, unless: string | null }} Trigger */

// The tools that run a shell command, by the names clients give them.
const SHELLS = new Set(["bash", "powershell", "pwsh", "sh", "zsh", "shell", "local_shell", "exec_command", "run_shell_command", "execute_command", "run_terminal_cmd"]);

/** The tool a trigger is kept under: "bash" for every shell, else the tool's name lower-cased, an MCP tool's without its `mcp__` prefix. @param {string} tool */
export function triggerTool(tool) {
  const t = String(tool ?? "").trim().toLowerCase();
  return SHELLS.has(t) ? "bash" : t.replace(/^mcp__/, "");
}

/** A shell call's command: its text, or the script of an argv (`["bash", "-lc", "npm test"]`), bare or as its `command`. @param {any} input */
export function commandOf(input) {
  const c = typeof input === "string" || Array.isArray(input) ? input : (input?.command ?? input?.cmd ?? "");
  if (!Array.isArray(c)) return String(c).trim();
  const at = c.findIndex((a) => /^(?:-[a-z]*c|-command)$/i.test(String(a)));
  return (at >= 0 && at + 1 < c.length ? String(c[at + 1]) : c.map(String).join(" ")).trim();
}

/**
 * A shell command's simple commands: split at `&&`, `||`, `;`, `|`, a lone `&` and newlines outside quotes (the `&` of
 * a redirect, `2>&1` or `&>`, is not one), a group's parentheses and braces left out.
 * @param {string} cmd @returns {string[]}
 */
export function simpleCommands(cmd) {
  const s = String(cmd ?? "");
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let quote = "";
  const close = () => {
    const t = cur.trim().replace(/^[({]\s*/, "").replace(/\s*[)}]$/, "").trim();
    if (t) out.push(t);
    cur = "";
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === "\n" || ch === ";") close();
    else if (ch === "|") {
      if (s[i + 1] === "|" || s[i + 1] === "&") i++;
      close();
    } else if (ch === "&") {
      if (s[i + 1] === "&") {
        i++;
        close();
      } else if (s[i - 1] === ">" || s[i + 1] === ">") cur += ch;
      else close();
    } else cur += ch;
  }
  close();
  return out;
}

// What only sets up a command's run: `VAR=value`, and the wrappers that run the command they are given, with their
// options (the ones that take a value step over it too).
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** @type {Record<string, Set<string>>} */
const WRAPPERS = {
  env: new Set(["-u", "--unset", "-C", "--chdir"]),
  "cross-env": new Set(),
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-U"]),
  nohup: new Set(),
  time: new Set(),
  nice: new Set(["-n"]),
  exec: new Set(),
  command: new Set(),
};

/**
 * A simple command split where its own words start: `setup` is what sets up its run (assignments, wrappers and their
 * options), `words` the command itself. Words are split at spaces outside quotes (`GIT_SSH_COMMAND='ssh -i k'` is one).
 * A command that is only setup has no words.
 * @param {string} simple @returns {{ setup: string, words: string[] }}
 */
export function commandParts(simple) {
  const s = String(simple ?? "");
  const toks = [...s.matchAll(/(?:[^\s"']+|"[^"]*"?|'[^']*'?)+/g)];
  let i = 0;
  let wrapper = "";
  while (i < toks.length) {
    const t = toks[i][0];
    if (ASSIGN.test(t)) i++;
    else if (Object.hasOwn(WRAPPERS, t.toLowerCase())) {
      wrapper = t.toLowerCase();
      i++;
    } else if (wrapper && t.startsWith("-")) i += WRAPPERS[wrapper].has(t) ? 2 : 1;
    else break;
  }
  const at = i < toks.length ? (toks[i].index ?? 0) : s.length;
  return { setup: s.slice(0, at).trim(), words: toks.slice(i).map((m) => m[0]) };
}

/**
 * A command's shape as triggers keep it: its head's bare word, plus the subcommand for the tools that have one (`npm
 * test`, `git push`, `cd`). A variable's statement (PowerShell's `$env:X = 1`) has none.
 * @param {string[]} words @returns {string | null}
 */
export function shapeOfWords(words) {
  if (!words.length || words[0].startsWith("$")) return null;
  const { word, sub } = commandWords([words[0].replace(/^["']+|["']+$/g, ""), ...words.slice(1)]);
  return word ? (sub ? `${word} ${sub}` : word) : null;
}

/** A word as the shell passes it on: its quotes aside, lower-cased (Windows' shells do not care about case). @param {string} w */
const bare = (w) => String(w).replace(/^["']+|["']+$/g, "").toLowerCase();
/** A command's words after its shape (`git push --force origin` → `--force`, `origin`). @param {string[]} words @param {string} shape */
const afterShape = (words, shape) => words.slice(shape.split(" ").length);

// The subcommands that run what the word after them names (`npm run build`, `uv run pytest`, `pnpm dlx x`).
const RUNNERS = new Set(["run", "run-script", "exec", "x", "dlx"]);
/**
 * What a command runs when its shape does not say (M5-D31): the script or program after a runner's subcommand (`npm
 * run migrate` → `migrate`; its options, and what follows `--`, aside), or the module after a python's `-m` (`python
 * -m pytest` → `-m pytest`); '' for any other command, whose shape says what it is.
 * @param {string[]} words  a command's own words (`commandParts`)
 */
export function targetOf(words) {
  const shape = shapeOfWords(words);
  if (!shape) return "";
  const [head, sub] = shape.split(" ");
  const rest = afterShape(words, shape);
  if (sub && RUNNERS.has(sub)) {
    for (const w of rest) {
      if (w === "--") break;
      if (!w.startsWith("-")) return bare(w);
    }
    return "";
  }
  return /^(?:python[\d.]*|py)$/.test(head) && rest[0] === "-m" && rest[1] ? `-m ${bare(rest[1])}` : "";
}

/**
 * The shapes of a tool call (M5-1): each simple command of a shell call, after its setup (`cd x && env -u A npm test`
 * is `cd` and `npm test`); any other tool's is its name (`triggerTool`). The same shape twice is one.
 * @param {string} tool @param {any} input  a shell call's input (`{ command }`) or its command @returns {string[]}
 */
export function callShapes(tool, input) {
  const t = triggerTool(tool);
  if (t !== "bash") return t ? [t] : [];
  /** @type {string[]} */
  const out = [];
  for (const s of simpleCommands(commandOf(input))) {
    const shape = shapeOfWords(commandParts(s).words);
    if (shape && !out.includes(shape)) out.push(shape);
  }
  return out;
}

/** The trigger shapes a call's shapes answer to: each, and its head alone (a trigger on `npm` is every `npm …`). @param {string[]} shapes */
export const shapesToMatch = (shapes) => [...new Set(shapes.flatMap((s) => [s, s.split(" ")[0]]))];

/**
 * Whether a call makes a trigger's mistake (M5-D31): one of its commands of the trigger's shape (or under its head, for
 * a trigger on a head alone) carries each of the trigger's words, anywhere after the shape, quotes and case aside. A
 * trigger with no words is every call of its shape; another tool's trigger has none.
 * @param {string} tool @param {any} input @param {string} shape @param {string | null | undefined} args
 */
export function callCarries(tool, input, shape, args) {
  const want = String(args ?? "").split(/\s+/).filter(Boolean).map(bare);
  if (!want.length) return true;
  if (triggerTool(tool) !== "bash") return false;
  return simpleCommands(commandOf(input)).some((s) => {
    const { words } = commandParts(s);
    const own = shapeOfWords(words);
    if (!own || (own !== shape && own.split(" ")[0] !== shape)) return false;
    const has = new Set(afterShape(words, shape).map(bare));
    return want.every((w) => has.has(w));
  });
}

const fold = (/** @type {any} */ s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** What a call's `unless` is looked for in: a shell call's command, else its input as JSON; lower-cased, spaces folded. @param {string} tool @param {any} input */
export const callText = (tool, input) => fold(triggerTool(tool) === "bash" ? commandOf(input) : JSON.stringify(input ?? {}));
/** Whether a call holds the right way: then it is not reminded. @param {string} text  `callText` @param {string | null} unless */
export const holdsWay = (text, unless) => !!unless && text.includes(fold(unless));
/**
 * Whether two triggers on one shape are one: the same words and the same right way, case and spacing aside (no words
 * are one with no words, no way with no way).
 * @param {{ args?: string | null, unless?: string | null }} a @param {{ args?: string | null, unless?: string | null }} b
 */
export const sameTrigger = (a, b) => fold(a.args) === fold(b.args) && fold(a.unless) === fold(b.unless);

// ---- M5-2: the pitfalls a claim's words name ----

// The command-line tools a sentence may name in plain words. Those that are also everyday English count only right
// after the verb that runs them ("don't use make"), never further on ("don't use the make target" names no command).
const COMMANDS = new Set([
  ...SUBCOMMAND_TOOLS,
  "rm", "rmdir", "del", "mv", "cp", "ls", "grep", "rg", "sed", "awk", "curl", "wget", "ssh", "scp", "rsync", "tar",
  "unzip", "chmod", "chown", "pkill", "killall", "taskkill", "sudo", "python", "python3", "py", "pytest", "jest",
  "vitest", "mocha", "playwright", "cypress", "tsc", "eslint", "prettier", "biome", "ruff", "black", "mypy", "webpack",
  "vite", "rollup", "esbuild", "tsx", "ts-node", "nodemon", "pm2", "java", "javac", "gcc", "g++", "clang", "cmake",
  "ruby", "gem", "bundle", "rails", "rake", "php", "composer", "perl", "swift", "xcodebuild", "flutter", "dart", "adb",
  "psql", "mysql", "sqlite3", "redis-cli", "mongosh", "aws", "gcloud", "az", "firebase", "vercel", "netlify", "heroku",
  "flyctl", "wrangler", "pulumi", "ansible", "vagrant", "nix", "systemctl", "journalctl", "bash", "sh", "zsh", "pwsh",
  "powershell", "robocopy", "xcopy", "icacls", "netsh", "lsof", "cross-env", "nohup", "cd", "mkdir", "echo", "cat",
  "find", "kill", "touch", "env", "export", "source", "set", "start", "open", "code",
]);
const PLAIN = new Set(["cd", "echo", "cat", "find", "kill", "touch", "env", "export", "source", "set", "start", "open", "code", "make", "go", "just", "task", "node", "black", "bundle", "gem", "rails", "swift", "dart", "composer", "time"]);
// Where a command named in a sentence ends: a clause's punctuation (a period only after a word and before a space or
// the end, so `index.js` and `PYTHONPATH=.` stay whole) or a word that opens the next clause.
const CLAUSE_END = /[,;:!?\n]|(?<=[\p{L}\p{N}_)\]"'`])\.(?=\s|$)|\s(?:instead|because|since|unless|when|but|so that)\b/iu;
// The words that end a command named in prose ("don't run npm test directly", "don't use make here"), so none is taken
// for its subcommand.
const PROSE = new Set(["here", "there", "directly", "inside", "in", "on", "from", "for", "to", "with", "without", "anymore", "again", "ever", "please", "now", "locally", "manually", "by", "at", "while", "before", "after", "until", "or", "and", "so", "as", "if", "outside", "into", "anywhere", "everywhere", "yourself", "either", "too", "also", "first", "the", "a", "an", "this", "that", "it", "any", "every", "all", "unless", "because", "bare", "alone"]);
// The mistake: a command under a negation. `scan`: how many of the words after it may come before the command ("don't
// run the tests with npm test"); `plain`: whether an everyday word right after it is a command.
const NEGATIONS = [
  { re: /\b(?:don'?t|do not|never|stop|avoid|quit|not to)\s+(?:(?:ever|again|just|even)\s+)?(?:run(?:ning)?|us(?:e|ing)|call(?:ing)?|typ(?:e|ing)|execut(?:e|ing)|invok(?:e|ing)|launch(?:ing)?)\s+/gi, scan: 4, plain: true },
  { re: /\b(?:don'?t|do not|never)\s+/gi, scan: 1, plain: false },
  { re: /\binstead of\s+(?:running\s+|using\s+|calling\s+)?/gi, scan: 1, plain: false },
  { re: /\bnot\s+/gi, scan: 1, plain: false },
];
// The right way: a command the sentence says to run. After a clause's mark, a colon or a sentence's period ("don't run
// X bare: use Y", "Don't run X bare. Use Y.").
const WAYS = [
  /\b(?:run|use|call|invoke|execute)\s+(?:(?:it|them|this|that|the\s+[\w-]+|tests?|commands?)\s+)?(?:as|with|via|through|using|like)\s+/gi,
  /\binstead,?\s+(?:run|use|call|type|execute|invoke)\s+/gi,
  /\b(?:always|only)\s+(?:run|use|call|invoke|execute)\s+/gi,
  /[;:,.\u2013\u2014]\s*(?:(?:but|just|instead|please)\s+)?(?:run|use|call|type|execute|invoke)\s+/gi,
];
// A way said before "instead" ("run Y instead"): in plain words to the clause's end, a sentence's period included,
// so a mistake named before it ("don't run X bare. Run Y instead.") never swallows the way after it.
const WAY_BEFORE_INSTEAD = /\b(?:run|use|call|type|execute|invoke)\s+(`[^`\n]+`|(?:[^,;:!?\n`.]|\.(?!\s|$))+?)\s+instead\b/gi;
// A way's verb under a negation ("never run the migrations with X") says the mistake, not the way.
const NEGATED = /\b(?:don'?t|do not|never|stop|avoid|quit|not)\s+(?:(?:ever|again|just|even|to)\s+)?$/i;

/**
 * The command a sentence names from `at`: a backticked one (within `scan` words; `code`), else plain words from a known
 * command.
 * @param {string} text @param {number} at @param {{ scan: number, plain: boolean }} o @returns {{ cmd: string, code: boolean } | null}
 */
function commandAt(text, at, { scan, plain }) {
  const rest = text.slice(at);
  const code = new RegExp(`^(?:[\\w'-]+\\s+){0,${scan - 1}}\`([^\`\\n]+)\``).exec(rest);
  if (code) return { cmd: code[1].trim(), code: true };
  const end = CLAUSE_END.exec(rest);
  const words = (end ? rest.slice(0, end.index) : rest).split(/\s+/).filter(Boolean);
  for (let i = 0; i < Math.min(scan, words.length); i++) {
    const w = words[i].toLowerCase().replace(/[`'"]/g, "").split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/, "") || "";
    if (!COMMANDS.has(w) || (PLAIN.has(w) && !(plain && i === 0))) continue;
    const cmd = words.slice(i);
    const stop = cmd.findIndex((x, k) => k > 0 && PROSE.has(x.toLowerCase()));
    return { cmd: (stop > 0 ? cmd.slice(0, stop) : cmd).join(" ").replace(/[`'"]+$/, ""), code: false };
  }
  return null;
}
// A word after a command named in plain words that is surely the command's, not the sentence's (M5-D31): an option, or
// a word with a path's, a name's or a number's mark in it (`--force`, `node_modules`, `build:prod`, `3000`).
const CODELIKE = /^-|[\\/._:=@*\d]/;
/**
 * The words that make a named command the mistaken one (M5-D31): every word after its shape when the user backticked
 * it; in plain words, only those that are surely the command's (`CODELIKE`) and what a runner runs (`targetOf`), so a
 * word of the sentence ("never run psql against prod") never keeps a trigger from firing.
 * @param {string[]} words  the command's own words @param {string} shape @param {boolean} code
 */
function argsOf(words, shape, code) {
  const rest = afterShape(words, shape);
  const target = new Set(targetOf(words).split(" ").filter(Boolean));
  return rest.filter((w) => code || CODELIKE.test(w) || target.has(bare(w))).map(bare).join(" ");
}
/** The text a way starts with at `at`: a backticked command, or the words to the clause's end. @param {string} text @param {number} at */
function wayAt(text, at) {
  const rest = text.slice(at);
  const code = /^`([^`\n]+)`/.exec(rest);
  if (code) return code[1].trim();
  const end = CLAUSE_END.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}
/**
 * Where a command starts among a way's own words (M5-D32): at the first, or after the words of a wrapper Filament does
 * not know (`dotenv -e .env.test npm run migrate`, `npx jest`), none of them prose (`the linter with eslint` is a
 * sentence, not a wrapper); -1 when `is` holds nowhere.
 * @param {string[]} words @param {(rest: string[], k: number) => boolean} is  whether the words from `k` on are the command
 */
function startOf(words, is) {
  for (let k = 0; k < words.length; k++) {
    if (is(words.slice(k), k)) return k;
    if (PROSE.has(words[k].toLowerCase())) return -1;
  }
  return -1;
}
/**
 * What a way adds to a command of `shape`: what sets up its run (a known wrapper's or an unknown one's words, M5-D32),
 * else the commands run before it, else (`suffix`) its own arguments; null when it adds nothing or runs another
 * command.
 * @param {string} way @param {string} shape @param {boolean} suffix
 */
function addedBy(way, shape, suffix) {
  for (const sc of simpleCommands(way)) {
    const { setup, words } = commandParts(sc);
    const k = startOf(words, (rest) => shapeOfWords(rest) === shape);
    if (k < 0) continue;
    const pre = [setup, ...words.slice(0, k)].filter(Boolean).join(" ");
    if (pre) return pre;
    const before = way.slice(0, Math.max(0, way.indexOf(sc))).replace(/\s*(?:&&|\|\||;|\|)\s*$/, "").trim();
    if (before) return before;
    const args = suffix ? afterShape(words, shape).join(" ").trim() : "";
    return args || null;
  }
  return null;
}

/**
 * The pitfalls a claim's words name (M5-2), deterministic. A command under a negation is a trigger ("don't run X",
 * "never use X", "stop running X", "instead of X", "not X"), with the words that make it the mistaken one (`argsOf`:
 * `--force` of "never run git push --force", M5-D31); the right way the sentence gives ("run it as Y", "use Y
 * instead") is its `unless` when Y runs the same command: what Y adds to it, its setup first ("env -u CLAUDECODE").
 * A way with a setup and no negation is a trigger too, on the command it sets up ("always run tests with env -u A npm
 * test", M5-D7), with what a runner runs as its words (`targetOf`). Words that name no command arm nothing.
 * @param {string} text @returns {Trigger[]}
 */
export function pitfallsOf(text) {
  const s = String(text ?? "");
  /** @type {string[]} */
  const ways = [];
  for (const re of WAYS) for (const m of s.matchAll(re)) if (!NEGATED.test(s.slice(0, m.index))) ways.push(wayAt(s, (m.index ?? 0) + m[0].length));
  for (const m of s.matchAll(WAY_BEFORE_INSTEAD)) if (!NEGATED.test(s.slice(0, m.index))) ways.push(m[1].replace(/^`|`$/g, "").trim());
  /** @type {Trigger[]} */
  const out = [];
  const add = (/** @type {string} */ shape, /** @type {string} */ args, /** @type {string | null} */ unless) => {
    if (!out.some((t) => t.shape === shape && t.args === args)) out.push({ tool: "bash", shape, args, unless });
  };
  for (const n of NEGATIONS)
    for (const m of s.matchAll(n.re)) {
      const named = commandAt(s, (m.index ?? 0) + m[0].length, n);
      const first = named ? simpleCommands(named.cmd)[0] : null;
      const words = first ? commandParts(first).words : [];
      const shape = shapeOfWords(words);
      if (!shape) continue;
      const unless = ways.map((w) => addedBy(w, shape, true)).find(Boolean) ?? null;
      add(shape, argsOf(words, shape, !!named?.code), unless);
    }
  for (const w of ways)
    for (const sc of simpleCommands(w)) {
      const { setup, words } = commandParts(sc);
      const k = startOf(words, (rest, at) => {
        const head = shapeOfWords(rest)?.split(" ")[0] ?? "";
        return COMMANDS.has(head) && (at === 0 || !PLAIN.has(head));
      });
      if (k < 0) continue;
      const pre = [setup, ...words.slice(0, k)].filter(Boolean).join(" ");
      const shape = shapeOfWords(words.slice(k));
      if (shape && pre) add(shape, targetOf(words.slice(k)), pre);
    }
  return out;
}
