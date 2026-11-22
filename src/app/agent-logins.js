// @ts-check
// More than one account for a coding agent (HarnessV3-ACP AC3-7). An account is an agent upstream: the Default one
// runs on the agent's usual login; an added one has a folder of its own, which the agent's CLI reads its login,
// settings and sessions from (`acp.home`), or, on Cursor's SDK route, a key of its own. Here accounts are added,
// renamed and removed, and signed in and out the ways each agent's bridge names: a program run in a terminal the
// harness shows (the ways Claude's adapter names; the CLI's own for Cursor's CLI and Qoder, and for Codex
// where its app-server can't start), a page in the browser (Codex's app-server; Cursor's SDK, which makes a key; an ACP
// agent's own, which it opens itself), or a key the person pastes (the review of 11-10: Codex's OpenAI API key, handed
// to Codex, which keeps it in its folder; a key an ACP agent reads from a variable, kept sealed in the account's
// environment as a card's variables are — until its sign-in fails or is stopped, which puts back what the variable
// held, or Sign out forgets it). The person signs in on the agent's own page or with their own key: Filament
// never types a credential, keeps none but that variable, and says no key in a log, an operation or an answer.
// One sign-in an account at a time, from the moment it is asked for: one asked for meanwhile is that one.
// Where an agent doesn't say who it runs as itself (Cursor's CLI, Qoder, Antigravity; Claude's adapter before its first
// start), whether someone is signed in is read without a turn — its CLI's status — at start, as a page reads the accounts, at Check now and
// as a sign-in ends, and learnt from its turns and from the sessions it opens for its models: the model picker offers it
// only while someone is (the owner's of 10-30). Where nothing says who, someone signed in is kept as that, and a sign-in
// or a sign-out that ended well is the word where nothing else can tell (the owner's of 11-11: Antigravity's row read
// as not signed in after each sign-in that worked).
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { CURSOR_SDK_OFF, KNOWN_AGENTS, accountId, accountStyle, agentKey, agentName, agentTitle, commandLine, cursorSdkHeld, folderLineVars, signInLine } from "../core/catalogues.js";
import { CANNOT_TELL, notSignedIn } from "../core/agent-limits.js";
import { placeAgentRoute, withoutUpstreams } from "../core/routing.js";
import { accountIsOff, isAgentUpstream } from "../core/schema.js";
import { agentEnv, resolveAgentCommand } from "../adapters/agents/agent-process.js";
import { SECRET_ENV_RE } from "../services/config/secrets.js";
import { changeConfig, failure } from "./config-change.js";

/** How long a sign-in in the browser waits for the person before it stops by itself. */
export const BROWSER_WAIT_MS = 15 * 60_000;
/** How long a reading of an agent's sign-in serves before a page's read of the accounts reads it again. */
export const SIGN_IN_READ_MS = 60_000;
/**
 * Where what is kept of an agent's sign-in came from: its CLI or its files, its turns and the sessions it opens for its
 * models, a sign-in that ended well, a sign-out that did.
 */
const FROM_STATUS = "status";
const FROM_TURN = "turn";
const FROM_SIGN_IN = "sign-in";
const FROM_SIGN_OUT = "sign-out";

/**
 * A way an agent signs in, as the page offers it: the agent's own name for it and what it says of it; a key's way says
 * so, with its field's label; a page's way that finishes from a browser on another computer says that (`far`), for the
 * command line, which offers it first where no page comes back.
 * @typedef {{ id: string, name: string, description: string, kind?: "key", label?: string, far?: true }} Way
 */
/**
 * A sign-in under way, as the page shows it: in a terminal (the terminal's id), on a page in the browser (its address,
 * and the code Codex asks to be typed there when it gave one; none where the agent opens its page itself), or with a
 * key, being checked. `line`: the same sign-in as a line to run in a terminal instead.
 * @typedef {{ kind: "terminal", way: string, name: string, terminal: string, line: string | null, at: number }
 *   | { kind: "browser", way: string, name: string, url: string | null, code: string | null, line: string | null,
 *       at: number }
 *   | { kind: "key", way: string, name: string, at: number }} SignIn
 */
/** The longest key a field takes. */
const KEY_MAX = 4096;
/**
 * How an account's last sign-in or sign-out ended, until the next one starts. `key-kept`: a pasted key is kept, and
 * nothing here could check it — its next turn tries it.
 * @typedef {{ outcome: "signed-in" | "key-kept" | "signed-out" | "failed" | "cancelled", error: string | null,
 *   at: number }} SignInEnd
 */
/** @typedef {import("../core/ports.js").SignInWay} SignInWay */
/** @typedef {import("../core/agent-limits.js").SignInReading} SignInReading */

/** An account's name as its id ends: `Work Laptop` → `work-laptop`. @param {string} name */
const slugOf = (name) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * A way as the page reads it: its name and its words, not the program it runs; a key's, its field's label; a page's
 * that finishes from another computer, that it does (the re-read of 11-11: the command line sorts by it, and it was
 * left out here).
 * @param {SignInWay} w @returns {Way}
 */
const shown = (w) => ({
  id: w.id,
  name: w.name,
  description: w.description,
  ...(w.kind === "key" ? { kind: w.kind, label: w.label } : {}),
  ...(w.kind === "browser" && w.far ? { far: /** @type {const} */ (true) } : {}),
});

/** Words a key may be in — an agent's refusal that repeats it — without it. @param {string} words @param {string} key */
const unsaid = (words, key) => (key ? words.split(key).join("••••") : words);

