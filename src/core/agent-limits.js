// @ts-check
// An agent's account and its plan's windows in one shape (HarnessV3-ACP AC3-6), whoever reports them: Claude's adapter
// (`_auth/status_update`, its rate-limit info and Claude Code's `/usage` report), Codex's app-server (`account/*`: its
// windows, credits, reset credits and why it stopped), the Cursor SDK (`Cursor.me()`). The windows' shape is what the
// store keeps, a turn's record carries and the page draws. Each reader takes the agent's own words and nothing else:
// what an agent didn't say stays unsaid.

/**
 * Who an agent runs as, as it said: the kind of login, its name as the agent gives it ("Claude Max", "ChatGPT plus",
 * "Cursor API key “work”"), the plan, the email and organization where it names them, and what else it said (the
 * API key's source, a gateway's host, the Cursor key's name). `billing`: how the login pays, as its kind says — a
 * plan (`plan`: a subscription's login, or a Cursor key, which bills its owner's plan), by use (`metered`: an API key
 * of Anthropic's or OpenAI's, a cloud provider), or null where the kind says nothing of it (a gateway, the provider
 * Codex is configured for, nobody signed in). `held`: what keeps the agent on this identity whatever is signed in
 * here, in words for the account's card — a key from outside the account, which no Sign in or Sign out reaches.
 * @typedef {{ kind: "account" | "api-key" | "gateway" | "external" | "none", label: string, plan: string | null,
 *   email: string | null, organization: string | null, detail: string | null,
 *   billing: "plan" | "metered" | null, held?: string }} Identity
 */

/**
 * One of a plan's windows: its id as the agent names it, its length's kind and name, how much of it is used (a
 * percent, null when only its status came), when it resets (epoch ms), its length in minutes, and the agent's own
 * word on it (`warning`: near its end; `rejected`: spent).
 * @typedef {{ id: string, kind: "session" | "weekly" | "monthly" | "other", label: string, usedPercent: number | null,
 *   resetsAt: number | null, windowMins: number | null, status: "allowed" | "warning" | "rejected" | null }} PlanWindow
 */

/**
 * What a plan's extra usage stands at, as Claude says it, each of its channels its own part: its rate-limit info,
 * whether it is in use now, its own status and reset, and why it is off where it is; its `/usage` report, whether it
 * can cover sends, what it has spent this month and its monthly limit, in its currency's minor units (cents for USD).
 * @typedef {{ using?: boolean, status?: "allowed" | "warning" | "rejected" | null, resetsAt?: number | null,
 *   off?: string | null, enabled?: boolean, spent?: number | null, limit?: number | null,
 *   currency?: string | null }} ExtraUsage
 */

/**
 * The credits a Codex account buys past its plan, as Codex says them: whether it has any, whether they are
 * unlimited, and the balance in Codex's words.
 * @typedef {{ has: boolean, unlimited: boolean, balance: string | null }} Credits
 */

/**
 * A Codex account's reset credits: how many it has, and when the soonest of them expires (epoch ms). Each one resets
 * the plan's spent windows at once.
 * @typedef {{ available: number, nextExpiresAt: number | null }} ResetCredits
 */

/**
 * What a bridge hands the server's store of an agent's account (`onAccount`): the channel it heard
 * (`_auth/status_update`, `rate_limit_event`, `account/read`, `Cursor.me()`…), and any of: who the agent runs as,
 * windows it reported, its extra usage, its credits and reset credits, why it stopped (Codex's
 * `rateLimitReachedType`; null where a full reading says it hasn't), and why it has no windows to report. A field
 * left out is one the agent didn't speak of.
 * @typedef {{ source: string, identity?: Identity | null, windows?: PlanWindow[], extra?: ExtraUsage | null,
 *   credits?: Credits | null, resetCredits?: ResetCredits | null, reached?: string | null,
 *   noWindows?: string | null }} AccountReport
 */

/**
 * An account as a turn's record keeps it (`acp.account`), for every agent: who, the plan's windows as they stood,
 * what else the agent said of its plan, and as of when.
 * @typedef {Identity & { windows: PlanWindow[], extra?: ExtraUsage, credits?: Credits, resetCredits?: ResetCredits,
 *   reached?: string, at: number }} AccountRecord
 */

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/** Two resets this close apart are the same period's: an agent's reset time moves a second or two between reports. */
export const SAME_PERIOD_MS = 120_000;

