// @ts-check
// Memory-backed permissions (plan WP-L): the agent loop's gate learns what the developer always says yes to. A call's
// question offers Always allow in this project for its SHAPE (a bash command's head, a write's file class) from the
// first ask, as Claude Code offers it (HarnessV4_Tasks E3); chosen, the gate lets that shape through without asking.
// Every allow is also counted per project under the shape, and at the threshold one `permission` item is offered
// (inferred) on the Memory page — and to a client that draws no card, in its reply. The rule is a memory item like
// any other — listed, confirmed, dismissed in the same place — and scoped to its project. Bash never gets a blanket
// allow: a rule is one command shape, and a compound command (pipes, chains, redirects) is never learned at all.

/** @typedef {{ tool: string, shape: string, text: string }} PermissionShape */

const SUBCOMMAND = /^[a-z][\w:.+-]*$/i;
// Anything that makes a command more than one simple command: never learned, always asked.
const COMPOUND = /[|;&<>`\n]|\$\(/;
// Tools whose first bare word is a subcommand, so `npm test` and `npm publish` are two shapes. Anything else is one
// shape per head word (`echo hi` and `echo bye` are both `echo`): there is no syntax that tells a subcommand from an
// argument, so the list is the rule, as it is in the allow-lists people write by hand.
export const SUBCOMMAND_TOOLS = new Set([
  "npm", "pnpm", "yarn", "npx", "bun", "bunx", "deno", "node", "corepack",
  "git", "gh", "hg", "svn",
  "cargo", "go", "rustup", "dotnet", "mvn", "gradle", "make", "just", "task",
  "pip", "pip3", "uv", "uvx", "poetry", "pipx", "conda",
  "docker", "podman", "kubectl", "helm", "terraform",
  "brew", "apt", "apt-get", "winget", "choco", "scoop",
]);

/** The shells that can be handed their script on the line: the head word of such a line names the shell, not what runs. */
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]);
/**
 * The interpreters that can be handed their program on the line, each by a letter in a word of its short flags
 * (`python -Ic '…'`, `perl -lne '…'`), the program in that word or the next. Node's `-e` stands where its subcommand
 * would, so it has no shape already.
 */
const INTERPRETERS = Object.freeze([
  { word: /^(?:python[\d.]*w?|py)$/, flag: /^-[A-Za-z0-9]*c/ },
  { word: /^perl[\d.]*$/, flag: /^-[A-Za-z0-9]*[eE]/ },
  { word: /^ruby[\d.]*$/, flag: /^-[A-Za-z0-9]*e/ },
  { word: /^php[\d.]*$/, flag: /^-[A-Za-z0-9]*[rRBE]/ },
]);
/**
 * The programs that run another command their words name (`env X=1 python -c …`, `xargs rm`, `timeout 5 sh -c …`,
 * `sudo …`, PowerShell's `Invoke-Expression`, cmd's `start`): their head says nothing of what runs, as a shell's `-c`
 * says nothing. As SUBCOMMAND_TOOLS, the list is the rule.
 */
export const RUNS_A_COMMAND = new Set([
  "env", "xargs", "timeout", "nice", "nohup", "time", "stdbuf", "ionice", "taskset", "chrt", "setsid", "unbuffer",
  "sudo", "doas", "su", "runas", "pkexec", "command", "exec", "builtin", "eval", "watch", "flock", "chroot", "nsenter",
  "unshare", "firejail", "systemd-run", "xvfb-run", "parallel", "busybox", "strace", "ltrace", "valgrind", "script",
  "start", "call", "start-process", "saps", "invoke-expression", "iex", "invoke-command", "icm", "start-job",
]);
/** awk in every name: it runs commands from its program (`system(…)`) or a program file, which its name says nothing of. */
const AWKS = new Set(["awk", "gawk", "mawk", "nawk"]);
/**
 * An awk line whose program can run a command or write a file: `system(…)`, gawk's `@load`/`@include` (`AWK_RUNS`), or
 * a switch that reads its program from a file, loads an extension or includes a source — `-f`, `-E`, gawk's `-l`, `-i`
 * (`-i inplace` rewrites the files it reads) and their long names (`AWK_SWITCH`).
 */
const AWK_RUNS = /\bsystem\s*\(|@(?:load|include)\b/;
const AWK_SWITCH = /^-(?:[fil]|E$|-(?:file|exec|include|load)\b)/;
/** find's actions that run or remove what it finds (`-exec rm {} +`, `-delete`), or write a file. */
const FIND_ACTS = /^-(?:exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/;
/**
 * PowerShell's switch for a script on the line, in every spelling it takes: led by a dash (or an en dash, an em dash
 * or a horizontal bar, which it reads as one), `--` (pwsh) or `/`, and any start of `-Command` (`-co`),
 * `-CommandWithArgs`' `-cwa`, or `-EncodedCommand`'s.
 */
const PS_SCRIPT = /^(?:[-–—―]{1,2}|\/)(?:c|co[a-z]*|cwa|e|ec|en[a-z]*)$/i;
/**
 * Whether a program is handed its script on the line: a POSIX shell's `-c` (alone or among its letters: `-lc`), cmd's
 * `/c`, `/k` and `/r` (alone, among its switches: `/d/c`, or with the line after it: `/cdel`), PowerShell's
 * `PS_SCRIPT`, an interpreter's flag for its program (`INTERPRETERS`). Each word is read as the shell hands it on, its
 * quotes gone: `cmd "/c" del x` is `cmd /c del x`.
 * @param {string} program  the head's bare word, without quotes @param {string[]} rest  the words after it
 */
const carries = (program, rest) => {
  const words = rest.map((t) => t.replace(/["']/g, ""));
  if (POSIX_SHELLS.has(program)) return words.some((t) => t === "--command" || /^-[A-Za-z]*c[A-Za-z]*$/.test(t));
  if (program === "cmd") return words.some((t) => /^(?:\/[a-z](?::[a-z]+)?)*\/[ckr]/i.test(t));
  if (program === "powershell" || program === "pwsh") return words.some((t) => PS_SCRIPT.test(t));
  const by = INTERPRETERS.find((i) => i.word.test(program));
  return !!by && words.some((t) => by.flag.test(t));
};

/**
 * The words a simple command's shape is made of: its head as typed, the head's bare word (no folder, no `.exe`, `.cmd`
 * or `.bat`, lower-cased), and the subcommand for the tools that have them, lower-cased ("" for none).
 * @param {string[]} tokens  the command's words @returns {{ head: string, word: string, sub: string }}
 */
export function commandWords(tokens) {
  const head = tokens[0] || "";
  const word = (head.split(/[\\/]/).pop() || head).toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
  const sub =
    SUBCOMMAND_TOOLS.has(word) && tokens[1] && !tokens[1].startsWith("-") && SUBCOMMAND.test(tokens[1]) && !/[\\/]/.test(tokens[1])
      ? tokens[1].toLowerCase()
      : "";
  return { head, word, sub };
}

/**
 * The shape a permission is learned under — what "the same call" means for the gate.
 * - bash: the command's head word, plus its subcommand for the tools that have them (`npm test`, `git status`;
 *   `echo`); flags, paths and arguments are not part of it, and a compound command has no shape. Nor has a tool with
 *   subcommands whose subcommand can't be read (`git -C x push`, `node --test`: a flag stands where it would be) —
 *   learned, it would be every call of the tool that starts with a flag. A powershell command is learned as bash's:
 *   one approval history and one rule per command, whichever shell ran it (TL-D5). A shell handed its script on the
 *   line (`bash -lc '…'`, `cmd /c …`, `"C:\…\powershell.exe" -Command '…'`, as Codex words every command of its own)
 *   has no shape either: learned, it would be every command that shell runs, under the name of one (HarnessV4_Tasks
 *   C10) — `bash build.sh` is still `bash`. Nor has an interpreter handed its program so (`python -c '…'`,
 *   `perl -e '…'`), for the same reason: `python test.py` is still `python`. Nor has a PowerShell script with a block (`if (…) { … }`,
 *   `ForEach-Object { … }`): its first word says nothing of what the block runs. Nor has a program that runs the
 *   command its words name (`RUNS_A_COMMAND`: `env`, `xargs`, `timeout`, `sudo` …), a head that is an assignment or a
 *   variable, awk with a program that can run a command, or find with an action that runs or removes (`-exec`, `-delete`).
 * - write / edit: the file's class by extension (`*.md`), or `(no extension)`.
 * Other tools never ask, so they have no shape.
 * @param {string} tool @param {any} input
 * @returns {PermissionShape | null}
 */
export function permissionShape(tool, input) {
  const inp = input || {};
  if (tool === "bash" || tool === "powershell") {
    const cmd = String(inp.command || "").trim();
    if (!cmd || COMPOUND.test(cmd)) return null;
    const tokens = cmd.split(/\s+/);
    const { head, word, sub } = commandWords(tokens);
    if (SUBCOMMAND_TOOLS.has(word) && !sub && tokens.length > 1) return null;
    const bare = word.replace(/^["']+|["']+$/g, "").replace(/\.exe$/, "");
    if (carries(bare, tokens.slice(1))) return null;
    // A head that says nothing of what runs: a program that runs the command its words name, an assignment before the
    // command (`X=1 rm …`), a variable's value (`$EDITOR …`, `%COMSPEC% …`); nor does awk's name, whose program can
    // run one, nor find's, whose actions run or remove what it finds.
    if (RUNS_A_COMMAND.has(bare) || head.includes("=") || /^["']?[$%]/.test(head)) return null;
    if (AWKS.has(bare) && (AWK_RUNS.test(cmd) || tokens.slice(1).some((t) => AWK_SWITCH.test(t.replace(/["']/g, ""))))) return null;
    if (bare === "find" && tokens.slice(1).some((t) => FIND_ACTS.test(t.replace(/["']/g, "")))) return null;
    if (tool === "powershell" && cmd.includes("{")) return null;
    // Lower-cased (Windows shells do not care about case: `NPM test` and `npm test` are one shape) but the head as
    // typed, path included: a rule for `npm test` must not let `.\somewhere\npm test` through.
    const shape = sub ? `${head.toLowerCase()} ${sub}` : head.toLowerCase();
    return { tool: "bash", shape, text: `bash: ${shape}` };
  }
  if (tool === "write" || tool === "edit") {
    const p = String(inp.path || inp.file_path || "").trim();
    if (!p) return null;
    const base = p.split(/[\\/]/).pop() || "";
    const dot = base.lastIndexOf(".");
    const shape = dot > 0 ? `*${base.slice(dot).toLowerCase()}` : "(no extension)";
    return { tool, shape, text: `${tool}: ${shape}` };
  }
  return null;
}

/**
 * The permission item's text for a shape a question offered, as the page sends it back (HarnessV4_Tasks E3): bash and
 * a command's head (`npm test`), write or edit and a kind of file (`*.md`, `(no extension)`). Null for anything
 * `permissionShape` does not make: another tool, a compound command, a path, a line break.
 * @param {unknown} tool @param {unknown} shape
 * @returns {string | null}
 */
export function shapeText(tool, shape) {
  const s = typeof shape === "string" ? shape.trim() : "";
  if (!s || s.length > 200 || /[\r\n]/.test(s)) return null;
  if (tool === "bash") return COMPOUND.test(s) ? null : `bash: ${s.toLowerCase()}`;
  if (tool === "write" || tool === "edit") return s === "(no extension)" || /^\*\.[^\s\\/*?]+$/.test(s) ? `${tool}: ${s.toLowerCase()}` : null;
  return null;
}

/** The sentence the offer is made with. @param {PermissionShape} s @param {number} count */
export function offerText(s, count) {
  const what = s.tool === "bash" ? `the command \`${s.shape}\`` : `${s.tool === "write" ? "writing" : "editing"} ${s.shape} files`;
  return `You have allowed ${what} ${count} times in this project. An always-allow for it is waiting as a memory item (kind permission, inferred): confirm it on the Memory page to stop being asked, or dismiss it.`;
}

