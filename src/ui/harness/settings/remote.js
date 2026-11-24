// @ts-check
// Settings › Remote access (the owner's remote Filament of 11-06, Part 1): this machine as other machines see it — its
// name —; the calls of this computer's programs that came without Filament's owner key (`ownerlessWords`); reaching it on the network (Part 2): the https listener turned on, its port, its addresses, its certificate's
// fingerprint and what Windows Firewall lets through, with Allow; sharing it on the tailnet: tailscale serve turned on,
// its https address, what Tailscale asks for, and trusting your own tailnet login; a pairing started here: a code good for five minutes
// and one claim, counted down, and a link for each address another machine reaches this Filament at — the tailnet's
// first —, each with its QR code for a phone's camera (vendor/qr, loaded once a code is made), for a full
// device or a view-only one; and the devices paired, each with when it was last seen and when it expires unused (90
// days on from its last use, `expiryWords`), Revoke and, once revoked, Forget —
// another machine's agents' device under the full device that minted it, with a switch for each thing they may do here
// (the remote-agents plan's f-ui). Read from another machine, pairing is this machine's alone, the device list is a full
// device's, and the device it is signs itself out. In the desktop app, This computer's page adds another machine to its
// window's rail (Add a machine, the app's bridge) — or sets one up over SSH first (ssh-setup.js) —, and lets this
// Filament's agents work on each of them, or not: the app makes those calls with its sign-in there, and the page hears
// the outcome. Where their device is kept, a second switch
// uses that machine's models in this Filament's chats (the remote-agents plan's m-ui): the app switches the device's
// grant `models` there, and the page adds this Filament's upstream of them (POST /upstreams, type `filament`), or
// removes it. Built with an injected `h`, `api`, clipboard, dialog and clock, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { segment } from "../lib/fields.js";
import { mountConfigPage } from "../lib/config-rows.js";
import { confirmDialog, dialog } from "../lib/ui.js";
import { maskEmail } from "../../lib/accounts.js";
import { PAIR_PAGE } from "../../lib/standing.js";
import { openSshSetup } from "../ssh-setup.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "This machine", words: "name hostname remote access" },
  { label: "This device", words: "sign out remote" },
  { label: "Calls without the owner key", words: "owner key token programs scripts curl command line api security local this computer" },
  { path: "server.lan.enabled", label: "Reach this machine on my network", words: "lan local network https tls wifi remote access listen" },
  { path: "server.lan.port", label: "Port", words: "network lan https port" },
  { label: "Certificate", words: "tls https fingerprint self-signed warning lan network address ip", also: ["Addresses"] },
  { label: "Certificate key", words: "new key certificate renew rotate compromised copied tls lan pair again" },
  { label: "Windows Firewall", words: "firewall allow network lan port blocked" },
  { path: "server.tailscale.serve", label: "Share on my tailnet", words: "tailscale tailnet ts.net serve https vpn remote access", also: ["Tailnet address", "Turn it on", "Tailscale"] },
  { path: "server.tailscale.trustOwnLogin", label: "Trust my own tailnet login", words: "tailscale login sign in trust without pairing" },
  { label: "Machines", words: "other machines computers paired connected status revoke another machine's agents grant let in sub-agents commands models use its models picker use this app's browser remote ask full access auto without asking coding agents claude code codex cursor mcp full control yolo act as you forget copies clear copies folder" },
  { label: "Add a machine", words: "other machines drive another computer workstation laptop machines menu desktop app window pair connect" },
  { label: "Set up a machine over SSH", words: "ssh server cloud vm linux install service systemd setup headless remote machine user@host" },
  { label: "Browsers and command lines", words: "paired devices phone laptop tablet browser command line terminal filament connect revoke forget view-only" },
  { label: "New code", words: "pair a device remote phone laptop tablet another machine connect code link view-only", also: ["Code", "Good for", "Links", "Codes open"] },
]);

/** A size said in GB, or MB below one, as the copies' line says it. @param {unknown} n  bytes */
export const sizeWords = (n) => {
  const b = Math.max(0, Number(n) || 0);
  return b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
};

/** What New key asks the person to confirm: what it cuts off, and that renewal never does. */
export const NEW_KEY_WORDS =
  "This machine's network listener gets a new key and certificate now. Every machine and command line paired over the network pinned the old one: each stops reaching this machine there until it pairs again with a new code. A browser warns of the certificate once more: compare the new fingerprint. Devices on your tailnet or an SSH tunnel go on. Renewing the certificate keeps the key: this is only for a key that may have been copied.";

/**
 * This computer's calls without Filament's owner key since it started (/state `ownerless`, services/owner.js), in
 * words: none, or how many and the programs that made them, newest first.
 * @param {{ count?: number, programs?: { agent: string, count: number }[] } | null | undefined} o
 */
export const ownerlessWords = (o) => {
  const n = Number(o?.count) || 0;
  if (!n) return "Every program on this computer that called Filament since it started sent its owner key: the Filament app and the filament command line do.";
  const named = (o?.programs || []).slice(0, 3).map((p) => `${p.agent} (${p.count})`).join(", ");
  return `${n} call${n === 1 ? "" : "s"} since Filament started came from a program here without its owner key, answered all the same${named ? `: ${named}` : ""}. The Filament app and the filament command line send it; a script sends owner.key from Filament's data folder as the x-filament-owner header.`;
};

/** How often a page with a code open looks for the device that claimed it. */
export const CLAIM_LOOK_MS = 2000;

/** A code's time left as the page counts it: m:ss, never below 0:00. @param {number} ms */
export const leftWords = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How long ago, in a few words. @param {number} ms */
const agoWords = (ms) => {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hrs = Math.floor(m / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.floor(hrs / 24)} days ago`;
};

/**
 * When a person's device lapses unused, in words (services/devices.js `expiresAt`, moved on by each use): "" where it
 * never does — an agents' device, a revoked one. @param {number | null | undefined} at @param {number} now
 */
export const expiryWords = (at, now) =>
  typeof at !== "number" ? "" : at <= now ? "expired: it went unused, pair it again" : `expires ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} if unused`;

/**
 * A paired device's line: what it is, what it may do, and when it was last seen and from where, and when it lapses
 * unused (`expiryWords`) — or when it was revoked.
 * @param {{ kind?: string, scope?: string, lastSeenAt?: number | null, lastSeenFrom?: string | null, revokedAt?: number | null, expiresAt?: number | null }} d @param {number} now
 */
export function deviceWords(d, now) {
  const what = d.scope === "agent" ? "Agents" : `${d.kind === "cli" ? "Command line" : "Browser"} · ${d.scope === "view" ? "view-only" : "full"}`;
  if (d.revokedAt) return `${what} · revoked ${agoWords(now - d.revokedAt)}`;
  const ends = expiryWords(d.expiresAt, now);
  return `${what} · ${d.lastSeenAt ? `seen ${agoWords(now - d.lastSeenAt)}${d.lastSeenFrom ? ` from ${d.lastSeenFrom}` : ""}` : "not seen yet"}${ends ? ` · ${ends}` : ""}`;
}

/**
 * A code's links where the network's listener answers now, as the server makes them (admin/remote.js `pairLinks`): one
 * for each of its addresses, the code and the certificate's fingerprint in the fragment — so the listener turned on
 * after the code was made brings them, and turned off takes them away. @param {any} net  GET /remote/lan's answer
 * @param {string} code
 */
export const linksOf = (net, code) => {
  if (!net?.listening || !net.fingerprint) return [];
  const fp = String(net.fingerprint).replace(/[^0-9a-f]/gi, "").toUpperCase();
  return (Array.isArray(net.addresses) ? net.addresses : []).map((/** @type {string} */ u) => `${u}${PAIR_PAGE}#code=${encodeURIComponent(code)}&fp=${fp}`);
};

/** What the page says as its code's time is up and the list could not be read: whether a device took it is not known. */
export const RAN_OUT_UNREAD_WORDS = "The code's time is up, and whether a device took it in its last seconds could not be read: Machines and Browsers and command lines say, once Filament answers";

/** Where Tailscale is installed from, and where a tailnet's HTTPS certificates are turned on (services/tailscale.js). */
export const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";
export const TAILSCALE_HTTPS = "https://login.tailscale.com/admin/dns";
/**
 * A code's link on the tailnet, where Filament is served there (admin/remote.js `tailnetLink`): the code in the fragment,
 * no fingerprint. @param {any} ts  GET /remote/tailscale's answer @param {string} code
 */
export const tailnetLinkOf = (ts, code) => (ts?.address ? `${ts.address}${PAIR_PAGE}#code=${encodeURIComponent(code)}` : null);

/**
 * Whether a code's link is the tailnet's: the one with no fingerprint, an authority signing its certificate — a link on
 * the network's address always carries its own (admin/remote.js `pairLinks`). @param {string} link
 */
