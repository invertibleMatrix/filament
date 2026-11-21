// @ts-check
// What a provider's failure says of the provider (HarnessV3-TaskGraph-v2 TG2-D54, revised), read from its status, its
// error's type, its words and the wait it asks: busy for everyone for a while, limiting this account's rate, this
// account's allowance spent, this account or its key refused, or this account refused the one model it asked for —
// or none of these, where the request was its own fault or Filament's. One reading for every caller and seat: the
// loops' retries (an out, an account or a model is never tried again), the health board (which holds a provider that
// cannot serve, for the pool and the failover order to skip, and never for a model it refused alone), and the words a
// lead and the developer read. Where the words and the status disagree, the words decide: a 429 that says the balance
// is gone is an out, one that says the provider is overloaded is a busy, and one that says the plan does not include
// the model is a model. Pure.

/**
 * `busy`: the provider is busy or failing for everyone · `rate`: it limits this account's rate of calls · `out`: this
 * account's allowance is spent (its balance, credits or quota, a plan's window, a daily limit) · `account`: it refuses
 * this account or its key · `model`: it refuses this account the model asked for (its plan does not include it), and
 * serves it others.
 * @typedef {"busy" | "rate" | "out" | "account" | "model"} CauseKind
 */
/**
 * @typedef {object} Cause
 * @property {CauseKind} kind
 * @property {number | null} resets  when the provider said it serves again (epoch ms), where Filament could read it: an
 *   out's reset, from its Retry-After, a time with its zone or a coding agent's epoch — never a time with no zone
 */
/**
 * What a failure said, as each door has it: the HTTP status where the provider answered, its error's type (an
 * Anthropic, OpenAI or Moonshot type, a coding agent's error kind), its words, the seconds its Retry-After asks, and
 * whether it was a network error or a time limit, which no provider answered.
 * @typedef {{ status?: number | null, type?: string | null, said?: string | null, retryAfter?: number | null, network?: boolean }} Said
 */

/** The causes that are a wall: no call is tried again into one, and the provider is held as one that cannot serve. */
export const WALLS = Object.freeze(/** @type {CauseKind[]} */ (["out", "account"]));
/**
 * The causes no call is tried again into: the walls, and a model the provider refuses this account, which another try
 * of the same model meets again — while the provider serves this account its other models, so it is held for none.
 */
export const FINAL = Object.freeze(/** @type {CauseKind[]} */ ([...WALLS, "model"]));
/** A wait this long or shorter, asked by the provider, is a rate's: one longer is an allowance spent until then. */
export const NEAR_WAIT_S = 600;
/**
 * How long a provider that said this account's allowance is spent is held as one that cannot serve, where it said no
 * reset Filament could read: then a call may try it again (services/health.js).
 */
export const OUT_HOLD_MS = 15 * 60_000;

/** The error types that settle the cause alone. */
const TYPES = /** @type {Record<string, CauseKind>} */ ({
  authentication_error: "account",
  permission_error: "account",
  invalid_authentication_error: "account",
  permission_denied_error: "account",
  invalid_api_key: "account",
  authentication_failed: "account",
  oauth_org_not_allowed: "account",
  account_on_hold: "account",
  unauthorized: "account",
  // Cursor's SDK on a plan its Cloud Agent is not in: "[plan_required] Cloud Agent is not available for free users.
  // Please upgrade to Pro." (TinyQuest's of 11-18) — every model there, until the plan changes.
  plan_required: "account",
  insufficient_quota: "out",
  billing_error: "out",
  exceeded_current_quota_error: "out",
  usageLimitExceeded: "out",
  overloaded_error: "busy",
  engine_overloaded_error: "busy",
  overloaded: "busy",
  serverOverloaded: "busy",
  server_error: "busy",
  internalServerError: "busy",
  rate_limit_error: "rate",
  rate_limit_exceeded: "rate",
  rate_limit_reached_error: "rate",
  rateLimitExceeded: "rate",
  rate_limit: "rate",
});

/**
 * A provider refusing this account the model it asked for, in its words: zai's "Your current subscription plan does
 * not yet include access to GLM-5.3-FlashX", "You do not have access to the model …", Moonshot's "Not found the
 * model … or Permission denied". Read before an account's words, which a model's refusal can share ("permission
 * denied").
 */
