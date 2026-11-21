// @ts-check
// "Always allow in this chat" (d-allow, the owner's of 11-12): the commands a chat keeps that the person allowed for
// good in it. The project's always-allow is learned by a command's shape — its head word and its subcommand
// (services/memory/permissions.js) — and a test command has none: `node --test test/a.test.js` has a flag where the
// subcommand would be, a path is no subcommand, and a pipe makes it compound. Such a command asked at every run (a team's
// lead ran three test files: seven Allow presses in one turn). Its card offers to allow exactly that command in this
// chat: a press keeps each part of it that neither only reads nor is a `cd` into the folder it runs in, on the chat's
// meta (`alwaysRun`), and from then on a command of those parts runs without asking — read part by part as a brief's
// grant is (grants.js `grantFor`, given exact entries): the kept text as written, never with more words after it, beside
// parts that only read, `2>&1` and output thrown away read past. Never an install, a step that cannot be undone, a
// redirect or a substitution; and only in the folder and through the hand's family it was asked in.
// Narrower than a brief's grant where the person read less: a brief names its commands, a press allows what its card
// showed. So a command is neither kept nor run on what was kept where its parts are not its shell's — a mark its quotes
// hold (the parts are cut blind to quotes: `git commit -m "wip; curl x | sh"` would keep `curl x`), or more than one
// line (a grant reads a line break as a blank: `node --test` and `test/a.test.js` on two lines would read as the kept
// one) — nor where it moves to another folder or names another to run in.
// It lifts the gate's own ask and nothing more: a deny rule, an ask or a review rule, read-only and the fence still win.
// The chat's own seat alone has it — its agent, or a team's lead in charge of it —, never a sub-agent or a worker, whose
// asks have their own roads, nor a chat another machine's agents started; a new chat and a fork start with none. It is
// read from the meta at each verdict (`keptNow`), never at a turn's start: a press holds for the turn's next request,
// and Forget (the permission switch's Remembered rules) makes the command ask again in the middle of one.
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { UNCOVERABLE, asksFirst, commandSegments, movesAway, staysPut } from "./rules.js";
import { grantFor, installs, plain, unquoted } from "./grants.js";
import { oneWayOf } from "../../core/signs.js";
import { listed } from "../../core/text.js";
import { isCommandHand } from "../../adapters/tools/hands.js";

/** The key of a chat's meta its kept commands are under. */
export const ALWAYS_RUN = "alwaysRun";
/**
 * How many commands a chat keeps, and how long one may be. Past either the row is not offered and the route keeps
 * nothing: an older one is never dropped for a new one.
 */
export const ALWAYS_MAX = 100;
export const ALWAYS_CHARS = 2000;

/**
 * @typedef {"bash" | "powershell"} Hand  the family of a hand that runs commands: bash and bash_background are one
 *   (one shell reads both), powershell another
 * @typedef {{ command: string, hand: Hand, folder: string, at: number }} Kept  a command a chat keeps: one part of a
 *   command as a grant reads it (`plain`, `commandSegments`), the family of the hand it was asked through, the folder
 *   its call ran in, and when it was kept (ms)
 * @typedef {{ hand: Hand, folder: string, commands: string[] }} Keeps  what an ask offers to keep, beside the
 *   project's `offer`: the parts a press of "Always allow in this chat" keeps, for that hand and folder. Made by the
 *   server (`keepsFor`); the route that takes it back reads each command again (`keepsOf`)
 * @typedef {{ at: import("./rules.js").CommandPlace, readsOnly: (part: string) => { ok: boolean } | null, cwd?: string | null }} Reading
 *   how a command is read: `at`, the folder it is judged in and its shell; `readsOnly`, the switch's reader, on one
 *   part; `cwd`, the folder its call names to run in, where it names one
 */

/** The family of a hand that runs commands; null for any other call. @param {string} name @returns {Hand | null} */
export const handOf = (name) => (name === "powershell" ? "powershell" : isCommandHand(name) ? "bash" : null);

/**
 * A folder as the filesystem resolves it, where it is there — as turn.js `realFolder` reads one (the loop reads this
 * module, and turn.js the loop). @param {string} p
 */
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
/**
 * Whether a folder is `here`, whatever its spelling: each spelling resolved once, as a chat's kept commands mostly
 * name one folder. @param {string} here
 */