/** A percent kept between 0 and 100. @param {number} n */
const percent = (n) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

/** Epoch seconds as epoch ms; null for none. @param {unknown} s */
const fromSeconds = (s) => (Number(s) > 0 ? Math.round(Number(s) * 1000) : null);

/** The agent's word on a window, in the shape's. @param {unknown} s @returns {PlanWindow["status"]} */
const statusOf = (s) => (s === "rejected" ? "rejected" : s === "allowed_warning" ? "warning" : s === "allowed" ? "allowed" : null);

/**
 * A window's kind and name by its length: a day or less is a session's ("5-hour"), a week a weekly, a month a monthly.
 * @param {number} mins
 * @returns {{ kind: PlanWindow["kind"], label: string }}
 */
function byLength(mins) {
  if (mins >= MONTH) return { kind: "monthly", label: "Monthly" };
  if (mins >= WEEK) return { kind: "weekly", label: "Weekly" };
  if (mins > DAY) return { kind: "other", label: `${Math.round(mins / DAY)}-day` };
  return { kind: "session", label: `${Math.max(1, Math.round(mins / HOUR))}-hour` };
}

/** Claude's windows by the SDK's `rateLimitType`: the account's own, and its per-model weeklies. */
const CLAUDE_WINDOWS = /** @type {Record<string, { kind: PlanWindow["kind"], label: string, windowMins: number | null }>} */ ({
  five_hour: { kind: "session", label: "5-hour", windowMins: 5 * HOUR },
  seven_day: { kind: "weekly", label: "Weekly", windowMins: WEEK },
  seven_day_opus: { kind: "weekly", label: "Weekly · Opus", windowMins: WEEK },
  seven_day_sonnet: { kind: "weekly", label: "Weekly · Sonnet", windowMins: WEEK },
  // The weekly bucket of one model, which the event names by type alone: its model has no name here.
  seven_day_overage_included: { kind: "weekly", label: "Weekly · one model", windowMins: WEEK },
  overage: { kind: "other", label: "Extra usage", windowMins: null },
});

/**
 * Nobody signed in, in the shape (HarnessV3-ACP AC3-7): `detail` says what is missing where the agent itself can't be
 * asked (an upstream with no key yet).
 * @param {string | null} [detail]
 * @returns {Identity}
 */
export function notSignedIn(detail = null) {
  return { kind: "none", label: "Not signed in", plan: null, email: null, organization: null, detail, billing: null };
}

/**
 * What holds Claude's identity whatever is signed in here, by its key's source (HarnessV3-ACP AF1): Claude Code puts
 * an API key above any sign-in, so a key from Filament's environment or from its own settings outlasts every Sign in
 * and Sign out. A Console sign-in's key (`/login managed key`) holds nothing: signing out ends it. A key a command of
 * Claude Code's settings makes is named by the setting (`apiKeyHelper`), or as claude-agent-acp 0.93 says it ("API key
 * helper").
 */
const HELPER_HELD =
  "Runs on the key Claude Code's own settings make (apiKeyHelper). Claude Code puts it above any sign-in, so signing in or out here changes nothing while that setting stands.";
const CLAUDE_HELD = /** @type {Record<string, string>} */ ({
  ANTHROPIC_API_KEY:
    "Runs on the ANTHROPIC_API_KEY Filament was started with. Claude Code puts it above any sign-in, so signing in or out here changes nothing: to use a sign-in, remove the key from your environment, then start Filament afresh (quit its tray and open it again, or use a new terminal).",
  apiKeyHelper: HELPER_HELD,
  "API key helper": HELPER_HELD,
});

/**
 * Claude's identity from its adapter's `_auth/status_update` (claude-agent-acp's `authStatus`): silence is "not
 * reported", which is null here; `kind: "none"` is a sign-in it knows is missing.
 * @param {any} s
 * @returns {Identity | null}
 */
export function claudeIdentity(s) {
  const kind = s?.kind === "account" ? "account" : s?.kind === "api_key" ? "api-key" : s?.kind === "gateway" ? "gateway" : s?.kind === "external" ? "external" : s?.kind === "none" ? "none" : null;
  if (!kind) return null;
  const a = s.account || {};
  return {
    kind,
    label: String(s.label || (kind === "none" ? "Not signed in" : kind)),
    plan: a.plan ? String(a.plan) : null,
    email: a.email ? String(a.email) : null,
    organization: a.organization ? String(a.organization) : null,
    detail: s.detail ? String(s.detail) : null,
    // The adapter's own rule: an API key outranks a subscription's login, so the kind it reports is what pays the turn.
    billing: kind === "account" ? "plan" : kind === "api-key" || kind === "external" ? "metered" : null,
    ...(kind === "api-key" && Object.hasOwn(CLAUDE_HELD, String(s.detail || "")) ? { held: CLAUDE_HELD[String(s.detail)] } : {}),
  };
}

