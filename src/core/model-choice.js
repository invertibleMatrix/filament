// @ts-check
// A sub-agent's model as a person names it (HarnessV4_Tasks E23): "Kimi K3", "GPT Sol" from "Codex", or a name as
// Filament lists it — read against the models the picker offers (the catalogue folded into families), with the
// provider or coding agent named (E23-D1, D2), and the effort it runs at (E23-D5). Where it cannot run, why, in words a
// person acts on: a coding agent not connected, signed out or its plan used up, a provider switched off, no model like
// it, with the nearest there are (E23-D3). And the list a launcher reads of what can run now (E23-D4). Pure: the
// catalogue, the launch's own check, the coding agents and their accounts are handed in.
import { findRoute, findUpstream, listedParse, renderUpstreamModel, withEffort } from "./routing.js";
import { parseModelSuffix } from "./shaping.js";
import { buildFamilies, LEVEL_ORDER } from "./model-families.js";
import { EFFORT_LEVELS, isAgentUpstream } from "./schema.js";
import { agentKey, agentName, agentTitle } from "./catalogues.js";
import { prefixRouteOf, providerForBaseUrl } from "./providers.js";
import { editDistance } from "./text.js";
import { answeredAs } from "./answering-model.js";

/**
 * @typedef {import("./model-families.js").Family} Family
 * @typedef {{ signedOut: boolean, spent: boolean, freeAt: number | null }} AccountFacts  a coding agent's account as
 *   Filament last heard of it (services/agent-accounts.js `view`)
 * @typedef {{ id: string, name: string, state: "connected" | "off" | "ready" | "missing" }} AgentEntry  a coding agent
 *   as Settings › Coding agents lists it (app/coding-agents.js)
 * @typedef {object} Book  what a choice reads
 * @property {any} cfg  the configuration
 * @property {readonly Family[]} families  the picker's models in its order (`buildFamilies` over `/api/models`' rows)
 * @property {boolean} [reading]  the catalogue is not read yet: a name as a person says it waits for it
 * @property {(model: string) => string | null} problem  why a name cannot run a sub-agent now: the launch's own check
 * @property {(upstreamId: string) => AccountFacts | null} [account]
 * @property {() => readonly AgentEntry[]} [agents]  read only where the words need them
 * @property {number} [now]
 * @typedef {{ ok: true, model: string, upstream: string, note: string, rows?: string[] } | { ok: false, error: string, off?: true }} Choice
 *   `note`: who else serves it, or which of its providers could not run it — a sentence for the launch's answer, or "".
 *   A choice `within` a list: `rows`, its rows that serve the model chosen — those that can run in the list's order,
 *   then those that cannot now; `off`, a name that names none of its rows
 */

/** How long a list may be before it is said by provider: one screen. */
const LIST_MAX = 60;
/** The most models one provider lists in a list that is said by provider. */
const GROUP_MAX = 12;

/** A name as names are compared: lower case, letters and digits alone ("Kimi K3", "kimi-k3" and "kimi_k3" are one). @param {unknown} s */
const keyOf = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** A name less its provider's path: `openrouter/moonshotai/kimi-k3` → `kimi-k3`. @param {string} id */
const tailOf = (id) => id.slice(id.lastIndexOf("/") + 1);
/** A family's member that spells no variant: the model as it is. @param {Family} f */
const plainOf = (f) => f.members.find((m) => !m.effort && !m.speed && !m.thinking && !m.window) || f.members[0];
/** Two keys alike: the same, or one holding the other where it is long enough to mean something. @param {string} a @param {string} b */
const near = (a, b) => a === b || (b.length >= 3 && a.includes(b)) || (a.length >= 3 && b.includes(a));

/**
 * @typedef {object} Entry  a model of the book as a name is matched against it
 * @property {Family} fam
 * @property {string} id  what a launch runs: its plain member, else its first
 * @property {string} upstream
 * @property {string} tail  what names it at any provider: its name less the provider's path, as a key
 * @property {Map<string, string>} keys  each key it answers to, with the member a match on it runs
 * @property {string[]} words  its words, for the nearest names
 * @property {number} at  its place in the picker's order
 * @property {string} label  a coding agent's own words for its model ("Opus 5.5"), "" for a provider's
 */
