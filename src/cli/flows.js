// @ts-check
// The command line's steps that take more than one call (the owner's of 11-05: "connecting API keys, helping noob
// users"): a provider's key added and tried, a coding agent signed in, a page opened — each said in plain words as it
// goes, for `filament keys add`, `filament agents sign-in` and `filament setup` alike.
import { spawn } from "node:child_process";
import { CliError, EXIT } from "./client.js";
import { askChoice, askLine, askSecret, askYes, readAll } from "./ask.js";

/**
 * What a flow writes and asks with, and the command's Ctrl+C (`signal`).
 * @typedef {{ client: import("./client.js").Client, term: import("./ask.js").Term, out: (s: string) => void, flags: Record<string, string | true>, signal?: AbortSignal }} Ctx
 */

/** A flag's value, where it has one. @param {Record<string, string | true>} flags @param {string} name */
export const flagValue = (flags, name) => (typeof flags[name] === "string" ? String(flags[name]) : "");

/**
 * Whether a page opened here shows on a screen the person sees: not over SSH (the page would open on the far machine's
 * screen, or nowhere), nor on a Linux with no display (a server). @param {NodeJS.ProcessEnv} [env]
 */
export const screenHere = (env = process.env) =>
  !env.SSH_CONNECTION && !env.SSH_TTY && (process.platform === "win32" || process.platform === "darwin" || !!(env.DISPLAY || env.WAYLAND_DISPLAY));

/**
 * Open a page in the person's browser — or, with `--no-open` or no screen here to open it on, say its address.
 * @param {string} url @param {Record<string, string | true>} [flags] @param {(s: string) => void} [out]
 */
export function openPage(url, flags = {}, out = () => {}) {
  if (flags["no-open"] === true) return false;
  const said = () => out(`Open ${url} in your browser.`);
  if (!screenHere()) {
    said();
    return false;
  }
  // Windows: the URL handler itself, never cmd's `start`, which reads a `&` in the address as its next command (found
  // by the review of 9fc83b83a: a sign-in's page opened cut at its first `&`, the rest run as commands).
  const c = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    // A program missing (no xdg-open on a server) is an 'error' event after the spawn, never a throw: unheard, it ends
    // the command (the remote plan's sv-signin: a Codex sign-in over SSH died as it waited).
    const child = spawn(/** @type {string} */ (c[0]), /** @type {string[]} */ (c[1]), { detached: true, stdio: "ignore" });
    child.on("error", said);
    child.unref();
    return true;
  } catch {
    said();
    return false;
  }
}

/** A wait that the command's Ctrl+C ends (exit 130). @param {number} ms @param {AbortSignal} [signal] */
export const pause = (ms, signal) =>
  new Promise((res, rej) => {
    if (signal?.aborted) return rej(new CliError("Stopped.", EXIT.interrupted));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      res(undefined);
    }, ms);
    const stop = () => {
      clearTimeout(t);
      rej(new CliError("Stopped.", EXIT.interrupted));
    };
    signal?.addEventListener("abort", stop, { once: true });
  });

/** A word matched against a row's names, as typed: its id, its prefix, or its name. @param {string} word @param {...unknown} names */
export const named = (word, ...names) => names.some((n) => typeof n === "string" && n.toLowerCase() === word.toLowerCase());

// ---- a provider's key ------------------------------------------------------------------------------------------------

/**
 * A provider's key added and tried (POST /api/upstreams, then its test): the provider by its id, prefix or name — or
 * chosen at the terminal —, its plan where it has several, the key typed as stars or piped in (`--key-stdin`),
 * never taken from the command line. → the upstream's id, and whether its key answered (null: not tried).
 * @param {Ctx} ctx @param {string} [word]
 */
