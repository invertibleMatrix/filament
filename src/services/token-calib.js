// @ts-check
// Self-calibration of the token estimator, per upstream+model. Every real reply states what the provider actually
// tokenized (input + cache read + cache write, in the usage the wire readers normalize), so the ratio
// actual÷estimate is learned as an EWMA and handed back as estimateBodyTokens' `factor`. Nothing is ever sent
// anywhere to learn this — it is read off receipts Filament already keeps, which is the only way an exact-ish count
// exists without contacting a provider. Upstreams that never state usage never grow a ratio and stay on the
// class-weighted heuristic.
//
// A coding agent's upstream is never calibrated (`uncalibrated`, which the server answers from the configuration).
// What an agent states is its own context's count — every model call of the turn added up, after whatever it
// compacted by itself — never the tokens of the body Filament estimated: their ratio is no vocabulary density (the
// same Opus read ×1.82 on one account and ×0.63 on another, 2026-10-10). Nothing is learned from such an upstream's
// counts, and a factor on file from before is not kept.
//
// What an agent's turn does state is which model counted it (Claude Code and Gemini CLI name each, with its tokens):
// the API name of the model the agent calls by a name of its own ("opus" is claude-opus-5-5). The store keeps that
// name per upstream+model (`observeCountedModel`), and an agent's model is served the factor the named model showed
// on an upstream that is calibrated: the same vocabulary, measured where a ratio means something (HarnessV4_Tasks
// C19). An agent's model nobody named, or whose named model no upstream has learned, stays on the heuristic.
//
// A coding agent's own share of its context (HarnessV4_Tasks C33) is learned here too: each session new to it says
// what its first request held — its own prompt and tools, and what Filament sent, which Filament knows only by its
// estimate. One start cannot tell the two apart: on a big seed the estimate's error is booked as the agent's (the
// owner's look of 10-24, "plus its own ≈78.6K" from a 114K seed). So the starts are kept, by agent
// and folder across chats, and the share is the line through them: the estimate's scale apart from the agent's own
// part (`ownFit`). A new chat's first turn sends little, and pins the own part nearly exactly.
//
// Inert until initTokenCalib names a file (the server does; tests that want it call init with a temp path) — so
// nothing observes or applies anything as a side effect of importing.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { mainCounted } from "../core/answering-model.js";

const MIN_SAMPLES = 3; // two replies' worth of noise never steers the estimator
const ALPHA = 0.25; // EWMA weight of a new observation
const PLAUSIBLE = [0.34, 3]; // raw ratios outside this are mismatches, not density — discarded whole
const CLAMP_FACTOR = [0.5, 3]; // a served factor never leaves this band
const MIN_TOKENS = 40; // bodies smaller than this carry more noise than signal
const MAX_KEYS = 96; // the file stays bounded; the stalest entry drops when over
const SAVE_DEBOUNCE_MS = 5000;
const STARTS_KEPT = 12; // a coding agent's newest fresh sessions kept per agent and folder
const FIT_SCALE = [0.5, 3]; // an estimate's scale a fit may find; outside it the starts disagree, and the least-sent one is taken

/** @type {string | null} */ let file = null;
/** @type {((level: string, msg: string) => void) | null} */ let logFn = null;
/** @type {((upstreamId: string) => boolean) | null} */ let uncalibrated = null;
/** @type {Record<string, { f: number, n: number, at: number }>} */ let data = {};
/**
 * The model a coding agent's turns were counted under, by the agent's upstream+model: `as`, the name in force, and
 * `next`, another the newest turn named (it takes over when a second turn running names it).
 * @type {Record<string, { as: string, next: string | null, at: number }>}
 */
let names = {};
/**
 * A coding agent's fresh sessions, by its upstream and folder (`startsKey`): each one's first count (`first`, the
 * agent's) and what Filament sent in it (`sent`, Filament's estimate), newest last.
 * @type {Record<string, { starts: { first: number, sent: number, at: number }[], at: number }>}
 */
let starts = {};
/** @type {Record<string, number>} */ let served = {}; // the factor last announced per key, for move logging
let loaded = false,
  /** @type {any} */ timer = null;

/**
 * Wire up persistence; call with no file to run in memory only (the default until the server says otherwise).
 * `uncalibrated` says whether an upstream is never calibrated — a coding agent's — by its id, in any letter case.
 * @param {{ file?: string | null, log?: (level: string, msg: string) => void, uncalibrated?: (upstreamId: string) => boolean }} [o]
 */
export function initTokenCalib(o = {}) {
  file = o.file || null;
  logFn = o.log || null;
  uncalibrated = o.uncalibrated || null;
  loaded = false;
  served = {};
}

