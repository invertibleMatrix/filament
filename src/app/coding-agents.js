// @ts-check
// Settings → Coding agents (HarnessV3-ACP AC3-8): every coding agent Filament can drive, each an entry — the ones it
// knows (Claude Code, Codex, Cursor's CLI and its SDK, Antigravity, Qoder CLI, Qoder CN), ACP's registry's, and any
// agent upstream made by hand — and where each stands: connected (an upstream of it is on), turned off in Settings,
// ready to connect (its program is here), or missing. Here an agent is installed in a terminal the person sees (the
// ones Filament knows their makers' way, for the whole computer; the registry's into Filament's own folder, at the
// registry's version), connected (its upstream and route made, or turned on, then its models asked for), turned off
// and on again, updated, and removed from this computer. The open pages hear each change as `coding-agents`.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { AGENT_CATALOGUE, RETIRED_AGENTS, agentCatalogue, agentRoute, agentTitle, agentUpstream, catalogueUpstream, entryOf, installCommand, viaRegistry } from "../core/catalogues.js";
import { placeAgentRoute, turnOnAgentRoute, withoutUpstreams } from "../core/routing.js";
import { accountIsOff, isAgentUpstream } from "../core/schema.js";
import { newerVersion } from "../core/util.js";
import { agentEnv, commandExists, resolveAgentCommand } from "../adapters/agents/agent-process.js";
import { catalogueInstalled, catalogueInstalledNow, catalogueVersion, programHere } from "../adapters/agents/acp/detect.js";
import { platformTarget } from "../adapters/agents/registry.js";
import { retiredLeaves } from "../services/config/store.js";
import { changeConfig, failure } from "./config-change.js";

/** @typedef {import("../adapters/agents/registry.js").RegistryAgent} RegistryAgent */
/** @typedef {import("../adapters/agents/installs.js").Receipt} Receipt */
/** @typedef {import("../adapters/agents/installs.js").InstallPlan} InstallPlan */
/**
 * An install under way, as the page shows it: its terminal, the line it runs, when it began, and the version it
 * installs (a registry agent's).
 * @typedef {{ terminal: string, line: string, at: number, version: string | null }} Installing
 */
/**
 * How an entry's last install ended, until the next one starts.
 * @typedef {{ outcome: "installed" | "failed" | "cancelled", error: string | null, at: number }} InstallEnd
 */
/**
 * An entry as the page reads it.
 * - `from`: the catalogue Filament knows (`filament`), ACP's registry, or the configuration alone (`config`: an agent
 *   upstream made by hand);
 * - `mark`: the registry entry whose icon it wears, served at `/api/coding-agents/icons/<mark>`;
 * - `version`: the registry's; `installed`: Filament's own install of it; `runs`: the version of an agent of the
 *   catalogue that npm installs, as installed here — what its next start runs; `update`: the registry's newer version,
 *   of an agent Filament installed or of one of the catalogue whose npm package the registry names (HarnessV3-ACP AF3);
 *   `outdated`: why Filament's install of it is to be updated, where it is older than the catalogue's `minVersion`;
 * - `install`: how Filament installs it — `npm` and `script` for the whole computer, `npx`, `uvx` and `binary` (a
 *   program it downloads) into Filament's own folder — and the installer it lacks (`needs`); `download`: a program to
 *   download for this computer that Filament can't install (its command outside its download), with the name it runs
 *   by; `unavailable`: the registry has no build of it for this computer; `waiting`: why its program isn't known yet,
 *   where it comes from its maker's own feed, unread (Antigravity's, adapters/agents/agy-feed.js);
 * - `gone`: connected, but its program isn't here;
 * - `primary`: the upstream its models line reads (its Default), `models` its list as kept, `asking` while asked,
 *   `modelsError` why it couldn't answer; `profile`: what it declared the last time it started;
 * - `retired`: on an agent Filament drives no more alone (`RETIRED_AGENTS`), whether its connection, once off, leaves
 *   the settings as they are next read (services/config/store.js `retiredLeaves`) — else it holds settings of the
 *   person's, and stays.
 * @typedef {{ id: string, name: string, about: string, authors: string[], license: string | null, docs: string | null,
 *   retired?: { leaves: boolean },
 *   from: "filament" | "registry" | "config", mark: string | null, version: string | null,
 *   state: "connected" | "off" | "ready" | "missing", upstreams: string[], primary: string | null,
 *   installed: { version: string, at: number } | null, runs: string | null, update: string | null, outdated?: string,
 *   install: { way: "npm" | "script" | "npx" | "uvx" | "binary", line: string, needs: "npm" | "uv" | null } | null,
 *   download: { url: string, program: string } | null, unavailable: boolean, waiting?: string, gone: boolean,
 *   installing: Installing | null, lastInstall: InstallEnd | null,
 *   models: { count: number, at: number } | null, asking: boolean, modelsError: string | null, profile: any }} Entry
 */