/** @type {WeakMap<readonly Family[], { entries: Entry[], byMember: Map<string, Family> }>} */
const INDEX = new WeakMap();
/** The book's models as names are matched against them, made once per book. @param {readonly Family[]} families */
function indexOf(families) {
  let out = INDEX.get(families);
  if (out) return out;
  /** @type {Map<string, Family>} */
  const byMember = new Map();
  /** @type {Entry[]} */
  const entries = [];
  for (const f of families) {
    if (!f?.members?.length) continue;
    for (const m of f.members) if (!byMember.has(m.id.toLowerCase())) byMember.set(m.id.toLowerCase(), f);
    if (f.kind === "other") continue;
    const plain = plainOf(f);
    /** @type {Map<string, string>} */
    const keys = new Map();
    const add = (/** @type {unknown} */ k, /** @type {string} */ id) => {
      const key = keyOf(k);
      if (key && !keys.has(key)) keys.set(key, id);
    };
    add(tailOf(f.id), plain.id);
    add(f.id, plain.id);
    if (f.label) {
      add(f.label, plain.id);
      add(String(f.label).split(" · ")[0], plain.id);
    }
    for (const m of f.members) {
      add(tailOf(m.id), m.id);
      add(m.id, m.id);
    }
    const words = [...new Set(`${tailOf(f.id)} ${f.label || ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2))];
    entries.push({ fam: f, id: plain.id, upstream: f.upstream, tail: keyOf(tailOf(f.id)), keys, words, at: entries.length, label: f.codingAgent && f.label ? String(f.label) : "" });
  }
  out = { entries, byMember };
  INDEX.set(families, out);
  return out;
}

/** An upstream as configured, switched on or off. @param {any} cfg @param {string} id */
const upstreamOf = (cfg, id) => (cfg?.upstreams || []).find((/** @type {any} */ u) => u.id === id) || null;

/**
 * Who serves a model, in words: a coding agent by its own name ("Codex"), an account of it added beside its Default by
 * that account's too ("Claude Code · Work" — two accounts said alike could not be told apart, nor named to choose one:
 * the owner's of 11-06), a provider by its card's ("OpenRouter").
 * @param {any} cfg @param {string} id  the upstream
 */
export const providerWords = (cfg, id) => {
  const u = upstreamOf(cfg, id);
  return !u ? id : isAgentUpstream(u) ? agentTitle(u) : String(u.name || u.id);
};

/**
 * The upstreams a provider's name reaches (E23-D2): by its id, its card's name, its catalogue provider's name, id or
 * prefix, its prefix route, a coding agent's own name — "Codex", "Claude Code", "OpenRouter", "Moonshot", "zai" — with
 * the switched-off ones apart, for the words.
 * @param {any} cfg @param {string} said
 * @returns {{ on: string[], off: any[] }}
 */
function upstreamsNamed(cfg, said) {
  const want = keyOf(said);
  /** @type {string[]} */
  const on = [];
  /** @type {any[]} */
  const off = [];
  if (want.length < 2) return { on, off };
  // One named whole by its own id or name — an account of a coding agent, `claude-code-work` — is that one alone: the
  // agent's own name, which each of its accounts holds ("Claude Code", `claude-code`), names them all. Else a provider
  // named `claude-code-workcredits` reached every account of Claude Code, the first in the picker's order run (the
  // owner's of 11-06: a reviewer sent to the account the chat does not run on).
  /** @param {any} u */
  const ownKeys = (u) => [u.id, u.name].map(keyOf).filter((k) => k.length >= 2 && !(isAgentUpstream(u) && (k === keyOf(agentKey(u)) || k === keyOf(agentName(u)))));
  const whole = new Set((cfg?.upstreams || []).filter((/** @type {any} */ u) => ownKeys(u).includes(want)).map((/** @type {any} */ u) => u.id));
  for (const u of cfg?.upstreams || []) {
    if (whole.size && !whole.has(u.id)) continue;
    const cat = providerForBaseUrl(u.baseUrl)?.provider;
    const prefix = String(prefixRouteOf(cfg, u.id)?.match || "").replace(/\/\*$/, "");
    const keys = [u.id, u.name, cat?.name, cat?.id, cat?.prefix, prefix, ...(isAgentUpstream(u) ? [agentName(u), agentKey(u)] : [])].map(keyOf).filter((k) => k.length >= 2);
    if (!keys.some((k) => near(k, want))) continue;
    if (u.enabled === false) off.push(u);
    else on.push(String(u.id));
  }
  return { on, off };
}

/** The coding agents a provider's name reaches, as Settings › Coding agents lists them. @param {Book} book @param {string} said */
const agentsNamed = (book, said) => {
  const want = keyOf(said);
  return want.length < 2 ? [] : (book.agents?.() || []).filter((a) => [a.id, a.name].map(keyOf).some((k) => k.length >= 2 && near(k, want)));
};

/** Why a coding agent's models are not in the list, and what to do (E23-D3). @param {AgentEntry} a */
const agentStateWords = (a) =>
  a.state === "off"
    ? `${a.name} is turned off: turn it on in Settings › Coding agents`
    : a.state === "ready"
      ? `${a.name} isn't connected. It is installed here: Connect it in Settings › Coding agents`
      : a.state === "missing"
        ? `${a.name} isn't on this computer: install it from Settings › Coding agents, then Connect it`
        : `${a.name} lists no models yet: ask for its models again with ↻ on its card in Settings › Coding agents`;

/**
 * Why a provider's name reaches nothing that can serve, in words: the coding agent it names and where it stands, the
 * providers it names that are switched off, or the providers there are.
 * @param {string} said @param {any[]} off @param {Book} book
 */
function noProvider(said, off, book) {
  const cfg = book.cfg;
  const agent = agentsNamed(book, said)[0];
  if (agent) return agentStateWords(agent);
  if (off.length)
    return `${off.map((u) => (isAgentUpstream(u) ? agentTitle(u) : String(u.name || u.id))).join(", ")} ${off.length === 1 ? "is" : "are"} switched off: switch ${off.length === 1 ? "it" : "one"} on in Settings › Providers`;
  const yours = [...new Set((cfg?.upstreams || []).filter((/** @type {any} */ u) => u.enabled !== false).map((/** @type {any} */ u) => providerWords(cfg, u.id)))];
  return `no provider or coding agent is called "${said}"${yours.length ? `. Yours: ${yours.join(", ")}` : ""}`;
}

/**
 * Why a provider named lists no model, in words: a coding agent says where it stands, a provider that its list is
 * empty.
 * @param {string} said @param {{ on: string[] }} named @param {Book} book
 */
function listsNothing(said, named, book) {
  const agent = agentsNamed(book, said)[0];
  if (agent) return agentStateWords(agent);
  const who = named.on.map((u) => providerWords(book.cfg, u));
  return `${who.join(", ")} ${who.length === 1 ? "lists" : "list"} no models yet: press Refresh list on ${who.length === 1 ? "its page" : "their pages"} in Settings › Providers`;
}

/** How long until, in words: "in 25 min", "in 3 h 10 min", "in 2 days". @param {number} ms */
const inWords = (ms) => {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h < 48 ? `in ${h} h${m ? ` ${m} min` : ""}` : `in ${Math.round(h / 24)} days`;
};

/**
 * Why a coding agent's model cannot run now for its accounts, or null (E23-D3): every account its route tries is
 * signed out, or its plan is used up — each said, in the route's order, a used-up plan with when it is free again. An
 * account Filament has heard nothing of may serve.
 * @param {any} cfg @param {string} id @param {Book} book
 */
function accountProblem(cfg, id, book) {
  if (!book.account) return null;
  const route = findRoute(cfg, parseModelSuffix(id, cfg?.rules).base) || findRoute(cfg, id);
  if (!route) return null;
  const backups = cfg?.rules?.resilience?.failover === true && Array.isArray(route.fallbacks) ? route.fallbacks : [];
  const ids = [...new Set([route.upstream, ...backups.map((/** @type {any} */ f) => (typeof f === "string" ? f : f?.upstream))].filter(Boolean).map(String))];
  const facts = ids.map((u) => findUpstream(cfg, u)).filter((u) => isAgentUpstream(u)).map((u) => ({ u, f: book.account?.(String(u.id)) || null }));
  if (!facts.length || facts.some(({ f }) => !f || (!f.signedOut && !f.spent))) return null;
  const now = book.now ?? Date.now();
  return facts
    .map(({ u, f }) =>
      f?.signedOut
        ? `${agentTitle(u)} is signed out: sign in on its account widget, or in Settings › Coding agents`
        : `${agentTitle(u)}'s plan is used up${f?.freeAt ? `: it is free again ${inWords(f.freeAt - now)}` : ""}`,
    )
    .join("; ");
}

/** Why a name cannot run a sub-agent now, or null: the launch's own check, then its coding agent's accounts. @param {Book} book @param {string} id */
const whyNot = (book, id) => book.problem(id) || accountProblem(book.cfg, id, book);

/** Models as words name them: each with who serves it, at most `n`, and how many more. @param {any} cfg @param {{ id: string, upstream: string }[]} list @param {number} [n] */
const namesWords = (cfg, list, n = 6) => `${list.slice(0, n).map((x) => `${x.id} (${providerWords(cfg, x.upstream)})`).join(", ")}${list.length > n ? `, and ${list.length - n} more` : ""}`;

/**
 * Whether a word of a name reaches a word of a model's: the start of it, or it the start of the name's word — or, for
 * a word of four letters or more, one off by a letter or two, as a misspelling is ("kimmy" for kimi, "sonet" for
 * sonnet). Only ever a suggestion: a launch is never matched so.
 * @param {string} w  the name's @param {string} x  the model's
 */
const wordNear = (w, x) => x.startsWith(w) || (x.length >= 3 && w.startsWith(x)) || (w.length >= 4 && x.length >= 3 && editDistance(w, x) <= (w.length >= 5 ? 2 : 1));

/**
 * The models nearest a name nothing matched: those sharing a word with it, or nearly, the most first, in the picker's
 * order.
 * @param {string} raw @param {Entry[]} entries @param {number} [n]
 */
function nearest(raw, entries, n = 6) {
  const words = raw.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  return entries
    .map((e) => ({ e, score: words.filter((w) => e.words.some((x) => wordNear(w, x))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.at - b.e.at)
    .slice(0, n)
    .map((x) => x.e);
}

/**
 * Whether a name reads as a coding agent's model in the agent's own words (TinyQuest's of 11-18: `claude-opus-5-5`
 * named where the chat's Claude Code lists the model as `opus`, "Opus 5.5", which no key of it holds): its words carry
 * a version, the name holds each of them that is no number, and the two read as one model (core/answering-model.js
 * `answeredAs`) — never a bare number ("5.5"), another version ("Opus 5") or a word that names no version.
 * @param {string} raw @param {Entry} e
 */
function readsAs(raw, e) {
  if (!/\d/.test(e.label)) return false;
  const said = new Set(raw.toLowerCase().split(/[^a-z0-9]+/));
  const words = e.label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^\d+$/.test(w));
  return words.length > 0 && words.every((w) => said.has(w)) && answeredAs(raw, e.label) === "same";
}

/**
 * The models a name matches: those it names whole — a name, a member's id, a coding agent's label, spaces, marks and
 * case aside, or a coding agent's model it reads as (`readsAs`) — else, unless `whole`, those it names a part of; in
 * the picker's order. `same`: which model each is, for telling one model several serve from several models — a match
 * on its words is the model the whole matches are, where they are one.
 * @param {string} raw @param {Entry[]} entries @param {boolean} [whole]
 * @returns {{ e: Entry, member: string, same: string }[]}
 */
function hitsOf(raw, entries, whole = false) {
  const q = keyOf(raw);
  if (q.length < 2) return [];
  const exact = entries.flatMap((e) => (e.keys.has(q) ? [{ e, member: /** @type {string} */ (e.keys.get(q)), same: e.tail }] : []));
  const ones = new Set(exact.map((h) => h.same));
  const as = ones.size === 1 ? [...ones][0] : q;
  const read = entries.flatMap((e) => (!e.keys.has(q) && readsAs(raw, e) ? [{ e, member: e.id, same: as }] : []));
  if (exact.length || read.length || whole) return [...exact, ...read].sort((a, b) => a.e.at - b.e.at);
  return entries.flatMap((e) => {
    for (const [k, member] of e.keys) if (k.includes(q)) return [{ e, member, same: e.tail }];
    return [];
  });
}

/**
 * The upstream a name the picker does not offer runs at as named, or null: a route takes it — never a catch-all, which
 * takes any word — and the name is spelled as Filament names models, with its path ("openrouter/vendor/model"), or is
 * one the person hid from the pickers at that upstream. A bare word nothing lists is matched, never sent.
 * @param {any} cfg @param {string} raw
 */
function routedAsNamed(cfg, raw) {
  if (/\s/.test(raw)) return null;
  const base = parseModelSuffix(raw, cfg?.rules).base;
  const route = findRoute(cfg, base) || findRoute(cfg, raw);
  if (!route || String(route.match) === "*") return null;
  if (raw.includes("/")) return String(route.upstream);
  const sent = renderUpstreamModel(route.upstreamModel, base, route.captures || []).toLowerCase();
  const hidden = (upstreamOf(cfg, route.upstream)?.hiddenModels || []).map((/** @type {unknown} */ x) => String(x).toLowerCase());
  return hidden.includes(sent) ? String(route.upstream) : null;
}

/**
 * The model a launch that names one runs on (E23-D1 to D3).
 * - A name as a person says it ("Kimi K3", "gpt sol") or as Filament lists it is matched against the picker's models
 *   on each one's name, its members' and its coding agent's label: a whole match before a part of one. Two models
 *   that match alike are refused, both named: it never guesses between models.
 * - A name nothing matches: one with a path ("openrouter/kimi-k3") reads its first word as the provider, where the
 *   rest names a model there whole; else a name a route takes runs as named (`routedAsNamed`).
 * - `provider` keeps the providers and coding agents it names. One model several serve runs on the first in the
 *   picker's order that can run now — `prefer`'s first, the account the chat's agent runs on (the owner's of 11-06) —;
 *   the note names the others.
 * - Where none can run, the refusal says why for each: the launch's own check, a coding agent's accounts.
 * - `within`: the rows of a list the person set, by name in its order (the owner's of 11-19: "when i explicitly already
 *   setup an order along with account and effort then why the id was even needed and passed"). The name is matched
 *   against the models its rows hold alone, each run as its row names it, in the list's order before the picker's; the
 *   rows that serve the model chosen and can run are `rows`. A name none of them matches is refused `off`, for the
 *   launch to say the list in its own words.
 * @param {string} name @param {string | null | undefined} provider @param {Book} book
 * @param {{ whole?: boolean, prefer?: string | null, within?: readonly string[] | null }} [o]  `whole`: whole matches only
 *   (a path read as the provider)
 * @returns {Choice}
 */
export function chooseModel(name, provider, book, { whole = false, prefer = null, within = null } = {}) {
  const cfg = book.cfg;
  const raw = String(name ?? "").trim();
  const said = String(provider ?? "").trim();
  if (!raw && !said) return { ok: false, error: "name the model it runs on" };
  const named = said ? upstreamsNamed(cfg, said) : null;
  if (named && !named.on.length) return { ok: false, error: noProvider(said, named.off, book) };
  if (within) return chooseWithin(raw, said, named, book, within);
  const { entries } = indexOf(book.families);
  // A provider alone: its models, to name one — never a guess at which.
  if (!raw && named) {
    if (book.reading) return { ok: false, error: "Filament is still reading your list of models: try again in a moment, or name the model as Filament lists it" };
    const there = entries.filter((e) => named.on.includes(e.upstream));
    return { ok: false, error: there.length ? `name the model too: ${said} has ${namesWords(cfg, there, 8)}` : listsNothing(said, named, book) };
  }
  const all = hitsOf(raw, entries, whole);
  if (!all.length) {
    if (whole) return { ok: false, error: `no model "${raw}" at ${said}` };
    // "openrouter/kimi-k3", which names no model: its first word read as the provider, where the rest names one there.
    const slash = raw.indexOf("/");
    if (!said && slash > 0 && upstreamsNamed(cfg, raw.slice(0, slash)).on.length) {
      const viaPath = chooseModel(raw.slice(slash + 1), raw.slice(0, slash), book, { whole: true });
      if (viaPath.ok) return viaPath;
    }
    const at = routedAsNamed(cfg, raw);
    if (at && (!named || named.on.includes(at))) {
      const why = whyNot(book, raw);
      return why ? { ok: false, error: `${raw} can't run now: ${why}` } : { ok: true, model: raw, upstream: at, note: "" };
    }
    if (book.reading) return { ok: false, error: "Filament is still reading your list of models: try again in a moment, or name the model as Filament lists it" };
    const pool = named ? entries.filter((e) => named.on.includes(e.upstream)) : entries;
    if (named && !pool.length) return { ok: false, error: listsNothing(said, named, book) };
    const close = nearest(raw, pool);
    const agents = named ? [] : (book.agents?.() || []).filter((a) => a.state === "off" || a.state === "ready");
    const where = named ? ` at ${said}` : "";
    const has = named && !close.length && pool.length ? ` It has ${namesWords(cfg, pool, 8)}.` : "";
    const nearWords = close.length ? ` The nearest: ${namesWords(cfg, close)}.` : "";
    const notIn = agents.length ? ` Coding agents whose models aren't in it: ${agents.map((a) => agentStateWords(a)).join("; ")}.` : "";
    return { ok: false, error: `no model like "${raw}"${where} in your list of models.${has}${nearWords}${notIn} To see them all, call with list_models.` };
  }
  const kept = named ? all.filter((h) => named.on.includes(h.e.upstream)) : all;
  if (!kept.length) return { ok: false, error: `"${raw}" isn't at ${said}: ${namesWords(cfg, all.map((h) => ({ id: h.member, upstream: h.e.upstream })))} ${all.length === 1 ? "serves" : "serve"} it` };
  if (new Set(kept.map((h) => h.same)).size > 1)
    return { ok: false, error: `"${raw}" matches ${kept.length} models: ${namesWords(cfg, kept.map((h) => ({ id: h.member, upstream: h.e.upstream })), 8)}. Name one${named ? "" : ", or its provider"}.` };
  // One model: the first of its providers that can run it now, the chat's own account before the others.
  const order = prefer ? [...kept.filter((h) => h.e.upstream === prefer), ...kept.filter((h) => h.e.upstream !== prefer)] : kept;
  const tried = order.map((h) => ({ h, why: /** @type {string | null} */ (null) }));
  const pick = tried.find((t) => !(t.why = whyNot(book, t.h.member)));
  if (!pick) {
    if (tried.length === 1) return { ok: false, error: `${tried[0].h.member} can't run now: ${tried[0].why}` };
    return { ok: false, error: `"${raw}" can't run now at any of its ${tried.length} providers: ${tried.map((t) => `${providerWords(cfg, t.h.e.upstream)}'s ${t.h.member}: ${t.why}`).join("; ")}` };
  }
  const passed = tried.slice(0, tried.indexOf(pick));
  const rest = tried.slice(tried.indexOf(pick) + 1).map((t) => providerWords(cfg, t.h.e.upstream));
  const note = [
    ...passed.map((t) => `${providerWords(cfg, t.h.e.upstream)}'s ${t.h.member} can't run now (${t.why}).`),
    ...(rest.length ? [`${rest.join(", ")} ${rest.length === 1 ? "serves" : "serve"} it too: name its provider to choose.`] : []),
  ].join(" ");
  return { ok: true, model: pick.h.member, upstream: pick.h.e.upstream, note };
}

/**
 * A choice among a list's rows (`chooseModel`'s `within`): a row named as it is written — or as its model's name less
 * Filament's `agent/` and its effort suffix — is that row; else the name is matched as `hitsOf` matches: the models it
 * names whole across the picker, of which the rows must hold one (a whole match elsewhere is no part match of a row's:
 * the review of 11-19's `kimi-k3` against a `kimi-k3-turbo` row), else a part of a row's. It must name one model; a
 * provider named keeps its own rows, and alone names them all. The rows that serve it: those that can run, in the list's
 * order, then those that cannot now, kept for the launch's fallback; the ones passed before the first are said, as
 * `chooseModel` says them.
 * @param {string} raw @param {string} said @param {{ on: string[] } | null} named @param {Book} book
 * @param {readonly string[]} within
 * @returns {Choice}
 */
function chooseWithin(raw, said, named, book, within) {
  const cfg = book.cfg;
  const rows = [...new Set(within.map((m) => String(m || "").trim()).filter(Boolean))];
  /** A name as a row and a member are compared: less Filament's `agent/` and its effort suffix. @param {string} m */
  const baseOf = (m) => parseModelSuffix(m.replace(/^agent\//i, ""), cfg?.rules).base.toLowerCase();
  const lower = rows.map((m) => m.toLowerCase());
  const bases = rows.map(baseOf);
  const { entries } = indexOf(book.families);
  /** The rows that hold each model of the picker's, in the list's order. @type {Map<Entry, string[]>} */
  const held = new Map();
  for (const e of entries) {
    const ids = new Set(e.fam.members.flatMap((m) => [m.id.toLowerCase(), baseOf(m.id)]));
    const its = rows.filter((_, i) => ids.has(lower[i]) || ids.has(bases[i]));
    if (its.length) held.set(e, its);
  }
  const at = (/** @type {string} */ m) => lower.indexOf(m.toLowerCase());
  const upOf = (/** @type {string} */ m) => [...held].find(([, its]) => its.includes(m))?.[0].upstream || String(findRoute(cfg, m)?.upstream || "");
  const atNamed = (/** @type {string} */ m) => !named || named.on.includes(upOf(m));
  const asWritten = raw ? rows.filter((m, i) => lower[i] === raw.toLowerCase() || bases[i] === baseOf(raw)) : [];
  /** The rows the name reaches, in the list's order, at any provider. @type {string[]} */
  let reached;
  if (asWritten.length) reached = asWritten;
  else if (!raw) reached = rows;
  else {
    if (book.reading) return { ok: false, error: "Filament is still reading your list of models: try again in a moment, or name the model as the list writes it" };
    const whole = hitsOf(raw, entries, true);
    const all = whole.length ? whole.filter((h) => held.has(h.e)) : hitsOf(raw, [...held.keys()]);
    if (!all.length) return { ok: false, error: `"${raw}" is none of the list's models`, off: true };
    const hits = all.filter((h) => !named || named.on.includes(h.e.upstream));
    if (new Set(hits.map((h) => h.same)).size > 1) return { ok: false, error: `"${raw}" matches ${hits.length} models of the list: ${namesWords(cfg, hits.map((h) => ({ id: h.member, upstream: h.e.upstream })), 8)}. Name one${named ? "" : ", or its provider"}.` };
    reached = [...new Set((hits.length ? hits : all).flatMap((h) => held.get(h.e) || []))].sort((a, b) => at(a) - at(b));
  }
  const picks = reached.filter(atNamed);
  if (!picks.length)
    return raw
      ? { ok: false, error: `"${raw}" isn't at ${said} on the list: ${namesWords(cfg, reached.map((m) => ({ id: m, upstream: upOf(m) })))} ${reached.length === 1 ? "serves" : "serve"} it` }
      : { ok: false, error: `${said} serves none of the list's models`, off: true };
  const tried = picks.map((m) => ({ m, why: whyNot(book, m) }));
  const can = tried.filter((t) => !t.why);
  if (!can.length) {
    if (tried.length === 1) return { ok: false, error: `${tried[0].m} can't run now: ${tried[0].why}` };
    return { ok: false, error: `"${raw || said}" can't run now on any of its ${tried.length} rows: ${tried.map((t) => `${t.m}: ${t.why}`).join("; ")}` };
  }
  const passed = tried.slice(0, tried.indexOf(can[0]));
  const note = passed.map((t) => `${providerWords(cfg, upOf(t.m))}'s ${t.m} can't run now (${t.why}).`).join(" ");
  return { ok: true, model: can[0].m, upstream: upOf(can[0].m), note, rows: [...can, ...tried.filter((t) => t.why)].map((t) => t.m) };
}

/**
 * The family a name runs as: the picker's, else one read for that name alone (a model hidden from the picker).
 * @param {string} name @param {readonly Family[]} families @param {any} cfg
 * @returns {Family | null}
 */
function familyOf(name, families, cfg) {
  const f = indexOf(families).byMember.get(name.toLowerCase());
  if (f) return f;
  const route = findRoute(cfg, parseModelSuffix(name, cfg?.rules).base) || findRoute(cfg, name);
  return route ? buildFamilies(cfg, [{ id: name, upstream: route.upstream }])[0] || null : null;
}

/**
 * The effort a sub-agent's model runs at, and the name its requests carry for it (E23-D5): the highest level the
 * model takes at or below the one asked — the levels the composer's picker offers for it — else its lowest; on the
 * name's ending, as a session's own effort goes (`withEffort`), or as its member that spells the level where its ids
 * spell their efforts (Cursor's `grok-4.7-high`). None where it takes no level, or none is asked. A name that spells
 * its own effort — a member's id at a level, or Filament's suffix on its name — keeps it unless the launch asked for one
 * (`asked`): `spelled` says so.
 * @param {string} model  the name it runs on @param {string | null} wanted  one of EFFORT_LEVELS, or null
 * @param {{ cfg: any, families: readonly Family[] }} book
 * @param {{ asked?: boolean }} [o]
 * @returns {{ level: string | null, wire: string, levels: string[] | null, spelled: boolean }}  `wire`: the name its
 *   requests carry; `levels`: the levels the model takes, null where it takes none
 */
export function effortOf(model, wanted, { cfg, families }, { asked = true } = {}) {
  const name = String(model || "");
  const fam = familyOf(name, families, cfg);
  const levels = fam?.effort ? fam.effort.levels.filter((l) => l !== "none") : [];
  const want = String(wanted || "").toLowerCase();
  const own = fam?.members.find((m) => m.id.toLowerCase() === name.toLowerCase()) || null;
  if (!fam?.effort || !levels.length) return { level: null, wire: name, levels: null, spelled: false };
  if (!asked) {
    // A name that spells its level: its member's word, or Filament's own suffix — read as the parse stage reads it, so a
    // provider's own `qwen3-max` is a name, not a level.
    const spelled = own?.effort || (fam.effort.via === "setting" ? (listedParse(cfg, name) || parseModelSuffix(name, cfg?.rules)).suffixEffort : null);
    if (spelled) return { level: spelled, wire: name, levels, spelled: true };
  }
  if (!EFFORT_LEVELS.includes(want)) return { level: null, wire: name, levels, spelled: false };
  const rank = (/** @type {string} */ l) => LEVEL_ORDER.indexOf(l);
  const level = [...levels].reverse().find((l) => rank(l) <= rank(want)) || levels[0];
  if (fam.effort.via === "setting") return { level, wire: withEffort(name, level, cfg), levels, spelled: false };
  // Its ids spell their efforts: the member at that level, alike on every other word.
  const at = own || plainOf(fam);
  const same = fam.members.filter((m) => m.effort === level);
  const pick = same.find((m) => m.speed === at.speed && m.thinking === at.thinking && m.window === at.window) || same.find((m) => !m.speed && !m.window) || same[0];
  return pick ? { level, wire: pick.id, levels, spelled: false } : { level: null, wire: name, levels, spelled: false };
}

/**
 * A chat's model and effort as it is made (a Space's runs, the owner's of 11-04): the level asked, made the nearest the
 * model takes as `effortOf` makes it, kept as a chat keeps one — beside its name in `model.effort`, where the model
 * takes an effort as a setting; in its name, as its member at that level, where its ids spell their efforts. No effort
 * where it takes none, or none was asked. One it inherits, not asked (`asked` false: a team's lead at the main agent's
 * effort, the owner's word of 11-05), keeps a level its name spells.
 * @param {string} model @param {string | null} wanted @param {{ cfg: any, families: readonly Family[] }} book
 * @param {{ asked?: boolean }} [o]
 * @returns {{ name: string, effort: string | null }}
 */
export function chatEffortOf(model, wanted, book, { asked = true } = {}) {
  const name = String(model || "");
  const e = effortOf(name, wanted, book, { asked });
  if (!e.level) return { name, effort: null };
  return familyOf(name, book.families, book.cfg)?.effort?.via === "setting" ? { name, effort: e.level } : { name: e.wire, effort: null };
}

/** A model's levels in words: "low to max", "high". @param {string[]} levels */
const levelsWords = (levels) => (levels.length === 1 ? levels[0] : `${levels[0]} to ${levels[levels.length - 1]}`);
/** A price per million tokens. @param {number} n */
const usd = (n) => `$${Number(n).toFixed(2)}`;

/**
 * What a launcher reads of the models a sub-agent can run on (E23-D4): by provider and coding agent, in the picker's
 * order, each model with whether it can run now and why not, the efforts it takes, its price or "your plan", and its
 * seats in the session's lists; then the coding agents whose models are not there and why. `model` and `provider`
 * narrow it. A list longer than a screen lists each provider's models only where they are few, and says how to narrow
 * the others.
 * @param {{ model?: string | null, provider?: string | null }} ask @param {Book} book
 * @param {{ seats?: (model: string) => string }} [o]  `seats`: a model's seats in the session's lists, in words, "" for none
 * @returns {string}
 */
export function modelList(ask, book, { seats = () => "" } = {}) {
  const cfg = book.cfg;
  const word = String(ask?.model ?? "").trim();
  const said = String(ask?.provider ?? "").trim();
  if (book.reading) return "Filament is still reading your list of models: ask again in a moment.";
  const named = said ? upstreamsNamed(cfg, said) : null;
  if (named && !named.on.length) return `Nothing to list: ${noProvider(said, named.off, book)}.`;
  const { entries } = indexOf(book.families);
  const q = keyOf(word);
  const shown = entries.filter((e) => (!named || named.on.includes(e.upstream)) && (!q || [...e.keys.keys()].some((k) => k.includes(q)) || readsAs(word, e)));
  /** @type {Map<string, Entry[]>} */
  const groups = new Map();
  for (const e of shown) {
    const g = groups.get(e.upstream);
    if (g) g.push(e);
    else groups.set(e.upstream, [e]);
  }
  const whole = shown.length <= LIST_MAX;
  /** @param {Entry} e */
  const line = (e) => {
    const f = e.fam;
    const why = whyNot(book, e.id);
    const levels = f.effort ? f.effort.levels.filter((l) => l !== "none") : [];
    return [
      `${e.id}${f.label && keyOf(f.label) !== e.tail ? ` "${f.label}"` : ""}`,
      why ? `can't run now: ${why}` : "can run",
      levels.length ? `effort ${levelsWords(levels)}` : "no effort setting",
      f.codingAgent || f.billing === "plan" ? "your plan" : f.price ? `${usd(f.price.input)} in, ${usd(f.price.output)} out per million tokens` : "",
      seats(e.id),
    ]
      .filter(Boolean)
      .join(" · ");
  };
  /** @type {string[]} */
  const lines = [];
  for (const [up, list] of groups) {
    const head = `${providerWords(cfg, up)}${isAgentUpstream(upstreamOf(cfg, up)) ? " (coding agent)" : ""}, ${list.length} model${list.length === 1 ? "" : "s"}`;
    if (!whole && list.length > GROUP_MAX) {
      lines.push(`${head}: too many to list here — call again with ${named ? "" : `provider "${providerWords(cfg, up)}" and `}a word of the model's name in model`);
      continue;
    }
    lines.push(`${head}:`, ...list.map((e) => `- ${line(e)}`));
  }
  if (!lines.length) {
    const close = nearest(word, named ? entries.filter((e) => named.on.includes(e.upstream)) : entries);
    return `No model like "${word}"${said ? ` at ${said}` : ""} in your list of models.${close.length ? ` The nearest: ${namesWords(cfg, close)}.` : ""}`;
  }
  // The coding agents whose models are not in it, and why — those turned off or not connected; one not on this computer
  // is no model of the person's.
  const wanted = keyOf(said);
  const away = word ? [] : (book.agents?.() || []).filter((a) => (a.state === "off" || a.state === "ready") && (!said || [a.id, a.name].map(keyOf).some((k) => k.length >= 2 && near(k, wanted))));
  return [
    // Never an ask to name one (the owner's of 11-19: an agent named the first here, and its launch left the list the
    // person set): leaving the model out runs on that list.
    "Models a sub-agent can run on, by who serves them, in your list's order. Leave model out to run on the chat's list (those marked on the chat's list), unless the person asks for a model: then name it as listed, or as you'd say it, with provider where two serve it. Where the person set that list, only its rows can be named.",
    "",
    ...lines,
    ...(away.length ? ["", `Not in the list: ${away.map((a) => agentStateWords(a)).join("; ")}.`] : []),
  ].join("\n");
}