/**
 * Whether the person's word on a memory makes an Always allow — a press (http/guards.js `pressRefused`): a `permission`
 * confirmed, whose shape the gate lets through from then on (`allowedBy`), or given new words, which stand confirmed
 * as an Always allow for whatever they name, an offer nobody confirmed among them. No words retire it, which asks less
 * of nobody, and a memory of any other kind allows no call. One judgement for the Memory page's rows
 * (http/admin/memory.js) and for the same act typed as chat words (app/commands/mem.js `memAsksLess`; s-rows, 11-12).
 * @param {{ kind?: string, error?: string } | null | undefined} claim  the memory its id names, as the port's `claim` reads it
 * @param {{ confirm: true } | { text: unknown }} act  confirmed, or corrected to these words
 */
export const allowsAlways = (claim, act) => !!claim && !("error" in claim) && claim.kind === "permission" && ("confirm" in act || !!String(act.text || "").trim());

/**
 * @typedef {object} LearnedPermissions
 * @property {(a: { projectId: string, tool: string, input: any }) => any | null} allowedBy
 *   the confirmed permission item that covers this call in this project, or null
 * @property {(a: { projectId: string, chainId?: string | null, tool: string, input: any }) => { shape: PermissionShape, count: number, offered: any | null } | null} recordAllow
 *   count one allow; at the threshold, with no item yet for the shape, an inferred `permission` item is created and returned as `offered`
 * @property {(a: { projectId: string, tool: string, input: any }) => { itemId: number | null, tool: string, shape: string } | null} offeredFor
 *   the always-allow this call's question carries for the page's Always allow (HarnessV3-Views V3), from the first
 *   ask of its shape in this project (HarnessV4_Tasks E3): with the inferred `permission` item a yes brought to the
 *   threshold, nobody has confirmed or dismissed yet, or with none (`itemId` null), which Always allow makes. Null
 *   for a call with no shape, a shape always allowed already, and one dismissed: it is not offered again
 * @property {number} threshold
 */