/** The registry entry an agent of the catalogue takes its mark and its makers from. @param {any} a @returns {string | null} */
const registryOf = (a) => a.registry || a.mark || null;
/** A registry program's name on the PATH: its command's file, without its folder or its extension. @param {string} cmd */
const programOf = (cmd) => cmd.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, "") || cmd;
/** @param {any} u */
const isOn = (u) => u.enabled !== false;
/**
 * @param {{
 *   config: import("../core/ports.js").ConfigStore,
 *   destinationFor: (u: any) => any,
 *   terminal: { create: (o: any) => any, kill: (id: string) => boolean },
 *   registry: ReturnType<typeof import("../adapters/agents/agy-feed.js").withAgyFeed>,
 *   installs: ReturnType<typeof import("../adapters/agents/installs.js").createInstalls>,
 *   models: { askAgent: (id: string) => Promise<void>, listed: (id: string) => { count: number, at: number } | null,
 *     discoveryOf: (id: string) => { asking: boolean, error?: string } | null },
 *   logins: { cancelSignIn: (id: string) => Promise<boolean> },
 *   profileOf: (upstreamId: string) => any,
 *   publish: (id: string) => void,
 *   log: (level: string, msg: string) => void,
 *   platform?: string,
 *   arch?: string,
 * }} o
 *   `publish`: an entry changed (the bus tells the open pages); `profileOf`: what an upstream's agent declared
 */