/**
 * @param {{
 *   config: import("../core/ports.js").ConfigStore,
 *   destinationFor: (u: any) => any,
 *   terminal: { create: (o: any) => any, kill: (id: string) => boolean },
 *   accounts: Pick<import("../services/agent-accounts.js").AgentAccounts, "view" | "report" | "signedIn" | "unknown">,
 *   dataDir: string,
 *   adoptModels: (fromId: string, toId: string) => void,
 *   askModels: (upstreamId: string) => Promise<void>,
 *   publish: (upstreamId: string) => void,
 *   log: (level: string, msg: string) => void,
 *   signInOf: (u: any) => Promise<SignInReading>,
 *   saysWho: (u: any) => boolean | null,
 *   platform?: string,
 * }} o
 *   `publish`: an account's sign-in changed (the bus tells the open pages); `adoptModels`: the model cache's adopt;
 *   `askModels`: an agent's models asked for now (its `askAgent`); `signInOf`: an agent upstream's sign-in read without a
 *   turn (detect.js `upstreamLogin`); `saysWho`: whether its agent says who it runs as itself (null: not known before it
 *   first starts)
 */
export function createAgentLogins({ config, destinationFor, terminal, accounts, dataDir, adoptModels, askModels, publish, log, signInOf, saysWho, platform = process.platform }) {
  /** Where the added accounts' folders are made. */
  const root = join(dataDir, "accounts");
  /** @type {Map<string, SignIn & { stop: () => Promise<void> }>} upstream id -> its sign-in under way */
  const pending = new Map();
  /**
   * upstream id -> its sign-in being started: its agent is asked for the page, and nothing is under way yet.
   * @type {Map<string, Promise<{ signIn: SignIn } | { line: string }>>}
   */
  const starting = new Map();
  /** @type {Map<string, SignInEnd>} upstream id -> how its last sign-in or sign-out ended */
  const ended = new Map();
  /**
   * Each agent's newest reading of its sign-in: when it began, what it was read for (its program and variables), and
   * the reading, under way or done.
   * @type {Map<string, { at: number, shape: string, seq: number, reading: Promise<SignInReading> }>}
   */
  const readings = new Map();
  let readSeq = 0;
  /** @type {Set<string>} the upstreams whose agent served a turn since it last refused one for its sign-in */
  const served = new Set();

  /** An agent upstream by id, enabled or not. @param {string} id */
  const upstreamOf = (id) => (config.get().upstreams || []).find((/** @type {any} */ u) => u.id === id && isAgentUpstream(u)) || null;
  /** The bridge that runs an upstream's agent. @param {any} u @returns {import("../core/ports.js").AgentBridge} */
  const bridgeOf = (u) => destinationFor(u).agent;
  /**
   * Cursor's SDK while its Experimental switch is off, refused in the switch's words before anything reaches Cursor
   * (catalogues.js `cursorSdkHeld`; the bug hunt of 5d57bbe8a: a sign-in, an account added and a sign-out reached it).
   * @param {any} u
   */
  const mustRun = (u) => {
    if (cursorSdkHeld(config.get(), u)) throw failure(400, `${CURSOR_SDK_OFF}.`);
  };
  /**
   * The ways an account signs in, as its bridge names them; `start`: an agent that hasn't said is started to say. A key
   * kept under a variable is kept only under one the configuration seals (its name says KEY, TOKEN, SECRET…): any other
   * would be stored in the clear and read back by the page, so its way is none.
   * @param {any} u @param {boolean} start @returns {Promise<SignInWay[]>}
   */
  const waysOf = async (u, start) => {
    const bridge = bridgeOf(u);
    const ways = bridge.signInWays ? await bridge.signInWays(u, { start }) : [];
    return ways.filter((w) => w.kind !== "key" || !w.variable || SECRET_ENV_RE.test(w.variable));
  };
  /** An account's folder, where it has one. @param {any} u */
  const homeOf = (u) => String(u?.acp?.home || "").trim();
  /**
   * The account's folder as the variable its CLI reads, and what such an account also starts with, for a line to copy
   * (`folderLineVars`): the line runs as the terminal does.
   * @param {any} u @returns {Record<string, string>}
   */
  const homeVars = (u) => folderLineVars(u);
  /** A folder Filament made: inside `<data dir>/accounts`. @param {string} home */
  const madeHere = (home) => {
    const r = relative(root, home);
    return !!home && !!r && !r.startsWith("..") && !isAbsolute(r);
  };

  /** @param {string} id @param {SignInEnd["outcome"]} outcome @param {string | null} error */
  function end(id, outcome, error) {
    ended.set(id, { outcome, error, at: Date.now() });
    publish(id);
  }

  /**
   * Why an agent keeps one account, where it does: neither a folder its CLI reads nor a key of its own. An agent
   * Filament doesn't know (one of ACP's registry, one made by hand) may keep more, but Filament knows no way to.
   * @param {any} u @returns {string | null}  null where it can add more
   */
  function oneAccount(u) {
    if (accountStyle(u)) return null;
    return KNOWN_AGENTS.some((a) => a.id === agentKey(u))
      ? `${agentTitle(u)} keeps one login on a computer: its CLI reads it from one place, with no setting for a folder of its own`
      : `${agentTitle(u)} runs on the login it keeps itself: Filament knows no way to give it a second account`;
  }

  /**
   * An account added beside an agent's (HarnessV3-ACP AC3-7): a copy of the agent's upstream — its command,
   * arguments, environment and settings — named `<agent> · <name>`, with a folder of its own under the data folder
   * (none on Cursor's SDK route, which starts with no key), its route placed as detection places an agent's, and its
   * agent's model list to start from. It isn't signed in: the page signs it in next.
   * @param {{ from: string, name: string }} o
   * @returns {any}  the new upstream
   */
  function add({ from, name }) {
    const base = upstreamOf(String(from || ""));
    if (!base) throw failure(404, "no such coding agent");
    mustRun(base);
    const why = oneAccount(base);
    if (why) throw failure(400, why);
    const label = String(name || "").trim().replace(/\s+/g, " ");
    if (!label || label.length > 40) throw failure(400, "name the account: 1 to 40 characters");
    const slug = slugOf(label);
    if (!slug) throw failure(400, "name the account with a letter or a number in it");
    const style = accountStyle(base);
    const id = accountId(base, slug);
    const cfg = config.get();
    if ((cfg.upstreams || []).some((/** @type {any} */ u) => u.id === id))
      throw failure(409, `there is already an upstream with the id ${id}: name the account another way`);
    if ((cfg.upstreams || []).some((/** @type {any} */ u) => isAgentUpstream(u) && agentKey(u) === agentKey(base) && String(u.acp?.account || "").toLowerCase() === label.toLowerCase()))
      throw failure(409, `${agentName(base)} already has an account named ${label}`);
    const home = style === "folder" ? join(root, id) : "";
    const next = structuredClone(cfg);
    const copy = structuredClone(base);
    copy.id = id;
    copy.name = `${agentName(base)} · ${label}`;
    copy.enabled = true;
    if (style === "key") copy.apiKey = "";
    copy.acp = { ...(copy.acp || {}), account: label };
    // Made from an account turned off (the Default set aside): the new one is on, with no mark of being turned off.
    delete copy.acp.accountOff;
    delete copy.acp.turnedOff;
    if (home) copy.acp.home = home;
    next.upstreams.push(copy);
    // The agent's own route is the pattern: its rules and format, under the account's names.
    const own = (next.routes || []).find((/** @type {any} */ rt) => rt.upstream === base.id && rt.enabled !== false);
    const route = { fallbacks: [], discoverPrefixes: [], rules: {}, format: "auto", upstreamModel: "{1}", ...structuredClone(own || {}), match: `${id}/*`, upstream: id, enabled: true };
    const moved = placeAgentRoute((next.routes ||= []), id, id, route);
    if (home) mkdirSync(home, { recursive: true });
    changeConfig(config, next);
    if (moved) log("info", `route ${moved.moved} moved above ${moved.above}, which was catching its names`);
    adoptModels(base.id, id);
    log("info", `accounts: ${copy.name} added (${id}${home ? `, its folder ${home}` : ""})`);
    publish(id);
    return copy;
  }

  /** An added account renamed: its name changes, its id and its route stay. @param {string} id @param {string} name */
  function rename(id, name) {
    const u = upstreamOf(id);
    if (!u) throw failure(404, "no such coding agent");
    if (!u.acp?.account) throw failure(400, `${agentTitle(u)} is the agent's Default account: it keeps its name`);
    const label = String(name || "").trim().replace(/\s+/g, " ");
    if (!label || label.length > 40) throw failure(400, "name the account: 1 to 40 characters");
    const next = structuredClone(config.get());
    const t = next.upstreams.find((/** @type {any} */ x) => x.id === id);
    t.name = `${agentName(u)} · ${label}`;
    t.acp.account = label;
    changeConfig(config, next);
    publish(id);
    return t;
  }

  /**
   * An account turned off, or on again (the owner's of 11-05): off, Filament runs nothing on it and its models leave the
   * picker — its upstream off, kept as turned off by itself (`acp.accountOff`), so detection never turns it on — while
   * its sign-in stays, so on again needs none; its sign-in under way stops, its processes are let go of. The agent's
   * other accounts are as they were. Never under a running turn.
   * @param {string} id @param {boolean} off
   */
  async function setOff(id, off) {
    const u = upstreamOf(id);
    if (!u) throw failure(404, "no such coding agent");
    const bridge = bridgeOf(u);
    const busy = () => failure(409, `a turn is running on ${agentTitle(u)}: turn it off once the turn ends`);
    if (off && bridge.running(id)) throw busy();
    if (off) await cancelSignIn(id);
    // A turn that started while the sign-in stopped is never cut short.
    if (off && bridge.running(id)) throw busy();
    const next = structuredClone(config.get());
    const t = next.upstreams.find((/** @type {any} */ x) => x.id === id);
    // On again: an account turned off by itself; one off with its agent comes on with the agent, as Connect turns it on.
    if (!off && !accountIsOff(t)) {
      if (t.enabled === false) throw failure(409, `${agentTitle(u)} is off with its agent: Connect turns them on`);
      return;
    }
    t.enabled = !off;
    if (off) t.acp = { ...(t.acp || {}), accountOff: true };
    else if (t.acp) {
      delete t.acp.accountOff;
      delete t.acp.turnedOff;
    }
    changeConfig(config, next);
    if (off) bridge.letGo?.(id);
    log("info", `accounts: ${agentTitle(u)} turned ${off ? "off" : "on"}`);
    publish(id);
  }

  /**
   * An added account removed: its upstream and its routes (and the fallbacks that name it), its processes, its kept
   * account and profile (their stores let go of an upstream no longer configured), and its folder where Filament made
   * it — its login on this computer goes with it. Never under a running turn.
   * @param {string} id
   * @returns {Promise<{ folder: string | null, kept: string | null }>}  the folder deleted, or one kept and why
   */
  async function remove(id) {
    const u = upstreamOf(id);
    if (!u) throw failure(404, "no such coding agent");
    if (!u.acp?.account) throw failure(400, `${agentTitle(u)} is the agent's Default account: turn the agent off instead`);
    const bridge = bridgeOf(u);
    if (bridge.running(id)) throw failure(409, `a turn is running on ${agentTitle(u)}: remove it once the turn ends`);
    await cancelSignIn(id);
    changeConfig(config, withoutUpstreams(config.get(), new Set([id])));
    bridge.letGo?.(id);
    ended.delete(id);
    const home = homeOf(u);
    let folder = null;
    let kept = null;
    if (home && madeHere(home)) {
      // Its agent's process lets go of the folder's files as it ends: Windows refuses to delete them until then.
      try {
        await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        folder = home;
      } catch (/** @type {any} */ e) {
        kept = `its folder ${home} could not be deleted (${String(e?.message || e).slice(0, 160)}): delete it yourself`;
      }
    } else if (home) kept = `its folder ${home} is not one Filament made, so it stays`;
    log("info", `accounts: ${agentTitle(u)} removed${folder ? `, its folder deleted` : ""}${kept ? `; ${kept}` : ""}`);
    publish(id);
    return { folder, kept };
  }

  /**
   * An account signed in, the agent's own way (HarnessV3-ACP AC3-7). Where its bridge names several ways and none
   * was chosen, nothing starts: the ways come back to choose from — and so they do for a key's way with no key, whose
   * field the page shows. One sign-in an account at a time, from the moment its agent is asked for it (`underWay`):
   * asked again, the one under way comes back, said as that (`already`). An agent that names no way at all is refused
   * with its own program to run in a terminal, by its full path where Filament installed it in a folder of its own (the
   * review of 11-10: on no PATH, "its own CLI" named nothing that could be run).
   * @param {string} id @param {{ way?: string, key?: string }} [o]  `key`: the key a key's way signs in with
   * @returns {Promise<{ choose: Way[] } | { signIn: SignIn, already?: true } | { line: string }>}  `line`: no terminal
   *   can run here — the line to run in one, then Check now; `already`: the sign-in was under way before this was asked
   */
  async function signIn(id, { way = "", key = "" } = {}) {
    const u = upstreamOf(id);
    if (!u || u.enabled === false) throw failure(404, "no such coding agent");
    mustRun(u);
    const pasted = String(key || "").trim();
    const open = underWay(u, pasted);
    if (open) return open;
    const ways = await waysOf(u, true);
    // Asked twice at once, the first one's sign-in is the answer.
    const meanwhile = underWay(u, pasted);
    if (meanwhile) return meanwhile;
    if (!ways.length) {
      const own = String(u.acp?.command || "").trim();
      throw failure(
        400,
        own
          ? `${agentTitle(u)} names no way to sign in here: run its own program in a terminal, \`${commandLine([own], homeVars(u), platform)}\`, and sign in there, then Check now`
          : `${agentTitle(u)} names no way to sign in: sign in with its own CLI, then Check now`,
      );
    }
    const chosen = ways.find((w) => w.id === way) || (ways.length === 1 ? ways[0] : null);
    if (!chosen || (chosen.kind === "key" && !pasted)) return { choose: ways.map(shown) };
    if (chosen.kind === "key") {
      if (pasted.length > KEY_MAX || /\s/.test(pasted)) throw failure(400, "paste the key alone: one line, with no spaces in it");
      return chosen.variable ? inEnvironment(u, chosen, pasted) : begin(id, inBrowser(u, chosen, pasted));
    }
    return chosen.kind === "terminal" ? inTerminal(u, chosen) : begin(id, inBrowser(u, chosen));
  }

  /**
   * The sign-in an account has under way, or being started, as the answer to one asked for meanwhile (the re-read of
   * 11-11: two asked for at once both started, the second in the first one's place, the first one's 15 minutes left
   * running). A key brought to it is refused in words: it would be dropped unsaid, or kept over the one being checked.
   * @param {any} u @param {string} key
   * @returns {{ signIn: SignIn, already: true } | Promise<{ signIn: SignIn, already: true } | { line: string }> | null}
   */
  function underWay(u, key) {
    const open = pending.get(u.id);
    const start = starting.get(u.id);
    if (!open && !start) return null;
    if (key) throw failure(409, `${agentTitle(u)} is signing in already: let that sign-in end, or cancel it, then paste the key again`);
    if (open) return { signIn: view(open), already: true };
    return /** @type {NonNullable<typeof start>} */ (start).then((r) => ("signIn" in r ? { ...r, already: /** @type {const} */ (true) } : r));
  }

  /**
   * A sign-in whose agent is being asked for it, kept as the account's until it stands or is refused: one asked for
   * meanwhile waits for it (`underWay`), and so does a stop (`cancelSignIn`).
   * @template {Promise<{ signIn: SignIn } | { line: string }>} T
   * @param {string} id @param {T} start @returns {T}
   */
  function begin(id, start) {
    starting.set(id, start);
    const over = () => {
      if (starting.get(id) === start) starting.delete(id);
    };
    start.then(over, over);
    return start;
  }

  /**
   * A variable of the account's environment given a value, sealed as a card's variables are, or (`undefined`) taken out.
   * @param {string} id @param {string} variable @param {string | undefined} value
   * @returns {boolean}  false where the account is gone
   */
  function keepVar(id, variable, value) {
    const next = structuredClone(config.get());
    const t = (next.upstreams || []).find((/** @type {any} */ x) => x.id === id);
    if (!t) return false;
    const env = { ...(t.acp?.env || {}) };
    if (value === undefined) delete env[variable];
    else env[variable] = value;
    t.acp = { ...(t.acp || {}), env };
    changeConfig(config, next);
    return true;
  }
  /**
   * The variables an account keeps a pasted key under now: those its key's ways name, where its environment holds one.
   * @param {any} u @param {SignInWay[]} ways @returns {string[]}
   */
  const keyVars = (u, ways) => [...new Set(ways.flatMap((w) => (w.kind === "key" && w.variable && u.acp?.env?.[w.variable] ? [w.variable] : [])))];

  /**
   * A key the agent reads from a variable (an ACP agent's `env_var`, the review of 11-10): kept in the account's
   * environment under it, sealed as a card's variables are, in place of any it held; then its processes are let go of —
   * the next one starts with it — and the account is checked afresh, as after a terminal's sign-in. Nothing waits on a
   * page: the sign-in is the check, under way until it ends. A check that fails, and a stop meanwhile, put back what
   * the variable held — the key before it, or none (the re-read of 11-11: a key its agent called nobody's stayed, in
   * place of the one that worked).
   * @param {any} u @param {SignInWay & { kind: "key" }} w @param {string} key
   */
  function inEnvironment(u, w, key) {
    const variable = String(w.variable);
    const held = upstreamOf(u.id)?.acp?.env?.[variable];
    const had = typeof held === "string" ? held : undefined;
    keepVar(u.id, variable, key);
    /** @type {SignIn} */
    const s = { kind: "key", way: w.id, name: w.name, at: Date.now() };
    const mine = {
      ...s,
      // The variable holds again what it held, and the process started with the key goes.
      stop: async () => {
        if (keepVar(u.id, variable, had)) bridgeOf(u).letGo?.(u.id);
      },
    };
    pending.set(u.id, mine);
    ended.delete(u.id);
    log("info", `accounts: ${agentTitle(u)} signs in with ${w.name}: its key kept, sealed, as ${variable}`);
    void settled(u.id, { outside: true, pasted: mine, had: had !== undefined }).catch(async (e) => {
      if (pending.get(u.id) === mine) {
        pending.delete(u.id);
        await mine.stop().catch(() => {});
      }
      end(u.id, "failed", `the sign-in's end could not be read (${String(e?.message || e).slice(0, 160)})`);
    });
    publish(u.id);
    return { signIn: s };
  }

  /**
   * A sign-in program run in a terminal, in the account's folder: when it ends well, the account's agent processes are
   * let go of — the next turn starts in the new login — and the account is checked afresh; its terminal closed (the
   * Terminal pane's ×) stops it as Cancel does.
   * @param {any} u @param {SignInWay & { kind: "terminal" }} w
   */
  function inTerminal(u, w) {
    const spec = resolveAgentCommand(w.command, w.args);
    const { env } = agentEnv(w.env, u.acp?.envRemove);
    const home = homeOf(u);
    if (home) mkdirSync(home, { recursive: true });
    const line = commandLine([w.command, ...w.args], homeVars(u), platform);
    let tid = "";
    try {
      tid = terminal.create({
        cwd: home || homedir(),
        cols: 100,
        rows: 26,
        title: `Sign in · ${agentTitle(u)}`,
        program: { file: spec.file, args: spec.args, env },
        onExit: (/** @type {number | null} */ code, /** @type {boolean} */ closed) =>
          void terminalEnded(u.id, tid, code, closed).catch((e) => end(u.id, "failed", `the sign-in's end could not be read (${String(e?.message || e).slice(0, 160)})`)),
      }).id;
    } catch (/** @type {any} */ e) {
      log("warn", `accounts: no terminal for ${agentTitle(u)}'s sign-in (${String(e?.message || e).slice(0, 160)}); the line to run instead`);
      return { line };
    }
    /** @type {SignIn} */
    const s = { kind: "terminal", way: w.id, name: w.name, terminal: tid, line, at: Date.now() };
    pending.set(u.id, {
      ...s,
      stop: async () => {
        try {
          terminal.kill(tid);
        } catch {}
      },
    });
    ended.delete(u.id);
    log("info", `accounts: ${agentTitle(u)} signs in through ${w.name} in terminal ${tid}`);
    publish(u.id);
    return { signIn: s };
  }

  /** @param {string} id @param {string} tid @param {number | null} code @param {boolean} closed */
  async function terminalEnded(id, tid, code, closed) {
    const p = pending.get(id);
    if (!p || p.kind !== "terminal" || p.terminal !== tid) return;
    pending.delete(id);
    if (closed) return end(id, "cancelled", null);
    if (code !== 0) return end(id, "failed", code == null ? "the sign-in stopped" : `the sign-in ended with code ${code}`);
    await settled(id, { outside: true });
  }

  /** Whether an upstream's agent keeps who it runs as to itself: its sign-in is read and learnt here. @param {any} u */
  const quiet = (u) => saysWho(u) !== true;

  /**
   * An agent's sign-in read without a turn, where its agent keeps who it runs as to itself: its CLI's word or its
   * files', into the accounts store — someone, as whom where they say, or nobody. A reading that can't tell leaves the
   * account as it stands. One asked for at the person's word (`asked`: Check now, a sign-in's or a sign-out's end) also
   * lets go of a "nobody" that only a turn's refusal said, which nothing here can confirm — nothing is known of it then
   * (the store's `unknown`), and the next turn says it again where it holds; one that isn't says no "nobody" over a
   * turn the agent served since its last refusal, which a CLI may not know of (a login it doesn't see). A reading
   * serves a minute, and one under way serves whoever asks meanwhile; one asked for at the person's word or after a
   * served turn (`force`) is read afresh, and only the newest reading speaks.
   * @param {any} u @param {{ force?: boolean, asked?: boolean }} [o]
   * @returns {Promise<SignInReading>}
   */
  function readSignIn(u, { force = false, asked = false } = {}) {
    const shape = JSON.stringify([u.type, u.acp?.command || "", u.acp?.env || {}, u.acp?.home || ""]);
    const was = readings.get(u.id);
    if (was && !force && was.shape === shape && Date.now() - was.at < SIGN_IN_READ_MS) return was.reading;
    const seq = ++readSeq;
    const reading = Promise.resolve()
      .then(() => signInOf(u))
      .catch(() => CANNOT_TELL)
      .then((r) => {
        if (readings.get(u.id)?.seq === seq) keepReading(u.id, r, asked);
        return r;
      });
    readings.set(u.id, { at: Date.now(), shape, seq, reading });
    return reading;
  }
  /** What a reading said, into the store, while its upstream is configured. @param {string} id @param {SignInReading} r @param {boolean} asked */
  function keepReading(id, r, asked) {
    if (!upstreamOf(id)) return;
    if (r.signedIn === false) {
      if (!asked && served.has(id)) return;
      accounts.report(id, { source: FROM_STATUS, identity: r.identity || notSignedIn() });
    } else if (r.signedIn === true && r.identity) accounts.report(id, { source: FROM_STATUS, identity: r.identity });
    else if (r.signedIn === true) accounts.signedIn(id, FROM_STATUS);
    else if (asked && accounts.view(id)?.identitySource === FROM_TURN) accounts.unknown(id);
  }

  /**
   * Every enabled agent's sign-in that its agent keeps to itself, read where its reading is a minute old: at start, and
   * as a page reads the accounts. Nobody waits for it: what it finds reaches the pages as the store's change.
   */
  function refresh() {
    const cfg = config.get();
    for (const u of cfg.upstreams || []) if (isAgentUpstream(u) && u.enabled !== false && !cursorSdkHeld(cfg, u) && quiet(u)) void readSignIn(u);
  }

  /**
   * Check now: for an agent that keeps who it runs as to itself, its sign-in read afresh; for every agent, the account's
   * models asked for again, nobody waiting on them (the owner's of 11-10: a model released since the list was last asked
   * — Fable 5.2 — showed nowhere until the agent's own Refresh; the account's ↻ is where people look for it).
   * @param {any} u
   */
  async function check(u) {
    if (cursorSdkHeld(config.get(), u)) return;
    void askModels(u.id).catch((/** @type {any} */ e) => log("warn", `accounts: ${agentTitle(u)}'s models could not be asked for (${String(e?.message || e).slice(0, 160)})`));
    if (quiet(u)) await readSignIn(u, { force: true, asked: true });
  }

  /**
   * What a turn, or a session opened for its models (the bridges' `onSignIn`), showed of its agent's sign-in, where the
   * agent keeps who it runs as to itself: one it refused asking for a sign-in (failures.js `saysSignedOut`) says nobody
   * is signed in there; one it served says someone is — over its CLI's or its files' "nobody" until one is refused
   * again, as whom then read afresh; and, where nothing is kept of it, wherever its agent names a way to sign in: one
   * that names none has no sign-in to speak of. An agent's own word, where it says it, is never overruled by a turn.
   * @param {string} id @param {boolean} ok  served, or refused @param {string} [said]  the refusal's words
   */
  function turnSaid(id, ok, said = "") {
    const u = upstreamOf(id);
    if (!u || !quiet(u)) return;
    if (!ok) {
      served.delete(id);
      return accounts.report(id, { source: FROM_TURN, identity: notSignedIn(said.replace(/\s+/g, " ").trim().slice(0, 200) || null) });
    }
    served.add(id);
    const kept = accounts.view(id);
    if (kept?.signedOut) {
      accounts.signedIn(id, FROM_TURN);
      return void readSignIn(u, { force: true });
    }
    if (kept?.identity || kept?.identitySource) return;
    void waysOf(u, false).then(
      (ways) => {
        // Refused since, or its upstream removed: the newer word stands.
        if (ways.length && served.has(id) && upstreamOf(id)) accounts.signedIn(id, FROM_TURN);
      },
      () => {},
    );
  }

  /**
   * After a sign-in ended well, the account checked afresh: signed in only where the agent now says someone is — or,
   * where it keeps who it runs as to itself, where its CLI or its files do, even where the agent could not be asked;
   * where they can't tell, the sign-in's good end is the word. One made outside the agent's processes (a program in a
   * terminal) lets go of them first, as they hold the old login.
   * A key kept under a variable (`pasted`: its sign-in, under way until here) has no good end to be the word: where
   * nothing said who the account runs as since the key was kept — its agent says nothing of it, or said nothing in time,
   * and neither its CLI nor its files can tell — nothing checked the key, and its end says only that it is kept
   * (`key-kept`; the re-read of 11-11: it ended "signed in"), and the account is kept as neither someone's nor
   * nobody's: whoever a key it took the place of signed in is not said of this one, nor their plan (the store's
   * `unknown`). Its failed end puts back what the variable held (its stop); with a key put back (`had`), who the
   * account runs as is asked again, nobody waiting: what its agent said of the key that went is not left standing.
   * @param {string} id
   * @param {{ outside?: boolean, pasted?: (SignIn & { stop: () => Promise<void> }) | null, had?: boolean }} [o]
   */
  async function settled(id, { outside = false, pasted = null, had = false } = {}) {
    const u = upstreamOf(id);
    if (!u) return;
    const bridge = bridgeOf(u);
    if (outside) bridge.letGo?.(id);
    /** @type {any} */
    let unasked = null;
    try {
      await bridge.checkAccount(u);
    } catch (/** @type {any} */ e) {
      unasked = e;
    }
    const reading = quiet(u) ? await readSignIn(u, { force: true, asked: true }) : null;
    if (pasted) {
      // Stopped meanwhile (Cancel, its account turned off or removed): its stop took the key out again.
      if (pending.get(id) !== pasted) return;
      pending.delete(id);
    }
    /** @param {string} why */
    const failed = async (why) => {
      await pasted?.stop();
      end(id, "failed", why);
      if (pasted && had) void askWho(id);
    };
    if (unasked && reading?.signedIn !== true)
      return failed(`the sign-in ended, but ${agentTitle(u)} could not be asked who it runs as (${String(unasked?.message || unasked).slice(0, 160)})`);
    const untried = !!pasted && (reading ? reading.signedIn == null : !(Number(accounts.view(id)?.identityAt) >= pasted.at));
    // Nothing is known of who the key signs in: what is kept from before it — a "nobody", or whoever the key in its
    // place signed in, with their plan — is let go of.
    if (untried) accounts.unknown(id, { whoever: true });
    else if (reading && reading.signedIn == null) accounts.signedIn(id, FROM_SIGN_IN);
    const kind = accounts.view(id)?.identity?.kind || null;
    if (kind === "none") return failed(`the sign-in ended, but ${agentTitle(u)} says nobody is signed in`);
    log("info", untried ? `accounts: ${agentTitle(u)}'s key is kept, and nothing here could check it: its next turn tries it` : `accounts: ${agentTitle(u)} signed in`);
    end(id, untried ? "key-kept" : "signed-in", null);
    // Who it runs as now picks its models (a plan of its own; Cursor's SDK route lists none before its key): asked for
    // at once, so the picker lists them (HarnessV3-ACP AC3-8).
    void askModels(id).catch((/** @type {any} */ e) => log("warn", `accounts: ${agentTitle(u)}'s models could not be asked for (${String(e?.message || e).slice(0, 160)})`));
  }

  /**
   * Who an account runs as, asked again with nobody waiting: its agent and, where it keeps that to itself, its CLI or
   * its files.
   * @param {string} id
   */
  async function askWho(id) {
    const u = upstreamOf(id);
    if (!u) return;
    await bridgeOf(u).checkAccount(u).catch(() => {});
    if (quiet(u)) await readSignIn(u, { force: true, asked: true });
  }

  /**
   * A sign-in on the agent's page in the browser (Codex's app-server: ChatGPT's page, or its code for another
   * computer's browser; Cursor's SDK, whose key is then kept as the upstream's; an ACP agent's own, which it opens
   * itself: no address), or with a key the agent takes (`key`: Codex's OpenAI API key, which Codex keeps), which no
   * word of the agent's carries back. A page that can't open names a program to run in a terminal instead (Codex's
   * `codex login`, where its app-server can't start).
   * @param {any} u @param {SignInWay} w @param {string} [key]
   */
  async function inBrowser(u, w, key = "") {
    const bridge = bridgeOf(u);
    const ac = new AbortController();
    /** @type {any} */
    let r;
    try {
      if (!bridge.signIn) throw failure(400, `${agentTitle(u)} has no sign-in of its own`);
      r = await bridge.signIn(u, { way: w.id, name: `Filament · ${u.acp?.account || agentTitle(u)}`, signal: ac.signal, ...(key ? { key } : {}) });
    } catch (/** @type {any} */ e) {
      if (e?.instead) return inTerminal(u, e.instead);
      throw e?.status ? e : failure(502, unsaid(String(e?.message || e), key));
    }
    /** @type {SignIn} */
    const s =
      w.kind === "key"
        ? { kind: "key", way: w.id, name: w.name, at: Date.now() }
        : { kind: "browser", way: w.id, name: w.name, url: r.url || null, code: r.code || null, line: signInLine(u, platform), at: Date.now() };
    const mine = {
      ...s,
      stop: async () => {
        clearTimeout(timer);
        ac.abort();
        await bridge.cancelSignIn?.(u).catch(() => false);
      },
    };
    // Its own 15 minutes: they end this sign-in, never one that waits in its place by then.
    const timer = setTimeout(() => {
      if (pending.get(u.id) === mine) void cancelSignIn(u.id, "nobody finished the sign-in within 15 minutes");
    }, BROWSER_WAIT_MS);
    timer.unref?.();
    pending.set(u.id, mine);
    ended.delete(u.id);
    r.done.then(async (/** @type {{ ok: boolean, error: string | null, key?: string }} */ out) => {
      if (pending.get(u.id) !== mine) return; // stopped meanwhile
      pending.delete(u.id);
      clearTimeout(timer);
      if (!out.ok) return end(u.id, out.error ? "failed" : "cancelled", out.error ? unsaid(out.error, key) : null);
      if (out.key && !keepKey(u.id, out.key)) return end(u.id, "failed", "the account was removed before its key came back");
      await settled(u.id);
    }).catch((/** @type {any} */ e) => end(u.id, "failed", `the sign-in's end could not be kept (${unsaid(String(e?.message || e), key).slice(0, 160)})`));
    log("info", `accounts: ${agentTitle(u)} signs in ${w.kind === "key" ? `with ${w.name}` : `through ${w.name} in the browser`}`);
    publish(u.id);
    return { signIn: s };
  }

  /** The key a sign-in made, kept as the upstream's (sealed with the configuration's other keys). @param {string} id @param {string} key */
  function keepKey(id, key) {
    const next = structuredClone(config.get());
    const t = (next.upstreams || []).find((/** @type {any} */ x) => x.id === id);
    if (!t) return false;
    t.apiKey = key;
    changeConfig(config, next);
    return true;
  }

  /**
   * The sign-in under way stopped: at the person's word, or by itself (`why`) after waiting too long. One whose agent
   * is still asked for it is stopped once it stands.
   * @param {string} id @param {string | null} [why]
   */
  async function cancelSignIn(id, why = null) {
    await starting.get(id)?.catch(() => {});
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    await p.stop();
    end(id, why ? "failed" : "cancelled", why);
    return true;
  }

  /**
   * An account signed out its agent's own way: Claude's adapter clears its login in the account's folder (ACP
   * `logout`), Codex its own (`account/logout`); Cursor's key is forgotten — it stays valid at Cursor until it expires
   * or is revoked in Cursor's dashboard. A key pasted for it, which Filament keeps under a variable of the account's
   * environment, is forgotten too — the variable taken out, the processes that hold it let go of — whether or not its
   * agent has a sign-out of its own (the re-read of 11-11: one with none was refused, its key kept for good). Then the
   * account is checked afresh: the agent says who it runs as now — or, where it keeps who it runs as to itself, its CLI
   * or its files do; where they can't tell, the sign-out's good end is the word that nobody is signed in. Never under a
   * running turn.
   * @param {string} id
   */
  async function signOut(id) {
    const u = upstreamOf(id);
    if (!u) throw failure(404, "no such coding agent");
    mustRun(u);
    const bridge = bridgeOf(u);
    if (bridge.running(id)) throw failure(409, `a turn is running on ${agentTitle(u)}: sign out once the turn ends`);
    const ways = await waysOf(u, false);
    // A key kept here is Filament's to forget, with or without a sign-out of the agent's own.
    const keeps = keyVars(u, ways).length > 0;
    if (!bridge.signOut && !keeps) throw failure(400, `${agentTitle(u)} has no sign-out of its own: sign out with its own CLI`);
    await cancelSignIn(id);
    // The account as it stands now: a key's sign-in stopped just above put back what its variable held.
    const now = upstreamOf(id) || u;
    /** @type {any} */
    let out;
    try {
      out = await bridge.signOut?.(now);
    } catch (/** @type {any} */ e) {
      if (!keeps || e?.code !== "NO_SIGN_OUT") throw failure(e?.code === "NO_SIGN_OUT" ? 400 : 502, String(e?.message || e));
    }
    if (out?.forgetKey) keepKey(id, "");
    const vars = keyVars(now, ways);
    for (const variable of vars) keepVar(id, variable, undefined);
    if (vars.length) bridge.letGo?.(id);
    log("info", `accounts: ${agentTitle(u)} signed out${vars.length ? `, its key under ${vars.join(", ")} forgotten` : ""}`);
    // Asked, and read, as the account is left: without the key that went.
    const left = upstreamOf(id) || now;
    await bridge.checkAccount(left).catch((/** @type {any} */ e) =>
      log("warn", `accounts: ${agentTitle(u)} could not be asked who it runs as after its sign-out (${String(e?.message || e).slice(0, 160)})`),
    );
    if (quiet(left) && (await readSignIn(left, { force: true, asked: true })).signedIn == null) accounts.report(id, { source: FROM_SIGN_OUT, identity: notSignedIn() });
    end(id, "signed-out", null);
  }

  /** A sign-in as the page reads it: everything but its stop. @param {SignIn & { stop?: any }} p @returns {SignIn} */
  function view(p) {
    const { stop: _stop, ...s } = p;
    return /** @type {SignIn} */ (s);
  }

  /**
   * What the page shows of an account's signing in: whether its agent says who it runs as (null: not known before it
   * first starts), its agent's name, its own ("Default" or the one given), whether it is an added one (renamed and
   * removed here) and its folder, how its agent keeps more than one account or why it keeps one, the ways it signs in
   * (as known without starting its agent), whether its agent signs out, whether Filament keeps a pasted key for it —
   * which Sign out forgets, whether or not its agent signs out —, the sign-in under way and how the last one ended.
   * @param {any} u
   */
  async function state(u) {
    const p = pending.get(u.id);
    const ways = await waysOf(u, false);
    return {
      says: saysWho(u),
      agentName: agentName(u),
      label: u.acp?.account ? String(u.acp.account) : "Default",
      added: !!u.acp?.account,
      home: homeOf(u) || null,
      style: accountStyle(u),
      oneAccount: oneAccount(u),
      ways: ways.map(shown),
      signsOut: !!bridgeOf(u).signsOut?.(u),
      keyKept: keyVars(u, ways).length > 0,
      signingIn: p ? view(p) : null,
      lastSignIn: ended.get(u.id) || null,
    };
  }

  /** The server's stop: every sign-in under way stops. */
  async function stopAll() {
    for (const id of [...pending.keys()]) {
      const p = pending.get(id);
      pending.delete(id);
      await p?.stop().catch(() => {});
    }
  }

  return { add, rename, remove, setOff, signIn, cancelSignIn, signOut, state, stopAll, refresh, check, turnSaid };
}