function load() {
  if (loaded) return;
  loaded = true;
  if (!file) return;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (j && typeof j === "object")
      for (const [k, v] of Object.entries(j)) {
        if (v && typeof v.f === "number" && typeof v.n === "number") data[k] = { f: v.f, n: v.n, at: v.at || 0 };
        else if (v && typeof v.as === "string" && v.as) names[k] = { as: v.as, next: typeof v.next === "string" && v.next ? v.next : null, at: v.at || 0 };
        else if (v && Array.isArray(v.starts))
          starts[k] = { starts: v.starts.filter((/** @type {any} */ s) => Number(s?.first) > 0 && Number(s?.sent) >= 0).map((/** @type {any} */ s) => ({ first: Number(s.first), sent: Number(s.sent), at: Number(s.at) || 0 })).slice(-STARTS_KEPT), at: v.at || 0 };
      }
  } catch {} // no file yet, or unreadable: start empty
  // The store keeps only what it serves: a factor of an upstream that is never calibrated goes, so does the name of a
  // model on one that is — it learns its own — and the file follows.
  const never = Object.keys(data).filter((k) => skips(k.split("::")[0]));
  for (const k of never) delete data[k];
  const own = Object.keys(names).filter((k) => !skips(k.split("::")[0]));
  for (const k of own) delete names[k];
  if (never.length || own.length) saveSoon();
}

/** Whether an upstream is never calibrated. @param {string} upstreamId */
const skips = (upstreamId) => !!uncalibrated && uncalibrated(String(upstreamId || ""));

function saveNow() {
  if (!file || !loaded) return;
  // No mkdir: the file lives in the server's data dir, which exists while the server runs — a save into one that was
  // removed (a stopped instance's) must fail, never bring the dir back (HarnessV3-FixRound F1 item 1).
  try {
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify({ ...data, ...names, ...starts }, null, 2) + "\n");
    renameSync(tmp, file);
  } catch {} // calibration is an enhancement; a failed save never takes a request down
}

function saveSoon() {
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
  if (timer.unref) timer.unref();
}

/** The calibration key: the upstream that tokenizes and the model whose vocabulary did the tokenizing. */
export const calibKey = (upstreamId, model) =>
  `${String(upstreamId || "").toLowerCase()}::${String(model || "").toLowerCase()}`;

/** A factor as it is served: never outside the band. @param {number} f */
const inBand = (f) => Math.min(CLAMP_FACTOR[1], Math.max(CLAMP_FACTOR[0], f));

/**
 * The learned key a coding agent's model borrows from: the model its turns were counted under, on the upstream that
 * learned it from the most replies. Null while no turn named one, or no upstream has learned the one named.
 * @param {string} k  the agent's own key @returns {string | null}
 */
function lender(k) {
  const as = names[k]?.as;
  if (!as) return null;
  /** @type {string | null} */
  let best = null;
  for (const [key, e] of Object.entries(data)) if (key.endsWith(`::${as}`) && e.n >= MIN_SAMPLES && (!best || e.n > data[best].n)) best = key;
  return best;
}

/**
 * The factor for one upstream+model, or null while there is too little evidence (cold start — the caller estimates
 * uncalibrated): the one its own replies taught, or, for a coding agent's, the one the model its turns were counted
 * under showed on an upstream that is calibrated. Never null-adjacent garbage: the band is clamped.
 * @param {string} upstreamId @param {string} model @returns {number | null}
 */
export function calibFactor(upstreamId, model) {
  if (!file) return null; // not initialized: the heuristic stands on its own
  load();
  const k = calibKey(upstreamId, model);
  const lent = skips(upstreamId) ? lender(k) : null;
  const e = skips(upstreamId) ? (lent ? data[lent] : null) : data[k];
  if (!e || e.n < MIN_SAMPLES) return null;
  const f = inBand(e.f);
  // Behavior changes are said, not silent: the first time a key serves (and whenever it moves by a tenth), a line
  // lands in the server log — the place a sizing decision's sudden change is explainable from after the fact.
  const was = served[k];
  if (was == null || Math.abs(f - was) > Math.max(0.1, was * 0.1)) {
    served[k] = f;
    logFn?.(
      "info",
      lent
        ? `estimator ×${f.toFixed(2)} for ${k}, borrowed from ${lent}: the model its turns were counted under (observability.tokenCalibration)`
        : `estimator calibrated ×${f.toFixed(2)} for ${k} from ${e.n} real replies (observability.tokenCalibration)`,
    );
  }
  return f;
}