export const folderIs = (here) => {
  const at = here ? real(here) : "";
  /** @type {Map<string, boolean>} */
  const seen = new Map();
  return (/** @type {string} */ folder) => {
    let is = seen.get(folder);
    if (is === undefined) seen.set(folder, (is = !!at && !!folder && relative(real(folder), at) === ""));
    return is;
  };
};
/** Whether two spellings name one folder. @param {string} a @param {string} b */
export const sameFolder = (a, b) => folderIs(a)(b);
/** The same command, as a grant compares one: without case. @param {string} a @param {string} b */
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
/** A command as the words name it. @param {string} c */
const q = (c) => `\`${c}\``;

/**
 * Why a command's parts are not what its shell runs, or where it runs is not where it is judged — or null: more than
 * one line, a mark its quotes hold, another folder named to run in, a `cd` elsewhere. Such a command is neither kept
 * nor run on what was kept.
 * @param {string} command @param {string} name @param {Pick<Reading, "at" | "cwd">} place
 */
const unread = (command, name, { at, cwd = null }) => {
  if (/[\r\n]/.test(String(command).trim())) return "it is more than one line";
  const text = plain(command);
  if (unquoted(text) !== text) return "its quotes hold a mark that cuts a command, so its parts cannot be told apart";
  if (cwd && !sameFolder(cwd, at.root)) return "it names another folder to run in";
  if (commandSegments(text).some((part) => movesAway(part, name, at))) return "it moves to another folder";
  return null;
};

/**
 * What a press of "Always allow in this chat" keeps of a command: each part that neither only reads nor is a `cd` into
 * the folder it runs in, once — or why it keeps nothing, in words: an install, a step that cannot be undone, a redirect
 * or a substitution, a command read otherwise than its shell runs it (`unread`), or nothing left to keep. The one rule
 * of what may be kept: the offer is made by it (`keepsFor`), and the route that keeps reads each command by it again.
 * @param {string} command @param {string} name  the hand: bash, bash_background or powershell @param {Reading} place
 * @returns {{ commands: string[] } | { why: string }}
 */
export function keepsOf(command, name, { at, readsOnly, cwd = null }) {
  if (!handOf(name)) return { why: "it runs no command" };
  if (installs(command)) return { why: "it installs packages" };
  const once = oneWayOf(command);
  if (once) return { why: `it is a step that cannot be undone (${once})` };
  const not = unread(command, name, { at, cwd });
  if (not) return { why: not };
  /** @type {string[]} */
  const commands = [];
  for (const part of commandSegments(plain(command))) {
    if (UNCOVERABLE.test(part)) return { why: "it redirects or substitutes, which puts more in a command than its words say" };
    if (staysPut(part, name, at) || readsOnly(part)?.ok) continue;
    if (part.length > ALWAYS_CHARS) return { why: `a command kept is at most ${ALWAYS_CHARS.toLocaleString("en-US")} characters` };
    if (!commands.some((c) => same(c, part))) commands.push(part);
  }
  return commands.length ? { commands } : { why: "nothing in it is left to keep: each part only reads, or is a cd into the folder it runs in" };
}

/**
 * The chat's kept commands a call runs on — each once, in the order its parts used them — or null: a grant's reading
 * (`grantFor`) of the ones kept for the call's hand family and the folder it is judged in, each covering itself alone.
 * Each part is a kept command, one that only reads or a cd that stays put, and one at least is kept. The one rule of
 * where it lifts, for a coding agent's requests (agent-permits.js) and the loop's own calls (loop.js).
 * @param {readonly Kept[]} kept @param {string} command @param {string} name @param {Reading} place
 * @returns {string[] | null}
 */
export function keptFor(kept, command, name, { at, readsOnly, cwd = null }) {
  const hand = handOf(name);
  const here = folderIs(at.root);
  const mine = hand ? kept.filter((k) => k.hand === hand && here(k.folder)) : [];
  if (!mine.length || unread(command, name, { at, cwd })) return null;
  return grantFor({ check: [], mayRun: [], exact: mine.map((k) => k.command) }, command, name, { at, readsOnly, outside: () => false });
}

