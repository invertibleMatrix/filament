// @ts-check
// What kind of failure an agent's error is (HarnessV3-ACP AC0-3), so that a prompt the agent refuses is not held
// against its health. Read, in this order: a prompt too long for the agent's context, or an account without credit,
// by its words; the `errorKind` Claude's adapter attaches (the Agent SDK's error types and its own), or Codex's bridge
// (its turn's `codexErrorInfo`, AC2-1); the JSON-RPC code; the rest of the words. What it says of the agent's account
// — busy, rate, out or account (HarnessV3-TaskGraph-v2 TG2-D54) — is `agentCause`'s, read with the account's windows.
import { providerCause, typeCause } from "../../../core/provider-cause.js";

/** @typedef {"auth" | "limit" | "refusal" | "overflow" | "timeout" | "transport"} FailureKind */
/** @typedef {{ kind: FailureKind, retryable: boolean, cools: boolean }} Failure */

/**
 * A prompt the agent's context cannot hold: Claude's adapter says so in words, sometimes as an invalid request; Gemini's
 * API as "The input token count (N) exceeds the maximum number of tokens allowed (M)".
 */
const OVERFLOW = /prompt is too long|context (length|window)|maximum context|too many tokens|exceeds? the (model's )?context|input token count .{0,40}exceeds the maximum number of tokens/i;
/** An account without credit: the API says so as an invalid request, and nothing sent again can pass until it has. */
const NO_CREDIT = /credit balance/i;

/** @type {Record<string, FailureKind>} */
const BY_ERROR_KIND = {
  authentication_failed: "auth",
  oauth_org_not_allowed: "auth",
  account_on_hold: "auth",
  billing_error: "auth",
  // Cursor's SDK on a plan its Cloud Agent is not in (TinyQuest's of 11-18): never tried again, until the plan changes.
  plan_required: "auth",
  rate_limit: "limit",
  overloaded: "limit",
  invalid_request: "refusal",
  model_not_found: "refusal",
  max_output_tokens: "overflow",
  server_error: "transport",
  transport_lost: "transport",
  worker_shutdown: "transport",
  no_result: "transport",
  // Codex's (its app-server's `codexErrorInfo`).
  contextWindowExceeded: "overflow",
  usageLimitExceeded: "limit",
  rateLimitExceeded: "limit",
  serverOverloaded: "limit",
  sessionBudgetExceeded: "limit",
  unauthorized: "auth",
  badRequest: "refusal",
  cyberPolicy: "refusal",
  misalignmentPolicyViolation: "refusal",
  sandboxError: "refusal",
  activeTurnNotSteerable: "refusal",
  internalServerError: "transport",
  httpConnectionFailed: "transport",
  responseStreamConnectionFailed: "transport",
  responseStreamDisconnected: "transport",
  responseTooManyFailedAttempts: "transport",
  threadRollbackFailed: "transport",
  // Filament's own: a turn the agent cannot serve as asked — an agent that takes no MCP server, asked to lead a team.
  filament_unfit: "refusal",
};

/** ACP's JSON-RPC codes that say what failed: -32000 asks for a login; the others refuse the request as sent. */
/** @type {Record<number, FailureKind>} */
const BY_CODE = { [-32000]: "auth", [-32600]: "refusal", [-32601]: "refusal", [-32602]: "refusal", [-32002]: "refusal" };

/** A sign-in the agent asks for, in its words. */
const SIGN_IN_WORDS = /authenticat|not (logged|signed) in|please run \/login|unauthori[sz]ed|invalid api key/i;

/** @type {[RegExp, FailureKind][]} */
const BY_WORDS = [
  [SIGN_IN_WORDS, "auth"],
  [/rate.?limit|usage limit|too many requests|overloaded|quota|limit (reached|exceeded)|hit your .*limit/i, "limit"],
  [/content (policy|filter)|invalid request/i, "refusal"],
  [/timed out|timeout/i, "timeout"],
];

/** Whether each kind may be sent again as it was, and whether it cools the agent down. */
/** @type {Record<FailureKind, { retryable: boolean, cools: boolean }>} */
const WEIGHT = {
  auth: { retryable: false, cools: true },
  limit: { retryable: true, cools: true },
  refusal: { retryable: false, cools: false },
  overflow: { retryable: false, cools: false },
  timeout: { retryable: true, cools: true },
  transport: { retryable: true, cools: true },
};

/** An overflow's own numbers: the most tokens the agent's context takes, and what it counted in the prompt. */
const SAID_MAX = [/maximum number of tokens allowed \(([\d,_]+)\)/i,/>\s*([\d,_]+)\s*(?:tokens?\s*)?maximum/i, /maximum context (?:length|window)(?: is| of)?\s*([\d,_]+)/i, /context (?:window|length)(?: limit)?(?: is| of)\s*([\d,_]+)/i];
const SAID_COUNTED = [/input token count \(([\d,_]+)\)/i,/([\d,_]+)\s*tokens?\s*>/i, /requested\s*([\d,_]+)\s*tokens/i, /resulted in\s*([\d,_]+)\s*tokens/i];

/**
 * What an agent's overflow says in numbers, where it does (HarnessV4_Tasks B5): the most tokens its context takes
 * (`max`) and how many it counted in the prompt it refused (`counted`) — "Prompt is too long: 212000 tokens > 200000
 * maximum", "maximum context length is 128000 tokens. However, you requested 150000 tokens". Null for each it leaves
 * unsaid.
 * @param {any} e
 * @returns {{ max: number | null, counted: number | null }}
 */
export function overflowSaid(e) {
  const words = `${e?.message || ""} ${typeof e?.data?.details === "string" ? e.data.details : ""}`;
  /** @param {RegExp[]} ways */
  const read = (ways) => {
    for (const re of ways) {
      const n = Number(String(re.exec(words)?.[1] ?? "").replace(/[,_]/g, ""));
      if (n > 0) return n;
    }
    return null;
  };
  return { max: read(SAID_MAX), counted: read(SAID_COUNTED) };
}

/** Claude Code's words for its own compaction refilling the context turn after turn (2.1.300: "Autocompact is thrashing: …"). */
const THRASH = /autocompact is thrashing/i;

/**
 * A coding agent that stopped because the context it compacted filled up again within a few turns, time after time
 * (the owner's of 11-10, Fable52: Claude Code, handed a line of 80,000 tokens, 40% of its 200K window, compacted three
 * times in three turns and failed, telling the person to /clear, which no chat of Filament's has): Filament's words,
 * the point it makes room at (the line it was handed, or the least it takes) and its share of the agent's window, and —
 * on a chat's turn, whose line is the person's — how to raise it. The agent's own words go under them. Null for any other failure.
 * @param {any} e
 * @param {{ who: string, line?: number | null, window?: number | null, chat?: boolean }} o
 * @returns {{ said: string, detail: string } | null}
 */
export function thrashWords(e, { who, line = null, window = null, chat = true }) {
  const words = `${e?.message || ""} ${typeof e?.data?.details === "string" ? e.data.details : ""}`.trim();
  if (!THRASH.test(words)) return null;
  const n = (/** @type {number} */ v) => v.toLocaleString("en-US");
  const w = Number(window) > 0 ? Number(window) : 0;
  const l = Number(line) > 0 ? Number(line) : 0;
  const share = l && w ? `, ${Math.round((l / w) * 100)}% of its ${n(w)}-token window` : "";
  const head = `${who} stopped: it compacted its context again and again, and each time it filled up again within a few turns.`;
  const said = l
    ? `${head} It makes room at ${n(l)} tokens${share}: what this work reads after a compaction doesn't fit under that.${chat ? ` Raise Your line in the Context popover${w && w < 1_000_000 ? ", or pick the model in a larger window" : ""}, then send again.` : ""}`
    : `${head} A file it read or a tool's output is likely too large for its window: ask for the work in smaller parts.`;
  return { said, detail: `${who} said: ${words}` };
}

/**
 * An agent's error kind: ACP's `errorKind`, the code an SDK's error carries (Cursor's `plan_required`), or the one its
 * words open with ("[plan_required] …", as Cursor's SDK writes them) — the first of them `known` takes, so a code no
 * reader knows never hides one it does; else the first there is; "" for none.
 * @param {any} e @param {(kind: string) => boolean} known
 */
export function errorKindOf(e, known) {
  const words = `${e?.message || ""}`.trim();
  const said = [typeof e?.data?.errorKind === "string" ? e.data.errorKind : "", typeof e?.code === "string" && /^[a-z][a-z0-9_]*$/i.test(e.code) ? e.code : "", /^\[([a-z][a-z0-9_]*)\]/i.exec(words)?.[1] || ""].filter(Boolean);
  return said.find(known) || said[0] || "";
}

/**
 * The failure an agent's error is; one with nothing to read it by is transport: a process that died, a pipe that broke.
 * @param {any} e
 * @returns {Failure}
 */
export function classifyFailure(e) {
  const errorKind = errorKindOf(e, (k) => Object.hasOwn(BY_ERROR_KIND, k));
  const words = `${e?.message || ""} ${typeof e?.data?.details === "string" ? e.data.details : ""}`;
  /** @type {FailureKind} */
  const kind = OVERFLOW.test(words)
    ? "overflow"
    : NO_CREDIT.test(words)
      ? "auth"
      : (Object.hasOwn(BY_ERROR_KIND, errorKind) ? BY_ERROR_KIND[errorKind] : undefined) ||
        (typeof e?.code === "number" && BY_CODE[e.code]) ||
        BY_WORDS.find(([re]) => re.test(words))?.[1] ||
        "transport";
  return { kind, ...WEIGHT[kind] };
}

/** The error kinds that say nobody is signed in: Claude's adapter's and Codex's. */
const SIGNED_OUT_KINDS = new Set(["authentication_failed", "unauthorized"]);

/**
 * Whether an agent's error says nobody is signed in to it (the owner's of 10-30: the picker offers an agent only while
 * someone is): an error kind of a sign-in refused, else ACP's code that asks for one, else the agent's words asking for
 * one. Never an account without credit, a plan spent, a session or a file it may not open: someone is signed in there.
 * @param {any} e
 */
export function saysSignedOut(e) {
  const errorKind = typeof e?.data?.errorKind === "string" ? e.data.errorKind : "";
  if (errorKind) return SIGNED_OUT_KINDS.has(errorKind);
  const words = `${e?.message || ""} ${typeof e?.data?.details === "string" ? e.data.details : ""}`;
  if (NO_CREDIT.test(words)) return false;
  return e?.code === -32000 || SIGN_IN_WORDS.test(words);
}

/** The error kinds of an account someone is signed in to whose plan or credit refuses the work. */
const REFUSED_PLAN_KINDS = new Set(["billing_error", "plan_required"]);

/**
 * Whether an agent's error is a sign-in failure only by its weight: someone is signed in, and the account's credit or
 * plan refuses the work — no credit, Cursor's free plan asked for its Cloud Agent (the review of 11-19). Its banner
 * keeps its own words, where a login refused says nobody is signed in beside its Sign in.
 * @param {any} e
 */
export function saysPlanRefused(e) {
  const words = `${e?.message || ""} ${typeof e?.data?.details === "string" ? e.data.details : ""}`;
  return NO_CREDIT.test(words) || REFUSED_PLAN_KINDS.has(errorKindOf(e, (k) => REFUSED_PLAN_KINDS.has(k)));
}

/**
 * What a coding agent's failure says of its account (TG2-D54), or null where it is not the account's: a prompt it
 * refused, or one too long for its context. A limit while the account's plan has a spent window is an out until that
 * window resets; else the agent's error kind and words are read as a provider's are (core/provider-cause.js); what
 * they leave unsaid goes by the failure's kind — a sign-in an account, a limit a rate, a process or pipe that broke a
 * busy. Its error kind as `errorKindOf` reads it, the first a provider's cause knows.
 * @param {any} e
 * @param {{ spent?: boolean, freeAt?: number | null } | null} [account]  the agent's account as its store reads it now
 * @returns {import("../../../core/provider-cause.js").Cause | null}
 */
export function agentCause(e, account = null) {
  const f = classifyFailure(e);
  if (f.kind === "refusal" || f.kind === "overflow") return null;
  if (f.kind === "limit" && account?.spent) return { kind: "out", resets: account.freeAt ?? null };
  const words = `${e?.message || ""} ${typeof e?.data?.details === "string" ? e.data.details : ""}`.trim();
  const type = errorKindOf(e, (k) => typeCause(k) != null) || null;
  const read = providerCause({ status: null, type, said: words, network: f.kind === "transport" || f.kind === "timeout" });
  if (read) return read;
  return f.kind === "auth" ? { kind: "account", resets: null } : f.kind === "limit" ? { kind: "rate", resets: null } : { kind: "busy", resets: null };
}