export async function addKey(ctx, word = "") {
  const { client, term, out, flags } = ctx;
  /** @type {any[]} */
  const providers = (await client.get("/providers")).providers || [];
  let p = word ? providers.find((x) => named(word, x.id, x.prefix, x.name)) : null;
  if (word && !p) throw new CliError(`no provider "${word}" — these take a key: ${providers.map((x) => x.id).join(", ")}`, EXIT.usage);
  if (!p) {
    if (!term.tty) throw new CliError(`name the provider — filament keys add <provider>, one of: ${providers.map((x) => x.id).join(", ")}`, EXIT.usage);
    const i = await askChoice(term, "Which provider is your key for?", providers.map((x) => `${x.name}${x.blurb ? ` — ${x.blurb}` : ""}`));
    p = providers[i];
  }
  /** @type {any[]} */
  const plans = p.plans || [];
  let plan = flagValue(flags, "plan") ? plans.find((x) => named(flagValue(flags, "plan"), x.id, x.label)) : plans.length === 1 ? plans[0] : null;
  if (flagValue(flags, "plan") && !plan) throw new CliError(`${p.name} has no plan "${flagValue(flags, "plan")}" — ${plans.map((x) => x.id).join(", ")}`, EXIT.usage);
  if (!plan && plans.length > 1) {
    if (!term.tty) throw new CliError(`${p.name} has plans: give --plan, one of ${plans.map((x) => x.id).join(", ")}`, EXIT.usage);
    plan = plans[await askChoice(term, `Which ${p.name} plan?`, plans.map((x) => `${x.label}${x.billing === "plan" ? " (a subscription plan)" : " (pay per use)"}`))];
  }
  /** @type {Record<string, string>} */
  const fields = {};
  for (const f of p.fields || []) {
    fields[f.id] = flagValue(flags, f.id) || (term.tty ? await askLine(term, `${f.label}${f.hint ? ` (${f.hint})` : ""}:`) : "");
    if (!fields[f.id]) throw new CliError(`${p.name} needs its ${f.label}: give --${f.id} <value>`, EXIT.usage);
  }
  let apiKey = "";
  if (!p.keyless) {
    const keyUrl = plan?.keyUrl || p.keyUrl || "";
    // A terminal's stdin would show the key as it is typed, and wait for an end it never gets: piped in alone.
    if (flags["key-stdin"] === true && term.input.isTTY) throw new CliError(`--key-stdin reads a key piped in (… | filament keys add ${p.id} --key-stdin): at a terminal, leave it out and type the key: it shows as stars`, EXIT.usage);
    if (flags["key-stdin"] === true) apiKey = await readAll(term.input);
    else {
      if (!term.tty) throw new CliError(`a key is typed at a terminal, or piped in: … | filament keys add ${p.id} --key-stdin`, EXIT.needsPerson);
      if (keyUrl) out(`Get a key at ${keyUrl}`);
      apiKey = await askSecret(term, `Paste your ${p.name} key (it shows as stars):`);
    }
    if (!apiKey) throw new CliError("no key given: nothing was added", EXIT.usage);
  }
  let prefix = flagValue(flags, "prefix") || p.prefix;
  /** @type {any} */
  let made = null;
  for (let tries = 0; !made; tries++) {
    try {
      made = await client.post("/upstreams", { provider: p.id, ...(plan ? { plan: plan.id } : {}), ...(Object.keys(fields).length ? { fields } : {}), ...(apiKey ? { apiKey } : {}), prefix });
    } catch (/** @type {any} */ e) {
      const free = e?.body?.free;
      if (!free || tries > 0) throw e;
      if (!term.tty || !(await askYes(term, `"${prefix}" is taken. Add it as "${free}"?`))) throw new CliError(`"${prefix}" is taken: give --prefix ${free}, or another`, EXIT.usage);
      prefix = String(free);
    }
  }
  const id = String(made.upstream?.id || prefix);
  out(`Added ${p.name} as "${id}": its models are named ${id}/<model>.`);
  const works = flags["no-test"] === true ? null : await tryKey(ctx, id);
  return { id, works };
}

/**
 * Try a provider's key (GET /api/upstreams/:id/test), said in a line. → whether it answered.
 * @param {Ctx} ctx @param {string} id
 */
export async function tryKey({ client, out }, id) {
  /** @type {any} */
  const t = await client.get(`/upstreams/${encodeURIComponent(id)}/test`, { timeoutMs: 60_000 });
  if (t?.ok) {
    out(`✓ ${id} answers${t.ms != null ? ` in ${t.ms} ms` : ""}${Number.isFinite(t.models) ? `: ${t.models} model${t.models === 1 ? "" : "s"}` : ""}.`);
    return true;
  }
  const why = t?.error || `HTTP ${t?.status}${t?.sample ? `: ${String(t.sample).slice(0, 200)}` : ""}`;
  out(`✗ ${id} did not answer: ${why}`);
  return false;
}