/**
 * The chat's offer on an ask: what a press would keep of its command, or null where its card has no such row. Only the
 * gate's own ask for a command gets one — never an ask or a review rule's (the rule would ask again), a link's or a
 * send's, nor a button's press — and only where the card shows the command whole (`shown`, tools.js `shownCommand`):
 * redacted or cut, the person would allow what they did not read, and the kept text could hold a secret. None past
 * what a chat keeps (`ALWAYS_MAX`). The seat decides the rest: whether it is the chat's own, and that the card offers
 * no always-row of the project's.
 * @param {{ name: string, input: any }} call
 * @param {{ verdict: string, links?: unknown, sends?: unknown, outside?: unknown }} g  the verdict that asks: the
 *   gate's, under the rules
 * @param {import("./rules.js").RuleHit | null} hit  what the rules say of the call: an ask or a review rule speaks for
 *   it whether or not the gate asked too (`asksFirst`)
 * @param {{ kept: readonly Kept[], shown: string | null } & Pick<Reading, "at" | "readsOnly">} o
 * @returns {Keeps | null}
 */
export function keepsFor(call, g, hit, { kept, shown, at, readsOnly }) {
  const hand = handOf(call.name);
  if (!hand || g.verdict !== "ask" || asksFirst(hit) || g.links || g.sends || g.outside || call.input?.press) return null;
  const command = String(call.input?.command ?? "");
  if (shown !== command) return null;
  const k = keepsOf(command, call.name, { at, readsOnly, cwd: typeof call.input?.cwd === "string" ? call.input.cwd : null });
  if (!("commands" in k)) return null;
  const keeps = { hand, folder: at.root, commands: k.commands };
  return withKept(kept, keeps, 0) ? keeps : null;
}

/**
 * A chat's kept commands as its meta holds them: each entry whole, anything else left out — what cannot be read keeps
 * nothing. @param {unknown} v @returns {Kept[]}
 */
export const keptOf = (v) =>
  Array.isArray(v)
    ? v.filter((k) => k && typeof k === "object" && typeof k.command === "string" && k.command !== "" && k.command.length <= ALWAYS_CHARS && (k.hand === "bash" || k.hand === "powershell") && typeof k.folder === "string" && k.folder !== "")
    : [];

/**
 * A chat's kept commands now, read from its meta: asked at each verdict, so a press holds for the turn's next request
 * and Forget makes the command ask again in the middle of one. A meta that cannot be read keeps nothing: the command
 * asks.
 * @param {{ metaOf?: (chain: string, keys: readonly string[]) => Record<string, any> | null } | null | undefined} archive
 * @param {string | null | undefined} chain
 * @returns {Kept[]}
 */
export function keptNow(archive, chain) {
  if (!archive?.metaOf || !chain) return [];
  try {
    return keptOf(archive.metaOf(chain, [ALWAYS_RUN])?.[ALWAYS_RUN]);
  } catch {
    return [];
  }
}

/**
 * A chat's kept commands with an offer's added — a command once for its hand and folder — or null where that is more
 * than a chat keeps (`ALWAYS_MAX`): nothing is kept then, and no older one dropped for it.
 * @param {readonly Kept[]} kept @param {Keeps} keeps @param {number} at  when (ms)
 * @returns {Kept[] | null}
 */
export function withKept(kept, { hand, folder, commands }, at) {
  const out = [...kept];
  const there = folderIs(folder);
  for (const command of commands) {
    if (!out.some((k) => k.hand === hand && same(k.command, command) && there(k.folder))) out.push({ command, hand, folder, at });
  }
  return out.length > ALWAYS_MAX ? null : out;
}

/**
 * A chat's kept commands without one, as Forget takes it back: the command of that hand's family kept for that folder.
 * @param {readonly Kept[]} kept @param {{ command: string, hand: string, folder: string }} one
 * @returns {Kept[]}
 */
export function withoutKept(kept, { command, hand, folder }) {
  const there = folderIs(folder);
  return kept.filter((k) => !(k.hand === hand && same(k.command, command) && there(k.folder)));
}

/**
 * The kept commands a call ran on, as the record says them after "ran on": "this chat's always-allow `node --test
 * test/a.test.js`". @param {readonly string[]} used  `keptFor`'s answer
 */
export const alwaysWords = (used) => `this chat's always-allow ${listed(used.map(q))}`;