/**
 * One of Claude's windows from its rate-limit info (the SDK's `SDKRateLimitInfo`, one window to an event): its share
 * comes as a fraction and its reset in epoch seconds. An event naming no window, or one this reader doesn't know, is
 * null: a guess would draw a row no later report can land on.
 * @param {any} info
 * @returns {PlanWindow | null}
 */
export function claudeWindow(info) {
  const id = String(info?.rateLimitType || "");
  const shape = Object.hasOwn(CLAUDE_WINDOWS, id) ? CLAUDE_WINDOWS[id] : null;
  if (!shape) return null;
  const share = typeof info.utilization === "number" && Number.isFinite(info.utilization) ? percent(info.utilization * 100) : null;
  return { id, ...shape, usedPercent: share, resetsAt: fromSeconds(info.resetsAt), status: statusOf(info.status) };
}

/**
 * Claude's extra usage from the same info, or null where it said nothing of it.
 * @param {any} info
 * @returns {ExtraUsage | null}
 */
export function claudeExtra(info) {
  if (info?.overageStatus == null && info?.isUsingOverage == null && info?.overageDisabledReason == null) return null;
  return {
    using: info.isUsingOverage === true,
    status: statusOf(info.overageStatus),
    resetsAt: fromSeconds(info.overageResetsAt),
    off: info.overageDisabledReason ? String(info.overageDisabledReason) : null,
  };
}

/** The server's grading of a `/usage` row (its meter's colour on claude.ai), as a window's word. */
const USAGE_SEVERITY = /** @type {Record<string, PlanWindow["status"]>} */ ({ normal: "allowed", warning: "warning", critical: "warning" });

/**
 * The window a `/usage` row is, by the rate-limit info's name for it: the session's, all models' week, Opus's and
 * Sonnet's weeks, and any other model's week on the one the info names by type alone (Claude Code calls it the Fable
 * limit). Null for a row this reader doesn't know: one scoped to a surface, or of another kind.
 * @param {any} r
 * @returns {string | null}
 */
function usageRowId(r) {
  if (!r || typeof r !== "object" || r.scope?.surface) return null;
  const model = typeof r.scope?.model?.display_name === "string" ? r.scope.model.display_name.trim().toLowerCase() : "";
  if (r.kind === "session" && !r.scope?.model) return "five_hour";
  if (r.kind === "weekly_all" && !r.scope?.model) return "seven_day";
  if (r.kind !== "weekly_scoped" || !model) return null;
  return model === "opus" ? "seven_day_opus" : model === "sonnet" ? "seven_day_sonnet" : "seven_day_overage_included";
}

/**
 * Claude's windows as its `/usage` report says them (the SDK's `SDKUsageReport`, on the raw message that carries the
 * command's answer): every row claude.ai's usage page shows, at any level — the rate-limit info says a share only as a
 * window nears its end. Its share is a percent already; its reset an ISO time, kept to the second as the rate-limit
 * info keeps it, so both land on one period; the server's grading is its word. Each row lands on the window the
 * rate-limit info names (`usageRowId`), the Fable limit's under its model's name. A row this reader doesn't know is left
 * out, and so is a second row for one window.
 * @param {any} report
 * @returns {PlanWindow[]}
 */
export function claudeUsageWindows(report) {
  const rows = Array.isArray(report?.rate_limits?.limits) ? report.rate_limits.limits : [];
  /** @type {Map<string, PlanWindow>} */
  const by = new Map();
  for (const r of rows) {
    const id = usageRowId(r);
    if (!id || by.has(id) || !Number.isFinite(r.percent)) continue;
    const at = Date.parse(String(r.resets_at ?? ""));
    const severity = String(r.severity);
    by.set(id, {
      id,
      ...CLAUDE_WINDOWS[id],
      ...(id === "seven_day_overage_included" ? { label: `Weekly · ${r.scope.model.display_name.trim()}` } : {}),
      usedPercent: percent(r.percent),
      resetsAt: Number.isFinite(at) ? Math.round(at / 1000) * 1000 : null,
      status: Object.hasOwn(USAGE_SEVERITY, severity) ? USAGE_SEVERITY[severity] : null,
    });
  }
  return [...by.values()];
}