// ---- a coding agent ----------------------------------------------------------------------------------------------------

/**
 * A coding agent's accounts (GET /api/agent-accounts rows) as Settings › Coding agents lists them: each sign-in Filament
 * keeps for it, its Default among them. One `off` is the person's choice — Filament does not use it, its sign-in kept.
 * @param {any} entry  its /api/coding-agents entry @param {any[]} rows
 */
export const accountsOf = (entry, rows) => {
  const ups = [entry?.primary, ...(entry?.upstreams || [])].filter(Boolean);
  return rows.filter((r) => ups.includes(r.upstream));
};

/** An account's name among its agent's others: its label (Default, Work…), else its id. @param {any} row */
export const accountLabel = (row) => String(row?.label || row?.upstream || "");

/** An account's name as a command line takes it: quoted where it has a space, so a line said can be run. @param {any} row */
export const accountWord = (row) => (/\s/.test(accountLabel(row)) ? `"${accountLabel(row)}"` : accountLabel(row));

/**
 * The accounts a word names (GET /api/agent-accounts): a coding agent's, by its catalogue id or name — every one, or the
 * one `account` names among them by its label or id —, else the one account whose id, name or label the word is. An
 * agent's id is read as the agent's before an account's: Claude Code's Default account is `claude-code` too (the
 * owner's of 11-05: `status` and `agents` took that one, turned off, for the agent, and said "not signed in" while
 * two accounts of theirs were).
 * `several`: the agent has more than one account, so a command for one names it (`--account`).
 * @param {import("./client.js").Client} client @param {string} word @param {string} [account]
 * @returns {Promise<{ name: string, rows: any[], several: boolean }>}
 */
export async function accountsNamed(client, word, account = "") {
  /** @type {any[]} */
  const rows = (await client.get("/agent-accounts")).agents || [];
  /** @type {any[]} */
  const entries = (await client.get("/coding-agents")).entries || [];
  const entry = entries.find((e) => named(word, e.id, e.name));
  if (entry) {
    const own = accountsOf(entry, rows);
    if (!own.length) throw new CliError(entry.state !== "connected" ? `${entry.name} is ${entry.state}: filament agents connect ${entry.id} first` : `${entry.name} has no account yet: filament agents sign-in ${entry.id}`, EXIT.usage);
    const several = own.length > 1;
    if (!account) return { name: String(entry.name), rows: own, several };
    const one = own.find((r) => named(account, r.upstream, r.label, r.name));
    if (!one) throw new CliError(`${entry.name} has no account "${account}" — its accounts: ${own.map(accountWord).join(", ")}`, EXIT.usage);
    return { name: String(entry.name), rows: [one], several };
  }
  const hits = rows.filter((r) => named(word, r.upstream, r.name, r.label));
  if (hits.length > 1) throw new CliError(`"${word}" names ${hits.length} accounts: ${hits.map((r) => r.upstream).join(", ")} — give one of those`, EXIT.usage);
  if (!hits.length) throw new CliError(`no coding agent "${word}" is connected — filament agents lists them`, EXIT.usage);
  return { name: String(hits[0].name), rows: hits, several: false };
}

/**
 * The one account a sign-in or a sign-out is for: the one the word names, else the agent's only one, else the one
 * chosen at the terminal; with no terminal to ask at, a usage error names them. A sign-in is for an account on: one
 * turned off runs nothing, and Filament signs none in (the person's choice, the owner's of 11-05) — a sign-out is
 * for any, its sign-in kept while off.
 * @param {import("./client.js").Client} client @param {string} word
 * @param {{ account?: string, term?: import("./ask.js").Term | null, signIn?: boolean }} [o]
 */
