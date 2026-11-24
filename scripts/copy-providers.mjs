#!/usr/bin/env node
// Copy the installed Filament's providers into another Filament running now — a throwaway on another port, say — so it
// reaches the same models with the same keys, with no restart of either. It reads the install's config.json and opens
// its keys with the install's secret.key, in memory only, then hands the chosen upstreams and their routes to the other
// Filament through that one's own API (`PUT /api/config` on 127.0.0.1), which seals them with its own key in its own data
// folder. No key is written in the clear and none is printed. The other Filament keeps its own upstreams; its routes
// come after the copied ones. Running it again replaces what an earlier run copied.
//
// Copied: every upstream that calls a provider's API (Anthropic, OpenAI-compatible…), with its routes. Never copied: a
// Cursor SDK key (`cursor-sdk`), and a Qoder sign-in (`qoder`), whose refresh token a second Filament would spend under
// the first one's feet. `--agents` adds the coding agents (ACP, Codex): they sign in through their own CLIs, and any
// credential in their env is left out. `--only zai,kimi-cn` copies those upstream ids alone.
//
// It refuses a Filament that serves the install's own data folder.
//
// The other Filament answers a program on this computer by its owner key (`server.loopbackTrust` "token", its default):
// `--to <its data folder>` sends the key it keeps there (`owner.key`), as the command line does.
//
//   node scripts/copy-providers.mjs <port> --to <its data folder> [--agents] [--only <id,id…>] [--key <its inbound key>] [--data-dir <install's folder>]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { appDataDir } from "../src/services/config/store.js";
import { SECRET_ENV_RE, loadKey, openConfig } from "../src/services/config/secrets.js";
import { withoutUpstreams } from "../src/core/routing.js";
import { ownerHeaders } from "../src/services/owner.js";

/** Upstream types never copied, and why. */
const NEVER = { "cursor-sdk": "a Cursor SDK key", qoder: "a Qoder sign-in, whose refresh token two Filament runs would share" };
/** Upstream types that are coding agents: copied with `--agents`. */
const AGENTS = new Set(["acp", "codex"]);

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`copy-providers: ${message}`);
  process.exit(1);
}

const { values: opts, positionals } = parseArgs({
  options: { agents: { type: "boolean", default: false }, only: { type: "string" }, key: { type: "string" }, "data-dir": { type: "string" }, to: { type: "string" } },
  allowPositionals: true,
});
const port = Number(positionals[0]);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("give the other Filament's port, e.g. node scripts/copy-providers.mjs 51234");
const only = opts.only ? new Set(opts.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;

// The install's config, its keys opened: the installed app's folder, from a checkout too.
const home = opts["data-dir"] || appDataDir();
/** @type {any} */
let stored;
try {
  stored = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
} catch (e) {
  fail(`could not read ${join(home, "config.json")}: ${/** @type {any} */ (e).message}`);
}
const { config: source, problems } = openConfig(stored, loadKey(home, { create: false }));

/** @type {string[]} */
const left = [];
const chosen = new Set();
for (const u of source.upstreams || []) {
  const why = NEVER[/** @type {keyof typeof NEVER} */ (u.type)];
  if (only && !only.has(u.id)) continue;
  if (why) left.push(`${u.id} (${why}: never copied)`);
  else if (AGENTS.has(u.type) && !opts.agents) left.push(`${u.id} (a coding agent: add --agents)`);
  else chosen.add(u.id);
}
for (const id of only || []) if (!(source.upstreams || []).some((/** @type {any} */ u) => u.id === id)) left.push(`${id} (no such upstream in the install)`);
if (!chosen.size) fail(`nothing to copy${left.length ? `; left out: ${left.join(", ")}` : ""}`);
const unreadable = problems.filter((p) => [...chosen].some((id) => p.startsWith(`upstreams.${id}.`)));
if (unreadable.length) fail(`the install's keys did not open: ${unreadable.join("; ")}`);

// The install's config with the chosen upstreams alone: their routes, and fallbacks only among them.
const notChosen = new Set((source.upstreams || []).map((/** @type {any} */ u) => u.id).filter((/** @type {string} */ id) => !chosen.has(id)));
const picked = withoutUpstreams(source, notChosen);
for (const u of picked.upstreams) {
  if (!u.acp?.env || typeof u.acp.env !== "object") continue;
  for (const k of Object.keys(u.acp.env)) if (SECRET_ENV_RE.test(k)) delete u.acp.env[k];
}

// The other Filament as it stands, and never the install itself.
const base = `http://127.0.0.1:${port}`;
const headers = { "content-type": "application/json", ...(opts.key ? { "x-api-key": opts.key } : {}), ...(opts.to ? ownerHeaders(resolve(opts.to), base) : {}) };
/** @type {any} */
let state;
try {
  const r = await fetch(`${base}/api/state`, { headers });
  if (r.status === 403 && (await r.clone().json().catch(() => null))?.ownerKey === true)
    fail(`${base} answers a program here by its owner key: give its data folder with --to <folder>${opts.to ? ` (${opts.to} holds none for that port)` : ""}`);
  if (!r.ok) fail(`${base}/api/state answered ${r.status}`);
  state = await r.json();
} catch (e) {
  fail(`no Filament answers on ${base} (${/** @type {any} */ (e).cause?.code || /** @type {any} */ (e).message})`);
}
const same = (/** @type {string} */ a, /** @type {string} */ b) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
if (!state?.dataDir || !state?.config) fail(`${base} did not say its data folder and config`);
if (same(state.dataDir, home)) fail(`the Filament on ${base} serves the install's own data folder (${home}): nothing copied`);

// Its own upstreams and routes stay, but for any an earlier run copied: those are replaced.
const kept = withoutUpstreams(state.config, chosen);
const next = { ...state.config, upstreams: [...kept.upstreams, ...picked.upstreams], routes: [...picked.routes, ...kept.routes] };
const put = await fetch(`${base}/api/config`, { method: "PUT", headers, body: JSON.stringify(next) });
const said = /** @type {any} */ (await put.json().catch(() => ({})));
if (!put.ok) fail(`${base} refused the config (${put.status}): ${said.error || ""}${said.errors ? ` — ${said.errors.join("; ")}` : ""}`);

console.log(`copied into the Filament on ${base} (data folder ${state.dataDir}):`);
console.log(`  upstreams: ${picked.upstreams.map((/** @type {any} */ u) => `${u.id}${u.enabled === false ? " (off, as in the install)" : ""}`).join(", ")}`);
console.log(`  routes: ${picked.routes.map((/** @type {any} */ r) => r.match).join(", ") || "none"}`);
if (left.length) console.log(`  left out: ${left.join(", ")}`);