/**
 * Claude's extra usage as its `/usage` report says it (the report's `extra_usage`): whether it can cover sends, what it
 * has spent this month and its monthly limit, in its currency's minor units, and the currency; null where the report
 * says nothing of it. A figure that is no number, and a currency that is none, are unsaid.
 * @param {any} report
 * @returns {ExtraUsage | null}
 */
export function claudeUsageExtra(report) {
  const x = report?.rate_limits?.extra_usage;
  if (typeof x?.is_enabled !== "boolean") return null;
  /** @param {unknown} n */
  const minor = (n) => (Number.isFinite(n) ? /** @type {number} */ (n) : null);
  const currency = typeof x.currency === "string" ? x.currency.trim() : "";
  return { enabled: x.is_enabled, spent: minor(x.used_credits), limit: minor(x.monthly_limit), currency: currency || null };
}

/** ChatGPT's plans by Codex's id, where the id doesn't read as the name. */
const CHATGPT_PLANS = /** @type {Record<string, string>} */ ({ prolite: "Pro Lite", edu_plus: "Edu Plus", edu_pro: "Edu Pro" });

/**
 * A ChatGPT plan's name from Codex's id ("plus" is Plus, "self_serve_business_prolite" Self Serve Business Prolite);
 * null for none, or for the `unknown` Codex says when it can't tell.
 * @param {unknown} id
 */