export const onTailnet = (link) => !/[#&]fp=/.test(String(link));
/** What a phone says of a link's QR code on the tailnet: nothing, an authority signs its certificate. */
export const QR_TAILNET_WORDS = "Scan it with a phone signed in to your tailnet: no warning, an authority signs this address's certificate.";
/** And of one on the network's address: its own certificate warned of first, its fingerprint the one to compare. */
export const QR_LAN_WORDS = "Scan it with a phone on the same network. Its browser warns about this machine's own certificate first: the fingerprint in its details is Certificate's above, then go on.";
/** Where the QR encoder is (vendor/qr, qrcode-generator, MIT), loaded once a code's links are drawn. */
export const QR_MODULE = "../vendor/qr/qrcode.mjs";
/** The quiet zone round a QR code, in its modules: the four the standard asks, so a camera finds its edge. */
const QR_QUIET = 4;

/**
 * A link's QR code as an SVG's markup, for a phone's camera to open the link by: its dark modules one path, each row's
 * runs joined, inside its quiet zone, dark on white whatever the page's look. Built from numbers alone; "" where the
 * words fit no code or no encoder is given. @param {any} encoder  qrcode-generator's `qrcode` @param {string} text
 * @returns {string}
 */
export function qrSvg(encoder, text) {
  if (typeof encoder !== "function") return "";
  /** @type {any} */
  let q;
  try {
    // The smallest version the words fit, at level M: a phone's screen shot of it still reads.
    q = encoder(0, "M");
    q.addData(String(text), "Byte");
    q.make();
  } catch {
    return "";
  }
  const n = Number(q.getModuleCount());
  if (!Number.isInteger(n) || n < 21) return "";
  const size = n + QR_QUIET * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && q.isDark(r, c + run)) run++;
      d += `M${c + QR_QUIET} ${r + QR_QUIET}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/**
 * What another machine's agents' device may do here, a switch each (services/devices.js GRANTS), and what each lets
 * them do, said of that machine by its name (`says`). `models` is read by the network's door (front-door.js `lanDoor`,
 * the remote-agents plan's m-door); `unasked` by their chats' and commands' mode (turn.js `sessionMode`, exec.js
 * `judged`); `codingAgents` by their chats' turn on a coding agent (acp-turn.js). `full`, on top of `agents`, by all of
 * them: their chats run as yours (devices.js `fullControl`), Without asking and Coding agents with it (`heldGrant`).
 * `browser` is kept, and gets its switch once something reads it (the plan's browser step): a switch that changes
 * nothing would say what is not so. `copies` by the admin gate (remote.js `COPY_ROUTES`): Run on from that machine
 * alone; Agents holds it with it.
 */
export const GRANT_ROWS = Object.freeze([
  { grant: "agents", short: "Agents", label: "Agents may work here", says: (/** @type {string} */ n) => `${n}'s agents may start chats here and run commands as you, in your project folders. What they ask comes to you on ${n}.` },
  { grant: "copies", short: "Run on", label: "Your chats on it may run here", says: (/** @type {string} */ n) => `${n} may send a copy of a project here for a chat of yours to run in, and bring its changes back (Run on). No agent of ${n}'s works here by it.` },
  { grant: "models", short: "Models", label: "Its chats may use this machine's models", says: (/** @type {string} */ n) => `${n}'s chats may use the API models set up here, on this machine's keys. Usage counts what they spend.` },
  { grant: "unasked", short: "Without asking", label: "May run without asking", says: (/** @type {string} */ n) => `${n}'s sub-agents, and the single commands ${n} sends, run here without asking when the chat on ${n} that sent them is in Full access. Off, they always ask, and their command tasks and checks don't run.` },
  { grant: "codingAgents", short: "Coding agents", label: "May use coding agents here", says: (/** @type {string} */ n) => `${n}'s chats may run on the coding agents here (Claude Code, Codex, Cursor), on their sign-ins here, without your own MCP servers; Cursor still loads its own.` },
  { grant: "full", short: "Full control", label: "Full control: its agents act here as you", says: (/** @type {string} */ n) => `On top of Agents: ${n}'s agents act here as you, in any folder but Filament's own, with your settings, tools and memory, without asking. A command they run can read and change whatever your account can. Asks first.` },
]);
/** The grants Full control holds while it is on (services/devices.js `heldGrant`): their pills show on, and still. */
const FULL_HOLDS = Object.freeze(["unasked", "codingAgents"]);
/** The providers whose key Copy keys offers: an API's, as another machine adds one (http/admin/keys-copy.js `KEY_TYPES`). */
const KEY_TYPES = new Set(["openai-compatible", "anthropic-compatible", "openai", "anthropic"]);

/**
 * What the confirm before Full control goes on says, on either machine: what it lets, and the line it crosses.
 * @param {string} who  whose agents, as the sentence opens @param {string} where  the machine they act on
 */
export const fullConfirmWords = (who, where) =>
  `${who} act on ${where} as you: their chats run with your settings, tools, MCP servers, skills and memory in any folder but Filament's own, their commands run without asking, and they use its coding agents. A command they run can read and change whatever your account on ${where} can, Filament's own keys and settings among it, and what it changes stays when you switch Full control off. Switch it on only for a machine of yours.`;

/**
 * The titles of a machine's card's two lines, each saying who may do what where (the owner's of 11-10: "This machine on
 * DESKTOP-1" read as DESKTOP-1 acting here): what the machine `name` may do on `where`, and what this machine may do on it.
 * @param {string} name @param {string} where
 */
export const inTitle = (name, where) => `What ${name} may do on ${where}`;
/** @param {string} name */
export const outTitle = (name) => `What this machine may do on ${name}`;

/** From this many entries a list of machines or devices has a filter over it. */
export const FILTER_FROM = 8;

/** What Machines holds, said once over it: each pill's title says its own whole (the owner's redesign of 11-09). */
export const MACHINES_WORDS = "Other computers running Filament, and what each may do on the other. Hover a pill for what it allows.";
/** What Add a machine does, in a line. */
export const ADD_MACHINE_WORDS = "Pair this window with another machine by a code from its Settings › Remote access. It then shows in the machines menu at the top (Ctrl+1…9).";
/** What Set up a machine over SSH does, in a line. */
export const SSH_SETUP_WORDS = "A Linux machine you reach with SSH, with no Filament yet: install it there, run it as a service, and pair this window with it, step by step.";

/** What the caller's switch lets this Filament's agents do on another machine (the app's other machines). @param {string} name */
export const thereWords = (name) => `This machine's agents may start chats on ${name} and run commands there as you. What they ask comes to you here.`;

/** The second switch under a machine whose agents' device is kept here (the remote-agents plan's m-ui). @param {string} name */
export const modelsLabel = (name) => `Use ${name}'s models in this Filament's chats`;
/** What it lets this Filament's chats do, in a line. @param {string} name */
export const modelsWords = (name) => `${name}'s models join the model picker here, on its keys and sign-ins: your conversation goes to ${name} for each call. Needs Agents.`;

/** The switch that lets this Filament's agents act on another machine as the person (Full control). @param {string} name */
export const fullLabel = (name) => `Full control: this Filament's agents act on ${name} as you`;
/** What it lets them do there, in a line. @param {string} name */
export const fullWords = (name) =>
  `On top of Agents: this machine's agents act on ${name} as you, in any folder but Filament's own, with your settings, tools and memory there, without asking. A command they run there can read and change whatever your account can. Asks first.`;

/** The switch that lets another machine's chats use this app's browser (b-remote). @param {string} name */
export const browserLabel = (name) => `Let ${name} use this app's browser`;
/** What it does, in a line. @param {string} name */
export const browserWords = (name) =>
  `Web pages agents open for your chats on ${name} show in this app, signed in to nothing of yours, where you watch them and take them over. Off, they open in Chrome on ${name}.`;

/** The name the desktop app pairs its window by on another machine (desktop/lib/add-machine.js `deviceNameHere`). */
const APP_NAMED = "Filament app on ";
/**
 * One card per machine (the owner's redesign of 11-09): another machine's app paired here (`app`, a full or view device
 * its desktop app claimed), its agents' device here (`agents`, the one not revoked), and this window's line to it
 * (`row`, the app's other machines, lib/machine-agents.js `AgentsRow`), each where there is one. A device is a machine's
 * app where its claim named that machine (`machine`), an agents' device was minted under it, or the app's own name for
 * it says so; a card takes its `row` by that machine's id, else by a name that one card and one row alone have. What is
 * no machine's — a browser, a command line, a machine's second app device, an agents' device revoked on its own — is
 * `loose`, listed apart.
 * @param {any[]} devices  GET /remote/devices's @param {any[]} [rows]  the app's other machines
 * @returns {{ cards: { key: string, name: string, app: any, agents: any, row: any }[], loose: any[] }}
 */
export function machinesOf(devices, rows = []) {
  const people = devices.filter((d) => d.scope !== "agent");
  const agents = devices.filter((d) => d.scope === "agent");
  const agentsOf = (/** @type {any} */ d) => agents.find((a) => a.of === d.id && a.revokedAt == null) ?? null;
  const isApp = (/** @type {any} */ d) => !!d.machine || agents.some((a) => a.of === d.id) || (d.kind === "browser" && String(d.name).startsWith(APP_NAMED));
  const nameOf = (/** @type {any} */ d) => agents.find((a) => a.of === d.id && a.from)?.from || (String(d.name).startsWith(APP_NAMED) ? String(d.name).slice(APP_NAMED.length) : String(d.name));
  /** @type {{ key: string, name: string, app: any, agents: any, row: any }[]} */
  const cards = [];
  /** @type {any[]} */
  const loose = [];
  // Live apps first, and of those the one its machine's agents came in by: one beside it — revoked, or paired again
  // from a window that kept its old sign-in — is listed apart, with its Forget, or its own agents' pills.
  const rank = (/** @type {any} */ d) => (d.revokedAt != null ? 2 : agentsOf(d) ? 0 : 1);
  const apps = people.filter(isApp).sort((a, b) => rank(a) - rank(b));
  for (const d of apps) {
    const key = d.machine || `name:${nameOf(d).toLowerCase()}`;
    const name = nameOf(d).toLowerCase();
    // The same machine: its id, or its name where either was paired before the claim named the machine (rd-id).
    if (cards.some((c) => c.key === key || ((!d.machine || !c.app.machine) && c.name.toLowerCase() === name))) loose.push(d);
    else cards.push({ key, name: nameOf(d), app: d, agents: d.revokedAt == null ? agentsOf(d) : null, row: null });
  }
  for (const a of agents)
    if (a.revokedAt == null && !people.some((d) => d.id === a.of)) {
      const name = String(a.from || a.name);
      const key = `name:${name.toLowerCase()}`;
      const had = cards.find((c) => c.key === key && !c.agents);
      if (had) had.agents = a;
      else if (!cards.some((c) => c.key === key)) cards.push({ key, name, app: null, agents: a, row: null });
    }
  loose.unshift(...people.filter((d) => !isApp(d)));
  // An agents' device revoked alone, or whose full device is forgotten, is on no card: listed apart, to forget. One
  // revoked with its full device goes when that is forgotten (devices.js `forget`).
  loose.push(...agents.filter((a) => a.revokedAt != null && !people.some((d) => d.id === a.of && d.revokedAt != null)));
  const named = (/** @type {string} */ n) => n.toLowerCase();
  for (const x of rows) {
    const id = String(x.id).toLowerCase();
    const n = named(String(x.name));
    const byId = cards.find((c) => c.app?.machine === id);
    const alike = cards.filter((c) => named(c.name) === n);
    const byName = !byId && alike.length === 1 && rows.filter((y) => named(String(y.name)) === n).length === 1 && !alike[0].row && !alike[0].app?.machine ? alike[0] : null;
    const card = byId || byName;
    if (card) card.row = x;
    else cards.push({ key: id, name: String(x.name), app: null, agents: null, row: x });
  }
  for (const c of cards) if (c.row) c.name = String(c.row.name);
  return { cards, loose };
}

/** What a scope lets a device do, in a few words. @param {string} scope */
const scopeWords = (scope) => (scope === "view" ? "view-only: it reads" : "full: it drives this Filament as you do");

/**
 * One coding agent's account on another machine, as its card says it (desktop/lib/machine-agents.js `AccountLine`): an
 * email it names masked, as this page masks one. @param {{ name: string, state: string, who: string | null }} a
 */