/**
 * @param {{ archive: any, threshold?: number }} deps  threshold 0 turns learning off (confirmed items still apply)
 * @returns {LearnedPermissions}
 */
export function createLearnedPermissions({ archive, threshold = 5 }) {
  const n = Math.max(0, Math.floor(Number(threshold) || 0));
  const itemsFor = (projectId, status) => archive.items.list({ projectId, kind: "permission", status, limit: 500 });
  /**
   * Whether the project holds any permission item of these words: one look in the archive's index on an item's words,
   * which hold the same words told apart by less (case, spaces, an end's stop). Most gated calls have none of their
   * shape, and listing the project's items to match each — up to 500 — took every one of them.
   * @param {string} projectId @param {string} text
   */
  const anyOf = (projectId, text) => archive.items.withText(projectId, "permission", text) !== null;
  return {
    threshold: n,
    allowedBy({ projectId, tool, input }) {
      if (!projectId || projectId === "none") return null;
      const s = permissionShape(tool, input);
      if (!s || !anyOf(projectId, s.text)) return null;
      return itemsFor(projectId, "confirmed").find((it) => it.text === s.text) || null;
    },
    offeredFor({ projectId, tool, input }) {
      if (!n || !projectId || projectId === "none") return null;
      const s = permissionShape(tool, input);
      if (!s) return null;
      const items = anyOf(projectId, s.text) ? itemsFor(projectId, undefined).filter((it) => it.text === s.text) : [];
      // Confirmed, it is always allowed already (it asks only where a rule or the mode says so); dismissed or
      // superseded, it is not offered again.
      if (items.some((it) => it.status !== "inferred")) return null;
      return { itemId: items[0] ? items[0].id : null, tool: s.tool, shape: s.shape };
    },
    recordAllow({ projectId, chainId = null, tool, input }) {
      if (!n || !projectId || projectId === "none") return null;
      const s = permissionShape(tool, input);
      if (!s) return null;
      const settings = archive.projectSettings(projectId);
      const approvals = { ...(settings.permissionApprovals || {}) };
      const count = (Number(approvals[s.text]?.count) || 0) + 1;
      approvals[s.text] = { count, lastAt: Date.now() };
      archive.setProjectSettings(projectId, { permissionApprovals: approvals });
      let offered = null;
      if (count >= n && !(anyOf(projectId, s.text) && itemsFor(projectId, undefined).some((it) => it.text === s.text))) {
        const r = archive.items.add({ projectId, chainId, kind: "permission", text: s.text, status: "inferred", importance: 0.8, origin: "learner" });
        if (r?.id && !r.deduped) offered = archive.items.get(r.id);
      }
      return { shape: s, count, offered };
    },
  };
}
