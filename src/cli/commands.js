// @ts-check
// The commands `filament` runs against the Filament that runs (the owner's of 11-05): each its usage, its line for
// `--help`, more words for `filament help <command>`, and its run — the admin API over loopback (client.js), its words
// for a person, `--json` for a script, and its exit code (client.js `EXIT`). The guided first run is setup.js.
import { spawn } from "node:child_process";
import { CliError, EXIT, connect, whereFilament } from "./client.js";
import { connectRemote, connectTo, disconnect, machineOf, readRemotes, remoteNamed, shownRemote } from "./remotes.js";
import { askChoice, askLine, askYes, readAll } from "./ask.js";
import { accountLabel, accountOf, accountWord, accountsNamed, addKey, flagValue, named, openPage, signIn, signedInOf, signedInWords, tryKey } from "./flows.js";
import { runSetup } from "./setup.js";
import { runService, startUnit, underSystemd } from "./service.js";
import { runUpdate } from "./update.js";
import { pageLabelOf } from "../services/machine.js";

/**
 * What a command is given: the words after its name, the flags, the data folder, the terminal, and where it writes —
 * a line (`out`), a line on stderr (`err`), words as they come (`write`, a reply streamed) —, and its Ctrl+C (`signal`).
 * @typedef {{ words: string[], flags: Record<string, string | true>, dataDir: string, term: import("./ask.js").Term, out: (s: string) => void, err: (s: string) => void, write: (s: string) => void, signal?: AbortSignal, quietMs?: number }} Run
 * @typedef {{ name: string, usage: string, summary: string, more?: string, run: (r: Run) => Promise<number | void> }} Command
 */

/** The answer as JSON, where `--json` asks it. @param {Run} r @param {any} value */
const json = (r, value) => (r.flags.json === true ? (r.out(JSON.stringify(value, null, 2)), true) : false);

/** What a Filament's state says started it where its service runs it: systemd's unit, or the runner of a Windows host's scheduled task or a Mac's launchd. */
const SERVICES = ["systemd", "service"];

/** The service a supervisor names, in words: the runner's by the system its state says it runs on. @param {unknown} by @param {any} [state] */
const serviceName = (by, state) => (by !== "service" ? "systemd" : /^mac/i.test(String(state?.system?.os || "")) ? "launchd" : "its scheduled task");

/**
 * The folder a chat sent to another machine with no --folder works in: its newest chat's there — this computer's own
 * folder means nothing on that one (the hunt of p1-cli). None there yet: --folder is asked for.
 * @param {any} client
 */
async function folderThere(client) {
  /** @type {any[]} */
  const list = (await client.get("/memory/sessions?limit=1&client=harness")).sessions || [];
  const cwd = String(list[0]?.cwd || "").trim();
  if (!cwd) throw new CliError(`name the folder on ${client.remote.name} the chat works in: --folder <path there>`, EXIT.usage);
  return cwd;
}

/** What an ask in a turn's run events asks, in a few words. @param {any} ev  its `ask` or `subagent-ask` event */
const askedOf = (ev) => String(ev?.form?.title || ev?.form?.questions?.[0]?.prompt || ev?.question || "a question");
/**
 * How long a chat's reply may say nothing — no words, no ping — before `filament chat` ends, saying the turn may go on:
 * Filament pings every 15 s of silence, so three pings missed (as app/agent/remote-agents.js `STREAM_IDLE_MS`).
 */
export const QUIET_MS = 45_000;

/** Words typed at a terminal, asked again until there are some. @param {import("./ask.js").Term} term @param {string} question */
async function wordsAt(term, question) {
  for (;;) {
    const a = await askLine(term, question);
    if (a) return a;
  }
}

/**
 * An ask a chat waits on (GET /api/sessions/:id/asks), put to the person at a terminal: what asks and what, its answers
 * numbered (`askChoice`), words where they answer it. → the answer the asks route takes: a choice by its option's id,
 * or the words typed — none of them read for a yes. One a terminal cannot answer (a form of several questions) is left
 * to the harness: exit 4.
 * @param {import("./ask.js").Term} term @param {any} ask
 * @returns {Promise<{ choice: string } | { words: string }>}
 */
async function answerAt(term, ask) {
  const who = ask.from === "chat" ? "The agent" : ask.from === "coding-agent" ? "The coding agent" : `Sub-agent ${ask.from}`;
  const command = ask.command && !String(ask.question).includes(ask.command) ? `\n  ${ask.command}` : "";
  const head = `${who} asks (ask ${ask.id}): ${ask.question}${command}`;
  /** @type {{ id: string, label: string, description?: string }[]} */
  const options = ask.options || [];
  if (!options.length) {
    if (!ask.words) throw new CliError(`${head} — answer it in the harness (filament open), where its turn waits`, EXIT.needsPerson);
    term.output.write(`${head}\n`);
    return { words: await wordsAt(term, "Your answer:") };
  }
  // A permission is its press, Allow or Deny; a question's words may answer it instead of its choices.
  const inWords = ask.words && ask.kind !== "permission" ? ["Answer in words"] : [];
  const i = await askChoice(term, head, [...options.map((o) => `${o.label}${o.description ? ` — ${o.description}` : ""}`), ...inWords]);
  return i < options.length ? { choice: options[i].id } : { words: await wordsAt(term, "Your answer:") };
}

/**
 * A client of the Filament a command names — a connected machine's (`--machine`, `--url`, FILAMENT_MACHINE: remotes.js),
 * else the one this data folder runs — and the flow context its steps take. @param {Run} r
 */
async function ready(r) {
  const which = machineOf(r.flags);
  const client = which ? await connectRemote(r.dataDir, which, { signal: r.signal }) : await connect(r.dataDir, { signal: r.signal });
  return { client, ctx: { client, term: r.term, out: r.out, flags: r.flags, signal: r.signal } };
}

/**
 * A provider's key as the command line shows it: a masked one's first and last characters only to a person at a
 * terminal — an agent's shell, a script's pipe or a log gets "set" (the review of 9fc83b83a: the status an agent runs
 * unasked put eight characters of every key in its transcript, which the assistant's own view never shows).
 * @param {any} u  an upstream as GET /api/upstreams gives it @param {boolean} shown
 */
const keyOf = (u, shown) => (u.provider?.keyless ? "keyless" : u.key?.stored ? (shown && u.key.masked) || "set" : "none");

/** A config with its masked secrets taken out: no part of a key, a token or a login. @param {any} v @returns {any} */
const unmasked = (v) =>
  Array.isArray(v) ? v.map(unmasked) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !/Masked$/.test(k)).map(([k, x]) => [k, unmasked(x)])) : v;

/** A duration in a few words. @param {number} ms */
const ago = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** A time as the chat list says it: today's at its hour, else its day. @param {number} at */
const when = (at) => {
  const d = new Date(Number(at) || 0);
  return d.toDateString() === new Date().toDateString() ? d.toTimeString().slice(0, 5) : d.toLocaleDateString("en-CA");
};