/**
 * A coding agent's turn named the models that counted it: the one that read the most is the model its context ran
 * on — a helper model reads a few thousand tokens, the session's the whole conversation — and its name is what the
 * agent's own name for its model stands for. The first name is taken as said; another takes over once two turns
 * running say it, so one turn retried on a fallback model moves nothing. Read for a coding agent's upstream only:
 * one that is calibrated learns its own factor.
 * @param {string} upstreamId @param {string} model  the agent's model, as `calibFactor` is asked for it
 * @param {{ model?: string, input?: number, output?: number, cacheRead?: number, cacheWrite?: number }[] | null | undefined} counted
 */
export function observeCountedModel(upstreamId, model, counted) {
  if (!file || !upstreamId || !model || !skips(upstreamId)) return;
  const main = mainCounted(counted);
  if (!main) return;
  const as = String(main.model).toLowerCase();
  load();
  const k = calibKey(upstreamId, model);
  const e = names[k];
  if (e && e.as === as && !e.next) return;
  if (!e || e.next === as) names[k] = { as, next: null, at: Date.now() };
  else names[k] = { ...e, next: e.as === as ? null : as };
  delete served[k];
  const keys = Object.keys(names);
  if (keys.length > MAX_KEYS) {
    keys.sort((a, b) => (names[a].at || 0) - (names[b].at || 0));
    delete names[keys[0]];
  }
  saveSoon();
}

/**
 * The model a coding agent's turns at `model` were counted under (`observeCountedModel`'s name, lower case): what
 * answered there before, whatever the model is called. Null where no turn there named one.
 * @param {string} upstreamId @param {string} model  the agent's model, as `observeCountedModel` is given it
 * @returns {string | null}
 */
export function countedAs(upstreamId, model) {
  if (!file || !upstreamId || !model || !skips(upstreamId)) return null;
  load();
  return names[calibKey(upstreamId, model)]?.as || null;
}

/**
 * Fold one real reply into the average: what the provider tokenized over what we estimated for the same body.
 * A raw ratio outside the plausible band is thrown away, not clamped: a provider tokenizing a third or triple of
 * the estimate is a measurement mismatch (usage summed over different bodies than the one estimated), not a
 * vocabulary density — feeding it would steer the estimator on fiction. The estimate is counted only for a reply this
 * reads: counting a whole body stringifies and hashes every tool block in it, and every reply came here — with
 * calibration off, on an agent's upstream, on a reply too small to read — to be thrown away.
 * @param {string} upstreamId @param {string} model
 * @param {() => number} estimate  what we estimated for the body sent @param {number} actualTokens
 */
export function observeRatio(upstreamId, model, estimate, actualTokens) {
  if (!file || !upstreamId || !model || skips(upstreamId)) return;
  const act = Number(actualTokens);
  if (!(act >= MIN_TOKENS)) return;
  const est = Number(estimate());
  if (!(est >= MIN_TOKENS)) return;
  const r = act / est;
  if (r < PLAUSIBLE[0] || r > PLAUSIBLE[1]) return;
  load();
  const k = calibKey(upstreamId, model);
  const e = data[k];
  data[k] = e ? { f: e.f + ALPHA * (r - e.f), n: e.n + 1, at: Date.now() } : { f: r, n: 1, at: Date.now() };
  const keys = Object.keys(data);
  if (keys.length > MAX_KEYS) {
    keys.sort((a, b) => (data[a].at || 0) - (data[b].at || 0));
    delete data[keys[0]];
  }
  saveSoon();
}

/** Where a coding agent's starts are kept: its upstream and the folder its sessions open in, as one spelling. */
const startsKey = (/** @type {string} */ upstreamId, /** @type {string} */ cwd) =>
  `${String(upstreamId || "").toLowerCase()}::own::${String(cwd || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()}`;

/**
 * A coding agent's own share from its fresh sessions' starts: the line `first = own + scale × sent` through them,
 * where their sends differ enough to tell the two apart (by a third of the most, and 4,000 tokens) and the scale is
 * one an estimate can be off by; else the start where Filament sent least, less what it sent — the one an estimate's
 * error moves least. Null with no start. `scale`: the fit's, null without one.
 * @param {readonly { first: number, sent: number }[]} list
 * @returns {{ own: number, scale: number | null, n: number } | null}
 */