const MODEL_WORDS =
  /\b(plan|subscription|package|tier)\b[^.]{0,40}\b(does not|doesn't|do not)\b[^.]{0,12}\binclude\b[^.]{0,8}\b(access|the model|this model)\b|\b(no|not have|without) access to (the |this )?model\b|\bmodel\b[^.]{0,60}\bnot (available|accessible|enabled|included) (for|to|on|in) (you|your|this)\b|\bnot found the model\b|\bmodel\b[^.]{0,60}\bor permission denied\b/i;
/** A provider refusing the account or its key, in its words. */
const ACCOUNT_WORDS =
  /\b(invalid|incorrect|wrong|revoked|expired|disabled)[ _-]+(x-)?api[ _-]?key|\bapi[ _-]?key\b[^.]{0,30}\b(invalid|incorrect|expired|revoked|disabled|not valid)|invalid[ _-]authenticat|authenticat\w*[ _-](failed|fails|required)|failed to authenticate|\bunauthori[sz]ed\b|not (logged|signed) in|please run \/login|\b(oauth|session|token|credentials?|login)\b[^.]{0,30}\bexpired\b|\baccount\b[^.]{0,40}\b(suspended|disabled|deactivated|locked|banned|frozen|inactive|not active|on hold|does not exist)|organi[sz]ation\b[^.]{0,30}\b(disabled|not allowed|suspended)|permission[ _-]denied|does not have (permission|access)|not (allowed|authorized|permitted) to (use|access)|身份验证|认证失败|账户.{0,10}(锁定|冻结|不存在|非活动)/i;
/** An account's allowance spent: its balance, credits or quota, a plan's window, a daily limit. */
const OUT_WORDS =
  /insufficient[ _-]?(balance|credits?|funds|quota|account balance)|credit balance|\bout of (credits|funds|quota|usage)|\bbalance\b[^.]{0,20}\b(too low|insufficient|not enough|exhausted|empty)|exceeded (your )?(current )?quota|\bquota\b[^.]{0,20}\b(exceeded|exhausted|used up|reached)|usage[ _-]limit|\b(5|five)[ -]?hours? limit|\b(weekly|monthly|daily)\b[^.]{0,20}\blimit|\blimit[ _-]exhausted|limit will reset|hit your (usage )?limit|per[ _-]?day\b|\b(TPD|RPD)\b|\brecharge\b|\btop[ -]?up\b|(purchase|buy|add) (more )?credits|payment required|\b(plan|package|subscription)\b[^.]{0,20}\bexpired|arrear|余额不足|欠费|充值|已达.{0,12}(上限|限额)|用量上限/i;
/** A provider busy for everyone, in its words. */
const BUSY_WORDS = /overload|at capacity|high demand|temporarily unavailable|service unavailable|server (is )?busy|当前API请求过多|繁忙/i;
/** A content refusal, which a 403 can be: the request's own, not the account's. */
const CONTENT_WORDS = /moderation|flagged|content[ _-](policy|filter|management)|safety|harmful/i;
/** The cause an error type settles alone, or null for a type it leaves to the words. @param {string} type */
export const typeCause = (type) => (Object.hasOwn(TYPES, type) ? TYPES[type] : null);
/** A wait the words ask: "Please try again in 1.2s", "retry in 27.4s", "try again after 1 seconds", "retry in 17h". */
const WAIT_WORDS = /\b(?:try again|retry)(?: after| in)?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
/** A reset said as epoch seconds after a bar, as Claude says its plan's: "Claude AI usage limit reached|1760032800". */
const EPOCH_WORDS = /\|\s*(\d{10})\b/;
/** A time with its zone: "2026-10-14T16:50:58Z", "2026-10-14 16:50:58+08:00". One with no zone is said, never read. */
const ZONED_TIME = /\b(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})\b/;

/** The seconds a failure's words ask to wait, or null. @param {string} said */
function waitInWords(said) {
  const m = WAIT_WORDS.exec(said);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit.startsWith("ms") || unit.startsWith("milli") ? n / 1000 : unit.startsWith("h") ? n * 3600 : unit.startsWith("m") ? n * 60 : n;
}

/**
 * When the provider said it serves again, where Filament can read it: the wait it asks (its Retry-After, else its
 * words), an epoch after a bar, or a time with its zone. Null for none, and for a time with no zone.
 * @param {string} said @param {number | null} wait  seconds @param {number} now
 */