export function createCodingAgents({ config, destinationFor, terminal, registry, installs, models, logins, profileOf, publish, log, platform = process.platform, arch = process.arch }) {
  /** This computer as the registry names systems. */
  const target = platformTarget(platform, arch);
  /** @type {Map<string, Installing & { stop: () => void }>} entry id -> its install under way */
  const pending = new Map();
  /** @type {Map<string, InstallEnd>} entry id -> how its last install ended */
  const ended = new Map();
  /** The catalogue's ids, and the registry entries folded into them. */
  const catalogueIds = new Set(AGENT_CATALOGUE.map((a) => a.id));
  const folded = new Set(AGENT_CATALOGUE.map(registryOf).filter((x) => x !== null));

  /** An agent of the catalogue by id. @param {string} id */
  const known = (id) => AGENT_CATALOGUE.find((a) => a.id === id) || null;
  /** An icon kept for a registry entry, by its id. @param {string | null} id */
  const markOf = (id) => (id && registry.iconOf(id) ? id : null);
  /** An install as the page reads it: everything but its stop. @param {Installing & { stop?: any }} p @returns {Installing} */
  const view = (p) => ({ terminal: p.terminal, line: p.line, at: p.at, version: p.version });

  /**
   * What the entries are read from, as they stand: the registry's agents (those folded into the catalogue's left out),
   * Filament's installs, and each agent upstream under its entry.
   */
  function read() {
    const v = registry.view();
    /** @type {Map<string, RegistryAgent>} */
    // An agent Filament drives no more (`RETIRED_AGENTS`: Gemini CLI) is offered no more.
    const reg = new Map(v.agents.filter((a) => !folded.has(a.id) && !catalogueIds.has(a.id) && !Object.hasOwn(RETIRED_AGENTS, a.id)).map((a) => [a.id, a]));
    /** @type {Map<string, Receipt>} */
    const receipts = new Map(installs.all().filter((r) => !catalogueIds.has(r.id)).map((r) => [r.id, r]));
    const ids = new Set([...reg.keys(), ...receipts.keys()]);
    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const u of config.get().upstreams || []) {
      if (!isAgentUpstream(u)) continue;
      const e = entryOf(u, ids);
      groups.set(e, [...(groups.get(e) || []), u]);
    }
    return { v, reg, receipts, ids, groups };
  }

  /**
   * What every entry says of its upstreams: its accounts, the one its models line reads, its models as kept and
   * asked for, its profile, its install under way or how the last one ended.
   * @param {string} id @param {any[]} ups
   */
  function common(id, ups) {
    const on = ups.filter(isOn);
    const primary = (on.find((u) => u.id === id) || on[0] || ups.find((u) => u.id === id) || ups[0])?.id || null;
    const d = primary ? models.discoveryOf(primary) : null;
    const p = pending.get(id);
    return {
      upstreams: ups.map((u) => String(u.id)),
      primary,
      models: primary ? models.listed(primary) : null,
      asking: !!d?.asking,
      modelsError: d && !d.asking ? d.error || null : null,
      profile: primary ? profileOf(primary) || null : null,
      installing: p ? view(p) : null,
      lastInstall: ended.get(id) || null,
    };
  }
  /**
   * Where an entry stands: connected with an upstream on; turned off where Settings turned it off; else ready or
   * missing as its program is here or not.
   * @param {any[]} ups @param {boolean} here @returns {Entry["state"]}
   */
  const stateOf = (ups, here) => (ups.some(isOn) ? "connected" : ups.some((u) => u.acp?.turnedOff || accountIsOff(u)) ? "off" : here ? "ready" : "missing");

  /**
   * An agent of the catalogue. Where npm installs it and the registry names its package, a newer version there is its
   * update (HarnessV3-ACP AF3), installed at that version. One Filament installs itself (`viaRegistry`: Antigravity, its entry
   * Google's feed's, adapters/agents/agy-feed.js) is its registry entry in its install, its update and its removal,
   * under the catalogue's name, words and docs; one older than the catalogue's `minVersion` says why on its card.
   * @param {any} a @param {any[]} ups @param {RegistryAgent | null} r @param {{ npm: boolean, uv: boolean }} tools @returns {Entry}
   */
  function fromCatalogue(a, ups, r, tools) {
    if (viaRegistry(a)) {
      const e = fromRegistry(a.id, r, installs.receipt(a.id), ups, tools);
      // Older than the version the catalogue holds it to: why it is to be updated, which its card says beside Update.
      const min = a.minVersion;
      const outdated = min && e.installed && newerVersion(min.version, e.installed.version) ? `${agentTitle(a)} ${e.installed.version} is older than ${min.version}: ${min.why}` : null;
      // Its program not known yet, its maker's feed unread: why, in place of "no build for this computer".
      const waiting = r?.waiting && !r.binary ? r.waiting : null;
      return { ...e, name: agentTitle({ id: a.id, name: a.name }), about: a.about, docs: a.docs, from: "filament", ...(outdated ? { outdated } : {}), ...(waiting ? { waiting, unavailable: false } : {}) };
    }
    const here = catalogueInstalled(a);
    const way = "npm" in a.install ? "npm" : "script";
    const shared = common(a.id, ups);
    const runs = catalogueVersion(a, ups.find((u) => u.id === shared.primary)?.acp?.command);
    const pkg = r?.npx;
    const offered = pkg && pkg.name === a.install.npm ? pkg.version : null;
    const update = offered && newerVersion(offered, runs) ? offered : null;
    const c = installCommand(a, platform, update);
    // Connected, its program is the one its accounts run: a path given, the catalogue's name, or Cursor's SDK.
    const on = ups.filter(isOn);
    return {
      id: a.id,
      name: agentTitle({ id: a.id, name: a.name }),
      about: a.about,
      authors: r?.authors || [],
      license: r?.license || null,
      docs: a.docs,
      from: "filament",
      mark: markOf(registryOf(a)),
      version: null,
      state: stateOf(ups, here),
      installed: null,
      runs,
      update,
      install: c ? { way, line: c.line, needs: way === "npm" && !tools.npm ? "npm" : null } : null,
      download: null,
      unavailable: false,
      gone: on.length > 0 && !on.some((u) => programHere(u, a.command)),
      ...shared,
    };
  }

  /**
   * A registry agent, by its entry (null once the registry no longer lists it) and Filament's install of it.
   * @param {string} id @param {RegistryAgent | null} agent @param {Receipt | null} receipt @param {any[]} ups @param {{ npm: boolean, uv: boolean }} tools
   * @returns {Entry}
   */
  function fromRegistry(id, agent, receipt, ups, tools) {
    const p = agent ? installs.plan(agent) : null;
    const bin = !p && agent?.binary && target ? agent.binary[target] || null : null;
    const program = bin ? programOf(bin.cmd) : null;
    // An install the person ran in a terminal of their own is here before Connect settles it.
    const here = receipt ? existsSync(receipt.command) : p ? !!installs.found(p) : program ? commandExists(program) : false;
    const needs = !p ? null : p.way === "npx" ? (tools.npm ? null : "npm") : p.way === "uvx" && !tools.uv ? "uv" : null;
    return {
      id,
      name: agent?.name || agentTitle(ups[0] || { id }),
      about: agent?.description || "",
      authors: agent?.authors || [],
      license: agent?.license || null,
      docs: agent?.website || agent?.repository || null,
      from: "registry",
      mark: markOf(id),
      version: agent?.version || null,
      state: stateOf(ups, here),
      installed: receipt ? { version: receipt.version, at: receipt.at } : null,
      runs: null,
      // Never an older version than the one installed, as a feed that went back would name (agy-feed.js).
      update: receipt && p && p.version !== receipt.version && !newerVersion(receipt.version, p.version) ? p.version : null,
      install: p ? { way: p.way, line: p.line, needs } : null,
      download: bin && program ? { url: bin.archive, program } : null,
      unavailable: !!agent && !p && !bin,
      gone: ups.some(isOn) && !here,
      ...common(id, ups),
    };
  }

  /** An agent upstream made by hand, for an agent neither the catalogue nor the registry offers. @param {string} id @param {any[]} ups @returns {Entry} */
  function fromConfig(id, ups) {
    const here = ups.some((u) => programHere(u));
    const on = ups.filter(isOn);
    return {
      id,
      name: agentTitle(ups.find((u) => u.id === id) || ups[0]),
      // One Filament drives no more, still in the settings (Gemini CLI), says so, and whether once off it leaves them.
      about: RETIRED_AGENTS[id] || "",
      authors: [],
      license: null,
      docs: null,
      from: "config",
      ...(Object.hasOwn(RETIRED_AGENTS, id) ? { retired: { leaves: ups.every((u) => retiredLeaves(config.get(), u)) } } : {}),
      mark: null,
      version: null,
      state: stateOf(ups, here),
      installed: null,
      runs: null,
      update: null,
      install: null,
      download: null,
      unavailable: false,
      gone: on.length > 0 && !on.some((u) => programHere(u)),
      ...common(id, ups),
    };
  }

  /**
   * Every entry, as the page lists them: the catalogue's in its order (Cursor's SDK where its Experimental switch is on,
   * `agentCatalogue`; its accounts unlisted while it is off), the registry's by name, then any agent upstream made by
   * hand; with the registry's age and this computer as the registry names it.
   */
  function list() {
    const { v, reg, receipts, ids, groups } = read();
    const tools = { npm: commandExists("npm"), uv: commandExists("uv") };
    /** @type {Entry[]} */
    const entries = agentCatalogue(config.get()).map((a) => fromCatalogue(a, groups.get(a.id) || [], v.agents.find((r) => r.id === registryOf(a)) || null, tools));
    const fromReg = [...ids].map((id) => fromRegistry(id, reg.get(id) || null, receipts.get(id) || null, groups.get(id) || [], tools));
    entries.push(...fromReg.sort((x, y) => x.name.localeCompare(y.name)));
    for (const [id, ups] of groups) if (!catalogueIds.has(id) && !ids.has(id)) entries.push(fromConfig(id, ups));
    return { entries, registry: { at: v.at, asking: v.asking, error: v.error }, computer: target };
  }
  /** One entry as it stands. @param {string} id */
  const entryById = (id) => list().entries.find((e) => e.id === id) || null;
  /** An entry, or the route's 404. @param {string} id */
  const must = (id) => {
    const e = entryById(id);
    if (!e) throw failure(404, "no such coding agent");
    return e;
  };
  /** An entry's upstreams as the configuration has them now. @param {Entry} e */
  const upstreamsOf = (e) => (config.get().upstreams || []).filter((/** @type {any} */ u) => e.upstreams.includes(u.id));
  /** A turn running on an entry's agent, refused for `what`. @param {Entry} e @param {string} what */
  const refuseWhileRunning = (e, what) => {
    if (upstreamsOf(e).some((u) => destinationFor(u).agent.running(u.id))) throw failure(409, `a turn is running on ${e.name}: ${what} once it ends`);
  };
  /** An upstream's models asked for in the background: the page hears the answer as a discovery's. @param {string} upstreamId */
  const ask = (upstreamId) =>
    void models.askAgent(upstreamId).catch((/** @type {any} */ err) => log("warn", `agents: ${upstreamId}'s models could not be asked for (${String(err?.message || err).slice(0, 160)})`));
  /** An install under way, refused for `what`. @param {Entry} e @param {string} what */
  const refuseWhileInstalling = (e, what) => {
    if (pending.has(e.id)) throw failure(409, `${e.name} is being installed: ${what} once the install ends`);
  };

  /**
   * The upstream and route a registry agent connects as: its id and name, the command Filament installed (or the
   * program on the PATH, for one to download that Filament can't install — Connect refused it while it wasn't there),
   * the registry's arguments and environment, its model chosen per session. A known agent ACP's registry installs
   * (`a`, `viaRegistry`) connects as the catalogue makes it — its id, name, prefix, mode and environment — running what
   * Filament installed.
   * @param {Entry} e @param {any} [a]
   */
  function registryUpstream(e, a = null) {
    const agent = registry.view().agents.find((a) => a.id === e.id) || null;
    const receipt = installs.receipt(e.id);
    const bin = !receipt && agent?.binary && target ? agent.binary[target] || null : null;
    const run = receipt
      ? { command: receipt.command, args: receipt.args, env: receipt.env }
      : bin
        ? { command: programOf(bin.cmd), args: bin.args, env: bin.env }
        : null;
    if (!run) throw failure(400, `${e.name} isn't installed yet: Install it first`);
    if (a)
      return {
        upstream: agentUpstream({ ...a, ...run, env: { ...(a.env || {}), ...(run.env || {}) } }, { enabled: true }),
        route: agentRoute(a, { enabled: true }),
        prefix: a.prefix,
      };
    return {
      upstream: agentUpstream({ id: e.id, name: e.name, ...run, mode: "agent", modelSelection: "session" }, { enabled: true }),
      route: agentRoute({ id: e.id, prefix: e.id }, { enabled: true }),
      prefix: e.id,
    };
  }

  /**
   * A registry agent's version installed in a terminal of the person's own (the line the install sheet gives where no
   * terminal opens here), settled: its receipt written and, for an agent with accounts already, they move to it.
   * @param {Entry} e @returns {Promise<Receipt | null>}  the receipt, where there was an install to settle
   */
  async function settleOwn(e) {
    if (e.from !== "registry" && !viaRegistry(known(e.id))) return null;
    const agent = registry.view().agents.find((a) => a.id === e.id);
    const p = agent ? installs.plan(agent) : null;
    if (!p || installs.receipt(e.id)?.version === p.version || !installs.found(p)) return null;
    const r = installs.settle(p);
    if (e.upstreams.length) await moved(e, r);
    return r;
  }

  /**
   * An agent connected: its upstreams turned on (Turn on undoes Turn off), or its upstream and route made as detection
   * makes them, for it alone; an install the person ran in a terminal of their own settled first. Its models are asked
   * for in the background, so the picker lists them.
   * @param {string} id
   */
  async function connect(id) {
    const was = must(id);
    refuseWhileInstalling(was, "connect it");
    const settled = await settleOwn(was);
    const e = settled ? must(id) : was;
    if (e.state === "connected") {
      // Connected already, it now runs what was installed in a terminal of the person's own: a registry agent's
      // version just settled; an agent of the catalogue's, once its processes are let go of (HarnessV3-ACP AF3). Its
      // models are asked for again.
      const catalogue = !!known(id);
      if (settled || catalogue) {
        if (catalogue) letGoOf(e);
        for (const u of upstreamsOf(e).filter(isOn)) ask(u.id);
        publish(id);
      }
      return;
    }
    if (e.state === "missing") throw failure(400, `${e.name} isn't on this computer: install it first`);
    const next = structuredClone(config.get());
    const a = known(id);
    let ups = (next.upstreams || []).filter((/** @type {any} */ u) => e.upstreams.includes(u.id));
    if (!ups.length) {
      const made = a && !viaRegistry(a) ? { upstream: catalogueUpstream(a, { enabled: true }), route: agentRoute(a, { enabled: true }), prefix: a.prefix } : registryUpstream(e, a);
      if ((next.upstreams || []).some((/** @type {any} */ u) => u.id === made.upstream.id))
        throw failure(409, `there is already an upstream with the id ${made.upstream.id} that isn't ${e.name}: rename it on the console's Upstreams page first`);
      (next.upstreams ||= []).push(made.upstream);
      ups = [made.upstream];
      const moved = placeAgentRoute((next.routes ||= []), made.upstream.id, made.prefix, made.route);
      if (moved) log("info", `route ${moved.moved} moved above ${moved.above}, which was catching its names`);
    } else {
      // An account turned off by itself stays off while another comes on; with every one turned off so, all come on.
      const allOff = ups.every(accountIsOff);
      for (const u of ups) {
        if (accountIsOff(u) && !allOff) continue;
        u.enabled = true;
        if (u.acp) {
          delete u.acp.turnedOff;
          delete u.acp.accountOff;
        }
      }
      // A known agent's own route, as detection places it, where it has none, and on where it is off: an agent added off
      // has its names reach it once connected.
      if (a && ups.some((/** @type {any} */ u) => u.id === a.id)) turnOnAgentRoute((next.routes ||= []), a.id, a.prefix, agentRoute(a, { enabled: true }));
    }
    changeConfig(config, next);
    log("info", `agents: ${e.name} connected (${ups.map((/** @type {any} */ u) => u.id).join(", ")})`);
    for (const u of ups) ask(u.id);
    publish(id);
  }

  /**
   * An agent turned off: every account of it (their upstreams) off and kept as turned off, so detection never turns
   * it on again; its sign-ins stopped, its processes let go of. Its accounts and their logins are kept; its routes stay
   * as they are (an off upstream's are skipped). Never under a running turn.
   * @param {string} id
   */
  async function off(id) {
    const e = must(id);
    refuseWhileInstalling(e, "turn it off");
    refuseWhileRunning(e, "turn it off");
    if (!e.upstreams.length) throw failure(400, `${e.name} isn't connected`);
    for (const u of e.upstreams) await logins.cancelSignIn(u);
    const next = structuredClone(config.get());
    for (const u of next.upstreams || [])
      if (e.upstreams.includes(u.id)) {
        u.enabled = false;
        u.acp = { ...(u.acp || {}), turnedOff: true };
      }
    changeConfig(config, next);
    letGoOf(e);
    log("info", `agents: ${e.name} turned off`);
    publish(id);
  }

  /**
   * An agent Filament installed, removed from this computer: its upstreams, their routes and the fallbacks that name
   * them (their kept accounts, profiles and model lists go with them), its processes, then its folder. One installed
   * for the whole computer is turned off instead: uninstalling it is its CLI's business. Never under a running turn.
   * @param {string} id @returns {Promise<{ folder: string | null, kept: string | null }>}
   */
  async function remove(id) {
    const e = must(id);
    if (!e.installed) throw failure(400, `Filament didn't install ${e.name}: turn it off instead`);
    refuseWhileInstalling(e, "remove it");
    refuseWhileRunning(e, "remove it");
    for (const u of e.upstreams) await logins.cancelSignIn(u);
    const ups = upstreamsOf(e);
    if (ups.length) changeConfig(config, withoutUpstreams(config.get(), new Set(e.upstreams)));
    for (const u of ups) destinationFor(u).agent.letGo?.(u.id);
    const out = await installs.remove(id);
    ended.delete(id);
    log("info", `agents: ${e.name} removed from this computer${out.kept ? `; ${out.kept}` : ""}`);
    publish(id);
    return out;
  }

  /** An agent's models asked for now, on each of its accounts that is on; the page hears each answer. @param {string} id */
  function askModels(id) {
    const e = must(id);
    const on = upstreamsOf(e).filter(isOn);
    if (!on.length) throw failure(400, `${e.name} isn't connected`);
    for (const u of on) ask(u.id);
    publish(id);
  }

  /** @param {string} id @param {InstallEnd["outcome"]} outcome @param {string | null} error */
  function end(id, outcome, error) {
    ended.set(id, { outcome, error, at: Date.now() });
    publish(id);
  }

  /**
   * An agent installed, in a terminal the person sees: the ones Filament knows their makers' way, for the whole
   * computer; the registry's into Filament's own folder, at the registry's version (an installed one's newer version is
   * its Update) — a program to download fetched and unpacked by Filament itself, as the terminal's task. Asked again
   * while it runs, the install under way comes back. Never started under a running turn of the agent.
   * @param {string} id
   * @returns {Promise<{ installing: Installing } | { line: string }>}  `line`: no terminal can run here — the line to
   *   run in one, then Connect
   */
  async function install(id) {
    const open = pending.get(id);
    if (open) return { installing: view(open) };
    const e = must(id);
    // Never under a running turn: an install replaces the program the turn runs from, or ends by deleting its folder.
    refuseWhileRunning(e, e.update ? "update it" : "install it");
    const a = known(id);
    /**
     * The installer to run, or the task (a program's download); and why a task failed, in its own words.
     * @type {{ argv: string[], env: Record<string, string>, line: string, cwd: string, version: string | null, done: () => Receipt | null,
     *   task?: import("../services/terminal.js").TerminalTask, why: () => string | null }}
     */
    let spec;
    // One ACP's registry installs (`viaRegistry`) installs as the registry's do, below.
    if (a && !viaRegistry(a)) {
      // Its update installs the registry's version (HarnessV3-ACP AF3); a first install, its maker's latest.
      const c = installCommand(a, platform, e.update);
      if (!c) throw failure(400, `Filament doesn't know how ${e.name} is installed`);
      if (e.install?.needs) throw failure(400, `${e.name} installs with ${e.install.needs}, which isn't on this computer`);
      spec = {
        argv: c.argv,
        env: {},
        line: c.line,
        cwd: homedir(),
        version: e.update,
        done: () => {
          catalogueInstalledNow(a);
          if (!catalogueInstalled(a)) throw new Error(`the install ended, but Filament can't find ${e.name}: open a new terminal and check that it runs there`);
          return null;
        },
        why: () => null,
      };
    } else {
      const agent = registry.view().agents.find((x) => x.id === id) || null;
      if (!agent) throw failure(404, `ACP's registry no longer lists ${e.name}`);
      const p = installs.plan(agent);
      if (!p) {
        const program = agent.binary && target ? agent.binary[target] : null;
        throw failure(400, program
          ? `${e.name}'s command (${program.cmd}) isn't inside its download, so Filament can't install it: download it from its page`
          : agent.waiting
            ? `${e.name} can't be installed yet: ${agent.waiting}`
            : `ACP's registry has no build of ${e.name} for this computer${target ? ` (${target})` : ""}`);
      }
      if (e.install?.needs) throw failure(400, `${e.name} installs with ${e.install.needs}, which isn't on this computer`);
      if (e.installed?.version === p.version && !e.gone) throw failure(400, `${e.name} ${p.version} is installed already`);
      // Never over a newer one, as a feed that went back would have it (the card offers no such Update either).
      if (e.installed && !e.gone && newerVersion(e.installed.version, p.version))
        throw failure(400, `${e.name} ${e.installed.version} is installed, newer than the ${p.version} its source names now: nothing to install`);
      mkdirSync(p.folder, { recursive: true });
      /** @type {string | null} */
      let why = null;
      spec = {
        argv: p.argv,
        env: p.env,
        line: p.line,
        cwd: p.folder,
        version: p.version,
        done: () => installs.settle(p),
        ...(p.way === "binary"
          ? { task: (/** @type {import("../adapters/agents/installs.js").TaskIo} */ io) => installs.download(p, io).catch((err) => {
              why = String(err?.message || err);
              throw err;
            }) }
          : {}),
        why: () => why,
      };
    }
    const prog = spec.task ? null : resolveAgentCommand(spec.argv[0], spec.argv.slice(1));
    let tid = "";
    try {
      tid = terminal.create({
        cwd: spec.cwd,
        cols: 100,
        rows: 26,
        title: `Install · ${e.name}`,
        ...(prog ? { program: { file: prog.file, args: prog.args, env: agentEnv(spec.env).env } } : { task: spec.task }),
        onExit: (/** @type {number | null} */ code, /** @type {boolean} */ closed) =>
          void installEnded(id, tid, code, closed, spec.done, spec.why).catch((err) => end(id, "failed", `the install's end could not be read (${String(err?.message || err).slice(0, 160)})`)),
      }).id;
    } catch (/** @type {any} */ err) {
      log("warn", `agents: no terminal for ${e.name}'s install (${String(err?.message || err).slice(0, 160)}); the line to run instead`);
      return { line: spec.line };
    }
    const p = { terminal: tid, line: spec.line, at: Date.now(), version: spec.version, stop: () => terminal.kill(tid) };
    pending.set(id, p);
    ended.delete(id);
    log("info", `agents: ${e.name} installs in terminal ${tid}: ${spec.line}`);
    publish(id);
    return { installing: view(p) };
  }

  /**
   * An install's terminal ended: stopped, failed (said in the words of a task's failure, where it ran one), or ended
   * well — then its command is found (a registry agent's receipt written), an updated agent's upstreams move to the new
   * version and its old folder goes (an agent of the catalogue's processes are let go of: npm replaced its program where
   * it was), and the agent is connected and its models asked for.
   * @param {string} id @param {string} tid @param {number | null} code @param {boolean} closed @param {() => Receipt | null} done
   * @param {() => string | null} [why]
   */
  async function installEnded(id, tid, code, closed, done, why = () => null) {
    const p = pending.get(id);
    if (!p || p.terminal !== tid) return;
    pending.delete(id);
    if (closed || code !== 0) {
      await installs.dropOthers(id);
      return closed ? end(id, "cancelled", null) : end(id, "failed", why() || (code == null ? "the install stopped" : `the install ended with code ${code}`));
    }
    try {
      const receipt = done();
      const e = must(id);
      if (receipt && e.upstreams.length) await moved(e, receipt);
      else if (!receipt) letGoOf(e);
      if (e.state !== "connected") await connect(id);
      else for (const u of upstreamsOf(e).filter(isOn)) ask(u.id);
      end(id, "installed", null);
    } catch (/** @type {any} */ err) {
      end(id, "failed", String(err?.message || err));
    }
  }

  /**
   * An updated agent's upstreams moved to its new version: its command, arguments and environment — the install's
   * variables over the account's own, so a key pasted at its sign-in stays (the review of 11-10); its processes let go
   * of (a running turn ends on the old one); the old version's folder deleted — at the next start (installs' `sweep`)
   * where a turn that began while it installed still runs from it, as an install is refused only at its start.
   * @param {Entry} e @param {Receipt} r
   */
  async function moved(e, r) {
    const next = structuredClone(config.get());
    for (const u of next.upstreams || [])
      if (e.upstreams.includes(u.id)) u.acp = { ...(u.acp || {}), command: r.command, args: r.args, env: { ...(u.acp?.env || {}), ...r.env } };
    const busy = upstreamsOf(e).some((u) => destinationFor(u).agent.running(u.id));
    changeConfig(config, next);
    letGoOf(e);
    if (busy) log("info", `agents: a turn still runs on ${e.name}'s old version: its folder stays until Filament's next start`);
    else await installs.dropOthers(e.id);
    log("info", `agents: ${e.name} moved to ${r.version}`);
  }
  /** An entry's processes let go of: a running turn ends on the program it started with, the next starts afresh. @param {Entry} e */
  function letGoOf(e) {
    for (const u of upstreamsOf(e)) destinationFor(u).agent.letGo?.(u.id);
  }

  /** The install under way stopped at the person's word. @param {string} id */
  function cancelInstall(id) {
    const p = pending.get(id);
    if (!p) return false;
    try {
      p.stop();
    } catch {}
    return true;
  }

  /** The registry read again now. */
  const refreshRegistry = async () => {
    await registry.refresh();
    publish("registry");
  };
  /** The registry read again when the section opens on a copy older than a day (or none) — Google's feed for Antigravity on one older than an hour. */
  const refreshIfStale = () => {
    if (registry.stale() && !registry.view().asking)
      void registry.refresh({ staleOnly: true }).then(() => publish("registry"));
  };

  /** The server's stop: every install under way stops, and its end is not followed. */
  function stopAll() {
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      try {
        p.stop();
      } catch {}
    }
  }

  return { list, connect, off, remove, askModels, install, cancelInstall, refreshRegistry, refreshIfStale, iconOf: registry.iconOf, stopAll };
}
