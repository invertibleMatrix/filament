// @ts-check
// `filament setup` (the owner's of 11-05: "setup, connecting API keys, helping noob users"): Filament set up at a
// terminal, a step at a time, each skippable and each its own command after — Filament started where none runs; the
// coding agents on this computer connected and signed in; a provider's key added and tried; memory and the model it
// learns with; then the harness opened. Where no one is at a terminal it says the commands that do each step.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appDataDir, isCheckout } from "../services/config/store.js";
import { CliError, EXIT, connect } from "./client.js";
import { askLine, askYes } from "./ask.js";
import { accountsNamed, addKey, named, openPage, pause, screenHere, signIn, signedInOf } from "./flows.js";
import { statusOf, statusWords } from "./commands.js";

/** The words of a step's heading. @param {(s: string) => void} out @param {number} n @param {string} title */
const step = (out, n, title) => out(`\n${n}. ${title}\n${"-".repeat(title.length + 3)}`);

/** The steps one by one, for a run with no terminal to ask at. */
const BY_HAND = [
  "filament setup asks at a terminal. Its steps, one by one:",
  "  filament agents                 the coding agents here; filament agents connect <id>, then sign-in <id>",
  "  … | filament keys add <provider> --key-stdin   a provider's API key, piped in",
  "  filament memory on              memory; filament memory model <name> sets the model it learns with",
  "  filament open                   the harness",
].join("\n");

/** A folder's path to compare by: resolved, in one case on Windows. @param {string} p */
const pathKey = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

/**
 * Filament, started in the background where none answers, on the same data folder, and waited for up to a minute: the
 * installed app — its command line is the app's Electron run as Node — as the app, in its tray (`--hidden`), so it keeps
 * Filament running as it always does; a checkout as this same program's `start`. Its data folder is said only where it
 * is not the one Filament finds by itself: the app reads its Start at logon by the words it starts with.
 * @param {import("./commands.js").Run} r
 */