function resetsOf(said, wait, now) {
  if (wait != null && wait > 0) return now + Math.round(wait * 1000);
  const epoch = EPOCH_WORDS.exec(said);
  if (epoch) return Number(epoch[1]) * 1000;
  const t = ZONED_TIME.exec(said);
  const at = t ? Date.parse(`${t[1]}T${t[2]}${t[3]}`) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * The cause of a failure, or null where it was not the provider's: the request's own fault (a 400 it refused, a 404, a
 * size), or Filament's.
 * @param {Said} f @param {number} [now]
 * @returns {Cause | null}
 */
export function providerCause(f, now = Date.now()) {
  const status = Number(f.status) || 0;
  const said = String(f.said || "");
  const wait = f.retryAfter != null && f.retryAfter >= 0 ? f.retryAfter : waitInWords(said);
  const near = wait != null && wait <= NEAR_WAIT_S;
  const far = wait != null && wait > NEAR_WAIT_S;
  /** @param {CauseKind} kind @returns {Cause} */
  const is = (kind) => ({ kind, resets: kind === "out" ? resetsOf(said, wait, now) : null });
  // Words that name the model refused settle the cause first: the type and the status a provider sends with them say
  // "rate", "permission" or 429 for a refusal no wait and no other key changes.
  if (MODEL_WORDS.test(said)) return is("model");
  const byType = f.type ? TYPES[String(f.type)] : undefined;
  if (byType === "account" || byType === "out" || byType === "busy") return is(byType);
  // A type that says "rate" still yields to words of an allowance spent — "reached max TPD" is a day's, not a minute's —
  // and to a wait of more than ten minutes: the provider serves this account again only then. And to words that say
  // the provider is overloaded, which a 429's type can carry.
  if (byType === "rate") return is((OUT_WORDS.test(said) && !near) || far ? "out" : BUSY_WORDS.test(said) ? "busy" : "rate");
  if (ACCOUNT_WORDS.test(said)) return is("account");
  // Words of a quota with a near wait are a rate's: "You exceeded your current quota … Please retry in 27s".
  if (OUT_WORDS.test(said)) return is(near && status !== 402 ? "rate" : "out");
  if (BUSY_WORDS.test(said)) return is("busy");
  if (status === 401) return is("account");
  if (status === 403) return CONTENT_WORDS.test(said) ? null : is("account");
  if (status === 402) return is("out");
  if (status === 429) return is(far ? "out" : "rate");
  if (status === 408 || status === 409 || status === 425 || status >= 500) return is("busy");
  if (f.network) return is("busy");
  return null;
}

/** Whether a cause is a wall: an out or an account. @param {Cause | null | undefined} c */
export const isWall = (c) => !!c && WALLS.includes(c.kind);
/** Whether a cause ends a call's tries: a wall, or a model refused this account. @param {Cause | null | undefined} c */
export const isFinal = (c) => !!c && FINAL.includes(c.kind);

/** What each cause says of its provider, in words a lead and the developer read. */
const CAUSE_WORDS = /** @type {Record<CauseKind, (p: string) => string>} */ ({
  busy: (p) => `${p} was busy or failing for everyone`,
  rate: (p) => `${p} limited this account's rate of calls`,
  out: (p) => `${p} says this account's allowance is used up`,
  account: (p) => `${p} refuses this account or its key`,
  model: (p) => `${p} says this account may not use this model`,
});
/** The cause in words, of its provider: "zai says this account's allowance is used up". @param {CauseKind} kind @param {string | null} [provider] */
export const causeWords = (kind, provider) => CAUSE_WORDS[kind](provider || "the provider");

/** A hold's length in words: "40 s", "14 min", "4 h 50 min". @param {number} ms */
export function holdWords(ms) {
  if (ms < 120_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 120) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}

/**
 * A provider held as one that cannot serve (services/health.js): its cause, its own words, since when, and until when
 * — an out's reset or Filament's own hold; null for an account's, which holds until it is fixed. `as`: for a coding
 * agent, whom it said it runs as when it was held — null where it had not said, or for a provider Filament calls.
 * @typedef {{ kind: "out" | "account", said: string, status: number | null, at: number, until: number | null, reset: number | null, as: import("./agent-limits.js").Identity | null }} Wall
 */

/**
 * Why a held provider cannot serve, in words for the pool's row, a refused follow-up and the Providers page:
 * "zai cannot serve now: this account's allowance is used up ("…") — for 14 min more, or until a call there succeeds".
 * @param {Wall} w @param {string} provider @param {number} [now]
 */
export function wallWords(w, provider, now = Date.now()) {
  const said = w.said ? ` ("${w.said.replace(/\s+/g, " ").trim().slice(0, 160)}")` : "";
  if (w.kind === "account") return `${provider} refuses this account or its key${said} — until it is fixed in Settings, or Reset on the Providers page`;
  const left = w.until != null ? holdWords(Math.max(0, w.until - now)) : null;
  return `${provider} cannot serve now: this account's allowance is used up${said} — ${left ? `for ${left} more, ` : ""}or until a call there succeeds`;
}