const accountWords = (a) => {
  const who = a.who ? (a.who.includes("@") ? maskEmail(a.who) : a.who) : "";
  const state = a.state === "in" ? (who ? `signed in as ${who}` : "signed in") : a.state === "out" ? "nobody signed in" : a.state === "off" ? "off" : "not said yet";
  return `${a.name} ${state}`;
};

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, copy?: (text: string) => Promise<void>, confirm?: (q: any) => Promise<boolean>,
 *   now?: () => number, every?: (fn: () => void, ms: number) => () => void, go?: (path: string) => void, qr?: () => Promise<any>,
 *   app?: { addMachine?: () => void, agentMachines?: () => Promise<any>, agentsOn?: (id: string, on: boolean) => Promise<any>, agentsModels?: (id: string, on: boolean) => Promise<any>, agentsFull?: (id: string, on: boolean) => Promise<any>, agentsForget?: (id: string) => Promise<any>,
 *     browserOn?: (id: string, on: boolean) => Promise<any>, onBrowserLink?: (fn: (row: any) => void) => () => void, sshSetup?: (input: any) => Promise<any>,
 *     openOn?: (id: string, route: string) => Promise<boolean>, copyKeys?: (id: string, ids: string[]) => Promise<any> } | null,
 *   sshSetup?: (o: { onToast?: (msg: string, kind?: string) => void }) => unknown, pickKeys?: (o: { name: string, providers: any[] }) => Promise<string[] | null> }} [io]
 *   `every`: a timer that runs `fn` each `ms` until stopped (the countdown, the look for a claim); `go`: where a device
 *   that signed itself out goes (the pairing page); `qr`: the QR encoder loaded (`QR_MODULE`); `app`: the desktop app's
 *   bridge (harness-preload.cjs `filamentApp`); `sshSetup`: the setup sheet opened (ssh-setup.js `openSshSetup`);
 *   `pickKeys`: the providers whose keys go to a machine, as the person ticks them (`keysSheet`)
 */