async function startFilament(r) {
  const bin = fileURLToPath(new URL("../../bin/filament.js", import.meta.url));
  r.out("Starting Filament…");
  const own = pathKey(r.dataDir) === pathKey(appDataDir({ dev: isCheckout() })) ? [] : ["--data-dir", r.dataDir];
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env;
  const app = !!process.versions.electron;
  const child = app
    ? spawn(process.execPath, ["--hidden", ...own], { detached: true, stdio: "ignore", env })
    : spawn(process.execPath, [bin, "start", ...own], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
  child.unref();
  const began = Date.now();
  for (const end = began + 60_000; Date.now() < end; ) {
    await pause(1000, r.signal);
    try {
      return await connect(r.dataDir, { timeoutMs: 1500, signal: r.signal });
    } catch {}
    // The app ended at once: one runs already, which took the start for itself — and its Filament does not answer.
    if (child.exitCode != null && app && Date.now() - began < 5000)
      throw new CliError("The Filament app runs already, and its Filament does not answer: Restart in its tray's menu starts it again.", EXIT.failed);
    if (child.exitCode != null) break;
  }
  throw new CliError(app ? "Filament did not start: open the Filament app, whose window says why." : "Filament did not start: `filament start` in a terminal shows why.", EXIT.failed);
}

/**
 * The coding agents step: each one found connected (on a yes) and signed in (on a yes); the missing ones' install lines.
 * @param {import("./flows.js").Ctx} ctx
 */
async function agentsStep(ctx) {
  const { client, term, out } = ctx;
  /** @type {any[]} */
  let entries = (await client.get("/coding-agents")).entries || [];
  if (!entries.some((e) => e.state !== "missing")) {
    await client.post("/acp/detect", {}).catch(() => null);
    entries = (await client.get("/coding-agents")).entries || [];
  }
  out("Filament runs the coding agents you already have — Claude Code, Codex and others — on your own sign-in.");
  for (const e of entries.filter((x) => x.state !== "missing")) {
    // One the person turned off — the agent, or every account of it — stays off: Connect would turn them all on.
    if (e.state === "off") {
      out(`${e.name} is off, as you set it: Settings › Coding agents turns it on.`);
      continue;
    }
    if (e.state !== "connected") {
      if (!(await askYes(term, `Connect ${e.name}?`))) continue;
      await client.post(`/coding-agents/${encodeURIComponent(e.id)}/connect`, {}, { timeoutMs: 300_000 });
      out(`✓ ${e.name} is connected.`);
    }
    // Every account of it: one on and signed in is enough; one off is the person's choice, never signed in here.
    const { rows } = await accountsNamed(client, e.id).catch(() => ({ rows: /** @type {any[]} */ ([]) }));
    const { signedIn } = signedInOf(e, rows);
    if (signedIn) out(`✓ ${e.name} is signed in: ${signedIn}.`);
    else if (rows.some((x) => x.off !== true) && (await askYes(term, `${e.name} is not signed in. Sign it in now?`))) await signIn(ctx, e.id).catch((/** @type {any} */ x) => out(`✗ ${x.message}`));
  }
  const missing = entries.filter((x) => x.state === "missing" && x.install?.line && ["claude-code", "codex"].some((id) => named(id, x.id)));
  for (const e of missing) out(`${e.name} is not installed here. To use it: ${e.install.line}, then filament agents connect ${e.id}.`);
  if (!entries.some((x) => x.state !== "missing")) out("No coding agent is installed — an API key (the next step) is enough to start.");
}

/**
 * The keys step: the keys already added, then one more on each yes.
 * @param {import("./flows.js").Ctx} ctx @param {boolean} answering
 */
async function keysStep(ctx, answering) {
  const { client, term, out } = ctx;
  /** @type {any[]} */
  const keys = ((await client.get("/upstreams")).upstreams || []).filter((/** @type {any} */ u) => !u.agent && (u.key?.stored || u.provider?.keyless));
  out(keys.length ? `Keys added: ${keys.map((u) => u.id).join(", ")}.` : "A provider's API key lets a chat run on its models (Anthropic, OpenAI, OpenRouter…); you pay the provider as you use it.");
  for (let first = true; await askYes(term, first ? "Add a provider's API key?" : "Add another?", { fallback: first && !answering && !keys.length }); first = false) {
    await addKey(ctx).catch((/** @type {any} */ e) => {
      if (e?.code === EXIT.interrupted) throw e;
      out(`✗ ${e.message}`);
    });
  }
}

/**
 * The memory step: why it is there, on or off, and the model it learns with.
 * @param {import("./flows.js").Ctx} ctx
 */
async function memoryStep(ctx) {
  const { client, term, out } = ctx;
  out([
    "Memory keeps what your chats learn — facts about your projects, your decisions, how things are done here — and",
    "briefs each new chat with it, so you do not explain the same things again. It learns between turns with memory's",
    "model: the one you set here, else each chat's compaction model, else the chat's own.",
  ].join("\n"));
  /** @type {any} */
  const st = await client.get("/memory/status");
  const on = await askYes(term, "Keep memory on?", { fallback: st.enabled !== false });
  if (on !== !!st.enabled) await client.post("/memory/enabled", { enabled: on });
  if (!on) return out("Memory is off: filament memory on turns it on.");
  if (!st.engine?.installed && st.engine?.state !== "installing") {
    await client.post("/memory/install", {});
    out("Its engine installs in the background: the console shows how far it is.");
  }
  /** @type {any} */
  const m = (await client.get("/memory/models")).models || {};
  out(!m.now ? `No model for it yet${m.whyNone ? ` (${m.whyNone})` : ""}.` : m.from === "memory" ? `It learns with ${m.now}.` : `Its model is not set: each chat's own stands (${m.now} where no chat is named).`);
  const name = await askLine(term, "Memory's model — a name from filament models, or Enter to keep it:");
  if (!name) return;
  /** @type {any} */
  const set = await client.post("/memory/models", { summarizer: name }).catch((/** @type {any} */ e) => (out(`✗ ${e.message}`), null));
  if (set) out(`✓ Memory learns with ${set.models?.summarizer || name}.`);
}

/**
 * The whole setup, at a terminal.
 * @param {import("./commands.js").Run} r
 */
export async function runSetup(r) {
  const { term, out } = r;
  if (!term.tty) throw new CliError(BY_HAND, EXIT.needsPerson);
  out("Filament setup — every step can be skipped, and done again later on its own.");
  let client;
  try {
    client = await connect(r.dataDir);
    out(`Filament ${client.version} runs at ${client.url}.`);
  } catch (/** @type {any} */ e) {
    // Another data folder's Filament holds the port: starting this one would find it taken.
    if (e?.code !== EXIT.noFilament || e?.body?.otherDataDir) throw e;
    if (!(await askYes(term, "Filament is not running. Start it now?"))) throw e;
    client = await startFilament(r);
    out(`✓ Filament ${client.version} runs at ${client.url}.`);
  }
  const ctx = { client, term, out, flags: r.flags, signal: r.signal };
  step(out, 1, "Coding agents");
  await agentsStep(ctx);
  step(out, 2, "API keys");
  await keysStep(ctx, Number((await client.get("/start"))?.connected?.models) > 0);
  step(out, 3, "Memory");
  await memoryStep(ctx);
  step(out, 4, "Ready");
  const s = await statusOf(client, { shown: !!term.output.isTTY });
  out(statusWords(s));
  // Not asked where no page shows here (over SSH, a server): the status above says the harness's address.
  if (!s.firstRun && r.flags["no-open"] !== true && screenHere() && (await askYes(term, "Open the harness in your browser?"))) openPage(s.harness, r.flags, out);
  out(`\nFrom here: filament --help lists every command; filament chat "<message>" sends a chat one.`);
}