export function chatgptPlan(id) {
  const s = id ? String(id) : "";
  if (!s || s === "unknown") return null;
  if (Object.hasOwn(CHATGPT_PLANS, s)) return CHATGPT_PLANS[s];
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Codex's identity from `account/read`: its account; with none, signed out where Codex needs OpenAI's sign-in, else
 * the provider Codex is configured for. A login other than ChatGPT's and an OpenAI key (Amazon Bedrock, or one this
 * reader doesn't know) is named as Codex names it.
 * @param {any} acc @param {boolean} requiresAuth
 * @returns {Identity}
 */
export function codexIdentity(acc, requiresAuth) {
  const none = { plan: null, email: null, organization: null, detail: null, billing: null };
  if (!acc)
    return requiresAuth ? notSignedIn() : { kind: "external", label: "Codex's configured provider", ...none, detail: "no sign-in needed" };
  if (acc.type === "apiKey") return { kind: "api-key", label: "OpenAI API key", ...none, billing: "metered" };
  if (acc.type === "amazonBedrock") return { kind: "external", label: "Amazon Bedrock", ...none, billing: "metered" };
  if (acc.type !== "chatgpt") return { kind: "external", label: String(acc.type || "Codex's own login"), ...none };
  const plan = chatgptPlan(acc.planType);
  return { kind: "account", label: `ChatGPT${plan ? ` ${plan}` : ""}`, ...none, plan: acc.planType ? String(acc.planType) : null, email: acc.email ? String(acc.email) : null, billing: "plan" };
}

/**
 * The main allowance's snapshot in an `account/rateLimits/read` answer: its by-limit view's `codex`, else the single
 * view an older Codex sends.
 * @param {any} read
 */
export function codexMain(read) {
  return read?.rateLimitsByLimitId?.codex ?? read?.rateLimits ?? null;
}

/**
 * Codex's credits from a snapshot, or null where it said nothing of them (an update leaves them out).
 * @param {any} rl
 * @returns {Credits | null}
 */
export function codexCredits(rl) {
  const c = rl?.credits;
  if (!c || typeof c !== "object") return null;
  return { has: c.hasCredits === true, unlimited: c.unlimited === true, balance: c.balance != null && String(c.balance) !== "" ? String(c.balance) : null };
}

/**
 * Codex's reset credits from an `account/rateLimits/read` answer's `rateLimitResetCredits`, or null where it said
 * nothing of them: the count, and the soonest expiry among the available ones it detailed.
 * @param {any} s
 * @returns {ResetCredits | null}
 */
export function codexResetCredits(s) {
  if (!s || typeof s !== "object" || !Number.isFinite(Number(s.availableCount))) return null;
  const ends = (Array.isArray(s.credits) ? s.credits : [])
    .filter((/** @type {any} */ c) => c?.status === "available")
    .map((/** @type {any} */ c) => fromSeconds(c.expiresAt))
    .filter((/** @type {number | null} */ t) => t != null);
  return { available: Math.max(0, Math.floor(Number(s.availableCount))), nextExpiresAt: ends.length ? Math.min(.../** @type {number[]} */ (ends)) : null };
}

/**
 * Codex's windows from a rate-limit snapshot (`account/rateLimits/read` or `…/updated`): the main allowance only (its
 * `limitId` is `codex`, or absent from an older Codex) — a model's own allowance never takes its rows. `primary` and
 * `secondary` are positions, not lengths: where Codex names no length, a paid plan's are the 5-hour and the weekly, a
 * free plan's one monthly. A window an update leaves out, or a field it leaves out, is the caller's to
 * keep.
 * @param {any} rl
 * @returns {PlanWindow[]}
 */
export function codexWindows(rl) {
  if (!rl || typeof rl !== "object" || (rl.limitId && rl.limitId !== "codex")) return [];
  const monthly = rl.planType === "free" || rl.planType === "go";
  /** @type {PlanWindow[]} */
  const out = [];
  for (const [id, fallback] of /** @type {[string, number][]} */ ([["primary", monthly ? MONTH : 5 * HOUR], ["secondary", WEEK]])) {
    const w = rl[id];
    if (!w || typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) continue;
    const named = Number(w.windowDurationMins) > 0 ? Number(w.windowDurationMins) : null;
    out.push({ id, ...byLength(named ?? fallback), usedPercent: percent(w.usedPercent), resetsAt: fromSeconds(w.resetsAt), windowMins: named, status: null });
  }
  return out;
}

/**
 * Cursor's identity from `Cursor.me()`: the key's owner. Cursor's plan windows have no published interface (AC-D9).
 * @param {any} me
 * @returns {Identity | null}
 */
export function cursorIdentity(me) {
  if (!me) return null;
  const key = me.apiKeyName ? String(me.apiKeyName) : null;
  return { kind: "api-key", label: `Cursor API key${key ? ` “${key}”` : ""}`, plan: null, email: me.userEmail ? String(me.userEmail) : null, organization: null, detail: key, billing: "plan" };
}

/**
 * What an agent's CLI or its files say of its sign-in, read without a turn where the agent doesn't say who it runs as
 * itself (the owner's of 10-30: the picker offers an agent only while someone is signed in to it): someone is
 * (`true`), as whom where they name it, nobody is (`false`, with the identity that says so), or they can't tell (`null`).
 * @typedef {{ signedIn: boolean | null, identity: Identity | null }} SignInReading
 */

/** A reading that can't tell. @type {SignInReading} */
export const CANNOT_TELL = Object.freeze({ signedIn: null, identity: null });
/** Nobody signed in, as a reading. @param {string | null} [detail] @returns {SignInReading} */
const nobody = (detail = null) => ({ signedIn: false, identity: notSignedIn(detail) });
/** A text field a CLI printed, trimmed; null for none. @param {unknown} v */
const said = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A login named by an agent's CLI or its files: billed by its plan. @param {string} label @param {unknown} email @param {unknown} [plan] @returns {Identity} */
const login = (label, email, plan = null) => ({ kind: "account", label, plan: said(plan), email: said(email), organization: null, detail: null, billing: "plan" });

/** The JSON object a CLI printed, or null where it printed none. @param {string} out */
function printedJson(out) {
  const s = String(out || "");
  const from = s.indexOf("{");
  if (from < 0) return null;
  try {
    const j = JSON.parse(s.slice(from, s.lastIndexOf("}") + 1));
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/**
 * An agent's sign-in as its CLI's status command says it (the catalogue's `status`), by the CLI's way of saying it:
 * Claude's `auth status` (its `loggedIn`), Codex's `login status` (its words), Cursor's `status --format json` (its
 * `isAuthenticated`, and who: its user's name and email), Qoder's `status -o json` (its `logged_in`, its user's name,
 * email and plan). Where the JSON isn't there, the words its text form prints: "✓ Logged in as …", "Not logged in". JSON
 * that says neither, as Cursor's does when its own check failed, can't tell. A name that is an email address is no label:
 * the pages show an email masked until it is asked for.
 * @param {string} parse  the catalogue's `status.parse` @param {string} out  its output @param {string} [err]  its errors
 * @returns {SignInReading}
 */
export function statusReading(parse, out, err = "") {
  const words = `${out || ""}\n${err || ""}`;
  const j = printedJson(out);
  if (parse === "claude") {
    const m = /"loggedIn"\s*:\s*(true|false)/.exec(words);
    return !m ? CANNOT_TELL : m[1] === "true" ? { signedIn: true, identity: null } : nobody();
  }
  if (parse === "codex") return /not logged in/i.test(words) ? nobody() : /logged in/i.test(words) ? { signedIn: true, identity: null } : CANNOT_TELL;
  if (parse === "cursor") {
    if (j && typeof j.isAuthenticated === "boolean") {
      if (!j.isAuthenticated) return nobody();
      const u = j.userInfo && typeof j.userInfo === "object" ? j.userInfo : {};
      const name = [said(u.firstName), said(u.lastName)].filter(Boolean).join(" ");
      return { signedIn: true, identity: name || said(u.email) ? login(name && !name.includes("@") ? name : "Cursor account", u.email) : null };
    }
    if (j) return CANNOT_TELL;
    if (/not logged in|partially authenticated/i.test(words)) return nobody();
    const as = /logged in as (\S+@\S+)/i.exec(words);
    if (as) return { signedIn: true, identity: login("Cursor account", as[1]) };
    return /logged in|login successful/i.test(words) ? { signedIn: true, identity: null } : CANNOT_TELL;
  }
  if (parse === "qoder") {
    if (j && typeof j.logged_in === "boolean") {
      if (!j.logged_in) return nobody();
      const name = said(j.username);
      return { signedIn: true, identity: login(name && !name.includes("@") ? name : "Qoder account", j.email, j.plan) };
    }
    if (j) return CANNOT_TELL;
    if (/not logged in/i.test(words)) return nobody();
    return /^\s*(username|email):/im.test(words) ? { signedIn: true, identity: null } : CANNOT_TELL;
  }
  return CANNOT_TELL;
}

/**
 * An account as a turn's record keeps it.
 * @param {Identity} identity @param {PlanWindow[]} windows @param {number} at
 * @param {{ extra?: ExtraUsage | null, credits?: Credits | null, resetCredits?: ResetCredits | null, reached?: string | null }} [more]
 * @returns {AccountRecord}
 */
export function accountRecord(identity, windows, at, more = {}) {
  return {
    ...identity,
    windows: windows.map((w) => ({ ...w })),
    ...(more.extra ? { extra: { ...more.extra } } : {}),
    ...(more.credits ? { credits: { ...more.credits } } : {}),
    ...(more.resetCredits ? { resetCredits: { ...more.resetCredits } } : {}),
    ...(more.reached ? { reached: more.reached } : {}),
    at,
  };
}

/**
 * Two identities for the same login: the kind, then the email of an account or what names a key.
 * @param {Identity | null | undefined} a @param {Identity | null | undefined} b
 */
export function sameIdentity(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "account") return (a.email || "") === (b.email || "");
  if (a.kind === "api-key") return (a.detail || "") === (b.detail || "") && (a.email || "") === (b.email || "");
  return true;
}

/**
 * Windows folded into the ones known, by id. A field a report leaves out keeps what was known (Codex's updates are
 * sparse), and so does a length it doesn't name, with its name. A new share without a word of the agent's drops the
 * old word: it was said of the old share. A report of another period keeps neither the old share nor the old word:
 * both were said of a period that has ended (Claude's first word of a new period names its reset, seldom its share).
 * @param {PlanWindow[]} known @param {PlanWindow[]} heard
 * @returns {PlanWindow[]}
 */
export function mergeWindows(known, heard) {
  const by = new Map(known.map((w) => [w.id, w]));
  for (const w of heard) {
    const was = by.get(w.id);
    if (!was) {
      by.set(w.id, w);
      continue;
    }
    const named = w.windowMins == null && was.windowMins != null ? { kind: was.kind, label: was.label, windowMins: was.windowMins } : {};
    const newPeriod = w.resetsAt != null && was.resetsAt != null && Math.abs(w.resetsAt - was.resetsAt) > SAME_PERIOD_MS;
    const kept = newPeriod ? { usedPercent: null, status: null } : was;
    by.set(w.id, {
      ...w,
      ...named,
      usedPercent: w.usedPercent ?? kept.usedPercent,
      resetsAt: w.resetsAt ?? was.resetsAt,
      status: w.status ?? (w.usedPercent != null ? null : kept.status),
    });
  }
  return [...by.values()];
}