export function renderRemote(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const copy = io.copy || ((/** @type {string} */ text) => navigator.clipboard.writeText(text));
  const ask = io.confirm || confirmDialog;
  const now = io.now || (() => Date.now());
  const every = io.every || ((fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  });
  const go = io.go || ((/** @type {string} */ path) => globalThis.location?.assign(path));
  const app = io.app === undefined ? /** @type {any} */ (globalThis).filamentApp : io.app;
  const toast = cb.onToast || (() => {});
  /** @param {any} e */
  const said = (e) => String(e?.body?.error || e?.message || e);

  /** The scope the next code is for. */
  let scope = "full";
  /**
   * The code this page shows, as POST /remote/pair answered it — its id, by which its claim is told from another
   * code's — and when it runs out by this page's clock: now plus the time the server says it has left, so a page whose
   * clock is not the server's (an SSH tunnel's laptop) counts it right (the review of 35049d31f). @type {any}
   */
  let pairing = null;
  let deadline = 0;
  /** A code asked for and not answered yet: Make a code waits. */
  let starting = false;
  /** The devices as last read; null before the first read. @type {any[] | null} */
  let devices = null;
  /** @type {string | null} why the list could not be read */
  let devicesWhy = null;
  /** @type {string | null} why a read after one that worked failed: the list stands as last read, said so */
  let devicesStale = null;
  /** The codes open on the server as last read, and when (this page's clock); null where they are not this caller's to see. @type {any[] | null} */
  let openCodes = null;
  let openRead = 0;
  let stopTick = () => {};
  /**
   * The network's listener as last read (GET /remote/lan): where it listens, why not, its certificate, the firewall;
   * `{ unread }` where the read failed; null before the first. Read again whenever server.lan is not what it was read
   * for. @type {any}
   */
  let lanNow = null;
  let lanFor = "";
  /** Windows asked to allow it, not answered yet. */
  let allowing = false;
  /** A new key asked for and not answered yet (`newKey`). */
  let keying = false;
  /**
   * Tailscale here as last read (GET /remote/tailscale): installed, signed in, this machine's name on the tailnet,
   * whether and where Filament is served there, and why not; `{ unread }` where the read failed; null before the first.
   * Read again whenever server.tailscale is not what it was read for. @type {any}
   */
  let tsNow = null;
  let tsFor = "";
  /** Try again asked, not answered yet. */
  let retrying = false;
  /** Another machine's agents' grants asked to change, not answered yet: `<device id>:<grant>`. @type {Set<string>} */
  const granting = new Set();
  /** Each device's grant saves, one after another, by its id: the newest's end. @type {Map<string, Promise<unknown>>} */
  const grantTurns = new Map();
  /**
   * The app's other machines as it last read them (lib/machine-agents.js `AgentsRow`): whether this Filament's agents may
   * work on each, as that machine says; null before the first read, or where the app has no such bridge. @type {any[] | null}
   */
  let there = null;
  /** @type {string | null} why the app could not read them */
  let thereWhy = null;
  /** The machines whose switch was moved, not answered yet. @type {Set<string>} */
  const thereBusy = new Set();
  /** What each long list's filter holds, kept as the page is drawn again. */
  const filters = { machines: "", devices: "" };
  /**
   * This Filament's upstreams of another machine's models (GET /upstreams, type `filament`), each naming its machine by
   * id; null before the first read. @type {any[] | null}
   */
  let machineUps = null;
  /** This machine as the page last said it: "this machine" on its own page, its name on another machine's. */
  let hereNow = "this machine";
  const hereName = () => hereNow;
  /** The QR encoder once loaded, asked for once a code's links are drawn; null till then, and where it would not load. @type {any} */
  let qrEncoder = null;
  let qrAsked = false;
  const loadQr = io.qr || (() => import(QR_MODULE).then((mod) => mod.qrcode || mod.default));

  const page = mountConfigPage(body, cb, { ...io, api: call }, { rows: (kit) => rows(kit) });
  const redraw = () => void page.redraw();

  /** Reads of the list asked for, and the newest whose answer landed: an older one landing after it stands for nothing. */
  let deviceReads = 0;
  let deviceLanded = 0;
  /**
   * Each device's grants as a save's answer kept them, and how many reads had begun as it landed: a read among those,
   * landing after it, holds the grants as they were before the save, and takes them from here (the f-ui hunt's: a pill
   * pressed while a slow read was out went back as the read landed). A read begun after it lets it go.
   * @type {Map<string, { grants: any, reads: number }>}
   */
  const grantsSaved = new Map();
  /**
   * The devices and the codes open, read again: true where this read's answer is the list now. An answer stands unless
   * a newer one landed before it — reads slower than the look each still land (the review of fx-pair-settings: one
   * dropped as any newer read began left a slow server's list unread for the code's whole life). One that fails says
   * why, and leaves the codes open as they were — a failed read is no news of them.
   */
  const readDevices = async () => {
    const mine = ++deviceReads;
    try {
      const got = await call("/remote/devices");
      if (mine < deviceLanded) return false;
      deviceLanded = mine;
      devices = (got?.devices || []).map((/** @type {any} */ d) => {
        const saved = grantsSaved.get(d?.id);
        if (!saved) return d;
        if (mine > saved.reads) {
          grantsSaved.delete(d.id);
          return d;
        }
        return { ...d, grants: saved.grants };
      });
      openCodes = Array.isArray(got?.pending) ? got.pending : null;
      openRead = now();
      devicesWhy = null;
      devicesStale = null;
      return true;
    } catch (/** @type {any} */ e) {
      if (mine < deviceLanded) return false;
      deviceLanded = mine;
      // A list read before stands, as last read: a read that fails is no news that its machines and devices went.
      if (devices && !devicesWhy) {
        devicesStale = said(e);
        return false;
      }
      devices = [];
      devicesWhy = said(e);
      return false;
    }
  };
  /** The codes open that this page does not show: another window's, `filament pair`'s, or this page's before a reload. */
  const otherCodes = () => (openCodes || []).filter((c) => c.id !== pairing?.id && Number(c.leftMs) - (now() - openRead) > 0);
  /** What the page draws of the server's lists: the codes open elsewhere and the devices, each as it stands. */
  const seen = () => JSON.stringify([otherCodes().map((c) => c.id), (devices || []).map((d) => `${d.id}:${d.revokedAt ?? ""}`)]);
  /** This page's code is over — run out, claimed, cancelled: never said again as open elsewhere. @param {any} gone */
  const over = (gone) => {
    stopTick();
    pairing = null;
    if (openCodes) openCodes = openCodes.filter((c) => c.id !== gone?.id);
  };
  void readDevices().then(redraw);
  /** Reads asked for, so an answer to an older one never stands for a newer; and the answers taken, counted. */
  let lanReads = 0;
  let lanTaken = 0;
  /** @param {boolean} [fresh]  the firewall read again */
  const readLan = async (fresh = false) => {
    const mine = ++lanReads;
    /** @type {any} */
    let got;
    try {
      got = await call(`/remote/lan${fresh ? "?fresh=1" : ""}`);
    } catch (/** @type {any} */ e) {
      got = { unread: said(e) };
    }
    if (mine === lanReads) {
      lanNow = got;
      lanTaken++;
    }
  };
  /** Reads of Tailscale asked for: an answer to an older one never stands for a newer. */
  let tsReads = 0;
  const readTs = async () => {
    const mine = ++tsReads;
    /** @type {any} */
    let got;
    try {
      got = await call("/remote/tailscale");
    } catch (/** @type {any} */ e) {
      got = { unread: said(e) };
    }
    if (mine === tsReads) tsNow = got;
  };
  /** Try again: served once more as the switch says, after the person turned on what Tailscale asked for. */
  const retry = async () => {
    if (retrying) return;
    retrying = true;
    redraw();
    const mine = ++tsReads;
    try {
      const got = await call("/remote/tailscale/retry", { method: "POST", body: {} });
      if (mine === tsReads) tsNow = got;
      if (got?.address) toast(`Shared on your tailnet at ${got.address}`);
    } catch (/** @type {any} */ e) {
      toast(`Not asked again: ${said(e)}`, "err");
    }
    retrying = false;
    redraw();
  };
  /** Filament's firewall rule for the port: Windows asks the person here to confirm. */
  const allow = async () => {
    if (allowing) return;
    allowing = true;
    redraw();
    try {
      const got = await call("/remote/lan/firewall", { method: "POST", body: {} });
      lanNow = { ...lanNow, firewall: got?.firewall ?? lanNow?.firewall };
      toast(got?.firewall?.open ? "Windows Firewall lets this network reach Filament" : "The rule is made");
    } catch (/** @type {any} */ e) {
      toast(`Not allowed: ${said(e)}`, "err");
    }
    allowing = false;
    redraw();
  };
  /**
   * New key: the network listener's key and certificate made anew (POST /remote/lan/new-key), once the person said so —
   * every device paired over the network pairs again. Renewal keeps the key; this alone changes it.
   */
  const newKey = async () => {
    if (keying) return;
    if (!(await ask({ title: "Make a new key?", description: NEW_KEY_WORDS, confirmLabel: "New key", destructive: true }))) return;
    keying = true;
    redraw();
    try {
      const got = await call("/remote/lan/new-key", { method: "POST", body: {} });
      lanNow = { ...lanNow, ...got };
      toast("A new key and certificate: pair each device again");
    } catch (/** @type {any} */ e) {
      toast(`No new key: ${said(e)}`, "err");
    }
    keying = false;
    redraw();
  };

  /** Text with its Copy. @param {string} text @param {string} what */
  const copyable = (text, what) =>
    m("div", { class: "cset-copy" },
      m("code", { class: "cset-code" }, text),
      m("button", { class: "mset-act", type: "button", title: `Copy ${what}`, "aria-label": `Copy ${what}`, html: ICONS.copy, onclick: () => copy(text).then(() => toast(`Copied ${what}`), () => toast("Copy failed: select it instead", "err")) }));

  /** The QR encoder asked for, once: the page drawn again as it comes; one that would not load leaves the links as words. */
  const wantQr = () => {
    if (qrAsked) return;
    qrAsked = true;
    void Promise.resolve()
      .then(loadQr)
      .then(
        (e) => {
          qrEncoder = typeof e === "function" ? e : null;
          if (qrEncoder) redraw();
        },
        () => {},
      );
  };
  /**
   * A pairing link: its words with Copy, and under them its QR code for a phone's camera, with what that phone says of
   * it — on the tailnet nothing, an authority signs its certificate; on the network's address, a warning first.
   * @param {string} link @param {boolean} tailnet
   */
  const linkBlock = (link, tailnet) => {
    const svg = qrSvg(qrEncoder, link);
    return m("div", { class: "rset-link" },
      copyable(link, "the link"),
      svg
        ? m("div", { class: "rset-qr-wrap" },
          m("div", { class: "rset-qr", role: "img", "aria-label": tailnet ? "QR code of the link on your tailnet" : "QR code of the link on your network", html: svg }),
          m("p", { class: "rset-qr-said" }, tailnet ? QR_TAILNET_WORDS : QR_LAN_WORDS))
        : null);
  };

  const start = async () => {
    if (starting) return;
    starting = true;
    redraw();
    try {
      const got = await call("/remote/pair", { method: "POST", body: { scope } });
      // Its links are its own — the listener as the server read it — until the page reads the listener after it: one
      // read before may be of another address.
      pairing = { ...got, lanAt: lanTaken };
      deadline = now() + (Number.isFinite(Number(got?.leftMs)) ? Number(got.leftMs) : Number(got?.expiresAt) - now());
      // Drawn at once; then the codes open, read again: the server keeps five, and a sixth lets the oldest go (the
      // review of fx-pair-settings).
      void readDevices().then(redraw);
    } catch (/** @type {any} */ e) {
      toast(`No code: ${said(e)}`, "err");
    }
    starting = false;
    redraw();
  };
  /** Close codes by their ids, on the server; the page draws again. @param {string[]} ids */
  const close = async (ids) => {
    for (const id of ids)
      try {
        await call(`/remote/pair?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {}
    await readDevices();
    redraw();
  };
  const cancel = async () => {
    const mine = pairing;
    over(mine);
    if (mine?.id) await close([mine.id]);
    else redraw();
  };
  /**
   * A device revoked here, asked first; a machine's card revokes its app's device, and its agents' go with it
   * (services/devices.js `revoke`). @param {any} d @param {string} [machine]  the card's machine, by its name
   * @param {boolean} [agents]  its agents' device goes with it, and is said to
   */
  const revoke = async (d, machine, agents = false) => {
    const name = machine || d.name;
    const description = machine
      ? d.scope === "agent"
        ? `Its agents are signed out of ${hereName()} at once, and what they have open here ends. They come back when Agents is turned on again on ${machine}.`
        : `${agents ? "Its app and its agents are" : "Its app is"} signed out of ${hereName()} at once. To undo, pair it again with a code.`
      : "Its token stops now, and what it has open here — a terminal, the live view — closes. It pairs again with a new code.";
    if (!(await ask({ title: `Revoke ${name}?`, description, confirmLabel: "Revoke", destructive: true }))) return;
    try {
      await call(`/remote/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      toast(`${name} is revoked`);
    } catch (/** @type {any} */ e) {
      toast(`Not revoked: ${said(e)}`, "err");
    }
    await readDevices();
    redraw();
  };
  /**
   * Clear copies: a machine's copies here go, busy ones too, with the chats its agents worked in there (POST
   * /remote/devices/:id/copies/clear). @param {any} d  its agents' device @param {string} machine
   */
  const clearCopies = async (d, machine) => {
    const n = Number(d.copies?.count) || 0;
    // Chats of yours that run in copies placed for them (Run on) go too: named, so none is deleted unsaid.
    const yours = (Array.isArray(d.copies?.chats) ? d.copies.chats : []).map((/** @type {any} */ c) => `“${String(c?.title || "Untitled chat")}”`);
    const also = yours.length ? ` Your ${yours.length === 1 ? "chat" : `${yours.length} chats`} running there from ${machine} ${yours.length === 1 ? "is" : "are"} deleted too: ${yours.slice(0, 5).join(", ")}${yours.length > 5 ? `, and ${yours.length - 5} more` : ""}.` : "";
    const description = `${n === 1 ? "Its copy" : `Its ${n} copies`} on ${hereName()} ${n === 1 ? "is" : "are"} deleted, with the chats its agents worked in there: one at work there stops.${also} The next time they work here, ${machine} sends a new copy.`;
    if (!(await ask({ title: `Clear ${machine}'s copies?`, description, confirmLabel: "Clear copies", destructive: true }))) return;
    try {
      const r = await call(`/remote/devices/${encodeURIComponent(d.id)}/copies/clear`, { method: "POST" });
      // A folder a file still holds open stays on disk a while: the hourly sweep removes it.
      if (Array.isArray(r?.failed) && r.failed.length) toast(`${machine}'s copies are cleared; a file there is still in use on ${hereName()}, so what holds it goes within the hour`);
      else toast(`${machine}'s copies are cleared${r?.bytes ? `: ${sizeWords(r.bytes)} freed` : ""}`);
    } catch (/** @type {any} */ e) {
      toast(`Not cleared: ${said(e)}`, "err");
    }
    await readDevices();
    redraw();
  };
  /** @param {any} d */
  const forget = async (d) => {
    try {
      await call(`/remote/devices/${encodeURIComponent(d.id)}?forget=1`, { method: "DELETE" });
    } catch (/** @type {any} */ e) {
      toast(`Not forgotten: ${said(e)}`, "err");
    }
    await readDevices();
    redraw();
  };
  /**
   * One of another machine's agents' grants switched here, as the server keeps it; one refused is said, and the list read
   * again. @param {any} d @param {string} grant @param {boolean} on @param {string} [machine]  whose agents, by its name
   */
  const setGrant = async (d, grant, on, machine) => {
    const key = `${d.id}:${grant}`;
    if (granting.has(key)) return;
    // Full control asks first: its agents then act here as the person.
    if (grant === "full" && on && !(await ask({ title: `Full control for ${machine || d.name}?`, description: fullConfirmWords(machine ? `${machine}'s agents` : d.name, hereName()), confirmLabel: "Switch on", destructive: true }))) return;
    granting.add(key);
    redraw();
    // One device's saves go one after another: each answer holds every grant saved before it, and none read late takes
    // back one saved after it.
    const save = () => call(`/remote/devices/${encodeURIComponent(d.id)}`, { method: "PATCH", body: { grants: { [grant]: on } } });
    const run = (grantTurns.get(d.id) ?? Promise.resolve()).then(save, save);
    const turn = run.catch(() => {});
    grantTurns.set(d.id, turn);
    void turn.then(() => void (grantTurns.get(d.id) === turn && grantTurns.delete(d.id)));
    try {
      const got = await run;
      if (got?.device) grantsSaved.set(d.id, { grants: got.device.grants, reads: deviceReads });
      if (got?.device && devices) devices = devices.map((x) => (x.id === d.id ? got.device : x));
    } catch (/** @type {any} */ e) {
      toast(`Not changed: ${said(e)}`, "err");
      await readDevices();
    }
    granting.delete(key);
    redraw();
  };

  /** The app's other machines, read by the app (its bridge): each as it stands there. */
  const readThere = async () => {
    try {
      const got = await app.agentMachines();
      there = Array.isArray(got?.machines) ? got.machines : [];
      thereWhy = null;
    } catch (/** @type {any} */ e) {
      there = [];
      thereWhy = said(e);
    }
  };
  /** This Filament's upstreams of other machines' models, read again; one that fails leaves them as they were read. */
  const readUps = async () => {
    try {
      const got = await call("/upstreams");
      machineUps = (Array.isArray(got?.upstreams) ? got.upstreams : []).filter((/** @type {any} */ u) => u?.type === "filament");
    } catch {
      machineUps ||= [];
    }
  };
  if (typeof app?.agentMachines === "function") void Promise.all([readThere(), readUps()]).then(redraw);
  // A browser link's state as it moves, said on its machine's line: a press answers with it as it was then —
  // connecting — and the link is up a moment after (the owner's of 11-09). A page left stops hearing it.
  /** @type {(() => void) | null} */
  let unhear = null;
  if (typeof app?.onBrowserLink === "function")
    unhear = app.onBrowserLink((/** @type {any} */ row) => {
      if (/** @type {any} */ (body).isConnected === false) return void unhear?.();
      if (!row?.id || !(there || []).some((y) => y.id === row.id)) return;
      tookThere({ id: row.id, browser: row.browser === true, browserLink: row.browserLink, browserWords: row.browserWords ?? null });
      redraw();
    });
  /** This Filament's upstream of a machine's models, or null. @param {any} x  an app's machine row */
  const upOf = (x) => (machineUps || []).find((u) => String(u.machine || "").toLowerCase() === String(x.id).toLowerCase()) || null;
  /**
   * A machine's row as the app answered it, in its place: what the answer does not carry — its browser switch and its
   * link, beside Agents', Models' and Forget's answers — kept as it stood. @param {any} got
   */
  // Its coding agents' line is the answer's alone: one that could not read them leaves none standing from before.
  const tookThere = (got) => void (got?.id && (there = (there || []).map((y) => (y.id === got.id ? { ...y, ...got, agents: got.agents } : y))));
  /**
   * This Filament's upstream of a machine's models removed here, where there is one: null where none is left, else why
   * it stays, in words (a route of the person's that names it). @param {any} x
   */
  const dropUp = async (x) => {
    const u = upOf(x);
    if (!u) return null;
    try {
      await call(`/upstreams/${encodeURIComponent(u.id)}`, { method: "DELETE" });
      machineUps = (machineUps || []).filter((y) => y.id !== u.id);
      return null;
    } catch (/** @type {any} */ e) {
      return said(e);
    }
  };
  /**
   * A machine's models used in this Filament's chats, or not. On: the app switches its agents' device's grant `models`
   * on there, then this Filament adds its upstream of them (one there already stays). Off: the upstream removed here
   * first — even where the machine does not answer, so its models leave the picker at once —, then the grant switched
   * off there, where this Filament keeps a device to switch it by. A removal refused here moves nothing there: said,
   * the pill stays pressed, and a press asks again. @param {any} x @param {boolean} on
   */
  const useModels = async (x, on) => {
    if (thereBusy.has(x.id)) return;
    thereBusy.add(x.id);
    redraw();
    try {
      if (on) {
        const got = await app.agentsModels(x.id, true);
        tookThere(got);
        if (got?.failed) toast(got.said || `Not switched on: ${x.name} did not say why`, "err");
        else {
          // Lent there, and not added here: the switch shows off, and a press adds it.
          const added = upOf(x) ? null : await call("/upstreams", { method: "POST", body: { type: "filament", machine: x.id } }).catch((/** @type {any} */ e) => ({ refused: said(e) }));
          if (added?.upstream) machineUps = [...(machineUps || []), added.upstream];
          if (added?.refused) toast(`${x.name} lends its models, and this Filament did not add them: ${added.refused}`, "err");
          else toast(`${x.name}'s models are in the model picker`);
        }
      } else {
        const stays = await dropUp(x);
        if (stays) toast(`${x.name}'s models stay in the model picker: ${stays}`, "err");
        else {
          // Removed here: the grant there, asked off, says how it went — a bridge that fails, as a machine that does not answer.
          const got = x.kept ? await app.agentsModels(x.id, false).catch((/** @type {any} */ e) => ({ said: `Not switched off: ${said(e)}`, failed: true })) : null;
          tookThere(got);
          toast([`${x.name}'s models left the model picker`, got?.failed ? got.said : null].filter(Boolean).join(". "), got?.failed ? "err" : undefined);
        }
      }
    } catch (/** @type {any} */ e) {
      toast(`Not changed: ${said(e)}`, "err");
      await readUps();
    }
    thereBusy.delete(x.id);
    redraw();
  };
  /** This Filament's agents let work on a machine, or not, by the app. @param {any} x @param {boolean} on */
  const letThere = async (x, on) => {
    if (thereBusy.has(x.id)) return;
    thereBusy.add(x.id);
    redraw();
    try {
      const got = await app.agentsOn(x.id, on);
      tookThere(got);
      toast(got?.said || (on ? `This Filament's agents may work on ${x.name}` : `This Filament's agents work on ${x.name} no more`), got?.failed ? "err" : undefined);
    } catch (/** @type {any} */ e) {
      toast(`Not changed: ${said(e)}`, "err");
    }
    thereBusy.delete(x.id);
    redraw();
  };
  /**
   * A machine let use this app's browser, or not, by the app: its answer — the switch kept, its link's state — taken
   * into the machine's row. @param {any} x @param {boolean} on
   */
  const useBrowser = async (x, on) => {
    if (thereBusy.has(x.id)) return;
    thereBusy.add(x.id);
    redraw();
    try {
      const got = await app.browserOn(x.id, on);
      tookThere(got);
      if (got?.said) toast(got.said, got.failed ? "err" : undefined);
    } catch (/** @type {any} */ e) {
      toast(`Not changed: ${said(e)}`, "err");
    }
    thereBusy.delete(x.id);
    redraw();
  };
  /**
   * Full control on a machine, or not, by the app: on asks first, as its agents then act there as the person; its answer
   * taken into the machine's row. @param {any} x @param {boolean} on
   */
  const fullThere = async (x, on) => {
    if (thereBusy.has(x.id)) return;
    if (on && !(await ask({ title: `Full control on ${x.name}?`, description: fullConfirmWords("This Filament's agents", x.name), confirmLabel: "Switch on", destructive: true }))) return;
    thereBusy.add(x.id);
    redraw();
    try {
      const got = await app.agentsFull(x.id, on);
      tookThere(got);
      toast(got?.said || (on ? `This Filament's agents act on ${x.name} as you` : `Full control on ${x.name} is off`), got?.failed ? "err" : undefined);
    } catch (/** @type {any} */ e) {
      toast(`Not changed: ${said(e)}`, "err");
    }
    thereBusy.delete(x.id);
    redraw();
  };
  /**
   * The sheet Copy keys opens: this computer's providers with a key, none ticked; → the ids ticked at Copy, or null where
   * it closed. The keys themselves never reach this page: the app reads them where it sends them.
   * @param {{ name: string, providers: any[] }} o @returns {Promise<string[] | null>}
   */
  const keysSheet = (o) =>
    new Promise((resolve) => {
      /** @type {Set<string>} */
      const ticked = new Set();
      let done = false;
      const rows = o.providers.map((u) =>
        m("label", { class: "rset-keypick" },
          m("input", { type: "checkbox", onchange: (/** @type {any} */ e) => void (e.target.checked ? ticked.add(String(u.id)) : ticked.delete(String(u.id))) }),
          m("span", {}, String(u.name || u.id)),
          m("span", { class: "prov-masked" }, String(u.key?.masked || ""))));
      /** @param {string[] | null} ids */
      const end = (ids) => {
        done = true;
        d.close(true);
        resolve(ids);
      };
      const d = dialog({
        title: `Copy keys to ${o.name}`,
        description: `Each key ticked goes to ${o.name} as your device there, over the way this app reaches it, and is sealed there as its own. ${o.name} says it came from here. Nothing else goes: not this computer's secret.key, sign-ins or memory.`,
        body: m("div", { class: "rset-keypicks" }, ...rows),
        actions: [
          { label: "Cancel", variant: "outline", onClick: () => end(null) },
          { label: "Copy", onClick: () => end([...ticked]) },
        ],
        onClose: () => void (done || resolve(null)),
      });
    });
  const pickKeys = io.pickKeys || keysSheet;
  /**
   * Copy keys: this computer's providers with a key listed, those ticked copied to the machine by the app, which reads
   * each key here and sends it as your full device there (desktop/lib/machine-agents.js `copyKeys`). @param {any} x
   */
  const copyKeysThere = async (x) => {
    if (thereBusy.has(x.id)) return;
    // Its card's buttons wait while the sheet is open too: one sheet at a time.
    thereBusy.add(x.id);
    redraw();
    try {
      /** @type {any[]} */
      let ups;
      try {
        ups = ((await call("/upstreams"))?.upstreams || []).filter((/** @type {any} */ u) => KEY_TYPES.has(u.type) && !u.agent && !u.machine && u.key?.stored && !u.key?.unreadable);
      } catch (/** @type {any} */ e) {
        return void toast(`No key copied: ${said(e)}`, "err");
      }
      if (!ups.length) return void toast("This machine keeps no provider's key to copy: add one under Settings › Providers", "err");
      const ids = await pickKeys({ name: String(x.name), providers: ups });
      if (!ids) return;
      if (!ids.length) return void toast("No key copied: none was ticked", "err");
      const got = await app.copyKeys(x.id, ids);
      tookThere(got);
      toast(got?.said || `Copied to ${x.name}`, got?.failed ? "err" : undefined);
    } catch (/** @type {any} */ e) {
      toast(`No key copied: ${said(e)}`, "err");
    } finally {
      thereBusy.delete(x.id);
      redraw();
    }
  };

  /** Forget: this Filament's agents' device revoked on that machine, its token let go here — by the app. @param {any} x */
  const forgetThere = async (x) => {
    if (!(await ask({ title: `Forget this Filament's agents on ${x.name}?`, description: `${x.name} revokes their device now, and this Filament lets its token go. Switched on again, ${x.name} makes a new one.`, confirmLabel: "Forget", destructive: true }))) return;
    thereBusy.add(x.id);
    redraw();
    try {
      const got = await app.agentsForget(x.id);
      tookThere(got);
      // Its token let go here: this Filament's upstream of its models can reach it no more, and goes too.
      const stays = got && got.kept === false ? await dropUp(x) : null;
      if (stays) toast([got?.said, `${x.name}'s models stay in the model picker: ${stays}`].filter(Boolean).join(". "), "err");
      else if (got?.said) toast(got.said, got.failed ? "err" : undefined);
    } catch (/** @type {any} */ e) {
      toast(`Not forgotten: ${said(e)}`, "err");
    }
    thereBusy.delete(x.id);
    redraw();
  };

  const signOut = async () => {
    if (!(await ask({ title: "Sign this device out?", description: "This browser stops reaching this Filament now. It pairs again with a new code from the machine Filament runs on.", confirmLabel: "Sign out", destructive: true }))) return;
    try {
      await call("/remote/sign-out", { method: "POST", body: {} });
      go("/ui/pair.html");
    } catch (/** @type {any} */ e) {
      toast(`Not signed out: ${said(e)}`, "err");
    }
  };

  /**
   * The open code's countdown, and the look for its claim: the code runs out at 0:00; gone from the server's open codes
   * before that, it was claimed — by the device that names it (`pairing`), whose name is said — or closed elsewhere.
   * Another code's claim leaves this one open.
   * @param {any} left  the element that says the time left
   */
  const tick = (left) => {
    stopTick();
    let n = 0;
    stopTick = every(() => {
      if (/** @type {any} */ (body).isConnected === false || !pairing) return stopTick();
      const ms = deadline - now();
      left.textContent = leftWords(ms);
      if (ms <= 0) {
        const mine = pairing;
        over(mine);
        // A claim in its last seconds, after the last look: the list read once more says whether a device took it — one
        // that did not land says it cannot tell (the review of fx-pair-settings); a page left by then says nothing.
        void readDevices().then((read) => {
          if (/** @type {any} */ (body).isConnected === false) return;
          const got = read ? (devices || []).find((d) => d.pairing === mine?.id) : null;
          toast(got ? `${got.name} is paired` : read ? "The code ran out: make a new one when the other machine is ready" : RAN_OUT_UNREAD_WORDS);
          redraw();
        });
        return redraw();
      }
      if (++n % Math.max(1, Math.round(CLAIM_LOOK_MS / 1000))) return;
      const mine = pairing;
      const before = seen();
      void readDevices().then((read) => {
        if (!read || pairing !== mine || !openCodes) return;
        // Still open: drawn again only where another code or a device came or went.
        if (openCodes.some((c) => c.id === mine.id)) return void (seen() !== before && redraw());
        over(mine);
        const got = (devices || []).find((d) => d.pairing === mine.id);
        toast(got ? `${got.name} is paired` : "The code is no longer open: it was used, or closed in another window");
        redraw();
      });
    }, 1000);
  };

  /**
   * Reach this machine on my network (Part 2): the switch and the port, kept at once like any setting; once it listens,
   * its addresses, its certificate's fingerprint, and what the firewall lets through — Allow on Windows, where the
   * person at this machine confirms.
   * @param {import("../lib/config-rows.js").ConfigKit} kit @param {string} here @param {boolean} elsewhere
   */
  function network(kit, here, elsewhere) {
    if (!kit.leaf("server.lan.enabled")) return [];
    const asked = JSON.stringify(kit.cfg.server?.lan ?? null);
    if (asked !== lanFor) {
      // What was read is of the setting before: the page says it reads, until the new one is read.
      lanFor = asked;
      lanNow = null;
      void readLan().then(redraw);
    }
    const n = lanNow;
    /** @type {any[]} */
    const out = [
      kit.head("On my network"),
      kit.field("server.lan.enabled", { label: "Reach this machine on my network", desc: "Another machine on this network — a laptop, a phone — opens Filament over https at an address below and pairs with a code. Its browser warns of the certificate once: the fingerprint it shows must be the one here." }),
    ];
    if (kit.cfg.server?.lan?.enabled !== true) return out;
    out.push(kit.field("server.lan.port", { label: "Port", desc: "Its own port, never the one this machine's apps call Filament at." }));
    if (!n) return [...out, kit.note("Reading where it listens…")];
    if (n.unread) return [...out, kit.note(`Where it listens could not be read: ${n.unread}`, "warn")];
    if (n.error) out.push(kit.note(`It does not listen: ${n.error}.`, "warn"));
    if (!n.listening) return out;
    out.push(n.addresses?.length
      ? kit.row("Addresses", "Open one in the other machine's browser — the one its network reaches this machine by — or a pairing's link below, which brings the code.", m("div", { class: "rset-links" }, ...n.addresses.map((/** @type {string} */ u) => copyable(u, "the address"))), { wide: true })
      : kit.note(`This machine is on no network yet: connected to one, it answers there at port ${n.listening.port}.`, "warn"));
    out.push(kit.row("Certificate", "Made for this machine by Filament: no authority vouches for it, so a browser warns once. The fingerprint in the warning's certificate details must be this one; another means something else answered.", copyable(String(n.fingerprint), "the fingerprint"), { wide: true }));
    // Its key, made anew on this computer alone: renewal keeps it, so the paired devices go on.
    if (!elsewhere)
      out.push(kit.row("Certificate key", "Renewing the certificate keeps its key, so paired devices go on. A new key cuts every machine and command line paired over the network off until it pairs again, and a browser warns once more: make one only if this machine's key may have been copied.",
        m("button", { class: "ghost sm danger", type: "button", disabled: keying ? "" : null, onclick: () => void newKey() }, "New key…")));
    if (n.platform === "win32") {
      const fw = n.firewall;
      const act = fw?.fix && !elsewhere
        ? m("button", { class: "primary sm", type: "button", disabled: allowing ? "" : null, onclick: () => void allow() }, "Allow")
        : m("button", { class: "ghost sm", type: "button", onclick: () => void readLan(true).then(redraw) }, "Check again");
      out.push(kit.row("Windows Firewall", fw ? `${fw.words}${fw.fix && elsewhere ? ` Allow it on ${here} itself: Windows asks the person there to confirm.` : ""}` : "Reading what it lets through…", act));
    } else
      out.push(kit.note(n.platform === "darwin" ? "If macOS asks whether Filament may accept incoming network connections, say Allow." : `If this machine runs a firewall (ufw, firewalld), open TCP port ${n.listening.port} to your network.`));
    return out;
  }

  /**
   * Share on my tailnet (Part 2): the switch, kept at once like any setting; Tailscale here as GET /remote/tailscale
   * reads it — installed, signed in, this machine's name on the tailnet —; once served, its address with Copy; what went
   * wrong, where Tailscale asked the person to turn something on, and Try again; and Trust my own tailnet login.
   * @param {import("../lib/config-rows.js").ConfigKit} kit @param {string} here
   */
  function tailnet(kit, here) {
    if (!kit.leaf("server.tailscale.serve")) return [];
    const asked = JSON.stringify(kit.cfg.server?.tailscale ?? null);
    if (asked !== tsFor) {
      // What was read is of the setting before: the page says it reads, until the new one is read.
      tsFor = asked;
      tsNow = null;
      void readTs().then(redraw);
    }
    const t = tsNow;
    const on = kit.cfg.server?.tailscale?.serve === true;
    /** @type {any[]} */
    const out = [kit.head("On my tailnet")];
    if (t?.installed === false) out.push(kit.note(`Tailscale is not installed on ${here}: install it from ${TAILSCALE_DOWNLOAD}, sign in, then turn this on.`));
    out.push(kit.field("server.tailscale.serve", { label: "Share on my tailnet", desc: `tailscale serve gives this Filament an https address on your tailnet${t?.name ? `, https://${t.name}` : ""}. Your other machines signed in to Tailscale open it and pair with a code; an authority signs its certificate, so no browser warns.` }));
    if (!on) return t?.installed && !t.running ? [...out, kit.note(`Tailscale is ${t.stateSaid || "not running"} on ${here}: sign in from its icon, then turn this on.`)] : out;
    if (!t) return [...out, kit.note("Reading Tailscale…")];
    // The share's own read failing says it below already: the page's look says only what that does not.
    if (t.unread && t.unread !== t.error) out.push(kit.note(`Tailscale could not be read: ${t.unread}`, "warn"));
    if (t.error) {
      out.push(kit.note(t.error, "warn"));
      if (t.enable) out.push(kit.row("Turn it on", "Where Tailscale asks for it: open it in a browser signed in to your tailnet, turn it on, then Try again.", copyable(t.enable, "the address"), { wide: true }));
      out.push(kit.row("Tailscale", "Ask it again, as the switch says.", m("button", { class: "ghost sm", type: "button", disabled: retrying ? "" : null, onclick: () => void retry() }, "Try again")));
    }
    if (t.address) {
      out.push(kit.row("Tailnet address", `Open it on another machine signed in to your tailnet${t.tailnet ? ` (${t.tailnet})` : ""}, or a pairing's link below. Its artifacts are at ${t.artifacts || "port 8443 of the same name"}.`, copyable(t.address, "the address"), { wide: true }));
      if (!t.https) out.push(kit.note(`HTTPS certificates are off for your tailnet: turn them on in its admin console, ${TAILSCALE_HTTPS}.`, "warn"));
      if (t.funnel) out.push(kit.note("Funnel is on for it: anyone on the internet reaches this address. A browser from there still pairs with a code.", "warn"));
    }
    out.push(kit.field("server.tailscale.trustOwnLogin", { label: "Trust my own tailnet login", desc: `A machine signed in to Tailscale as ${t.login || "you"} drives this Filament without pairing; while the Filament app runs, a browser there answers asks once it is paired with a code. Another person's machine on your tailnet still pairs with a code.` }));
    return out;
  }

  /** @param {import("../lib/config-rows.js").ConfigKit} kit */
  function rows(kit) {
    const s = kit.state || {};
    const here = s.machine?.name || "this machine";
    const elsewhere = s.viewer === "remote";
    hereNow = elsewhere ? here : "this machine";
    /** @type {any[]} */
    const out = [];
    out.push(kit.row("This machine", "The name another machine shows for it as it pairs, and in its list of machines.", m("span", { class: "cset-plain" }, s.machine?.name || "This machine")));
    if (s.device)
      out.push(kit.row("This device", `You reach this Filament from another machine, as ${s.device.name} (${scopeWords(s.device.scope)}).`, m("button", { class: "ghost sm danger", type: "button", onclick: () => void signOut() }, "Sign out")));
    // This computer's own read alone carries it.
    if (s.ownerless) out.push(kit.row("Calls without the owner key", ownerlessWords(s.ownerless), m("span", { class: "cset-plain" }, String(Number(s.ownerless.count) || 0))));
    out.push(...machinesRows(kit, s, here, elsewhere));
    if (s.device?.scope !== "view") out.push(...network(kit, here, elsewhere), ...tailnet(kit, here));

    out.push(kit.head("Pair with a code"));
    if (elsewhere) out.push(kit.note(`A pairing starts on ${here} itself: open Filament there, in Settings › Remote access.`));
    else if (!pairing) {
      out.push(kit.row("New code", "Good for five minutes, once: type it on a browser's pairing page, in filament connect, or in Add a machine on another Filament app. Full drives this Filament as you do; view-only reads it.",
        m("div", { class: "rset-start" },
          segment(m, [{ value: "full", label: "Full" }, { value: "view", label: "View-only" }], scope, (v) => { scope = v; redraw(); }, "What the device may do"),
          m("button", { class: "primary sm", type: "button", disabled: starting ? "" : null, onclick: () => void start() }, "Make a code"))));
    } else {
      // Its links where the network's listener answers now, as read since the code was made; the code's own until then.
      /** @type {string[]} */
      const lanLinks = lanNow && !lanNow.unread && lanTaken > Number(pairing.lanAt ?? Infinity) && kit.cfg.server?.lan ? linksOf(lanNow, String(pairing.code)) : Array.isArray(pairing.links) ? pairing.links : [];
      // And the tailnet's, where Filament is served there as read now; the code's own carries it until Tailscale is read.
      const tail = tsNow && !tsNow.unread ? tailnetLinkOf(tsNow, String(pairing.code)) : null;
      const onTail = (/** @type {string} */ l) => !!tsNow?.name && l.startsWith(`https://${tsNow.name}/`);
      // The tailnet's first — a phone opens it with no certificate warning —, the code's own as read until Tailscale is.
      const links = [...new Set([...(tsNow && !tsNow.unread ? lanLinks.filter((l) => !onTail(l)) : lanLinks), ...(tail ? [tail] : [])])].sort((a, b) => Number(onTailnet(b)) - Number(onTailnet(a)));
      const left = m("span", { class: "rset-left" }, leftWords(deadline - now()));
      tick(left);
      const forWhat = pairing.scope === "view" ? "a view-only device: it reads" : "a full device: it drives this Filament as you do";
      out.push(kit.row("Code", `For ${forWhat}. Type it on the other machine's pairing page${links.length ? ", or open a link below there" : ""}.`,
        m("div", { class: "cset-copy" },
          m("code", { class: "rset-code" }, String(pairing.code)),
          m("button", { class: "mset-act", type: "button", title: "Copy the code", "aria-label": "Copy the code", html: ICONS.copy, onclick: () => copy(String(pairing.code)).then(() => toast("Copied the code"), () => toast("Copy failed: select it instead", "err")) }))));
      out.push(kit.row("Good for", "Once, by one device: a new code for the next.", m("div", { class: "rset-start" }, left, m("button", { class: "ghost sm", type: "button", onclick: () => void cancel() }, "Cancel"))));
      if (links.length) {
        wantQr();
        out.push(kit.row("Links", "Open one on the other machine — the one its network reaches this machine by —, or scan its code with a phone's camera. A link on your network carries the certificate's fingerprint, which the pairing page shows to compare.",
          m("div", { class: "rset-links" }, ...links.map((l) => linkBlock(l, onTailnet(l)))), { wide: true }));
        out.push(kit.note(`Or in its terminal: filament connect ${links[0]}`));
      } else
        out.push(kit.note("No other machine reaches Filament on the network yet: turn on Reach this machine on my network or Share on my tailnet above, and a link for each address appears here. Through an SSH tunnel, the code works on that address.", "warn"));
    }
    // A code this page does not show is still a way in: said, and closed here (the review of 35049d31f).
    const others = elsewhere ? [] : otherCodes();
    if (others.length) {
      const one = others.length === 1;
      const newest = Math.max(...others.map((c) => Number(c.leftMs) || 0)) - (now() - openRead);
      out.push(kit.row("Codes open", `${one ? "A code" : `${others.length} codes`} made earlier — in another window, by filament pair, or here before the page was opened again — ${one ? "is" : "are"} still open, the newest good for ${leftWords(newest)}. Close ${one ? "it" : "them"} unless a device is pairing with ${one ? "it" : "one"}.`,
        m("button", { class: "ghost sm", type: "button", onclick: () => void close(others.map((c) => String(c.id))) }, one ? "Close it" : "Close them")));
    }
    return out;
  }

  /**
   * Machines, a card each, and the browsers and command lines paired here apart (the owner's redesign of 11-09, Product's
   * layout): a card says the machine's state, what it may do on this machine and — in the desktop app, on this machine's
   * own page — what this machine may do on it. Add a machine and this window's lines are the desktop app's alone.
   * @param {import("../lib/config-rows.js").ConfigKit} kit @param {any} s  the state @param {string} here @param {boolean} elsewhere
   */
  function machinesRows(kit, s, here, elsewhere) {
    const adds = !elsewhere && typeof app?.addMachine === "function";
    const lets = !elsewhere && typeof app?.agentMachines === "function";
    /** @type {any[]} */
    const out = [kit.head("Machines")];
    if (devices === null) return [...out, kit.note("Reading the machines…")];
    if (devicesWhy) out.push(kit.note(s.device?.scope === "view" ? "A view-only device sees no list of machines or devices." : `The machines and devices paired here could not be read: ${devicesWhy}`, s.device?.scope === "view" ? undefined : "warn"));
    else if (devicesStale) out.push(kit.note(`The machines and devices paired here could not be read again just now: ${devicesStale.replace(/\.$/, "")}. They show as last read.`, "warn"));
    const { cards, loose } = machinesOf(devicesWhy ? [] : devices, lets ? there || [] : []);
    if (cards.length || adds) out.push(kit.note(MACHINES_WORDS));
    if (elsewhere && cards.length) out.push(kit.note(`What ${here}'s own agents may do on other machines is set on ${here} itself.`));
    if (adds) out.push(kit.row("Add a machine", ADD_MACHINE_WORDS, m("button", { class: "ghost sm", type: "button", onclick: () => app.addMachine() }, "Add a machine…")));
    if (adds && typeof app?.sshSetup === "function")
      out.push(kit.row("Set up a machine over SSH", SSH_SETUP_WORDS, m("button", { class: "ghost sm", type: "button", onclick: () => (io.sshSetup || openSshSetup)({ onToast: toast }) }, "Set up over SSH…")));
    if (lets && there === null) out.push(kit.note("Reading the other machines…"));
    else if (lets && thereWhy) out.push(kit.note(`The other machines could not be read: ${thereWhy}`, "warn"));
    if (cards.length) out.push(filtered("machines", "machines", cards.map((c) => [[c.name], card(c, s, here, elsewhere, lets, adds)]), true));
    else if (!devicesWhy && !(lets && there === null)) out.push(kit.note(adds ? "No other machine yet: Add a machine pairs this window with one." : `No other machine is paired with ${elsewhere ? here : "this one"} yet.`));
    if (devicesWhy) return out;
    out.push(kit.head("Browsers and command lines"));
    out.push(loose.length ? filtered("devices", "devices", loose.map((d) => [[d.name], deviceItem(d, s)])) : kit.note("No browser or command line is paired yet."));
    return out;
  }

  /**
   * A permission's pill: pressed while on, a check before its name; its whole meaning in its title, or why it cannot
   * change now. `held`: on while Full control is, a lock after its name. `dot`: a link's state beside it (connecting,
   * connected, refused). `unknown`: on or off there, unread — dashed, pressed neither way (`mixed`).
   * @param {string} label @param {boolean} on @param {{ aria: string, title: string, disabled?: boolean, held?: boolean, unknown?: boolean, dot?: string, data?: Record<string, string>, onclick: () => void }} o
   */
  const pill = (label, on, o) =>
    m("button", { class: `rset-pill${on ? " is-on" : ""}${o.held ? " is-held" : ""}${o.unknown ? " is-unknown" : ""}`, type: "button", "aria-pressed": o.unknown ? "mixed" : on ? "true" : "false", "aria-label": o.aria, title: o.title, ...(o.disabled ? { disabled: "" } : {}), ...(o.data || {}), onclick: o.onclick },
      on ? m("span", { class: "rset-pill-check", "aria-hidden": "true", html: ICONS.check }) : null,
      m("span", {}, label),
      o.held ? m("span", { class: "rset-pill-lock", "aria-hidden": "true", html: ICONS.lock }) : null,
      o.dot ? m("span", { class: `rset-dot is-${o.dot}`, "aria-hidden": "true" }) : null);

  /**
   * A list of many: its items in one inset list — or, `cards`, its machines' cards one under another —, and from
   * `FILTER_FROM` on a filter by name over it — typed into, the list alone drawn again, so the field keeps its place.
   * Each entry: the names it is found by, and its item.
   * @param {"machines" | "devices"} key @param {string} what @param {[string[], any][]} entries @param {boolean} [cards]
   */
  const filtered = (key, what, entries, cards = false) => {
    const items = m("div", { class: cards ? "rset-cards" : "nset-items" });
    // Too few for a field: nothing filters them, whatever was typed while the list was longer.
    if (entries.length < FILTER_FROM) filters[key] = "";
    const show = () => {
      const q = filters[key].trim().toLowerCase();
      const shown = entries.filter(([names]) => !q || names.some((n) => String(n).toLowerCase().includes(q)));
      items.replaceChildren(...(shown.length ? shown.map(([, el]) => el) : [m("p", { class: "nset-none rset-none" }, `No ${what} named so.`)]));
    };
    show();
    if (entries.length < FILTER_FROM) return items;
    // The page drawn again while the filter is typed into: its field, new, takes the focus and the caret where they were.
    const was = /** @type {any} */ (globalThis.document?.activeElement);
    const caret = was?.getAttribute?.("data-filter") === key ? [was.selectionStart, was.selectionEnd] : null;
    const field = m("input", {
      class: "zc-input rset-filter",
      "data-filter": key,
      type: "search",
      placeholder: `Filter ${entries.length} ${what}`,
      "aria-label": `Filter the ${what}`,
      value: filters[key],
      oninput: (/** @type {any} */ e) => {
        filters[key] = String(e.target.value || "");
        show();
      },
    });
    if (caret)
      queueMicrotask(() => {
        field.focus?.();
        field.setSelectionRange?.(caret[0], caret[1]);
      });
    return m("div", { class: "nset-list" }, field, items);
  };

  /**
   * A browser or a command line paired here as one line: its name, what it is and when it was last seen, Revoke — or,
   * revoked, Forget. A machine's second app device whose agents came in by it shows their pills, its Revoke theirs too.
   * @param {any} d @param {any} s  the state
   */
  function deviceItem(d, s) {
    const a = d.revokedAt == null && d.scope !== "agent" ? (devices || []).find((x) => x.scope === "agent" && x.of === d.id && x.revokedAt == null) ?? null : null;
    const name = a ? String(a.from || d.name) : "";
    return m("div", { class: `nset-item rset-item${d.revokedAt ? " is-off" : ""}`, "data-device": d.id },
      m("span", { class: "nset-preset-text" },
        m("span", { class: "nset-preset-name" }, m("span", { class: "nset-preset-title rset-name" }, `${d.name}${s.device?.id === d.id ? " (this device)" : ""}`)),
        m("span", { class: "nset-preset-line rset-line" }, deviceWords(d, now())),
        a ? lineOf(`${name}'s agents work here by this sign-in too: Revoke signs both out.`) : null,
        a?.grants?.full === true && a.grants.agents === true ? lineOf(`Full control: ${name}'s agents act here as you, in any folder, without asking.`, " is-warn") : null),
      m("span", { class: "rset-end" },
        a ? grantPills(a, name) : null,
        d.revokedAt
          ? m("button", { class: "ghost sm", type: "button", onclick: () => void forget(d) }, "Forget")
          : m("button", { class: "ghost sm danger", type: "button", onclick: () => void (a ? revoke(d, name, true) : revoke(d)) }, "Revoke")));
  }

  /** When a device was last seen, and when it lapses unused (`expiryWords`), in a few words. @param {any} d */
  const seenWords = (d) => {
    const ends = expiryWords(d.expiresAt, now());
    return `${d.lastSeenAt ? `seen ${agoWords(now() - d.lastSeenAt)}` : "not seen yet"}${ends ? ` · ${ends}` : ""}`;
  };
  /** A line under a line's title; `cls` " is-warn" where it warns. @param {string} text @param {string} [cls] @param {string} [title] */
  const lineOf = (text, cls = "", title = "") => m("span", { class: `nset-preset-line rset-line${cls}`, ...(title ? { title } : {}) }, text);
  /**
   * One way of a machine's card: who acts on which machine as its title, its lines, and what it ends with.
   * @param {string} title @param {any[]} lines @param {any} end @param {string} cls @param {Record<string, string>} data
   */
  const wayOf = (title, lines, end, cls, data) =>
    m("div", { class: `nset-item rset-item rset-way${cls}`, ...data },
      m("span", { class: "nset-preset-text" }, m("span", { class: "nset-preset-name" }, m("span", { class: "nset-preset-title rset-name" }, title)), ...lines),
      end ? m("span", { class: "rset-end" }, ...(Array.isArray(end) ? end : [end])) : null);

  /**
   * A machine's state, for its card's head: this window's line to it where there is one — answering, not answering,
   * disconnected here —, else its pairing here. @param {{ name: string, app: any, agents: any, row: any }} c @param {string} where
   * @returns {[string, string]}  the dot's state and the words
   */
  const stateOf = (c, where) => {
    const x = c.row;
    if (x?.ready) return ["ok", "Connected"];
    // One that answers on a wire this app does not speak: its words say which side to update.
    if (x?.away === "quiet") return ["bad", x.update && x.words ? String(x.words) : `Not reachable: ${c.name} doesn't answer. Check it's on, with Filament open.`];
    if (x?.away === "off") return ["off", "Disconnected in this window: connect it from the machines menu."];
    if (c.app && c.app.revokedAt == null) return ["off", `Paired with ${where} · ${seenWords(c.app)}`];
    if (c.agents) return ["off", `Its agents are paired with ${where} · ${seenWords(c.agents)}`];
    if (c.app) return ["off", `Revoked ${agoWords(now() - c.app.revokedAt)}`];
    return ["off", "Not connected from this window"];
  };

  /**
   * A machine's card: its name and state, then what it may do on this machine and — `lets`, the app's — what this
   * machine may do on it, a line each said in those words.
   * @param {{ key: string, name: string, app: any, agents: any, row: any }} c @param {any} s @param {string} here
   * @param {boolean} elsewhere @param {boolean} lets @param {boolean} adds
   */
  function card(c, s, here, elsewhere, lets, adds) {
    const where = elsewhere ? here : "this machine";
    const [dot, words] = stateOf(c, where);
    return m("div", { class: "nset-items rset-card", "data-card": c.key },
      m("div", { class: "nset-item rset-card-head" },
        m("span", { class: "rset-card-name" }, c.name),
        m("span", { class: `rset-state is-${dot}` }, m("span", { class: `rset-dot is-${dot}`, "aria-hidden": "true" }), m("span", {}, words))),
      inWay(c, s, where, elsewhere),
      lets ? outWay(c, adds) : null);
  }

  /**
   * What a machine may do on this one: its app's pairing here, and its agents' pills — or that it is paired here no way,
   * or revoked. One Revoke: its app's device, its agents' with it.
   * @param {{ key: string, name: string, app: any, agents: any }} c @param {any} s @param {string} where @param {boolean} elsewhere
   */
  function inWay(c, s, where, elsewhere) {
    const d = c.app;
    const a = c.agents;
    // The machine whose window this is, marked beside its own name.
    const title = inTitle(`${c.name}${d && s.device?.id === d.id ? " (this device)" : ""}`, where);
    if (!d && !a) return wayOf(title, [lineOf(`Not paired with ${where}`)], null, " is-muted", { "data-in": c.key });
    if (d && d.revokedAt != null)
      return wayOf(title, [lineOf(`Revoked ${agoWords(now() - d.revokedAt)} · pair it again with a code to undo`)], m("button", { class: "ghost sm", type: "button", onclick: () => void forget(d) }, "Forget"), " is-off", { "data-device": d.id });
    const worked = a ? (a.lastSeenAt ? `Its agents last worked here ${agoWords(now() - a.lastSeenAt)}.` : "Its agents have not worked here yet.") : "";
    /** @type {any[]} */
    const lines = [d ? lineOf(d.scope === "view" ? `${c.name}'s app views ${where}, read-only · ${seenWords(d)}` : `${c.name}'s app opens ${where} in its window · ${seenWords(d)}`, "", worked) : lineOf(`Its agents' own sign-in here · ${seenWords(a)}`)];
    if (!a && d.scope === "view") lines.push(lineOf(`Its agents can't work here: its app is paired view-only. Pair it again with a full code to let them.`));
    else if (!a) lines.push(lineOf(`Its agents can't work here yet: on ${c.name}, press Agents under "${outTitle(s.machine?.name || "this machine")}".`));
    if (a?.grants?.full === true && a.grants.agents === true) lines.push(lineOf(`Full control: ${c.name}'s agents act ${elsewhere ? `on ${where}` : "here"} as you, in any folder, without asking.`, " is-warn"));
    // The copies its agents work in here (services/copies.js), where it keeps any: how many, their size, their folder.
    const copies = a?.copies?.count ? a.copies : null;
    if (copies) lines.push(lineOf(`Copies from ${c.name}: ${copies.count}, ${sizeWords(copies.bytes)}, in ${copies.folder}`));
    const clears = copies ? m("button", { class: "ghost sm", type: "button", "data-clear-copies": a.id, onclick: () => void clearCopies(a, c.name) }, "Clear copies") : null;
    return wayOf(title, lines, [a ? grantPills(a, c.name) : null, clears, m("button", { class: "ghost sm danger", type: "button", onclick: () => void revoke(d || a, c.name, !!a) }, "Revoke")], "", { "data-device": (d || a).id });
  }

  /**
   * A pill for each thing a machine's agents may do here, each PATCHing its grant on their device. Full control waits
   * for Agents, and holds Without asking and Coding agents on while it is on; Agents holds Run on.
   * @param {any} a  their device @param {string} name
   */
  const grantPills = (a, name) =>
    m("span", { class: "rset-pills", role: "group", "aria-label": `What ${name}'s agents may do here` },
      ...GRANT_ROWS.map((g) => {
        const own = a.grants?.[g.grant] === true;
        // Held by Full control, which is on top of Agents: on, and still while it is on. Run on is held by Agents.
        const byFull = FULL_HOLDS.includes(g.grant) && a.grants?.full === true && a.grants?.agents === true;
        const byAgents = g.grant === "copies" && a.grants?.agents === true;
        const held = byFull || byAgents;
        // Full control waits for Agents: on top of it, never alone.
        const waits = g.grant === "full" && !own && a.grants?.agents !== true;
        const title = held ? `${g.says(name)} On while ${byFull ? "Full control" : "Agents"} is on.` : waits ? `${g.says(name)} Turn on Agents first.` : g.says(name);
        return pill(g.short, own || held, { aria: `${g.label} (${a.name})`, title, held, disabled: held || waits || granting.has(`${a.id}:${g.grant}`), data: { "data-grant": g.grant }, onclick: () => void setGrant(a, g.grant, !own, name) });
      }));

  /**
   * What this machine may do on another (the app's other machines): Agents moves where the machine answers and this app
   * is a full device there. Models, where the app lends them: on where that machine lends them (the grant) and this
   * Filament has added them (its upstream) — either alone shows off, and a press makes both so —, pressed on once
   * Agents has made this Filament's device there; where the grant cannot be read (the machine does not answer, no device
   * is kept there), on while the upstream is here, and a press removes it. Full control on top of Agents. Browser, where
   * the app hosts it (b-remote): switched on where this app is a full device there, off at any time, its link's state its
   * dot. Forget where this Filament keeps its agents' device's token and the machine cannot be reached by it. Not in this
   * window: Add a machine.
   * @param {{ key: string, name: string, row: any }} c @param {boolean} adds
   */
  function outWay(c, adds) {
    const title = outTitle(c.name);
    const x = c.row;
    if (!x) return wayOf(title, [lineOf("Not in this window")], adds ? m("button", { class: "ghost sm", type: "button", onclick: () => app.addMachine() }, "Add a machine…") : null, " is-muted", { "data-out": c.key });
    const has = { models: typeof app?.agentsModels === "function", full: typeof app?.agentsFull === "function", browser: typeof app?.browserOn === "function" };
    const busy = thereBusy.has(x.id);
    const agents = x.on === true;
    // Its models used here: lent there and added here; where what it lends cannot be read — the machine does not
    // answer, or this Filament keeps no device there —, added here, so a press takes them out of the picker.
    const used = !!upOf(x) && (x.models === true || !x.ready || !x.kept);
    const browsing = x.browser === true;
    // Its line: a browser link refused, said with what to do; else, not answering, that its pills wait — its head says
    // why —, or what stands in the way; else what the machine said of this Filament's device there. Whole, never cut.
    const refused = browsing && x.browserLink === "refused" && !!x.browserWords;
    const notReady = x.words ? String(x.words) : `${x.name} does not answer now.`;
    // On a wire this app does not speak, its pills wait for an update, not for an answer: its head says which side.
    const gap = !x.ready && x.update === true;
    // Not read there, with a device kept here: Agents and Full control may be on there or off, and are said unknown.
    const unknown = !x.ready && !!x.kept;
    const unknownWords = `${notReady} Whether it is on there is unknown until ${gap ? "that update" : "it answers"}.`;
    const said = refused ? String(x.browserWords) : gap ? "Changes wait for that update" : !x.ready ? (x.away ? "Changes wait until it answers" : notReady) : x.words ? String(x.words) : `This app opens ${x.name} from the machines menu at the top`;
    /** @type {any[]} */
    const lines = [lineOf(said, refused || gap || (!x.ready && !x.away) ? " is-warn" : "")];
    if (x.full === true) lines.push(lineOf(`Full control: this machine's agents act on ${x.name} as you, in any folder, without asking.`, " is-warn"));
    // Its coding agents' sign-ins, as it lists them; signed in there from here by its own Settings › Coding agents.
    /** @type {any[]} */
    const accounts = x.ready && Array.isArray(x.agents) ? x.agents : [];
    if (accounts.length) lines.push(lineOf(`Coding agents there: ${accounts.map(accountWords).join(" · ")}`));
    const signsIn = accounts.some((a) => a.state === "out" || a.state === "unknown") && typeof app?.openOn === "function";
    const link = browsing ? ({ connected: "ok", connecting: "wait", refused: "bad" })[/** @type {string} */ (x.browserLink)] || "" : "";
    const pills = m("span", { class: "rset-pills", role: "group", "aria-label": `What this Filament may do on ${x.name}` },
      pill("Agents", agents, { aria: `Let this Filament's agents work on ${x.name}`, unknown, title: unknown ? unknownWords : !x.ready ? notReady : [thereWords(x.name), x.words].filter(Boolean).join(" "), disabled: !x.ready || busy, data: { "data-perm": "agents" }, onclick: () => void letThere(x, !agents) }),
      has.models
        ? pill("Models", used, {
            aria: modelsLabel(x.name),
            title: used
              ? [modelsWords(x.name), !x.kept ? `This Filament keeps no agents' device on ${x.name} now: its models answer nothing here, and a press takes them out of the model picker.` : !x.ready ? `${notReady} A press takes its models out of the model picker here at once.` : null].filter(Boolean).join(" ")
              : !x.kept ? `Press Agents first: ${x.name} lends its models to this Filament's agents' device there.` : !x.ready ? notReady : modelsWords(x.name),
            // Switched on once that machine answers and a device is kept there; off at any time.
            disabled: busy || machineUps === null || (!used && (!x.kept || !x.ready)),
            data: { "data-perm": "models" },
            onclick: () => void useModels(x, !used),
          })
        : null,
      has.full
        ? pill("Full control", x.full === true, {
            aria: fullLabel(x.name),
            unknown,
            title: unknown ? unknownWords : x.full !== true && (!x.kept || !agents) ? `Press Agents first: Full control is on top of it. ${fullWords(x.name)}` : !x.ready ? notReady : fullWords(x.name),
            // Switched on once Agents is on there; off at any time that machine answers.
            disabled: busy || !x.ready || (x.full !== true && (!x.kept || !agents)),
            data: { "data-perm": "full" },
            onclick: () => void fullThere(x, x.full !== true),
          })
        : null,
      has.browser
        ? pill("Browser", browsing, { aria: browserLabel(x.name), title: !browsing && !x.ready ? notReady : [browserWords(x.name), browsing ? x.browserWords : null].filter(Boolean).join(" "), disabled: busy || (!browsing && !x.ready), dot: link, data: { "data-perm": "browser" }, onclick: () => void useBrowser(x, !browsing) })
        : null);
    const forgets = x.kept && !x.ready
      ? m("button", { class: "ghost sm", type: "button", title: `Forget this Filament's agents on ${x.name}`, "aria-label": `Forget this Filament's agents on ${x.name}`, disabled: busy ? "" : null, onclick: () => void forgetThere(x) }, "Forget")
      : null;
    const signIn = signsIn
      ? m("button", { class: "ghost sm", type: "button", "data-act": "sign-in-there", title: `Opens ${x.name}'s Settings › Coding agents here: a sign-in shows on this screen, and a code to type in this computer's browser where the agent offers one`, onclick: () => void app.openOn(x.id, "#/settings/agents") }, "Sign in there…")
      : null;
    const copies = x.ready && typeof app?.copyKeys === "function"
      ? m("button", { class: "ghost sm", type: "button", "data-act": "copy-keys", title: `Copy chosen providers' keys from this machine to ${x.name}`, disabled: busy ? "" : null, onclick: () => void copyKeysThere(x) }, "Copy keys…")
      : null;
    return wayOf(title, lines, [pills, signIn, copies, forgets], x.ready ? "" : " is-away", { "data-machine": x.id });
  }
}