export function ownFit(list) {
  const pts = (list || []).filter((s) => Number(s?.first) > 0 && Number(s?.sent) >= 0);
  if (!pts.length) return null;
  const least = pts.reduce((a, b) => (b.sent < a.sent ? b : a));
  const fallback = { own: Math.max(0, Math.round(least.first - least.sent)), scale: null, n: pts.length };
  const xs = pts.map((s) => s.sent);
  const spread = Math.max(...xs) - Math.min(...xs);
  if (pts.length < 2 || spread < Math.max(4000, Math.max(...xs) / 3)) return fallback;
  const mx = xs.reduce((a, b) => a + b, 0) / pts.length;
  const my = pts.reduce((a, s) => a + s.first, 0) / pts.length;
  const cov = pts.reduce((a, s) => a + (s.sent - mx) * (s.first - my), 0);
  const vx = pts.reduce((a, s) => a + (s.sent - mx) ** 2, 0);
  const scale = cov / vx;
  const own = my - scale * mx;
  if (!(scale >= FIT_SCALE[0] && scale <= FIT_SCALE[1]) || !(own > 0) || own > Math.min(...pts.map((s) => s.first))) return fallback;
  return { own: Math.round(own), scale: Math.round(scale * 1000) / 1000, n: pts.length };
}

/**
 * A coding agent's session new to it began: what its first request held, by its own count, and what Filament sent
 * in it, by Filament's estimate. Kept by agent and folder, the newest `STARTS_KEPT`.
 * @param {string} upstreamId @param {string | null | undefined} cwd @param {number} first @param {number} sent
 */
export function observeAgentStart(upstreamId, cwd, first, sent) {
  if (!file || !upstreamId || !(Number(first) > 0) || !(Number(sent) >= 0)) return;
  load();
  const k = startsKey(upstreamId, String(cwd || ""));
  const at = Date.now();
  starts[k] = { starts: [...(starts[k]?.starts || []), { first: Math.round(Number(first)), sent: Math.round(Number(sent)), at }].slice(-STARTS_KEPT), at };
  const keys = Object.keys(starts);
  if (keys.length > MAX_KEYS) {
    keys.sort((a, b) => (starts[a].at || 0) - (starts[b].at || 0));
    delete starts[keys[0]];
  }
  saveSoon();
}

/**
 * A coding agent's own share in a folder, as its starts there tell it (`ownFit`); null where none was kept.
 * @param {string} upstreamId @param {string | null | undefined} cwd
 */
export function agentOwn(upstreamId, cwd) {
  if (!file || !upstreamId) return null;
  load();
  return ownFit(starts[startsKey(upstreamId, String(cwd || ""))]?.starts || []);
}

/**
 * Total input a provider tokenized, from Filament's normalized usage ({ input, cacheRead, cacheWrite } — input
 * excludes the cached parts, so all three sum to the whole prompt). Null when nothing real is there.
 * @param {any} u
 */
export const totalInputOf = (u) => {
  const t = (Number(u?.input) || 0) + (Number(u?.cacheRead) || 0) + (Number(u?.cacheWrite) || 0);
  return t > 0 ? t : null;
};

/**
 * What has been learned, for the UI and tests: a factor's row { key, f, n, at }, then each coding agent's model with
 * the model its turns were counted under — { key, as, from, f, n, at }, `from` the key it borrows from and `f`, `n`
 * that key's, or null and 0 while no upstream has learned that model.
 * @returns {{ key: string, f: number | null, n: number, at: number, as?: string, from?: string | null }[]}
 */
export const calibSnapshot = () => [
  ...Object.entries(data).map(([key, e]) => ({ key, f: Math.round(e.f * 1000) / 1000, n: e.n, at: e.at })),
  ...Object.entries(names).map(([key, e]) => {
    const from = lender(key);
    const l = from ? data[from] : null;
    return { key, as: e.as, from, f: l ? Math.round(inBand(l.f) * 1000) / 1000 : null, n: l ? l.n : 0, at: e.at };
  }),
];

/**
 * Forget one key's learning (the dashboard's reset): a factor, or the model a coding agent's turns named.
 * @param {string} key the snapshot entry's `key` (`upstream::model`)
 */
export function forgetTokenCalib(key) {
  const has = (/** @type {object} */ o) => Object.prototype.hasOwnProperty.call(o, key);
  if (!file || (!has(data) && !has(names) && !has(starts))) return false;
  delete data[key];
  delete names[key];
  delete starts[key];
  delete served[key];
  saveNow();
  return true;
}

/**
 * Flush and stop the debounce timer (the server's shutdown path), then stand down: nothing is written for that file
 * again. The state is the process's, so an instance passes the file it was given: a second instance in the same
 * process (the tests run several) may have named its own since, and an older instance's stop then leaves it alone
 * instead of flushing into it — or into a dir already removed.
 * @param {string | null} [owner]  the file this instance passed to `initTokenCalib`; omitted: whatever is current
 */
export function disposeTokenCalib(owner) {
  if (owner !== undefined && owner !== file) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  saveNow();
  file = null;
}