export async function accountOf(client, word, { account = "", term = null, signIn = false } = {}) {
  const { name, rows, several } = await accountsNamed(client, word, account);
  const pool = signIn ? rows.filter((r) => r.off !== true) : rows;
  if (!pool.length) throw new CliError(`${rows.length === 1 ? (several ? `${name} · ${accountLabel(rows[0])}` : rows[0].name) : `${name}'s accounts`} ${rows.length === 1 ? "is" : "are"} off: Filament does not use ${rows.length === 1 ? "it" : "them"} — Settings › Coding agents turns one on, then sign it in`, EXIT.needsPerson);
  if (pool.length === 1) return pool[0];
  if (term?.tty) return pool[await askChoice(term, `Which of ${name}'s accounts?`, pool.map((r) => `${accountLabel(r)}${signedInWords(r) ? ` — ${signedInWords(r)}` : r.off === true ? " — off" : ""}`))];
  throw new CliError(`${name} has ${pool.length} accounts${signIn ? " on" : ""}: name one with --account ${pool.map(accountWord).join(" | ")}`, EXIT.usage);
}

/**
 * A coding agent's accounts, as `status` and `agents` say them: who those on are signed in as — each by its label
 * where it has several —, and the others after (`apart`): off, or not signed in. A connected agent has one on at the
 * least (coding-agents.js `stateOf`); one with every account off is "off" itself.
 * @param {any} entry @param {any[]} rows
 */
export function signedInOf(entry, rows) {
  const own = accountsOf(entry, rows);
  const many = own.length > 1;
  const accounts = own.map((r) => ({ id: String(r.upstream), label: accountLabel(r), off: r.off === true, signedIn: signedInWords(r) }));
  const signedIn = accounts.filter((a) => !a.off && a.signedIn).map((a) => (many ? `${a.label} (${a.signedIn})` : a.signedIn)).join(", ");
  const apart = many ? accounts.filter((a) => a.off || !a.signedIn).map((a) => `${a.label} ${a.off ? "off" : "not signed in"}`) : [];
  return { accounts, signedIn, apart };
}

/**
 * Who a sign-in row says is signed in, in a few words, or "" where no one is: someone signed in as nobody said whom
 * (services/agent-accounts.js `signedIn`: a turn its agent served, a CLI that says only yes) is signed in too.
 * @param {any} row
 */
export function signedInWords(row) {
  const a = row?.account;
  if (!a || a.signedOut) return "";
  const id = a.identity;
  if (!id) return a.identitySource ? "whom it did not say" : "";
  if (id.kind === "none") return "";
  return [id.label || id.email || (id.kind === "api-key" ? "an API key" : id.kind), id.plan].filter(Boolean).join(" · ");
}

/**
 * The key a key's way signs in with (the review of 11-10: Codex's OpenAI API key, a key an ACP agent reads from a
 * variable): typed as stars, or piped in (`--key-stdin`) — never given on the command line.
 * @param {Ctx} ctx @param {any} way @param {string} id
 */
async function wayKey({ term, flags }, way, id) {
  const piped = `… | filament agents sign-in ${id} --way ${way.id} --key-stdin`;
  if (flags["key-stdin"] === true && term.input.isTTY) throw new CliError(`--key-stdin reads a key piped in (${piped}): at a terminal, leave it out and type the key: it shows as stars`, EXIT.usage);
  if (flags["key-stdin"] !== true && !term.tty) throw new CliError(`a key is typed at a terminal, or piped in: ${piped}`, EXIT.needsPerson);
  const key = flags["key-stdin"] === true ? await readAll(term.input) : await askSecret(term, `Paste your ${way.label || way.name} (it shows as stars):`);
  if (!key) throw new CliError("no key given: nothing was signed in", EXIT.usage);
  return key;
}

/**
 * Sign a coding agent in (POST /api/agent-accounts/:id/sign-in): a way chosen where it has several (`--way`, or at the
 * terminal); a browser's page opened, its code shown — or, where the agent opens its page itself, said so; a key's way's
 * key typed or piped in (`wayKey`); a terminal's line given to the person to run — Filament's own terminal is not theirs
 * here — and checked once they say it is done. Waits for the sign-in to end, up to 15 minutes: the end that came after
 * the sign-in began, both moments Filament's own (the re-read of 11-11: held against this machine's clock, another
 * machine's Filament a second behind never showed the end). → whether it signed in, or its key is kept.
 * @param {Ctx} ctx @param {string} word
 */
export async function signIn(ctx, word) {
  const { client, term, out, flags, signal } = ctx;
  const row = await accountOf(client, word, { account: flagValue(flags, "account"), term, signIn: true });
  const id = String(row.upstream);
  const path = `/agent-accounts/${encodeURIComponent(id)}`;
  /** @type {any} */
  let r = await client.post(`${path}/sign-in`, flagValue(flags, "way") ? { way: flagValue(flags, "way") } : {});
  if (r.choose) {
    // Where a page opened here would not come back — no screen here, or another machine's Filament —, a way that
    // finishes from a browser elsewhere (`far`, Codex's code) comes first, as the harness's sheet picks it there (the
    // swarm's review of 11-10: Codex's page way, first, came back to localhost on Filament's computer alone).
    const elsewhere = !screenHere() || !!client.remote;
    /** @type {any[]} */
    const ways = elsewhere ? [...r.choose.filter((/** @type {any} */ x) => x?.far), ...r.choose.filter((/** @type {any} */ x) => !x?.far)] : r.choose;
    // A key's way named by --way comes back to be given its key.
    let w = ways.find((x) => x.id === flagValue(flags, "way") && x.kind === "key");
    if (!w) {
      if (!term.tty) throw new CliError(`${row.name} signs in more than one way: give --way, one of ${ways.map((x) => x.id).join(", ")}`, EXIT.needsPerson);
      w = ways[await askChoice(term, `How should ${row.name} sign in?`, ways.map((x) => `${x.name}${x.description ? ` — ${x.description}` : ""}`))];
    }
    r = await client.post(`${path}/sign-in`, { way: w.id, ...(w.kind === "key" ? { key: await wayKey(ctx, w, id) } : {}) });
  }
  const s = r.signIn;
  if (s?.kind === "browser" && !s.url) {
    out(`Signing ${row.name} in with ${s.name}: it carries it out itself, and may open its sign-in page in a browser on Filament's computer.`);
  } else if (s?.kind === "browser") {
    out(`Signing ${row.name} in, in your browser${s.code ? ` — type this code there: ${s.code}` : ""}:\n  ${s.url}`);
    // Its address said just above: where it can't open here, nothing more to say.
    openPage(String(s.url), flags);
  } else if (s?.kind === "key") {
    out(`Signing ${row.name} in with ${s.name}…`);
  } else {
    // A terminal's sign-in: the person runs it in a terminal of their own, and Filament checks it after. One this call
    // started in Filament's own terminal is taken back — not one the person started in the harness before it
    // (`already`, Filament's own word), which is theirs to finish there.
    const line = String(s?.line || r.line || "");
    if (s?.kind === "terminal" && r.already === true) throw new CliError(`${row.name} is signing in in Filament's terminal already: finish it there (filament open), then filament agents check ${id}`, EXIT.needsPerson);
    if (s?.kind === "terminal") await client.post(`${path}/sign-in/cancel`, {}).catch(() => {});
    if (!term.tty) throw new CliError(`${row.name} signs in at a terminal: run \`${line}\`, then filament agents check ${id}`, EXIT.needsPerson);
    out(`${row.name} signs in at a terminal. In another terminal, run:\n  ${line}`);
    await askLine(term, "Press Enter once it says you are signed in:");
    const checked = await client.post(`${path}/check`, {});
    const who = signedInWords(checked.agent);
    out(who ? `✓ ${row.name} is signed in: ${who}.` : `✗ ${row.name} is not signed in yet: run \`${line}\` again, then filament agents check ${id}.`);
    return !!who;
  }
  out("Waiting for the sign-in to finish (Ctrl+C stops waiting; it goes on in the browser)…");
  for (const end = Date.now() + 15 * 60_000; Date.now() < end; ) {
    await pause(2000, signal);
    /** @type {any} */
    const now = ((await client.get("/agent-accounts")).agents || []).find((/** @type {any} */ x) => x.upstream === id);
    const last = now?.lastSignIn;
    if (now && !now.signingIn && last && Number(last.at) >= Number(s.at)) {
      if (last.outcome === "signed-in") out(`✓ ${row.name} is signed in${signedInWords(now) ? `: ${signedInWords(now)}` : ""}.`);
      // A key nothing could check: kept, and neither signed in nor refused until a turn tries it.
      else if (last.outcome === "key-kept") out(`Key kept; ${row.name}'s next turn tries it.`);
      else out(`✗ ${row.name}'s sign-in ${last.outcome === "cancelled" ? "was cancelled" : "failed"}${last.error ? `: ${last.error}` : ""}.`);
      return last.outcome === "signed-in" || last.outcome === "key-kept";
    }
  }
  throw new CliError(`${row.name}'s sign-in did not finish within 15 minutes`, EXIT.failed);
}