/** Rows of words in columns. @param {string[][]} rows */
const table = (rows) => {
  const w = rows[0]?.map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? "").length))) || [];
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? String(c ?? "") : String(c ?? "").padEnd(w[i]))).join("  ").trimEnd()).join("\n");
};

/** A typed value: true, false, a number, JSON, else the words. @param {string} v */
export const valueOf = (v) => {
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[[{"]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {}
  }
  return v;
};

/** A word the command needs, or a usage error that says so. @param {string | undefined} w @param {string} usage */
const need = (w, usage) => {
  if (!w) throw new CliError(`usage: filament ${usage}`, EXIT.usage);
  return w;
};

/**
 * Where Filament stands, in lines — the status's and setup's last word. `shown`: a person at a terminal reads it, who
 * sees a masked key's ends (`keyOf`).
 * @param {import("./client.js").Client} client @param {{ shown?: boolean }} [o]
 */
export async function statusOf(client, { shown = false } = {}) {
  // A view-only device is refused what acts or holds keys (/start, /upstreams): none of them, for it.
  const device = client.state?.device || null;
  /** @param {string} path */
  const read = (path) => (device?.scope === "view" ? client.get(path).catch(() => null) : client.get(path));
  const [start, ups, agents, accounts, lan, tail] = await Promise.all([
    read("/start"),
    read("/upstreams"),
    client.get("/coding-agents").catch(() => null),
    client.get("/agent-accounts").catch(() => null),
    // Its ways in over https, a full device's to read: the network listener (its firewall not read) and the tailnet's share.
    client.get("/remote/lan?firewall=0").catch(() => null),
    client.get("/remote/tailscale").catch(() => null),
  ]);
  /** @type {any[]} */
  const keys = (ups?.upstreams || []).filter((/** @type {any} */ u) => !u.agent);
  /** @type {any[]} */
  const rows = accounts?.agents || [];
  /** @type {any[]} */
  const entries = (agents?.entries || []).filter((/** @type {any} */ e) => e.state !== "missing");
  return {
    version: client.version,
    url: client.url,
    uptimeMs: Number(client.state?.uptimeMs) || 0,
    harness: `${client.url}/ui/harness.html`,
    // Another machine's (remotes.js): its name, and the device this command line is there.
    machine: client.remote ? String(client.state?.machine?.name || client.remote.name) : null,
    as: device ? { name: String(device.name || ""), scope: String(device.scope || "") } : null,
    models: { answering: Number(start?.connected?.models) || 0, example: start?.connected?.example || null },
    keys: keys.map((u) => ({ id: u.id, name: u.name, enabled: u.enabled !== false, key: keyOf(u, shown) })),
    // Every account of each: the first one found was its Default, turned off (the owner's of 11-05).
    agents: entries.map((e) => ({ id: e.id, name: e.name, state: e.state, ...signedInOf(e, rows) })),
    // The model it works with where no chat is named, never the setting ("" is no model): none, with why.
    memory: { on: !!start?.memory?.enabled, installed: !!start?.memory?.installed, model: start?.memory?.learnsWith || null, chosen: !!start?.memory?.chosen, whyNone: start?.memory?.whyNone || null },
    firstRun: start?.connected?.ok === false,
    // Asked for, and as it stands: the port the network listener listens on, whether Tailscale serves it, or why not.
    network: lan ? { on: lan.on === true, listening: Number(lan.listening?.port) || null, error: lan.error || null } : null,
    tailnet: tail ? { on: tail.on === true, served: !!tail.listening, error: tail.error || tail.enable || null } : null,
    // What a view-only device does not read: the models, keys and memory lines say nothing then.
    unread: device?.scope === "view" && !start,
  };
}

/**
 * The harness (or the console) opened in the person's browser, paired by a one-time link as this computer's own
 * (`filament open`, and `filament setup` at its end): a browser here is let in by its pairing, never by its address.
 * Another machine's page asks the browser for a code. → whether a page was opened.
 * @param {any} client @param {{ out: (s: string) => void, flags: Record<string, string | true> }} r @param {boolean} [toConsole]
 */
export async function openHere(client, r, toConsole = false) {
  const url = toConsole ? `${client.url}/` : `${client.url}/ui/harness.html`;
  // This command line's device is no browser's: the page there asks this browser to pair (the hunt of p1-cli).
  if (client.remote) {
    r.out(url);
    r.out(`This browser is not paired with ${client.remote.name}: the page asks for a code — Settings › Remote access there makes one (or run \`filament pair\` on ${client.remote.name}).`);
    return openPage(url, r.flags);
  }
  // This computer's own: a code made for the browser that opens the link, claimed on loopback alone, so its page
  // names a pairing of its own (devices.js `here`).
  /** @type {any} */
  const p = await client.post("/remote/pair", { scope: "full", here: true }).catch((/** @type {any} */ e) => {
    // While the desktop app holds its key, its window pairs a browser (its tray's Open in browser).
    if (e?.body?.press) return null;
    throw e;
  });
  if (!p?.code) {
    r.out(url);
    r.out("The Filament app runs here, and pairs a browser with its tray's Open in browser: use that, or type a code from the app's Settings › Remote access on the page this opens.");
    return openPage(url, r.flags);
  }
  // Its page moves on to this Filament's own name under localhost, where the browser opens it (src/ui/pair.js
  // `pageMove`): the browser's cookie is that name's alone, never sent to another port of this computer's address.
  const label = pageLabelOf(p.pageHost);
  const link = `${client.url}/ui/pair.html#code=${encodeURIComponent(p.code)}${label ? `&name=${label}` : ""}${toConsole ? "&to=console" : ""}`;
  r.out(link);
  const mins = Math.max(1, Math.round((Number(p.expiresAt) - Date.now()) / 60_000));
  const opened = openPage(link, r.flags);
  if (!opened) r.out(`A one-time link, good for ${mins} min: the browser that opens it, on this computer or through an SSH tunnel to it, is paired as this computer's own. Over a tunnel, open it at the tunnel's own address and port.`);
  return opened;
}

/** The status in a person's words. @param {Awaited<ReturnType<typeof statusOf>>} s */
export function statusWords(s) {
  // This computer's browser opens it paired (`filament open`); another machine's page asks the browser for a code.
  const lines = [`Filament ${s.version} at ${s.url}${s.machine ? ` on ${s.machine}` : ""} — up ${ago(s.uptimeMs)}`, `  harness : ${s.machine ? s.harness : `filament open (${s.harness}, paired with this computer's browser)`}`];
  if (s.as) lines.push(`  as      : ${s.as.name} (${s.as.scope === "view" ? "view-only: it reads" : "full: it drives"})`);
  if (s.unread) {
    lines.push("  (a view-only device: the models, the keys and memory are not read)");
    return lines.join("\n");
  }
  lines.push(`  models  : ${s.models.answering ? `${s.models.answering} can answer${s.models.example ? ` (${s.models.example}, say)` : ""}` : "none can answer yet — add a key (filament keys add) or connect a coding agent (filament agents)"}`);
  lines.push(`  keys    : ${s.keys.length ? s.keys.map((k) => `${k.id} (${k.key}${k.enabled ? "" : ", off"})`).join(", ") : "none"}`);
  lines.push(`  agents  : ${s.agents.length ? s.agents.map((a) => `${a.name} — ${a.state === "connected" ? [a.signedIn ? `signed in: ${a.signedIn}` : "connected, not signed in", ...a.apart].join(" · ") : a.state}`).join("; ") : "none found on this computer"}`);
  lines.push(`  memory  : ${!s.memory.on ? "off (filament memory on)" : !s.memory.installed ? "on, its engine not installed yet" : `on${s.memory.model ? (s.memory.chosen ? `, learning with each chat's own model (${s.memory.model} where none is named)` : `, learning with ${s.memory.model}`) : s.memory.whyNone ? `, learning with no model (${s.memory.whyNone})` : ""}`}`);
  if (s.firstRun) lines.push("", "No model can answer yet: `filament setup` walks you through it.");
  return lines.join("\n");
}

/**
 * What `filament pair` says of a pairing's links (`POST /remote/pair`): each, and how to connect there; and where a link
 * of the network's carries its certificate's fingerprint (`fp=`), the fingerprint the browser's one warning shows. A
 * tailnet link's certificate a public authority signs: no warning is said of it, nor a fingerprint it has none of.
 * @param {{ links?: string[], fingerprint?: string | null }} p @returns {string[]}
 */
export function pairLinkWords(p) {
  const links = Array.isArray(p.links) ? p.links : [];
  if (!links.length) return [];
  const network = links.filter((l) => /[#&]fp=/.test(l));
  const lines = ["On the other machine, open:", ...links.map((l) => `  ${l}`), `or run there: filament connect ${links[0]}`];
  if (p.fingerprint && network.length) lines.push(`${network.length < links.length ? "On a link of the network, its" : "Its"} browser warns of the certificate once: the fingerprint it shows must be ${p.fingerprint}.`);
  return lines;
}

/** @type {Command[]} */
export const COMMANDS = [
  {
    name: "setup",
    usage: "setup",
    summary: "Set Filament up, step by step: your coding agents, API keys, memory's model — then open it",
    more: "Asks at a terminal: which coding agents to connect and sign in (Claude Code, Codex…), which provider's key to add, whether memory is on and which model it works with. Each step can be skipped, and run again later. Starts Filament first where none runs.",
    run: (r) => {
      if (machineOf(r.flags)) throw new CliError("setup runs on the machine Filament runs on: run it there (a connected machine's coding agents sign in on it)", EXIT.usage);
      return runSetup(r);
    },
  },
  {
    name: "status",
    usage: "status [--json]",
    summary: "Whether Filament runs, where, and what is set up: models, keys, coding agents, memory",
    async run(r) {
      let client;
      const which = machineOf(r.flags);
      try {
        client = which ? await connectRemote(r.dataDir, which) : await connect(r.dataDir);
      } catch (/** @type {any} */ e) {
        if (e instanceof CliError && e.code === EXIT.usage) throw e;
        if (json(r, { running: false, url: which ? remoteNamed(r.dataDir, which).url : whereFilament(r.dataDir).url, error: e.message })) return e instanceof CliError ? e.code : EXIT.noFilament;
        throw e;
      }
      const s = await statusOf(client, { shown: !!r.term.output.isTTY });
      if (!json(r, { running: true, ...s })) r.out(statusWords(s));
    },
  },
  {
    name: "open",
    usage: "open [console] [--no-open]",
    summary: "Open the harness in your browser, paired with this Filament by a one-time link (console: the Filament console)",
    more: "Here, the link is the pairing page's with a code made for it (good for five minutes and one claim, on this computer or through an SSH tunnel to it alone), its page moving on to this Filament's own name under localhost, so the browser's cookie is sent to no other port of this computer: the browser that opens it is paired as this computer's own, then opens it. --no-open says the link instead, for a browser at an SSH tunnel's other end (ssh -L): open it at the tunnel's own address and port. While the Filament app runs, its tray's Open in browser does this; here the page opens unpaired. With --machine, the page there asks the browser for a code.",
    async run(r) {
      const { client } = await ready(r);
      await openHere(client, r, r.words[0] === "console");
    },
  },
  {
    name: "keys",
    usage: "keys [list | add [provider] | test <id> | remove <id>]",
    summary: "Your providers' API keys: list them, add one (typed as stars), try one, remove one",
    more: [
      "filament keys                 the providers with a key, each masked",
      "filament keys add [provider]  add a key: anthropic, openai, openrouter… (asked where not named); --plan <id> where it has",
      "                              several, --prefix <name> for its models' prefix; the key is typed as stars, or",
      "                              piped in with --key-stdin — never given on the command line; --no-test adds it untried",
      "filament keys test <id>       ask the provider whether the key works",
      "filament keys remove <id>     remove it (--yes asks nothing; --also removes the routes that name it too)",
    ].join("\n"),
    async run(r) {
      const [sub = "list", arg] = r.words;
      const { client, ctx } = await ready(r);
      if (sub === "list") {
        /** @type {any[]} */
        const ups = ((await client.get("/upstreams")).upstreams || []).filter((/** @type {any} */ u) => !u.agent);
        const shown = !!r.term.output.isTTY;
        if (json(r, ups.map((u) => ({ id: u.id, name: u.name, enabled: u.enabled !== false, key: keyOf(u, shown), keyless: !!u.provider?.keyless })))) return;
        r.out(ups.length ? table([["ID", "PROVIDER", "KEY", ""], ...ups.map((u) => [u.id, u.name, keyOf(u, shown), u.enabled === false ? "off" : ""])]) : "No provider has a key yet: filament keys add");
        return;
      }
      if (sub === "add") {
        // Added, and the provider said no: the key is there, and the command says it does not work (exit 1).
        return (await addKey(ctx, arg || "")).works === false ? EXIT.failed : EXIT.ok;
      }
      if (sub === "test") return (await tryKey(ctx, need(arg, "keys test <id>"))) ? EXIT.ok : EXIT.failed;
      if (sub === "remove") {
        const id = need(arg, "keys remove <id>");
        if (r.flags.yes !== true) {
          if (!r.term.tty) throw new CliError(`removing ${id} asks first: add --yes`, EXIT.needsPerson);
          if (!(await askYes(r.term, `Remove ${id} and its key?`, { fallback: false }))) return EXIT.ok;
        }
        /** @type {any} */
        const gone = await client.del(`/upstreams/${encodeURIComponent(id)}${r.flags.also === true ? "?also=1" : ""}`).catch((/** @type {any} */ e) => {
          if (e?.body?.routes) throw new CliError(`${e.message} — add --also to remove ${e.body.routes.map((/** @type {any} */ x) => x.match).join(", ")} with it`, EXIT.failed, e.body);
          throw e;
        });
        r.out(`Removed ${gone?.name || id}.`);
        return;
      }
      throw new CliError(`no keys command "${sub}" — filament help keys`, EXIT.usage);
    },
  },
  {
    name: "agents",
    usage: "agents [list | detect | install <id> | connect <id> | off <id> | sign-in <id> | check <id> | sign-out <id>]",
    summary: "Your coding agents (Claude Code, Codex…): find them, install, connect, sign in",
    more: [
      "filament agents               the coding agents on this computer, and who each is signed in as",
      "filament agents detect        look again for the ones installed",
      "filament agents install <id>  install one (claude-code, codex, cursor, antigravity-acp…), in Filament's terminal",
      "filament agents connect <id>  let Filament run it; off <id> stops that",
      "filament agents sign-in <id>  sign it in: a page in your browser, or a line to run (--way <id> where it has",
      "                              several, --no-open to only print the page's address); check <id> reads it again",
      "filament agents sign-out <id> sign it out",
      "--account <name>              one of an agent's accounts (Default, or one you added in Settings › Coding agents)",
      "                              for sign-in, check and sign-out; check alone reads each that is on",
    ].join("\n"),
    async run(r) {
      const [sub = "list", arg] = r.words;
      const { client, ctx } = await ready(r);
      if (sub === "list") {
        const s = await statusOf(client, { shown: !!r.term.output.isTTY });
        /** @type {any[]} */
        const all = (await client.get("/coding-agents")).entries || [];
        const none = { accounts: [], signedIn: "", apart: [] };
        const rows = all.map((e) => {
          const { accounts, signedIn, apart } = s.agents.find((a) => a.id === e.id) || none;
          return { id: e.id, name: e.name, state: e.state, signedIn, accounts, install: e.state === "missing" ? e.install?.line || "" : "", apart };
        });
        if (json(r, rows.map(({ apart, ...x }) => x))) return;
        // The ones not installed, of the many Filament knows, in a line after the ones here.
        const here = rows.filter((x) => x.state !== "missing");
        const missing = rows.filter((x) => x.state === "missing").map((x) => x.id);
        /** The SIGNED IN column: who, the accounts off or signed out after. @param {typeof rows[number]} x */
        const who = (x) => [x.signedIn || `no — filament agents sign-in ${x.id}`, ...x.apart].join(" · ");
        if (here.length) r.out(table([["ID", "AGENT", "STATE", "SIGNED IN"], ...here.map((x) => [x.id, x.name, x.state, x.state === "connected" ? who(x) : x.state === "ready" ? `(filament agents connect ${x.id})` : ""])]));
        else r.out("No coding agent is installed on this computer.");
        // An agent with more than one account: each, by the name --account takes.
        for (const x of here.filter((y) => y.state === "connected" && y.accounts.length > 1))
          r.out(`\n${x.name}'s accounts — --account <name> picks one for sign-in, check and sign-out:\n${table(x.accounts.map((a) => [`  ${a.label}`, a.off ? "off — Filament does not use it" : a.signedIn || "not signed in"]))}`);
        if (missing.length) r.out(`\nNot installed here: ${missing.join(", ")} — filament agents install <id>.`);
        return;
      }
      if (sub === "detect") {
        /** @type {any} */
        const d = await client.post("/acp/detect", {});
        if (json(r, d)) return;
        const found = (d.agents || []).filter((/** @type {any} */ a) => a.installed).map((/** @type {any} */ a) => a.id);
        r.out(found.length ? `Installed: ${found.join(", ")}${d.added?.length ? ` — added ${d.added.join(", ")}` : ""}.` : "No coding agent is installed on this computer: filament agents install <id>.");
        return;
      }
      const id = need(arg, `agents ${sub} <id>`);
      if (sub === "sign-in") return (await signIn(ctx, id)) ? EXIT.ok : EXIT.failed;
      if (sub === "sign-out") {
        const row = await accountOf(client, id, { account: flagValue(r.flags, "account"), term: r.term });
        await client.post(`/agent-accounts/${encodeURIComponent(row.upstream)}/sign-out`, {});
        r.out(`${row.name} is signed out.`);
        return;
      }
      if (sub === "check") {
        // Each account of the agent, or the one --account names: signed in where one on is. One off is said so, never
        // read — the person turned it off, and the server has no such agent on to ask.
        const { name, rows, several } = await accountsNamed(client, id, flagValue(r.flags, "account"));
        let on = 0;
        let any = false;
        for (const row of rows) {
          const called = several ? `${name} · ${accountLabel(row)}` : String(row.name);
          if (row.off === true) {
            r.out(`${called} is off: Filament does not use it (Settings › Coding agents turns it on).`);
            continue;
          }
          on++;
          /** @type {any} */
          const a = await client.post(`/agent-accounts/${encodeURIComponent(row.upstream)}/check`, {});
          const who = signedInWords(a.agent);
          any ||= !!who;
          r.out(who ? `${called} is signed in: ${who}.` : `${called} is not signed in: filament agents sign-in ${id}${several ? ` --account ${accountWord(row)}` : ""}.`);
        }
        // Only accounts off: nothing to sign in, as the person chose.
        return any || !on ? EXIT.ok : EXIT.needsPerson;
      }
      if (sub === "install" || sub === "connect" || sub === "off") {
        /** @type {any[]} */
        const entries = (await client.get("/coding-agents")).entries || [];
        const e = entries.find((x) => named(id, x.id, x.name));
        if (!e) throw new CliError(`no coding agent "${id}" — ${entries.map((x) => x.id).join(", ")}`, EXIT.usage);
        /** @type {any} */
        const done = await client.post(`/coding-agents/${encodeURIComponent(e.id)}/${sub}`, {}, { timeoutMs: 300_000 });
        if (sub === "install") r.out(done.installing ? `Installing ${e.name} in Filament's terminal: ${done.installing.line}\nThen: filament agents connect ${e.id}` : `Run this to install ${e.name}, then filament agents connect ${e.id}:\n  ${done.line}`);
        else r.out(sub === "connect" ? `${e.name} is connected: filament agents sign-in ${e.id} signs it in.` : `${e.name} is off: Filament runs it no more.`);
        return;
      }
      throw new CliError(`no agents command "${sub}" — filament help agents`, EXIT.usage);
    },
  },
  {
    name: "models",
    usage: "models [--json]",
    summary: "The models a chat can run on: each name as the message box takes it",
    async run(r) {
      const { client } = await ready(r);
      /** @type {any} */
      const m = await client.get("/models");
      // Those a chat can run on, as the server counts them (its `answers`, readiness.js) — an older Filament's, which
      // says none, all but the effort twins.
      /** @type {any[]} */
      const all = m.models || [];
      const said = all.some((/** @type {any} */ x) => "answers" in x);
      const list = all.filter((/** @type {any} */ x) => (said ? x.answers === true : x.source !== "effort-variant"));
      if (json(r, list.map((x) => ({ id: x.id, upstream: x.upstream, label: x.label || null, codingAgent: !!x.codingAgent })))) return;
      r.out(list.length ? table([["MODEL", "FROM"], ...list.map((x) => [x.id, x.upstream])]) : "No model can answer yet: filament keys add, or filament agents.");
    },
  },
  {
    name: "memory",
    usage: "memory [on | off | model <name | auto | off>]",
    summary: "Memory: whether it is on, and the model it learns your chats with",
    more: "Memory keeps what your chats learned — facts, decisions, how things are done here — and briefs every chat with it. It learns between turns with memory's model: the one you set, first for every memory call; not set (auto), each chat's compaction model, else the chat's own. filament memory model <name> sets it, auto unsets it, off turns learning off; filament models lists the names.",
    async run(r) {
      const [sub = "show", arg] = r.words;
      const { client } = await ready(r);
      if (sub === "on" || sub === "off") {
        await client.post("/memory/enabled", { enabled: sub === "on" });
        r.out(`Memory is ${sub}.`);
        return;
      }
      if (sub === "model") {
        /** @type {any} */
        const set = await client.post("/memory/models", { summarizer: need(arg, "memory model <name | auto | off>") });
        const ms = set?.models || {};
        r.out(ms.summarizer === "off" ? "Memory's model is off: it learns nothing from finished sessions." : ms.summarizer ? `Memory learns with ${ms.summarizer}.` : `Memory's model is not set: each chat's compaction model, else its own${ms.now ? `; ${ms.now} where no chat is named` : ""}.`);
        return;
      }
      if (sub !== "show") throw new CliError(`no memory command "${sub}" — filament help memory`, EXIT.usage);
      /** @type {any} */
      const st = await client.get("/memory/status");
      /** @type {any} */
      const models = (await client.get("/memory/models")).models || {};
      if (json(r, { enabled: !!st.enabled, engine: st.engine?.state || null, learnsWith: models.now || null, from: models.from || null, summarizer: models.summarizer || null, whyNone: models.whyNone || null })) return;
      const learns = !models.now
        ? `It learns with no model now${models.whyNone ? ` (${models.whyNone})` : ""}: filament memory model <name> sets one.`
        : models.from === "memory"
          ? `It learns with ${models.now}.`
          : `Its model is not set: each chat's compaction model, else the chat's own (${models.now} where no chat is named).`;
      r.out([`Memory is ${st.enabled ? "on" : "off"}${st.enabled && st.engine?.state ? ` (its engine: ${st.engine.state})` : ""}.`, learns].join(" "));
    },
  },
  {
    name: "chats",
    usage: "chats [--json]",
    summary: "Your newest chats in the harness: each one's id, when, title and project",
    async run(r) {
      const { client } = await ready(r);
      /** @type {any[]} */
      const list = (await client.get("/memory/sessions?limit=20&client=harness")).sessions || [];
      if (json(r, list.map((s) => ({ id: s.id, title: s.title || "", project: s.projectName || s.cwd || "", lastAt: s.lastAt || null, turns: s.turns || 0 })))) return;
      r.out(list.length ? table([["ID", "WHEN", "TITLE", "PROJECT"], ...list.map((s) => [s.id, when(s.lastAt), String(s.title || s.preview || "").slice(0, 60), s.projectName || ""])]) : "No chats yet: filament chat --model <name> <message> starts one.");
    },
  },
  {
    name: "chat",
    usage: "chat [--chat <id>] [--model <name>] [--folder <path>] <message>",
    summary: "Send a chat its message and print the reply as it comes (a new chat where --chat names none)",
    more: "A new chat runs in --folder (this folder where none is given) on --model (filament models lists them). The reply prints as it comes; what the agent runs is said on stderr. The message is the words after the flags, or stdin where there are none. Its chat's id is said at the end: --chat <id> goes on with it. A chat whose turn runs refuses (exit 5). Where the agent asks you something — a permission, a question — at a terminal it is asked here, its answers numbered, and the turn goes on; with no terminal the command says so and ends (exit 4), naming the ask: answer it in the harness (filament open), where the turn waits, or by its id (POST /api/sessions/<chat>/asks/<ask>/answer).",
    async run(r) {
      const { client } = await ready(r);
      let content = r.words.join(" ").trim();
      if (!content && !r.term.tty) content = await readAll(r.term.input);
      need(content, "chat [--chat <id>] [--model <name>] [--folder <path>] <message>");
      let id = flagValue(r.flags, "chat");
      if (!id) {
        /** @type {any} */
        const made = await client.post("/sessions", { cwd: flagValue(r.flags, "folder") || (client.remote ? await folderThere(client) : process.cwd()), ...(flagValue(r.flags, "model") ? { model: flagValue(r.flags, "model") } : {}) });
        id = String(made.id);
      }
      const chat = `/sessions/${encodeURIComponent(id)}`;
      // A turn needs no inbound key (guards.js markSessionTurn): none is read, and none leaves the machine.
      let said = false;
      /** Words printed with no line's end after them yet: a question asked here starts on a line of its own. */
      let open = false;
      /** @type {string | null} */
      let failed = null;
      /** What the agent asks the person, where its turn waits for them and no one is at a terminal here. @type {string | null} */
      let asked = null;
      /** The asks answered here, each once. @type {Set<string>} */
      const answered = new Set();
      /** The asks the chat waits on, as Filament lists them; null where it lists none (one from before the list). */
      const waiting = async () => {
        try {
          /** @type {any} */
          const j = await client.get(`${chat}/asks`);
          return /** @type {any[]} */ (j?.asks || []);
        } catch (/** @type {any} */ e) {
          if (e instanceof CliError && e.code !== EXIT.interrupted) return null;
          throw e;
        }
      };
      /** One ask answered at the terminal, through the asks route. @param {any} ask */
      const answer = async (ask) => {
        answered.add(ask.id);
        if (open) r.write("\n");
        open = false;
        return answerAt(r.term, ask);
      };
      /**
       * The asks a turn waits on while it runs — a coding agent's question, a sub-agent's call — answered here, each
       * through the asks route; the turn goes on as each is. One refused (answered in the harness meanwhile) is said.
       * @param {string} what  the ask that came, in a few words
       */
      const answerWaiting = async (what) => {
        const list = await waiting();
        if (!list) throw new CliError(`the agent asks you: ${what} — answer it in the harness (filament open), where its turn waits`, EXIT.needsPerson);
        for (const ask of list) {
          if (ask.from === "chat" || answered.has(ask.id)) continue;
          const body = await answer(ask);
          await client.post(`${chat}/asks/${encodeURIComponent(ask.id)}/answer`, body).catch((/** @type {any} */ e) => {
            if (!(e instanceof CliError) || e.code === EXIT.interrupted) throw e;
            r.err(`  (ask ${ask.id} not answered: ${e.message})`);
          });
        }
      };
      // As typed: the person's own words go past the chat's questions before a send — its cache gone cold, a model
      // switched (the review of 9fc83b83a: `--chat` five minutes on was refused with a question nobody here could answer).
      // The chat's own turn that pauses on an ask goes on in the answer's: read as the first was.
      /** @type {{ path: string, body: any } | null} */
      let next = { path: `${chat}/turns`, body: { content, stream: true, runEvents: true, sendAsIs: true } };
      while (next) {
        const { path, body } = next;
        next = null;
        const stop = new AbortController();
        /** The chat's own turn paused on its ask: its reply ends, and the answer's turn goes on with it. */
        let paused = false;
        /** The asks answered while the turn waits on them, one after another. @type {Promise<void>} */
        let answering = Promise.resolve();
        /** @type {any} */
        let broke = null;
        /** The turn's reply came: a stream that drops after it leaves the turn going on there. */
        let began = false;
        await client
          .stream(path, body, (event, d) => {
            began = true;
            // Each event by its data's type, as the harness page reads it (lib/api.js readReply).
            const type = d?.type || event;
            const ev = type === "filament_run" ? d?.event : null;
            if (type === "content_block_delta" && d?.delta?.type === "text_delta") {
              const text = String(d.delta.text || "");
              r.write(text);
              said = true;
              if (text) open = !text.endsWith("\n");
            } else if (ev?.type === "tool-start") r.err(`  · ${ev.name || "a tool"}${ev.args ? ` ${String(ev.args).slice(0, 120)}` : ""}`);
            // What the agent asks the person: the chat's own turn's ask ends its reply; a coding agent's, or a sub-agent's,
            // waits with no end of its own (the review of 9fc83b83a: the command printed nothing and never returned). At a
            // terminal each is asked here; else it is said, and left to the harness or the asks route.
            else if (ev?.type === "ask" || ev?.type === "subagent-ask") {
              const waits = ev.type === "subagent-ask" || ev.waits === true;
              if (!r.term.tty) {
                asked ??= askedOf(ev);
                if (waits) stop.abort();
              } else if (!waits) paused = true;
              else
                answering = answering
                  .then(() => answerWaiting(askedOf(ev)))
                  .catch((/** @type {any} */ e) => {
                    broke ??= e;
                    stop.abort();
                  });
            } else if (type === "error") failed = String(d?.error?.message || "the turn failed");
            // The reply is whole: a run that waits on a question stays open — the CLI does not.
            else if (type === "message_stop") setTimeout(() => stop.abort(), 300).unref?.();
          }, { signal: stop.signal, idleMs: r.quietMs ?? QUIET_MS })
          .catch((/** @type {any} */ e) => {
            if (e?.name === "AbortError") return;
            // Nothing came — no words, no ping — for that long: the connection is gone where nothing said so, and the
            // turn may go on there (the swarm's review of 11-10: the command waited for ever).
            if (e?.idle) {
              if (open) r.write("\n");
              open = false;
              throw new CliError(`Nothing came from Filament for ${Math.round((r.quietMs ?? QUIET_MS) / 1000)} s: the connection went quiet, and the turn may go on there (chat ${id}). filament chat --chat ${id} <message> goes on with it once it ends.`, EXIT.failed);
            }
            if (!began || e instanceof CliError) throw e;
            // The connection dropped mid-reply (the network gone, the laptop asleep): the turn goes on there, said so
            // (the sv-live hunt's: the bare network error read as the turn's end).
            if (open) r.write("\n");
            open = false;
            throw new CliError(`The connection dropped mid-reply (${e?.cause?.message || e?.message || e}): the turn goes on in Filament (chat ${id}). filament chat --chat ${id} <message> goes on with it once it ends.`, EXIT.failed);
          });
        await answering;
        if (broke) throw broke;
        if (!paused || r.signal?.aborted) break;
        const own = (await waiting())?.find((x) => x.from === "chat" && !answered.has(x.id));
        if (!own) break;
        next = { path: `${chat}/asks/${encodeURIComponent(own.id)}/answer`, body: { ...(await answer(own)), stream: true, runEvents: true } };
      }
      if (said && open) r.write("\n");
      if (r.signal?.aborted) throw new CliError(`Stopped watching: the turn goes on in Filament (chat ${id}).`, EXIT.interrupted);
      r.err(`(chat ${id} — filament chat --chat ${id} <message> goes on with it)`);
      if (asked) {
        // Named by its id, and the route that answers it: a script, or an agent that ran the command, answers it there.
        const list = (await waiting()) || [];
        const ids = list.map((x) => `${x.id} (${x.options?.length ? x.options.map((/** @type {any} */ o) => o.id).join(" | ") : "words"})`);
        throw new CliError(`the agent asks you: ${asked} — answer it in the harness (filament open), where its turn waits${ids.length ? `, or by POST /api/sessions/${id}/asks/<ask>/answer { choice | words }: ${ids.join(", ")}` : ""}`, EXIT.needsPerson);
      }
      if (failed) throw new CliError(failed, EXIT.failed);
    },
  },
  {
    name: "settings",
    usage: "settings get <path> | settings set <path> <value>",
    summary: "Read or change one of Filament's settings by its path (agentLoop.permissions, memory.enabled…)",
    more: "The paths are the Settings pages' rows: server, agentLoop, observability, alerts and memory. A value is true, false, a number, JSON, or words. A credential is never set here: the console's Settings seals it.",
    async run(r) {
      const [sub, path, ...rest] = r.words;
      const { client } = await ready(r);
      if (sub === "get") {
        need(path, "settings get <path>");
        // Its masked secrets left out: no part of a key or a token, whoever reads it (the review of 9fc83b83a).
        /** @type {any} */
        let v = unmasked(client.state?.config);
        for (const k of String(path).split(".")) v = v == null ? undefined : v[k];
        if (v === undefined) throw new CliError(`no setting "${path}"`, EXIT.usage);
        r.out(typeof v === "string" ? v : JSON.stringify(v, null, 2));
        return;
      }
      if (sub === "set") {
        need(path, "settings set <path> <value>");
        if (!rest.length) throw new CliError("usage: filament settings set <path> <value>", EXIT.usage);
        /** @type {any} */
        const done = await client.patch("/config/fields", { set: { [String(path)]: valueOf(rest.join(" ")) } });
        r.out([...(done.changes || [`${path} set`]), ...(done.restartNeeded ? ["It takes once Filament starts again."] : [])].join("\n"));
        return;
      }
      throw new CliError("usage: filament settings get <path> | settings set <path> <value>", EXIT.usage);
    },
  },
  {
    name: "stop",
    usage: "stop [--force]",
    summary: "Stop Filament — once no turn runs, unless --force; the Filament app's, by quitting the app",
    async run(r) {
      const { client } = await ready(r);
      // The app starts its Filament again whenever it stops by itself (desktop/lib/supervisor.js): the app is quit
      // instead, as its tray's Quit does — which asks while a turn runs (the review of 9fc83b83a: `stop` came straight
      // back).
      if (client.state?.supervisor === "desktop") {
        // Another machine's app is quit on that machine: this command line's app is not the one that runs it.
        if (client.remote) throw new CliError(`The Filament app on ${client.remote.name} runs that Filament, and starts it again when it stops: quit it from its tray there.`, EXIT.failed);
        if (!process.versions.electron) throw new CliError("The Filament app runs this Filament, and starts it again when it stops: quit it from its tray (Quit).", EXIT.failed);
        const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env;
        spawn(process.execPath, ["--quit"], { detached: true, stdio: "ignore", env }).unref();
        r.out("Asked the Filament app to quit: it asks you first where a turn runs.");
        return;
      }
      // systemd, or a Windows host's scheduled task or a Mac's launchd, starts its Filament again 3 s after it ends by
      // itself (filament service install): stopped through systemctl or the runner, on its own machine.
      if (SERVICES.includes(client.state?.supervisor)) {
        if (client.remote) throw new CliError(`${serviceName(client.state?.supervisor, client.state)} runs the Filament on ${client.remote.name}, and starts it again when it stops: run filament stop there (or filament service uninstall).`, EXIT.failed);
        return underSystemd(r, client, "stop");
      }
      /** @type {any} */
      const done = await client.post("/shutdown", r.flags.force === true ? {} : { ifIdle: true });
      r.out(done?.note || "Filament is stopping.");
    },
  },
  {
    name: "restart",
    usage: "restart [--force]",
    summary: "Restart Filament — once no turn runs, unless --force — where something starts it again: the Filament app, or its service",
    async run(r) {
      /** @type {Awaited<ReturnType<typeof ready>>["client"]} */
      let client;
      try {
        ({ client } = await ready(r));
      } catch (/** @type {any} */ e) {
        // Nothing answers: where systemd's unit runs this data folder's Filament (filament stop stopped it), started
        // through systemctl, as filament start starts it.
        if (e?.code === EXIT.noFilament && !e?.body?.otherDataDir && !e?.body?.taken && !machineOf(r.flags) && (await startUnit(r))) return;
        throw e;
      }
      const by = client.state?.supervisor;
      if (SERVICES.includes(by) && !client.remote) return underSystemd(r, client, "restart");
      if (by !== "desktop" && !SERVICES.includes(by))
        throw new CliError("Nothing starts this Filament again once it stops — it was started by hand: filament stop, then filament start (filament service install runs it as a service, which does: under systemd on a Linux server, a scheduled task on a Windows host, launchd on a Mac).", EXIT.failed);
      // The app, or another machine's service, starts it again once it ends: asked to stop, as Settings › About's Restart.
      /** @type {any} */
      const done = await client.post("/shutdown", r.flags.force === true ? {} : { ifIdle: true });
      r.out(`Filament is restarting: ${by === "desktop" ? "the Filament app" : serviceName(by, client.state)} starts it again in a few seconds${done?.inflight ? ` (${done.note})` : ""}.`);
    },
  },
  {
    name: "service",
    usage: "service [status | install | uninstall | logs]",
    summary: "Run Filament as a service on a Linux server, a Windows host or a Mac: started at boot, and again after a crash",
    more: [
      "On a Linux server:",
      "filament service install    write Filament's systemd user unit (~/.config/systemd/user/filament.service) and start it:",
      "                            at boot where lingering is on (it says how to turn it on), and again 3 s after it ends by",
      "                            itself. It runs the installed Filament by its stable path, so an update starts at the next",
      "                            restart; the data folder goes in it, and --port where given. A Filament this data folder",
      "                            runs by hand is stopped first, once no turn runs",
      "filament service status     whether it runs and starts at boot, what it runs, lingering, and its log's last lines",
      "filament service logs       its log as it comes (journalctl -f), until Ctrl+C",
      "filament service uninstall  stop it — once no turn runs, unless --force — and remove its unit",
      "With its unit installed, filament start, stop and restart go through systemctl.",
      "On a Windows host (install.ps1's Filament), the same commands run Task Scheduler's task \\Filament\\Filament: started",
      "at boot with no one logged in, as you without your password (S4U: no network shares, no Credential Manager), its",
      "runner starting Filament again 3 s after it ends by itself. Registering and removing it takes an administrator",
      "(a PowerShell opened as administrator, or SSH as one). Its log is <data folder>\\service\\server.log, which",
      "filament service logs follows. With its task installed, filament start, stop and restart go through its runner.",
      "On a Mac (install.sh's Filament), the same commands run launchd's LaunchAgent (~/Library/LaunchAgents/",
      "com.filamentdev.server.plist): started as you log in, its runner starting Filament again 3 s after it ends by",
      "itself. To start it at boot with no one logged in, install says the one sudo line that installs its LaunchDaemon.",
      "Its log is <data folder>/service/server.log, which filament service logs follows. With it installed, filament",
      "start, stop and restart go through its runner.",
      "On a Mac or a Windows PC with the app, the Filament app runs Filament, and starts it at logon.",
    ].join("\n"),
    run: (r) => runService(r),
  },
  {
    name: "update",
    usage: "update [--check | --version <v> | --back] [--force | --wait]",
    summary: "Update Filament for servers, as install.sh or install.ps1 installed it, to the newest release — or go back to the version before",
    more: [
      "filament update                the newest release, of the kind installed (with the memory engine, or without) and",
      "                               for the machine its build is for: downloaded, checked by the SHA-512 its feed gives",
      "                               (latest-server.yml; arm64's, a Windows host's latest-server-win32-x64.yml) and",
      "                               unpacked beside the version that runs; current then points at it, and the Filament",
      "                               its service runs (systemd; a Windows host's scheduled task) restarts on it once no",
      "                               turn runs (--force: now). One started by hand is told to start again",
      "filament update --check        only say whether a newer one is out",
      "filament update --version <v>  that release, older or newer — one kept beside is pointed at again, nothing downloaded",
      "filament update --back         current back to the version kept before, restarted the same way",
      "filament update --wait         the restart waits until no turn runs, asking again every few seconds, where it",
      "                               would be refused (exit 5) — another machine's desk updates it so",
      "The version before is kept and older ones removed, as its installer does. A download, a checksum or an unpack that",
      "fails changes nothing; nor does a release built on a newer glibc than this machine's. A version that does not",
      "come up under its service is left for the one before: current points back at it, and it is started again. A",
      "checkout updates with git pull; the Filament app updates itself.",
    ].join("\n"),
    run: (r) => runUpdate(r),
  },
  {
    name: "pair",
    usage: "pair [--view]",
    summary: "Pair another machine with this Filament: a code, and a link to open there (Settings › Remote access shows the same)",
    more: "The code is good for five minutes and one claim. On the other machine, open the link in a browser, or run `filament connect <link>` there. The device it makes drives this Filament as you do; --view makes one that reads alone. Run it on the machine Filament runs on: another machine starts no pairing here. While the Filament app runs, the code is made in it, in Settings › Remote access.",
    async run(r) {
      // This machine's own Filament, FILAMENT_MACHINE or not: a machine pairs devices with itself (the hunt of p1-cli).
      if (r.flags.machine || r.flags.url) throw new CliError("pair runs on the machine Filament runs on: run it there, or use Settings › Remote access on it", EXIT.usage);
      const client = await connect(r.dataDir, { signal: r.signal });
      /** @type {any} */
      const p = await client.post("/remote/pair", { scope: r.flags.view === true ? "view" : "full" }).catch((/** @type {any} */ e) => {
        // While the desktop app holds its key, its window makes the code (http/guards.js `doorRefused`): this is a program here.
        if (e?.body?.press) throw new CliError("the Filament app runs here, and makes the code while it runs: in it, Settings › Remote access › Pair with a code › Make a code (HTTP 403)", EXIT.failed, e.body);
        throw e;
      });
      if (json(r, p)) return;
      const mins = Math.max(1, Math.round((Number(p.expiresAt) - Date.now()) / 60_000));
      r.out(`Code ${p.code} — a ${p.scope === "view" ? "view-only" : "full"} device, for ${p.machine?.name || "this machine"}; good for ${mins} min, once.`);
      if (p.links?.length) {
        r.out(pairLinkWords(p).join("\n"));
        if (p.hostOnly) r.out(p.hostOnly);
      } else
        r.out(`No other machine reaches Filament on the network yet: turn on Settings › Remote access › Reach this machine on my network, and run this again for its links. Through tailscale serve or an SSH tunnel, open the pairing page at that address and type the code, or run there: filament connect <that address> ${p.code}`);
    },
  },
  {
    name: "connect",
    usage: "connect <link> | connect <address> <code> [--fingerprint <SHA-256>] [--name <this device>]",
    summary: "Connect this command line to the Filament on another machine, by the link its `filament pair` or Settings › Remote access shows",
    more: "The device token it is handed is kept in remotes.json in this machine's data folder (yours alone to read) and never said. Then any command goes there with --machine <its name> (or --url <its address>, or FILAMENT_MACHINE): filament status --machine <name>. The machine at the address is asked who it is first, so the token goes to the one it was paired with alone. Over the network it is https: the link carries the certificate's fingerprint, and this command line trusts that certificate alone; an https address without the link takes --fingerprint, the one Settings › Remote access shows there (with none, the certificate's is said and nothing is sent). Plain http is for an address on this machine (an SSH tunnel).",
    async run(r) {
      const link = need(r.words[0], "connect <link> | connect <address> <code>");
      const row = await connectTo(r.dataDir, link, { code: flagValue(r.flags, "code") || r.words[1] || "", name: flagValue(r.flags, "name") || "", fingerprint: flagValue(r.flags, "fingerprint") || "" });
      if (json(r, shownRemote(row))) return;
      const named = /\s/.test(row.name) ? `"${row.name}"` : row.name;
      r.out(`Connected to ${row.name} at ${row.url} as "${row.device.name}" (${row.device.scope === "view" ? "view-only: it reads" : "full: it drives"}). Any command goes there with --machine ${named}: filament status --machine ${named}`);
    },
  },
  {
    name: "machines",
    usage: "machines [--json]",
    summary: "The Filaments on other machines this command line is connected to",
    async run(r) {
      const all = readRemotes(r.dataDir).map(shownRemote);
      if (json(r, all)) return;
      if (!all.length) return void r.out("No machine is connected: `filament connect <link>` connects one.");
      r.out(table([["name", "address", "as", "since"], ...all.map((m) => [m.name, m.url, `${m.device} (${m.scope})`, when(m.connectedAt)])]));
    },
  },
  {
    name: "disconnect",
    usage: "disconnect <machine>",
    summary: "Sign this command line out of a connected machine's Filament, and forget it",
    async run(r) {
      const gone = await disconnect(r.dataDir, need(r.words[0], "disconnect <machine>"));
      if (json(r, { machine: gone.remote.name, signedOut: gone.signedOut, why: gone.why })) return;
      r.out(gone.signedOut ? `Signed out of ${gone.remote.name}, and forgot it.` : `Forgot ${gone.remote.name}. It could not be told (${gone.why}): the device stays listed there until it is revoked in its Settings › Remote access.`);
    },
  },
  {
    name: "workspace",
    usage: "workspace widen <folder>... [--folder <copy>]",
    summary: "In a sparse copy Filament made for a helper: bring more of the project's folders into it",
    more: "A helper that edits in a big repository may work in a sparse copy: it holds the folders its work is in, and the files at the top and in their parent folders. widen brings in each folder named (a file stands for its folder), relative to this folder or absolute — what the helper changed stays as it is. It runs on the copy this folder is in (--folder names another), on this machine, with no Filament running.",
    async run(r) {
      const [sub, ...folders] = r.words;
      if (sub !== "widen" || !folders.length) throw new CliError("usage: filament workspace widen <folder>... [--folder <copy>]", EXIT.usage);
      const { widenTaskWorktree } = await import("../adapters/git/worktree.js");
      const w = await widenTaskWorktree(flagValue(r.flags, "folder") || process.cwd(), folders, { signal: r.signal });
      if (!w.ok) throw new CliError(w.error, EXIT.failed);
      if (json(r, { copy: w.dest, cone: w.cone, added: w.added, whole: w.whole })) return;
      r.out(w.whole ? "This copy holds every file of the project already." : w.added.length ? `Brought in ${w.added.map((f) => `${f}/`).join(", ")}. The copy holds ${w.cone.map((f) => `${f}/`).join(", ")}.` : `The copy holds those already: ${w.cone.map((f) => `${f}/`).join(", ")}.`);
    },
  },
  {
    name: "devices",
    usage: "devices [list | revoke <device> | rename <device> <name>]",
    summary: "The devices paired with this Filament — this computer's browsers paired by `filament open`, other machines' browsers, apps and command lines: list them, revoke one, rename one",
    more: "A device is named by its name (any case) or its id. Revoked, its token stops at once and what it holds open — a terminal, the live view — closes; it stays listed as revoked.",
    async run(r) {
      const [sub = "list", which, ...rest] = r.words;
      const { client } = await ready(r);
      /** @type {any[]} */
      const all = (await client.get("/remote/devices"))?.devices || [];
      /** The one device a word names, unrevoked first. @param {string | undefined} w */
      const one = (w) => {
        const word = need(w, `devices ${sub} <device>`);
        const hits = all.filter((d) => d.id === word || String(d.name).toLowerCase() === word.toLowerCase());
        const live = hits.filter((d) => d.revokedAt == null);
        const pick = live.length === 1 ? live[0] : hits.length === 1 ? hits[0] : null;
        if (!pick) throw new CliError(hits.length ? `"${word}" names ${hits.length} devices: give its id (filament devices --json)` : `no device "${word}" — filament devices lists them`, EXIT.usage);
        return pick;
      };
      if (sub === "list") {
        if (json(r, all)) return;
        if (!all.length) return void r.out("No device is paired: `filament pair` pairs one.");
        r.out(table([["name", "scope", "kind", "last seen", "state"], ...all.map((d) => [d.name, d.scope, d.kind, d.lastSeenAt ? `${when(d.lastSeenAt)}${d.lastSeenFrom ? ` from ${d.lastSeenFrom}` : ""}` : "never", d.revokedAt ? `revoked ${when(d.revokedAt)}` : "paired"])]));
        return;
      }
      if (sub === "revoke") {
        const d = one(which);
        /** @type {any} */
        const done = await client.del(`/remote/devices/${encodeURIComponent(d.id)}`);
        if (!json(r, done)) r.out(`Revoked ${d.name}: its token stops now, and what it holds open closes.`);
        return;
      }
      if (sub === "rename") {
        const d = one(which);
        /** @type {any} */
        const done = await client.patch(`/remote/devices/${encodeURIComponent(d.id)}`, { name: need(rest.join(" ").trim(), "devices rename <device> <name>") });
        if (!json(r, done)) r.out(`${d.name} is ${done?.device?.name} now.`);
        return;
      }
      throw new CliError("usage: filament devices [list | revoke <device> | rename <device> <name>]", EXIT.usage);
    },
  },
];
