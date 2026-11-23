// @ts-check
// HarnessV3-ACP AC3-6: whose plan a coding agent's turns spend and how much of it is left, as the agent itself says
// it. The readers that take each agent's words into one shape (core/agent-limits.js); the store that keeps them per
// upstream with each window's state and pace (services/agent-accounts.js); the words every page says them in
// (ui/lib/accounts.js); what a turn its plan stopped keeps (turn-facts' `planLimit`); the routes, Check now, a plan's
// windows and its end through the whole app against the fake agents (Claude's adapter, Codex's app-server, Cursor's
// SDK), /status and the doctor; and the pages on a recording DOM — the Account instrument, the limit card, the
// picker's tabs and Home → Health's cards.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs, { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  accountRecord, chatgptPlan, claudeExtra, claudeIdentity, claudeUsageExtra, claudeUsageWindows, claudeWindow, codexCredits, codexIdentity,
  codexMain, codexResetCredits, codexWindows, cursorIdentity, mergeWindows, SAME_PERIOD_MS, sameIdentity,
} from "../src/core/agent-limits.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { RpcProcess } from "../src/adapters/agents/agent-process.js";
import { createAgentAccounts } from "../src/services/agent-accounts.js";
import { foldTurnFacts, planLimit } from "../src/core/turn-facts.js";
import {
  accountName, alternativesOf, awayKeys, checkWords, extraWords, followAccounts, freeWords, gaugeOf, glanceOf, hasRoom,
  limitWords, maskEmail, noticeOf, notYetWords, othersOf, paceWords, percentWords, putAway, reachedWords, resetOutcomeWords,
  resetWords, summaryWords, toneOf, untilWords, whenWords, windowName, windowTag,
} from "../src/ui/lib/accounts.js";
import { accountWidget } from "../src/ui/harness/widgets/account.js";
import { limitCard } from "../src/ui/harness/conversation/interaction.js";
import { sourcePlan } from "../src/ui/harness/composer/model.js";
import { bindUi, state as uiState } from "../src/ui/runtime.js";
import { overview } from "../src/ui/pages/home.js";
import { HOME_PANES } from "../src/ui/nav.js";
import { fmt } from "../src/ui/lib/format.js";
import { runDoctor } from "../src/cli/doctor.js";
import { defaultConfig } from "../src/config.js";
import { startApp, FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), "utf8");
const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
const FAKE_SDK = pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Every reaction already set off has run: the promise chains a page or a store starts. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** @type {any} */
const MAX = { kind: "account", label: "Claude Max", plan: "max", email: "dev@example.com", organization: "Example Org", detail: null, billing: "plan" };
/** @type {any} */
const PLUS = { kind: "account", label: "ChatGPT Plus", plan: "plus", email: "dev@example.com", organization: null, detail: null, billing: "plan" };
/** @type {any} */
const NONE = { kind: "none", label: "Not signed in", plan: null, email: null, organization: null, detail: null, billing: null };
/** @type {any} */
const KEY = { kind: "api-key", label: "Anthropic API key", plan: null, email: null, organization: null, detail: "env", billing: "metered" };

/**
 * A window as an agent reports it: Claude's 5-hour by default.
 * @param {string} id @param {number | null} usedPercent @param {number | null} resetsAt @param {Record<string, any>} [more]
 * @returns {any}
 */
const win = (id, usedPercent, resetsAt, more = {}) => ({ id, kind: "session", label: "5-hour", usedPercent, resetsAt, windowMins: 300, status: null, ...more });
/** Claude's weekly window. @param {number | null} usedPercent @param {number | null} resetsAt @param {Record<string, any>} [more] */
const weekly = (usedPercent, resetsAt, more = {}) => win("seven_day", usedPercent, resetsAt, { kind: "weekly", label: "Weekly", windowMins: 10080, ...more });

/**
 * An agent's row as the server says it: its account read out of a store, at `now`, after these reports.
 * @param {number} now @param {any[]} reports @param {Record<string, any>} [o]
 * @returns {any}
 */
const rowAt = (now, reports, o = {}) => {
  const upstream = o.upstream || "claude";
  const s = createAgentAccounts({ now: () => now });
  for (const r of reports) s.report(upstream, r);
  // An account as the server's rows carry it (app/agent-logins.js `state`): its agent's Default, signed in by its CLI.
  const signIn = { agentName: o.name || "Claude", label: "Default", added: false, home: null, style: null, oneAccount: null, ways: [], signsOut: false, signingIn: null, lastSignIn: null };
  return { upstream, name: "Claude", type: "acp", agent: "claude-code", says: true, login: "claude auth login", ...signIn, ...o, account: s.view(upstream) };
};

describe("an agent's account in one shape (core/agent-limits.js)", () => {
  test("Claude's sign-in as its adapter says it: each kind, its plan and email; silence or a kind it doesn't know is no word", () => {
    assert.deepEqual(claudeIdentity({ kind: "account", label: "Claude Max", account: { plan: "max", email: "dev@example.com", organization: "Example Org" } }), MAX);
    assert.deepEqual(claudeIdentity({ kind: "api_key", label: "Anthropic API key", detail: "env" }), KEY);
    assert.deepEqual(claudeIdentity({ kind: "gateway", label: "Company gateway", detail: "gw.example.com" }), { kind: "gateway", label: "Company gateway", plan: null, email: null, organization: null, detail: "gw.example.com", billing: null });
    assert.equal(claudeIdentity({ kind: "external" })?.label, "external", "a label it didn't say is its kind");
    assert.deepEqual(["account", "api_key", "external", "gateway", "none"].map((kind) => claudeIdentity({ kind })?.billing), ["plan", "metered", "metered", null, null], "how each kind of login pays: a gateway's is its own business");
    assert.deepEqual(claudeIdentity({ kind: "none" }), NONE);
    for (const silent of [null, undefined, {}, { kind: "oauth" }]) assert.equal(claudeIdentity(silent), null);
  });

  test("a key from outside the account holds it, in words for its card: Filament's environment's or Claude Code's settings'; a Console sign-in's holds nothing (HarnessV3-ACP AF1)", () => {
    /** @param {string} detail */
    const key = (detail) => /** @type {any} */ (claudeIdentity({ kind: "api_key", label: "Anthropic API key", detail }));
    assert.match(key("ANTHROPIC_API_KEY").held, /^Runs on the ANTHROPIC_API_KEY Filament was started with\. .*signing in or out here changes nothing/);
    assert.match(key("apiKeyHelper").held, /^Runs on the key Claude Code's own settings make \(apiKeyHelper\)\./);
    assert.equal("held" in key("/login managed key"), false, "signing out ends a Console sign-in's key");
    assert.equal("held" in key("env"), false, "a source it doesn't know claims nothing");
    assert.equal("held" in /** @type {any} */ (claudeIdentity({ kind: "account", label: "Claude Max", account: { plan: "max" } })), false);
  });

  // claude-agent-acp 0.93 names a key Claude Code's settings make "API key helper" (its auth-status.js
  // API_KEY_SOURCE_DETAILS), not by the setting's name: such an account's card said nothing of what holds it.
  // (fails before: yes — only the setting's own name was known)
  test("a key Claude Code's settings make holds the account under the adapter's word for it too", () => {
    /** @param {string} detail */
    const key = (detail) => /** @type {any} */ (claudeIdentity({ kind: "api_key", label: "Anthropic API key", detail }));
    assert.match(String(key("API key helper").held), /^Runs on the key Claude Code's own settings make \(apiKeyHelper\)\./);
    assert.equal(key("API key helper").held, key("apiKeyHelper").held);
  });

  test("Claude's windows: the share from a fraction to a tenth, kept within 0–100; the reset from seconds; its word", () => {
    assert.deepEqual(claudeWindow({ rateLimitType: "five_hour", utilization: 0.4217, resetsAt: 1791400000, status: "allowed" }), { id: "five_hour", kind: "session", label: "5-hour", windowMins: 300, usedPercent: 42.2, resetsAt: 1791400000000, status: "allowed" });
    assert.deepEqual(claudeWindow({ rateLimitType: "seven_day_opus", utilization: 1.3, status: "allowed_warning" }), { id: "seven_day_opus", kind: "weekly", label: "Weekly · Opus", windowMins: 10080, usedPercent: 100, resetsAt: null, status: "warning" });
    const extra = claudeWindow({ rateLimitType: "overage", status: "rejected" });
    assert.deepEqual([extra?.label, extra?.usedPercent, extra?.status, extra?.windowMins], ["Extra usage", null, "rejected", null]);
    assert.equal(claudeWindow({ rateLimitType: "seven_day", utilization: "0.5" })?.usedPercent, null, "a share that is no number is unsaid");
    // (fails before: no — a guard the mutation pass asked for: no share below nothing was said)
    assert.equal(claudeWindow({ rateLimitType: "five_hour", utilization: -0.2 })?.usedPercent, 0, "a share below nothing is none");
    // A window this reader doesn't know draws no row a later report could never land on.
    for (const odd of [{}, { rateLimitType: "hourly" }, { rateLimitType: "toString" }, { rateLimitType: "__proto__" }]) assert.equal(claudeWindow(odd), null);
  });

  test("Claude's extra usage: in use or not, its word and reset, why it is off; nothing where it said nothing of it", () => {
    assert.equal(claudeExtra({ rateLimitType: "five_hour", utilization: 0.1 }), null);
    assert.deepEqual(claudeExtra({ isUsingOverage: true, overageStatus: "allowed_warning", overageResetsAt: 1791400000 }), { using: true, status: "warning", resetsAt: 1791400000000, off: null });
    assert.deepEqual(claudeExtra({ overageStatus: "rejected", overageDisabledReason: "out_of_credits" }), { using: false, status: "rejected", resetsAt: null, off: "out_of_credits" });
    // (fails before: no — a guard the mutation pass asked for: Claude always said its extra usage's state)
    assert.deepEqual(claudeExtra({ isUsingOverage: false }), { using: false, status: null, resetsAt: null, off: null });
    assert.deepEqual(claudeExtra({ overageDisabledReason: "org_level_disabled" }), { using: false, status: null, resetsAt: null, off: "org_level_disabled" });
  });

  test("Claude's /usage report: every row of its plan at any level, on the window the rate-limit info names; its percent as it comes, its reset to the second, the server's grading its word", () => {
    /** @param {string} kind @param {number} percent @param {string | null} resets_at @param {Record<string, any>} [more] */
    const row = (kind, percent, resets_at, more = {}) => ({ kind, group: kind === "session" ? "session" : "weekly", percent, resets_at, scope: null, severity: "normal", is_active: false, ...more });
    /** @param {string} name */
    const model = (name) => ({ scope: { model: { display_name: name }, surface: null } });
    // The first two rows as Claude Code (SDK 0.3.287) sent them for a Max login on 2026-10-10; then a week each of Opus,
    // Sonnet and Fable.
    const report = {
      session: { total_cost_usd: 0 },
      rate_limits: {
        limits: [
          row("session", 7, "2026-10-09T21:49:59.763133+00:00", { is_active: true }),
          row("weekly_all", 43, "2026-10-14T16:59:59.763202+00:00", { severity: "warning" }),
          row("weekly_scoped", 12.34, "2026-10-14T17:00:00+00:00", model("Opus")),
          row("weekly_scoped", 0, "2026-10-14T17:00:00+00:00", { ...model(" Sonnet "), severity: "critical" }),
          row("weekly_scoped", 3, null, model(" Fable ")),
        ],
        extra_usage: null,
      },
    };
    const weekEnd = Date.UTC(2026, 9, 14, 17);
    assert.deepEqual(claudeUsageWindows(report), [
      { id: "five_hour", kind: "session", label: "5-hour", windowMins: 300, usedPercent: 7, resetsAt: Date.UTC(2026, 9, 9, 21, 50), status: "allowed" },
      { id: "seven_day", kind: "weekly", label: "Weekly", windowMins: 10080, usedPercent: 43, resetsAt: weekEnd, status: "warning" },
      { id: "seven_day_opus", kind: "weekly", label: "Weekly · Opus", windowMins: 10080, usedPercent: 12.3, resetsAt: weekEnd, status: "allowed" },
      { id: "seven_day_sonnet", kind: "weekly", label: "Weekly · Sonnet", windowMins: 10080, usedPercent: 0, resetsAt: weekEnd, status: "warning" },
      { id: "seven_day_overage_included", kind: "weekly", label: "Weekly · Fable", windowMins: 10080, usedPercent: 3, resetsAt: null, status: "allowed" },
    ]);
    // The 5-hour as a rate-limit event says it after, its reset in whole seconds and no share: one period, so the
    // share /usage read stands.
    const [five] = claudeUsageWindows(report);
    const heard = /** @type {any} */ (claudeWindow({ rateLimitType: "five_hour", status: "allowed", resetsAt: Date.UTC(2026, 9, 9, 21, 50) / 1000 }));
    assert.deepEqual(mergeWindows([five], [heard]).map((w) => [w.usedPercent, w.resetsAt]), [[7, five.resetsAt]]);
  });

  test("a /usage report draws nothing it can't place: no rate limits, a surface's row, a kind it doesn't know, a share that is no number; a window's second row", () => {
    for (const none of [null, undefined, {}, { rate_limits: null }, { rate_limits: { limits: null } }]) assert.deepEqual(claudeUsageWindows(none), []);
    const odd = [
      { kind: "session", percent: 5, resets_at: null, scope: { model: null, surface: { display_name: "Claude Code" } } },
      { kind: "session", percent: 5, resets_at: null, scope: { model: { display_name: "Opus" }, surface: null } },
      { kind: "weekly_all", percent: 5, resets_at: null, scope: { model: { display_name: "Opus" }, surface: null } },
      { kind: "weekly_scoped", percent: 5, resets_at: null, scope: null },
      { kind: "monthly", percent: 5, resets_at: null, scope: null },
      { kind: "monthly_scoped", percent: 5, resets_at: null, scope: { model: { display_name: "Opus" }, surface: null } },
      { kind: "session", percent: "5", resets_at: null, scope: null },
      { kind: "session", percent: Number.NaN, resets_at: null, scope: null },
      null,
    ];
    assert.deepEqual(claudeUsageWindows({ rate_limits: { limits: odd } }), []);
    const twice = claudeUsageWindows({ rate_limits: { limits: [{ kind: "session", percent: 10, resets_at: "soon", severity: "toString" }, { kind: "session", percent: 20, resets_at: null, severity: "normal" }] } });
    assert.deepEqual(twice.map((w) => [w.id, w.usedPercent, w.resetsAt, w.status]), [["five_hour", 10, null, null]], "the first row stands; a reset that is no time and a grading it doesn't know are unsaid");
    assert.equal(claudeUsageWindows({ rate_limits: { limits: [{ kind: "session", percent: 140 }] } })[0].usedPercent, 100, "kept within 0–100");
  });

  // (fails before: yes — nothing read /usage's extra usage: a plan spending past its windows never said what it cost)
  test("Claude's extra usage as its /usage report says it: whether it can cover sends, its spend and monthly limit in minor units, its currency; nothing where the report says nothing of it", () => {
    /** @param {any} extra_usage */
    const report = (extra_usage) => ({ rate_limits: { limits: [], extra_usage } });
    // As Claude Code sent it for a Team login on 2026-10-10, its 5-hour window spent; then a Max login's organization's.
    assert.deepEqual(claudeUsageExtra(report({ is_enabled: true, monthly_limit: null, used_credits: 22248, utilization: null, currency: "USD" })), { enabled: true, spent: 22248, limit: null, currency: "USD" });
    assert.deepEqual(claudeUsageExtra(report({ is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null })), { enabled: false, spent: null, limit: null, currency: null });
    assert.deepEqual(claudeUsageExtra(report({ is_enabled: true, monthly_limit: 50000, used_credits: 1250, utilization: 2.5, currency: " EUR " })), { enabled: true, spent: 1250, limit: 50000, currency: "EUR" });
    assert.deepEqual(claudeUsageExtra(report({ is_enabled: true, monthly_limit: Number.NaN, used_credits: "12", currency: "" })), { enabled: true, spent: null, limit: null, currency: null }, "a figure that is no number, and a currency that is none, are unsaid");
    for (const none of [null, undefined, {}, { rate_limits: null }, { rate_limits: { limits: [] } }, report(null), report({ is_enabled: "yes" })]) assert.equal(claudeUsageExtra(none), null);
  });

  test("ChatGPT's plans by Codex's id; who Codex runs as: its account, a key, another login, nobody, or its provider", () => {
    assert.deepEqual(["plus", "prolite", "self_serve_business_usage_based", "unknown", "", null].map(chatgptPlan), ["Plus", "Pro Lite", "Self Serve Business Usage Based", null, null, null]);
    const bare = { plan: null, email: null, organization: null, detail: null, billing: null };
    assert.deepEqual(codexIdentity({ type: "chatgpt", email: "dev@example.com", planType: "pro" }, true), { kind: "account", label: "ChatGPT Pro", plan: "pro", email: "dev@example.com", organization: null, detail: null, billing: "plan" });
    assert.deepEqual(codexIdentity({ type: "apiKey" }, true), { kind: "api-key", label: "OpenAI API key", ...bare, billing: "metered" });
    assert.deepEqual(codexIdentity({ type: "amazonBedrock" }, true), { kind: "external", label: "Amazon Bedrock", ...bare, billing: "metered" });
    assert.deepEqual(codexIdentity({ type: "vertex" }, true), { kind: "external", label: "vertex", ...bare }, "a login this reader doesn't know: named as Codex names it, how it pays unsaid");
    assert.deepEqual(codexIdentity(null, true), NONE);
    assert.deepEqual(codexIdentity(null, false), { kind: "external", label: "Codex's configured provider", ...bare, detail: "no sign-in needed" });
    assert.equal(codexIdentity({ type: "chatgpt", planType: "unknown" }, true).label, "ChatGPT", "a plan Codex can't tell is left unnamed");
  });

  test("Codex's windows: the main allowance's positions, named by their length; a model's own allowance is never the plan's", () => {
    const main = { limitId: "codex", planType: "plus", primary: { usedPercent: 12.34, windowDurationMins: 300, resetsAt: 1791400000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1791900000 } };
    const model = { limitId: "gpt-6-astra", primary: { usedPercent: 90, windowDurationMins: 300 } };
    assert.equal(codexMain({ rateLimitsByLimitId: { codex: main, "gpt-6-astra": model }, rateLimits: model }), main, "the by-limit view's own first");
    assert.equal(codexMain({ rateLimits: main }), main, "else the single view an older Codex sends");
    assert.equal(codexMain(null), null);
    assert.deepEqual(codexWindows(main), [
      { id: "primary", kind: "session", label: "5-hour", usedPercent: 12.3, resetsAt: 1791400000000, windowMins: 300, status: null },
      { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 40, resetsAt: 1791900000000, windowMins: 10080, status: null },
    ]);
    assert.deepEqual(codexWindows(model), []);
    // Where Codex names no length: a paid plan's are the 5-hour and the weekly, a free plan's one monthly.
    assert.deepEqual(codexWindows({ planType: "plus", primary: { usedPercent: 5 }, secondary: { usedPercent: 6 } }).map((w) => [w.label, w.windowMins]), [["5-hour", null], ["Weekly", null]]);
    assert.deepEqual(codexWindows({ planType: "free", primary: { usedPercent: 5 } }).map((w) => [w.kind, w.label]), [["monthly", "Monthly"]]);
    // (fails before: no — a guard the mutation pass asked for: no Go plan's windows were read, and none shorter than
    // half an hour)
    assert.deepEqual(codexWindows({ planType: "go", primary: { usedPercent: 5 } }).map((w) => [w.kind, w.label]), [["monthly", "Monthly"]]);
    const named = (/** @type {number} */ mins) => codexWindows({ primary: { usedPercent: 5, windowDurationMins: mins } })[0].label;
    assert.deepEqual([20, 30, 60, 1440, 2880, 10080, 43200].map(named), ["1-hour", "1-hour", "1-hour", "24-hour", "2-day", "Weekly", "Monthly"]);
    assert.deepEqual(codexWindows({ primary: { usedPercent: "5" }, secondary: { usedPercent: NaN } }), [], "a share that is no number is no window");
  });

  test("Codex's credits and reset credits as it says them; nothing where it said nothing", () => {
    assert.deepEqual(codexCredits({ credits: { hasCredits: true, unlimited: false, balance: "12.50" } }), { has: true, unlimited: false, balance: "12.50" });
    assert.deepEqual(codexCredits({ credits: { hasCredits: false, balance: "" } }), { has: false, unlimited: false, balance: null });
    assert.equal(codexCredits({ credits: null }), null);
    const credits = [{ status: "available", expiresAt: 1792000000 }, { status: "available", expiresAt: 1791000000 }, { status: "consumed", expiresAt: 1790000000 }];
    assert.deepEqual(codexResetCredits({ availableCount: 2, credits }), { available: 2, nextExpiresAt: 1791000000000 }, "the soonest of the available ones");
    assert.deepEqual(codexResetCredits({ availableCount: 1.7 }), { available: 1, nextExpiresAt: null });
    assert.deepEqual(codexResetCredits({ availableCount: -3 }), { available: 0, nextExpiresAt: null });
    for (const none of [null, {}, { availableCount: "some" }]) assert.equal(codexResetCredits(none), null);
  });

  test("Cursor's key and its owner", () => {
    assert.deepEqual(cursorIdentity({ apiKeyName: "work", userEmail: "dev@example.com" }), { kind: "api-key", label: "Cursor API key “work”", plan: null, email: "dev@example.com", organization: null, detail: "work", billing: "plan" });
    assert.deepEqual(cursorIdentity({}), { kind: "api-key", label: "Cursor API key", plan: null, email: null, organization: null, detail: null, billing: "plan" });
    assert.equal(cursorIdentity(null), null);
  });

  test("the same login: an account by its email, a key by its name and its owner, any other kind by its kind", () => {
    const acct = (/** @type {string | null} */ email) => ({ ...MAX, email });
    const key = (/** @type {string | null} */ detail, /** @type {string | null} */ email = null) => ({ ...KEY, detail, email });
    assert.equal(sameIdentity(acct("a@x"), acct("a@x")), true);
    assert.equal(sameIdentity(acct("a@x"), acct("b@x")), false);
    assert.equal(sameIdentity(key("work", "a@x"), key("work", "a@x")), true);
    assert.equal(sameIdentity(key("work", "a@x"), key("home", "a@x")), false);
    assert.equal(sameIdentity(key("work", "a@x"), key("work", "b@x")), false, "one key name, two owners");
    assert.equal(sameIdentity(acct("a@x"), key(null)), false);
    assert.equal(sameIdentity(NONE, { ...NONE }), true);
    assert.equal(sameIdentity(null, acct("a@x")), false);
  });

  test("windows folded in by id: what an update leaves out is kept, and a new share drops the old word", () => {
    const known = [win("primary", 12, 1000, { label: "2-hour", windowMins: 120, status: "warning" }), weekly(40, 5000)];
    // Codex's sparse update: a share, no length (read as a paid plan's 5-hour) and no reset.
    const [primary, week, fresh] = mergeWindows(known, [win("primary", 55, null, { windowMins: null }), win("extra", 3, null)]);
    assert.deepEqual(primary, { id: "primary", kind: "session", label: "2-hour", usedPercent: 55, resetsAt: 1000, windowMins: 120, status: null });
    assert.equal(week, known[1], "a window not heard is kept as it was");
    assert.equal(fresh.id, "extra", "a new one goes last");
    const [refused] = mergeWindows(known, [win("primary", null, null, { status: "rejected" })]);
    assert.deepEqual([refused.usedPercent, refused.status], [12, "rejected"], "a word without a share keeps the share");
    const [quiet] = mergeWindows(known, [win("primary", null, null)]);
    assert.equal(quiet.status, "warning", "nothing new said: the old word stands");
  });

  test("a report of another period keeps neither the old share nor the old word; a reset a little off is the same period's", () => {
    const R = 10 * HOUR;
    const known = [win("five_hour", 85, R, { status: "warning" })];
    // Claude's first word of the next period: its reset and its status, and no share.
    const [next] = mergeWindows(known, [win("five_hour", null, R + 5 * HOUR, { status: "allowed" })]);
    assert.deepEqual([next.usedPercent, next.status, next.resetsAt], [null, "allowed", R + 5 * HOUR]);
    const [quiet] = mergeWindows(known, [win("five_hour", null, R + 5 * HOUR)]);
    assert.deepEqual([quiet.usedPercent, quiet.status], [null, null], "nothing said of the new period: nothing kept of the old");
    const [same] = mergeWindows(known, [win("five_hour", null, R + SAME_PERIOD_MS)]);
    assert.deepEqual([same.usedPercent, same.status], [85, "warning"], "a reset that moved two minutes is the same period's");
  });

  test("an account as a turn's record keeps it: its own copies, and only what was said", () => {
    const windows = [win("five_hour", 42, 1000)];
    const rec = accountRecord(MAX, windows, 7, { credits: { has: true, unlimited: false, balance: "5" }, reached: "rate_limit_reached", extra: null });
    assert.deepEqual(rec, { ...MAX, windows, credits: { has: true, unlimited: false, balance: "5" }, reached: "rate_limit_reached", at: 7 });
    assert.notEqual(rec.windows[0], windows[0], "a copy: the bridge's own moves on");
    assert.deepEqual(Object.keys(accountRecord(KEY, [], 1)).sort(), [...Object.keys(KEY), "at", "windows"].sort());
  });
});

describe("the store of the agents' accounts (services/agent-accounts.js)", () => {
  const T0 = Date.UTC(2026, 9, 8, 9, 0, 0);
  /** A store on a clock the test moves, and what it logged. @param {{ file?: string }} [o] */
  const clocked = (o = {}) => {
    const clock = { t: T0 };
    /** @type {[string, string][]} */
    const logs = [];
    const s = createAgentAccounts({ now: () => clock.t, log: (level, msg) => logs.push([level, msg]), ...o });
    return { s, clock, logs };
  };
  /** The store's view of an upstream, which the test knows is there. @param {any} s @param {string} id @returns {any} */
  const viewOf = (s, id) => s.view(id);

  test("each window's state: reset once its time has passed, spent at 100 % or at the agent's refusal, warning from 80 % or at its word", () => {
    const { s } = clocked();
    s.report("cl", {
      source: "x",
      identity: MAX,
      windows: [win("a", 100, T0 - 1), win("b", 100, T0 + 1), win("c", 3, null, { status: "rejected" }), win("d", 80, null), win("e", null, null, { status: "warning" }), win("f", 79.9, null)],
    });
    assert.deepEqual(viewOf(s, "cl").windows.map((/** @type {any} */ w) => w.state), ["reset", "spent", "spent", "warning", "warning", "ok"]);
  });

  test("a window's next period reads as the agent says it, never with the last period's share", () => {
    const { s, clock } = clocked();
    s.report("cl", { source: "_auth/status_update", identity: MAX });
    s.report("cl", { source: "rate_limit_event", windows: [win("five_hour", 85, T0 + HOUR, { status: "warning" })] });
    assert.equal(viewOf(s, "cl").windows[0].state, "warning");
    clock.t = T0 + 2 * HOUR;
    // The next period's first word: Claude names its reset and says it is allowed, with no share.
    s.report("cl", { source: "usage_update", windows: [win("five_hour", null, T0 + 6 * HOUR, { status: "allowed" })] });
    const [w] = viewOf(s, "cl").windows;
    assert.deepEqual([w.usedPercent, w.state, w.resetsAt], [null, "ok", T0 + 6 * HOUR], "not the old period's 85 % in amber");
  });

  test("what it reads out: the fullest window, whether the plan is spent and when it is free again; a reset window is past", () => {
    const { s, clock } = clocked();
    s.report("cl", { source: "_auth/status_update", identity: MAX });
    s.report("cl", { source: "usage_update", windows: [win("five_hour", 42, T0 + 2 * HOUR)] });
    s.report("cl", { source: "rate_limit_event", windows: [weekly(85, T0 + 72 * HOUR)] });
    let v = viewOf(s, "cl");
    assert.deepEqual(v.windows.map((/** @type {any} */ w) => [w.id, w.state, w.source]), [["five_hour", "ok", "usage_update"], ["seven_day", "warning", "rate_limit_event"]]);
    assert.deepEqual([v.fullest, v.spent, v.freeAt, v.signedOut, v.identitySource], ["seven_day", false, null, false, "_auth/status_update"]);
    s.report("cl", { source: "usage_update", windows: [win("five_hour", 100, T0 + 2 * HOUR, { status: "rejected" })] });
    v = viewOf(s, "cl");
    assert.deepEqual([v.fullest, v.spent, v.freeAt], ["five_hour", true, T0 + 2 * HOUR], "a spent window comes first, whatever the shares");
    // Two spent: free once both have reset. One that names no reset: not known when.
    s.report("cl", { source: "rate_limit_event", windows: [weekly(100, T0 + 72 * HOUR)] });
    assert.equal(viewOf(s, "cl").freeAt, T0 + 72 * HOUR);
    s.report("cl", { source: "rate_limit_event", windows: [win("overage", null, null, { kind: "other", label: "Extra usage", windowMins: null, status: "rejected" })] });
    assert.equal(viewOf(s, "cl").freeAt, null);
    clock.t = T0 + 2 * HOUR;
    v = viewOf(s, "cl");
    assert.equal(v.windows[0].state, "reset", "past its reset, its reading is of a period that ended");
    assert.equal(v.fullest, "seven_day", "never the fullest then");
    assert.equal(s.view("nobody"), null);
    s.report("cl", { source: "_auth/status_update", identity: NONE });
    assert.equal(viewOf(s, "cl").signedOut, true);
  });

  // (fails before: yes — the owner's of 11-10: a Fable 5.2 sub-agent on the Northwind login was refused "its plan is used
  // up" while a chat on the same login answered, Claude Code going on in extra usage past its spent week)
  test("a spent window that extra usage covers leaves the account room: not spent while its extra usage is on, allowed and under its limit", () => {
    const { s } = clocked();
    s.report("cl", { source: "_auth/status_update", identity: MAX });
    s.report("cl", { source: "usage_update", windows: [weekly(100, T0 + 72 * HOUR, { status: "rejected" })] });
    assert.deepEqual([viewOf(s, "cl").spent, viewOf(s, "cl").extraCovers], [true, false], "no word of extra usage: spent");
    // As Claude Code said it for the Northwind login on 2026-11-10: the week rejected, extra usage on, in use and allowed.
    s.report("cl", { source: "usage_update", extra: { using: true, status: "allowed", resetsAt: T0 + 30 * DAY, off: null } });
    s.report("cl", { source: "/usage", extra: { enabled: true, spent: 169361, limit: null, currency: "USD" } });
    let v = viewOf(s, "cl");
    assert.deepEqual([v.spent, v.extraCovers, v.windows[0].state, v.freeAt], [false, true, "spent", T0 + 72 * HOUR], "the window still reads spent; the account does not");
    s.report("cl", { source: "/usage", extra: { enabled: true, spent: 50000, limit: 50000, currency: "USD" } });
    assert.deepEqual([viewOf(s, "cl").spent, viewOf(s, "cl").extraCovers], [true, false], "at its monthly limit");
    s.report("cl", { source: "/usage", extra: { enabled: true, spent: 100, limit: 50000, currency: "USD" } });
    s.report("cl", { source: "usage_update", extra: { using: false, status: "rejected", resetsAt: null, off: null } });
    assert.equal(viewOf(s, "cl").spent, true, "its own word refuses it");
    s.report("cl", { source: "usage_update", extra: { using: false, status: "allowed", resetsAt: null, off: "org_level_disabled" } });
    assert.equal(viewOf(s, "cl").spent, true, "switched off");
    s.report("cl", { source: "usage_update", extra: { using: true, status: "allowed", resetsAt: null, off: null } });
    s.report("cl", { source: "/usage", extra: { enabled: false, spent: null, limit: null, currency: null } });
    assert.equal(viewOf(s, "cl").spent, true, "/usage says it cannot cover sends");
    s.report("cl", { source: "/usage", extra: { enabled: true, spent: null, limit: null, currency: null } });
    assert.equal(viewOf(s, "cl").spent, false);
    s.report("cl", { source: "rate_limit_event", windows: [win("overage", null, null, { kind: "other", label: "Extra usage", windowMins: null, status: "rejected" })] });
    v = viewOf(s, "cl");
    assert.deepEqual([v.spent, v.extraCovers], [true, false], "its own window spent: extra usage is used up too");
  });

  test("the pace: when a window runs out at the rise its readings in this period show — a minute apart at least, never past its reset", () => {
    const { s, clock } = clocked();
    const R = T0 + 5 * HOUR;
    const pace = () => viewOf(s, "cl").windows[0].pace;
    s.report("cl", { source: "x", windows: [win("five_hour", 30, R)] });
    assert.equal(pace(), null, "one reading: no pace");
    clock.t = T0 + 30_000;
    s.report("cl", { source: "x", windows: [win("five_hour", 31, R)] });
    assert.equal(pace(), null, "readings under a minute apart say nothing yet");
    clock.t = T0 + 10 * MIN;
    s.report("cl", { source: "x", windows: [win("five_hour", 40, R + 1000)] });
    assert.equal(pace(), T0 + 70 * MIN, "ten points in ten minutes: the last sixty in an hour (a reset a second off is the same period)");
    s.report("cl", { source: "x", windows: [win("five_hour", 2, R + 5 * HOUR)] });
    assert.equal(pace(), null, "a new period starts its pace afresh");
    const slow = clocked();
    slow.s.report("cl", { source: "x", windows: [win("five_hour", 10, T0 + 2 * HOUR)] });
    slow.clock.t = T0 + HOUR;
    slow.s.report("cl", { source: "x", windows: [win("five_hour", 11, T0 + 2 * HOUR)] });
    assert.equal(viewOf(slow.s, "cl").windows[0].pace, null, "at this pace it resets first");
    // (fails before: no — a guard the mutation pass asked for: no window was refused while its readings rose, and none
    // had more than six readings)
    const refused = clocked();
    refused.s.report("cl", { source: "x", windows: [win("five_hour", 80, R)] });
    refused.clock.t = T0 + 10 * MIN;
    refused.s.report("cl", { source: "x", windows: [win("five_hour", 90, R, { status: "rejected" })] });
    assert.equal(viewOf(refused.s, "cl").windows[0].pace, null, "spent at the agent's word: nothing left to run out");
    const burst = clocked();
    for (const [m, used] of [[0, 2], [1, 50], [2, 51], [3, 52], [4, 53], [5, 54], [6, 55]]) {
      burst.clock.t = T0 + m * MIN;
      burst.s.report("cl", { source: "x", windows: [win("five_hour", used, R)] });
    }
    assert.equal(viewOf(burst.s, "cl").windows[0].pace, T0 + 51 * MIN, "the newest six readings set it: an early burst ages out");
  });

  test("a report that repeats what is kept is no change: nothing written, nobody told, only its age moves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-accounts-"));
    try {
      const file = join(dir, "agent-accounts.json");
      const { s, clock } = clocked({ file });
      /** @type {string[]} */
      const heard = [];
      s.onChange(() => {
        throw new Error("a listener that fails");
      });
      const off = s.onChange((id) => heard.push(id));
      s.report("cx", { source: "account/read", identity: PLUS });
      s.report("cx", { source: "account/rateLimits/updated", windows: [win("primary", 12, T0 + HOUR)] });
      const written = readFileSync(file, "utf8");
      clock.t = T0 + MIN;
      s.report("cx", { source: "account/rateLimits/updated", windows: [win("primary", 12, T0 + HOUR)] });
      assert.deepEqual(heard, ["cx", "cx"], "told twice — a listener that fails stops nobody");
      assert.equal(readFileSync(file, "utf8"), written, "not written again");
      assert.equal(viewOf(s, "cx").at, T0 + MIN);
      // (fails before: no — a guard the mutation pass asked for: no login was said again)
      clock.t = T0 + 2 * MIN;
      s.report("cx", { source: "account/read", identity: { ...PLUS } });
      assert.deepEqual([heard, readFileSync(file, "utf8") === written, viewOf(s, "cx").identityAt], [["cx", "cx"], true, T0 + 2 * MIN], "the same login said again: only its age moves");
      off();
      s.report("cx", { source: "account/rateLimits/updated", windows: [win("primary", 13, T0 + HOUR)] });
      assert.deepEqual(heard, ["cx", "cx"], "unsubscribed");
    } finally {
      await removeDirs(dir);
    }
  });

  test("another login takes the last one's windows, extra usage, credits and reasons with it; the same one keeps them", () => {
    const { s } = clocked();
    s.report("cx", { source: "account/read", identity: PLUS });
    s.report("cx", {
      source: "account/rateLimits/read",
      windows: [win("primary", 50, T0 + HOUR)],
      extra: { using: false, status: "allowed", resetsAt: null, off: null },
      credits: { has: true, unlimited: false, balance: "5" },
      resetCredits: { available: 1, nextExpiresAt: null },
      reached: "rate_limit_reached",
    });
    s.report("cx", { source: "account/read", identity: { ...PLUS } });
    assert.equal(viewOf(s, "cx").windows.length, 1, "the same account keeps what was said of its plan");
    s.report("cx", { source: "account/read", identity: { ...PLUS, email: "ops@example.com" } });
    const v = viewOf(s, "cx");
    assert.deepEqual([v.identity.email, v.windows, v.extra, v.credits, v.resetCredits, v.reached, v.spent], ["ops@example.com", [], null, null, null, null, false]);
  });

  // (fails before: yes — a report's extra usage took the place of the last whole: /usage's spend and the rate-limit
  // info's word wiped each other out)
  test("Claude's extra usage from its two channels is one: /usage's spend beside the rate-limit info's word, each kept as the other speaks", () => {
    const { s } = clocked();
    s.report("cl", { source: "_auth/status_update", identity: MAX });
    s.report("cl", { source: "usage_update", extra: { using: true, status: "allowed", resetsAt: T0 + DAY, off: null } });
    s.report("cl", { source: "/usage", extra: { enabled: true, spent: 22248, limit: null, currency: "USD" } });
    const both = { using: true, status: "allowed", resetsAt: T0 + DAY, off: null, enabled: true, spent: 22248, limit: null, currency: "USD" };
    assert.deepEqual(viewOf(s, "cl").extra, both);
    s.report("cl", { source: "usage_update", extra: { using: false, status: "allowed", resetsAt: T0 + DAY, off: null } });
    assert.deepEqual(viewOf(s, "cl").extra, { ...both, using: false }, "the info's new word, and /usage's spend stands");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent took back why its account had no windows)
  test("why an account has no windows holds until the agent says otherwise", () => {
    const { s } = clocked();
    const why = "An Anthropic API key has no plan windows: it is billed by the token";
    s.report("cl", { source: "_auth/status_update", identity: KEY, noWindows: why });
    s.report("cl", { source: "usage_update", windows: [] });
    assert.equal(viewOf(s, "cl").noWindows, why, "a report silent on it keeps it");
    s.report("cl", { source: "_auth/status_update", identity: MAX, noWindows: null });
    assert.equal(viewOf(s, "cl").noWindows, null, "signed in to a plan: its windows come with its turns");
  });

  test("Codex's word that a rate limit was reached holds for the period it was heard in; a workspace's reason stays", () => {
    const { s, clock } = clocked();
    s.report("cx", { source: "r", identity: PLUS, windows: [win("primary", 100, T0 + HOUR)], reached: "rate_limit_reached" });
    assert.deepEqual([viewOf(s, "cx").reached, viewOf(s, "cx").spent], ["rate_limit_reached", true]);
    clock.t = T0 + HOUR;
    let v = viewOf(s, "cx");
    assert.deepEqual([v.reached, v.spent, v.windows[0].state], [null, false, "reset"], "its window reset since: the windows say the rest");
    const bare = clocked();
    bare.s.report("cx", { source: "r", identity: PLUS, reached: "rate_limit_reached" });
    bare.clock.t = T0 + 5 * HOUR;
    assert.equal(viewOf(bare.s, "cx").reached, "rate_limit_reached", "no window to say it reset: it holds");
    const ws = clocked();
    ws.s.report("cx", { source: "r", identity: PLUS, windows: [win("primary", 30, T0 + HOUR)], reached: "workspace_owner_credits_depleted" });
    ws.clock.t = T0 + 2 * HOUR;
    v = viewOf(ws.s, "cx");
    assert.deepEqual([v.reached, v.spent], ["workspace_owner_credits_depleted", true]);
    // (fails before: no — a guard the mutation pass asked for: no window had reset before Codex's word came)
    const stale = clocked();
    stale.s.report("cx", { source: "r", identity: PLUS, windows: [win("primary", 30, T0 + HOUR)] });
    stale.clock.t = T0 + 2 * HOUR;
    stale.s.report("cx", { source: "r", reached: "rate_limit_reached" });
    v = viewOf(stale.s, "cx");
    assert.deepEqual([v.reached, v.spent], ["rate_limit_reached", true], "a window that reset before the word was of an earlier period");
  });

  test("kept in its file across a restart; a file it can't read is said once, and each agent is read again as it reports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-accounts-"));
    try {
      const file = join(dir, "agent-accounts.json");
      const first = clocked({ file });
      first.s.report("cl", { source: "_auth/status_update", identity: MAX, windows: [win("five_hour", 42, T0 + HOUR)] });
      assert.deepEqual(clocked({ file }).s.view("cl"), first.s.view("cl"));
      writeFileSync(file, "{ not json");
      const broken = clocked({ file });
      assert.equal(broken.s.view("cl"), null);
      assert.equal(broken.logs.length, 1);
      assert.match(broken.logs[0][1], /could not read .*each agent's account is read again as it reports/);
      assert.deepEqual(clocked({ file: join(dir, "none.json") }).logs, [], "no file yet is no fault");
    } finally {
      await removeDirs(dir);
    }
  });

  // (fails before: yes — the bug hunt of 10-30, SEC-9: the store wrote its file over itself in place, so a save cut
  // short left it torn, and at the next start every agent's account was gone)
  test("a save cut short leaves the file as it was: every account it held reads again at the next start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-accounts-"));
    try {
      const file = join(dir, "agent-accounts.json");
      const first = clocked({ file });
      first.s.report("cl", { source: "_auth/status_update", identity: MAX });
      const real = fs.writeFileSync;
      fs.writeFileSync = (/** @type {any} */ f, /** @type {any} */ data) => {
        real(f, String(data).slice(0, 20));
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
      };
      syncBuiltinESMExports();
      try {
        first.s.report("cx", { source: "account/read", identity: PLUS });
      } finally {
        fs.writeFileSync = real;
        syncBuiltinESMExports();
      }
      assert.match(first.logs.at(-1)?.[1] ?? "", /could not keep the agents' accounts: ENOSPC/);
      const again = clocked({ file });
      assert.deepEqual(again.logs, [], "its file reads");
      assert.deepEqual(again.s.view("cl")?.identity, MAX, "the account it held");
    } finally {
      await removeDirs(dir);
    }
  });

  test("retain: an upstream removed, or no longer a coding agent, takes its account with it, from the file too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-accounts-"));
    try {
      const file = join(dir, "agent-accounts.json");
      const { s, logs } = clocked({ file });
      for (const id of ["cl", "cx", "gone"]) s.report(id, { source: "x", identity: MAX });
      s.retain([{ id: "cl", type: "acp" }, { id: "cx", type: "anthropic" }]);
      assert.deepEqual(["cl", "cx", "gone"].map((id) => !!s.view(id)), [true, false, false]);
      assert.deepEqual(logs, [["info", "[accounts] let go of cx, gone's account: no longer configured"]]);
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).accounts), ["cl"]);
      s.retain([{ id: "cl", type: "acp" }]);
      assert.equal(logs.length, 1, "nothing to let go of: nothing said");
    } finally {
      await removeDirs(dir);
    }
  });
});

describe("the words every page says an account in (ui/lib/accounts.js)", () => {
  // Local 9:00 on a weekday: the reset words below stay within the day, and the week ahead is a weekday.
  const NOW = new Date(2026, 9, 8, 9, 0, 0).getTime();
  const time = (/** @type {number} */ at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const weekday = (/** @type {number} */ at) => new Date(at).toLocaleDateString([], { weekday: "short" });
  const date = (/** @type {number} */ at) => new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
  /** @param {any[]} reports @param {Record<string, any>} [o] */
  const row = (reports, o) => rowAt(NOW, reports, o);
  const R5 = NOW + 72 * MIN;
  const five = (/** @type {number | null} */ used, more = {}) => win("five_hour", used, R5, more);

  // (fails before: no — a guard the mutation pass asked for: no page named an agent's Default)
  test("an account by its agent and its name: the agent's alone for its Default", () => {
    assert.deepEqual([accountName(row([])), accountName(row([], { added: true, label: "Work" }))], ["Claude", "Claude · Work"]);
  });

  test("a stretch of time as a clock says it", () => {
    assert.deepEqual([500, 45_000, 59_001, MIN, 12 * MIN, HOUR, 72 * MIN, 2 * DAY, 76 * HOUR].map(untilWords), ["1 s", "45 s", "1 min", "1 min", "12 min", "1 h", "1 h 12 m", "2 d", "3 d 4 h"]);
  });

  test("a moment in local time: today's time, a weekday in the week ahead, a date further off or past; a window's reset", () => {
    assert.equal(whenWords(NOW + 2 * HOUR, NOW), time(NOW + 2 * HOUR));
    assert.equal(whenWords(NOW + 50 * HOUR, NOW), `${weekday(NOW + 50 * HOUR)} ${time(NOW + 50 * HOUR)}`);
    assert.equal(whenWords(NOW + 10 * DAY, NOW), `${date(NOW + 10 * DAY)}, ${time(NOW + 10 * DAY)}`);
    assert.equal(whenWords(NOW - 2 * DAY, NOW), `${date(NOW - 2 * DAY)}, ${time(NOW - 2 * DAY)}`);
    assert.deepEqual([resetWords(null, NOW), resetWords(NOW, NOW), resetWords(R5, NOW), resetWords(NOW + 3 * DAY, NOW)], ["", "reset", "resets in 1 h 12 m", `resets ${whenWords(NOW + 3 * DAY, NOW)}`]);
  });

  test("an email masked until asked for", () => {
    assert.deepEqual(["dev@example.com", "a@b.c", "averyverylongname@x.io", "nobody", "@x.io", "", null].map(maskEmail), ["d••@example.com", "a••@b.c", "a••••••@x.io", "•••", "•••", "", ""]);
  });

  test("a window named in a sentence and tagged on a pill; a share in words; a state's tone", () => {
    const ws = [{ kind: "session", label: "5-hour" }, { kind: "weekly", label: "Weekly" }, { kind: "weekly", label: "Weekly · Opus" }, { kind: "monthly", label: "Monthly" }, { kind: "other", label: "2-day" }, { kind: "other", label: "Extra usage" }, { kind: "other", label: "Burst" }];
    assert.deepEqual(ws.map(windowName), ["5-hour window", "weekly window", "weekly Opus window", "monthly window", "2-day window", "extra usage", "burst window"]);
    assert.deepEqual(ws.map(windowTag), ["5h", "week", "week", "month", "2d", "extra", ""]);
    assert.deepEqual([percentWords(null), percentWords(five(42.5)), percentWords(five(null))], ["—", "43%", "—"]);
    assert.deepEqual(["spent", "warning", "ok", "reset", null].map(toneOf), ["error", "warn", "", "", ""]);
  });

  test("an account at a glance and its gauge: the fullest window's tag and share, spent, signed out, stopped with no window", () => {
    const glance = (/** @type {any} */ r) => [glanceOf(r.account), gaugeOf(r.account)];
    assert.deepEqual(glance(row([])), [{ tag: "", figure: "", tone: "" }, null], "nothing said yet");
    assert.deepEqual(glance(row([{ source: "s", identity: NONE }])), [{ tag: "", figure: "Signed out", tone: "error" }, null]);
    assert.deepEqual(glance(row([{ source: "s", identity: MAX, windows: [five(42), weekly(12, NOW + 3 * DAY)] }])), [{ tag: "5h", figure: "42%", tone: "" }, 0.42]);
    assert.deepEqual(glance(row([{ source: "s", identity: MAX, windows: [five(42), weekly(85, NOW + 3 * DAY)] }])), [{ tag: "week", figure: "85%", tone: "warn" }, 0.85]);
    assert.deepEqual(glance(row([{ source: "s", identity: MAX, windows: [five(null, { status: "rejected" }), weekly(85, NOW + 3 * DAY)] }])), [{ tag: "5h", figure: "spent", tone: "error" }, 1]);
    assert.deepEqual(glance(row([{ source: "s", identity: MAX, windows: [win("burst", 100, R5, { kind: "other", label: "Burst" })] }])), [{ tag: "", figure: "Spent", tone: "error" }, 1]);
    // (fails before: yes — a week spent past which extra usage pays read as red "spent", the account stopped)
    const paying = { using: true, status: "allowed", resetsAt: null, off: null, enabled: true, spent: 100, limit: null, currency: "USD" };
    assert.deepEqual(glance(row([{ source: "s", identity: MAX, windows: [five(20), weekly(100, NOW + 3 * DAY, { status: "rejected" })], extra: paying }])), [{ tag: "week", figure: "extra usage", tone: "warn" }, 1]);
    assert.deepEqual(glance(row([{ source: "s", identity: PLUS, windows: [five(30)], reached: "workspace_member_credits_depleted" }])), [{ tag: "", figure: "No credits", tone: "error" }, 0.3]);
    assert.deepEqual(glance(row([{ source: "s", identity: PLUS, reached: "rate_limit_reached" }])), [{ tag: "", figure: "At limit", tone: "error" }, null]);
    assert.deepEqual(glance(row([{ source: "s", identity: MAX, windows: [weekly(null, NOW + DAY, { status: "warning" })] }])), [{ tag: "", figure: "", tone: "warn" }, null], "near its end, no share said: an empty gauge, amber");
    assert.deepEqual(glance(row([{ source: "s", identity: KEY, noWindows: "billed by the token" }])), [{ tag: "", figure: "", tone: "" }, null]);
    // (fails before: no — a guard the mutation pass asked for: no window was read before the agent said nobody is
    // signed in)
    assert.deepEqual(glance(row([{ source: "s", windows: [five(42)] }, { source: "s", identity: NONE }])), [{ tag: "", figure: "Signed out", tone: "error" }, null], "signed out: no gauge, whatever was read before");
  });

  test("an account in one sentence, for a tooltip", () => {
    assert.equal(summaryWords(row([]), NOW), "Claude hasn't said which account it runs on yet — it says when it starts");
    assert.equal(summaryWords(row([], { name: "Codex", type: "codex" }), NOW), "Codex hasn't said which account it runs on yet — Check now asks it");
    assert.equal(summaryWords(row([{ source: "s", identity: NONE }], { name: "Codex", type: "codex", login: "codex login" }), NOW), "Codex: nobody is signed in — run `codex login` in a terminal");
    assert.equal(summaryWords(row([{ source: "s", identity: NONE }], { login: null }), NOW), "Claude: nobody is signed in");
    // (fails before: no — a guard the mutation pass asked for: no agent signed out here had a sign-in of its own)
    const ways = [{ id: "claude-ai-login", name: "Claude Subscription", description: "Use Claude subscription" }];
    assert.equal(summaryWords(row([{ source: "s", identity: NONE }], { ways }), NOW), "Claude: nobody is signed in — sign in under Settings → Coding agents");
    assert.equal(summaryWords(row([{ source: "s", identity: MAX, windows: [five(100)] }]), NOW), "Claude Max's 5-hour window is spent — it resets in 1 h 12 m");
    const paying = { using: true, status: "allowed", resetsAt: null, off: null, enabled: true, spent: 100, limit: null, currency: "USD" };
    assert.equal(summaryWords(row([{ source: "s", identity: MAX, windows: [five(100)], extra: paying }]), NOW), "Claude Max's 5-hour window is spent: extra usage covers it — it resets in 1 h 12 m");
    assert.equal(summaryWords(row([{ source: "s", identity: PLUS, reached: "workspace_owner_usage_limit_reached" }], { type: "codex" }), NOW), "ChatGPT Plus: The workspace's spend limit is reached: raise it, or wait for the reset.");
    assert.equal(summaryWords(row([{ source: "s", identity: PLUS, reached: "rate_limit_reached" }], { type: "codex" }), NOW), "ChatGPT Plus: Codex says the plan has reached its limit.");
    assert.equal(summaryWords(row([{ source: "s", identity: MAX, windows: [five(42)] }]), NOW), "Claude Max: 42% of its 5-hour window used, resets in 1 h 12 m");
    assert.equal(summaryWords(row([{ source: "s", identity: MAX, windows: [weekly(null, null, { status: "warning" })] }]), NOW), "Claude Max: its weekly window is near its limit");
    assert.equal(summaryWords(row([{ source: "s", identity: KEY, noWindows: "An Anthropic API key has no plan windows: it is billed by the token" }]), NOW), "Anthropic API key — An Anthropic API key has no plan windows: it is billed by the token");
    assert.equal(summaryWords(row([{ source: "s", identity: MAX }]), NOW), "Claude Max — The agent reports its plan's windows as it works: they show after its next turn.");
  });

  test("the notice over the composer: from four-fifths used, or spent, until the window's next period — its key names both", () => {
    assert.deepEqual([noticeOf(null, NOW), noticeOf(row([]), NOW), noticeOf(row([{ source: "s", identity: NONE }]), NOW), noticeOf(row([{ source: "s", identity: MAX, windows: [five(79)] }]), NOW)], [null, null, null, null]);
    assert.deepEqual(noticeOf(row([{ source: "s", identity: MAX, windows: [five(20), weekly(85, NOW + 3 * DAY)] }]), NOW), {
      key: `claude|seven_day|${NOW + 3 * DAY}`,
      tone: "warn",
      text: `Claude Max is at 85% of its weekly window. It resets ${whenWords(NOW + 3 * DAY, NOW)}.`,
    });
    assert.deepEqual(noticeOf(row([{ source: "s", identity: MAX, windows: [five(100)] }]), NOW), { key: `claude|five_hour|${R5}`, tone: "error", text: `Claude Max's 5-hour window is spent. It resets at ${time(R5)}.` });
    assert.deepEqual(noticeOf(row([{ source: "s", identity: MAX, windows: [weekly(null, null, { status: "warning" })] }]), NOW), { key: "claude|seven_day|", tone: "warn", text: "Claude Max's weekly window is near its limit." }, "no share and no reset said: neither is");
  });

  // (fails before: yes — the Fable 5.2 re-read's finding 10: the pill said amber "extra usage" of a window extra usage
  // covers, while the notice over the composer said red "…is spent." and the picker's tab drew its gauge red)
  test("a spent window extra usage covers reads one way in every word: amber, said as covered, never red", () => {
    const paying = { using: true, status: "allowed", resetsAt: null, off: null, enabled: true, spent: 100, limit: null, currency: "USD" };
    const r = row([{ source: "s", identity: MAX, windows: [five(100)], extra: paying }]);
    assert.deepEqual([r.account.spent, r.account.extraCovers], [false, true], "the store's word: covered, the account has room");
    assert.deepEqual(noticeOf(r, NOW), { key: `claude|five_hour|${R5}`, tone: "warn", text: `Claude Max's 5-hour window is spent: extra usage covers it. It resets at ${time(R5)}.` });
    assert.equal(summaryWords(r, NOW), "Claude Max's 5-hour window is spent: extra usage covers it — it resets in 1 h 12 m");
    // The picker's tab: its gauge full and amber, its chip amber.
    assert.deepEqual([sourcePlan(r, NOW).gauge, sourcePlan(r, NOW).chip], [{ f: 1, color: "var(--color-sys-orange)" }, { tone: "warn", figure: "extra usage" }]);
    // Uncovered, it is red as before: extra usage off.
    const stopped = row([{ source: "s", identity: MAX, windows: [five(100)], extra: { ...paying, enabled: false, using: false } }]);
    assert.deepEqual([noticeOf(stopped, NOW)?.tone, sourcePlan(stopped, NOW).gauge?.color], ["error", "var(--color-sys-red)"]);
  });

  test("the notices put away in this browser: whatever its storage holds is read; each key once, the newest kept", () => {
    assert.deepEqual([awayKeys(null), awayKeys(""), awayKeys("{ not json"), awayKeys('{"a":1}'), awayKeys('["a", 2]')], [[], [], [], [], ["a", "2"]]);
    assert.deepEqual(putAway(["a", "b"], "a"), ["b", "a"], "put away again: last, once");
    const many = Array.from({ length: 24 }, (_, i) => `k${i}`);
    assert.deepEqual(putAway(many, "new"), [...many.slice(1), "new"], "twenty-four at most: the oldest goes");
    assert.deepEqual(putAway(["a", "b", "c"], "d", 2), ["c", "d"]);
  });

  test("when a spent plan is free again, and what the limit card says", () => {
    assert.deepEqual([freeWords(null, NOW), freeWords(NOW - 1, NOW)], ["", ""]);
    assert.equal(freeWords(R5, NOW), `It's free again at ${time(R5)}, in 1 h 12 m.`);
    assert.equal(freeWords(NOW + 3 * DAY, NOW), `It's free again ${whenWords(NOW + 3 * DAY, NOW)}.`);
    const one = { windows: [{ id: "primary", label: "5-hour", resetsAt: R5 }], freeAt: R5, reached: null, account: { kind: "account", label: "ChatGPT Plus", email: null }, upstream: "cx" };
    assert.deepEqual(limitWords(one, NOW), { title: "ChatGPT Plus's 5-hour window is spent", free: freeWords(R5, NOW), why: "" });
    const two = { ...one, windows: [...one.windows, { id: "secondary", label: "Weekly", resetsAt: NOW + 3 * DAY }], freeAt: NOW + 3 * DAY };
    assert.equal(limitWords(two, NOW).title, "ChatGPT Plus's 5-hour window and weekly window are spent");
    assert.deepEqual(limitWords({ ...one, windows: [], freeAt: null, reached: "workspace_member_usage_limit_reached" }, NOW), {
      title: "ChatGPT Plus has reached its plan's limit",
      free: "",
      why: "The workspace's spend limit is reached: ask its owner to raise it, or wait for the reset.",
    });
    assert.equal(limitWords(one, R5).free, "It has reset since: the turn can go again.");
  });

  test("Claude's extra usage in a word and a line; Codex's reasons and its answer on a reset credit", () => {
    const x = (/** @type {Record<string, any>} */ o) => extraWords({ using: false, status: null, resetsAt: null, off: null, ...o }, NOW);
    assert.deepEqual(x({ off: "out_of_credits", status: "rejected" }), ["Off", "Out of credits"]);
    assert.deepEqual(x({ status: "rejected", resetsAt: R5 }), ["Spent", "Resets in 1 h 12 m"]);
    assert.deepEqual(x({ using: true, resetsAt: R5 }), ["In use", "The plan's windows are spent: turns draw on it · Resets in 1 h 12 m"]);
    assert.deepEqual([x({ status: "warning" }), x({ status: "allowed" })], [["Near its limit", ""], ["Available", ""]]);
    assert.equal(reachedWords("workspace_owner_credits_depleted"), "The workspace has no credits left: add credits to it, or wait for the reset.");
    assert.equal(reachedWords("workspace_member_credits_depleted"), "The workspace has no credits left: ask its owner to add some, or wait for the reset.");
    assert.deepEqual([reachedWords("rate_limit_reached"), reachedWords(null)], ["", ""], "the windows say it");
    assert.deepEqual(["reset", "alreadyRedeemed", "nothingToReset", "noCredit", "later", null].map(resetOutcomeWords), [
      "Done: the plan's windows are reset.",
      "Done: that credit had already reset the plan's windows.",
      "Codex had no window to reset: no credit was used.",
      "Codex says no reset credit is left.",
      "Codex said: later.",
      "Codex said: nothing.",
    ]);
  });

  // (fails before: yes — the words had no spend: a plan drawing on extra usage never said what it had cost)
  test("Claude's extra usage spent, in its currency, this month, beside its word; off where /usage alone says it can't cover sends", () => {
    const x = (/** @type {Record<string, any>} */ o) => extraWords({ using: false, status: null, resetsAt: null, off: null, ...o }, NOW);
    const team = { enabled: true, spent: 22248, limit: null, currency: "USD" };
    assert.deepEqual(x({ ...team, using: true, resetsAt: R5 }), ["In use", "The plan's windows are spent: turns draw on it · $222.48 spent this month · Resets in 1 h 12 m"]);
    assert.deepEqual(x({ status: "allowed", enabled: true, spent: 1250, limit: 50000, currency: "EUR" }), ["Available", "€12.50 of €500.00 spent this month"]);
    assert.deepEqual(x({ status: "rejected", enabled: false, spent: 50000, limit: 50000, currency: "EUR" }), ["Spent", "€500.00 of €500.00 spent this month"]);
    assert.deepEqual(x({ status: "allowed", enabled: true, spent: 300, limit: null, currency: "JPY" }), ["Available", "¥300 spent this month"], "a currency's own minor units");
    assert.deepEqual(x({ status: "allowed", enabled: true, spent: 0, limit: null, currency: "USD" }), ["Available", "$0.00 spent this month"]);
    assert.deepEqual(x({ status: "allowed", enabled: true, spent: 22248, limit: null, currency: null }), ["Available", ""], "a sum with no currency is no sum");
    assert.deepEqual(x({ status: "allowed", enabled: true, spent: 22248, limit: null, currency: "dollars" }), ["Available", ""], "nor one in a currency that is none");
    assert.deepEqual(x({ off: "org_level_disabled", enabled: false, spent: null, limit: null, currency: null }), ["Off", "Org level disabled"]);
    assert.deepEqual(x({ off: "out_of_credits", enabled: false, spent: 50000, limit: 50000, currency: "USD" }), ["Off", "Out of credits · $500.00 of $500.00 spent this month"]);
    // /usage's word alone, before the rate-limit info said anything of it.
    assert.deepEqual(extraWords({ ...team, enabled: false, spent: null }, NOW), ["Off", ""]);
    assert.deepEqual(extraWords({ ...team, enabled: false }, NOW), ["Off", "$222.48 spent this month"]);
    assert.deepEqual(extraWords(team, NOW), ["Available", "$222.48 spent this month"]);
  });

  test("where a stopped turn can go on: another account of the same agent with room, or another agent signed in with room", () => {
    const rows = [
      row([{ source: "s", identity: MAX, windows: [five(100)] }], { upstream: "claude" }),
      row([{ source: "s", identity: { ...MAX, email: "ops@example.com" }, windows: [five(10)] }], { upstream: "claude2" }),
      row([{ source: "s", identity: { ...MAX, email: "x@example.com" }, windows: [five(100)] }], { upstream: "claude3" }),
      row([{ source: "s", identity: PLUS }], { upstream: "cx", agent: "codex", type: "codex" }),
      row([{ source: "s", identity: NONE }], { upstream: "cx2", agent: "codex", type: "codex" }),
      row([], { upstream: "cursor", agent: "cursor", type: "cursor-sdk" }),
    ];
    assert.deepEqual(rows.map(hasRoom), [false, true, false, true, false, false]);
    const limit = { windows: [], freeAt: null, reached: null, account: { kind: "account", label: "Claude Max", email: null }, upstream: "claude" };
    const alt = alternativesOf(limit, rows);
    assert.deepEqual([alt.same.map((r) => r.upstream), alt.other.map((r) => r.upstream)], [["claude2"], ["cx"]]);
    const lost = alternativesOf({ ...limit, upstream: "gone" }, rows);
    assert.deepEqual([lost.same, lost.other.map((r) => r.upstream)], [[], ["claude2", "cx"]], "an upstream no longer listed: every agent with room is another");
    // Another upstream signed in as the same person runs the plan that stopped, whatever its own last reading says.
    const twin = row([{ source: "s", identity: { ...MAX, email: "DEV@example.com" }, windows: [five(10)] }], { upstream: "twin" });
    const known = { ...limit, account: { ...limit.account, email: "dev@example.com" } };
    assert.deepEqual(alternativesOf(known, [...rows, twin]).same.map((r) => r.upstream), ["claude2"]);
    assert.deepEqual(alternativesOf(limit, [...rows, twin]).same.map((r) => r.upstream), ["claude2", "twin"], "whose plan stopped not said: not known to be the same");
    // (fails before: yes — the review of 4e913bf96: an account turned off was offered to go on, and its button failed)
    const setAside = { ...rows[1], off: true };
    assert.equal(hasRoom(setAside), false, "turned off: no room, whatever its plan says");
    assert.deepEqual(alternativesOf(limit, [rows[0], setAside, rows[3]]).same, [], "an account turned off is never offered");
  });

  // (fails before: yes — an account signed in as nobody said whom (Antigravity's, which never names its account) had no
  // room: a turn its plan stopped was never offered to go on on it — [false, false, false], and no other)
  test("an account signed in as nobody said whom has room, and a stopped turn can go on on it; one nothing is known of, or nobody is signed in to, has none", () => {
    const s = createAgentAccounts({ now: () => NOW });
    s.signedIn("agy", "sign-in");
    s.report("agy-out", { source: "sign-out", identity: NONE });
    /** An account of an agent that doesn't say who it runs as, as the store keeps it. @param {string} upstream */
    const quiet = (upstream) => ({ ...row([], { upstream, name: "Antigravity", agent: "antigravity", says: false }), account: s.view(upstream) });
    const [signedIn, signedOut, unheard] = [quiet("agy"), quiet("agy-out"), quiet("agy-new")];
    assert.deepEqual([signedIn, signedOut, unheard].map(hasRoom), [true, false, false]);
    assert.equal(hasRoom({ ...signedIn, off: true }), false, "turned off: no room");
    const from = row([{ source: "s", identity: MAX, windows: [five(100)] }], { upstream: "claude" });
    const limit = { windows: [], freeAt: null, reached: null, account: { kind: "account", label: "Claude Max", email: "dev@example.com" }, upstream: "claude" };
    const alt = alternativesOf(limit, [from, signedIn, signedOut, unheard]);
    assert.deepEqual([alt.same, alt.other.map((r) => r.upstream)], [[], ["agy"]], "another agent, signed in: whose plan it is, nobody said — never the one that stopped");
    assert.deepEqual(alternativesOf({ ...limit, upstream: "agy2" }, [{ ...signedIn, upstream: "agy2" }, signedIn]).same.map((r) => r.upstream), ["agy"], "and another account of its own agent");
  });

  test("Check now's tooltip and why no window shows yet, by agent; the pace with its ≈", () => {
    // Each says its models too (the owner's of 11-10: the account's ↻ asks for them again).
    assert.match(checkWords(row([], { type: "codex" })), /^Ask Codex for its account, its plan's windows and its models now$/);
    assert.match(checkWords(row([], { type: "cursor-sdk" })), /^Ask Cursor who owns the key, and for its models, now$/);
    // (fails before: yes — it said Claude starts, which it no longer does: a throwaway agent asks, and goes)
    assert.equal(checkWords(row([])), "Ask Claude who it runs as, how much of its plan is used and its models now");
    assert.match(checkWords(row([], { agent: "cursor" })), /it starts if it isn't running; its plan's windows come with its turns$/);
    assert.match(notYetWords(row([], { type: "codex" })), /Check now asks it/);
    assert.match(notYetWords(row([])), /they show after its next turn/);
    const paced = (/** @type {number | null} */ pace) => paceWords(/** @type {any} */ ({ pace }), NOW);
    assert.deepEqual([paced(null), paced(NOW - 1), paced(NOW + 2 * HOUR + 10 * MIN)], ["", "", "≈ runs out in 2 h 10 m at this pace"]);
  });

  test("the picker's source tab: the gauge, a chip where the plan warns or stops, and its sentence for the tab's title", () => {
    const gray = "var(--color-sys-gray)";
    assert.deepEqual(sourcePlan(undefined, NOW), { title: null, gauge: null, chip: null }, "no coding agent's source");
    assert.deepEqual(sourcePlan(row([]), NOW), { title: summaryWords(row([]), NOW), gauge: null, chip: null });
    const ok = row([{ source: "s", identity: MAX, windows: [five(42)] }]);
    assert.deepEqual(sourcePlan(ok, NOW), { title: "Claude Max: 42% of its 5-hour window used, resets in 1 h 12 m", gauge: { f: 0.42, color: gray }, chip: null });
    const warn = sourcePlan(row([{ source: "s", identity: MAX, windows: [weekly(85, NOW + 3 * DAY)] }]), NOW);
    assert.deepEqual([warn.gauge, warn.chip], [{ f: 0.85, color: "var(--color-sys-orange)" }, { tone: "warn", figure: "85%" }]);
    const spent = sourcePlan(row([{ source: "s", identity: MAX, windows: [five(100)] }]), NOW);
    assert.deepEqual([spent.gauge, spent.chip], [{ f: 1, color: "var(--color-sys-red)" }, { tone: "error", figure: "spent" }]);
    const out = sourcePlan(row([{ source: "s", identity: NONE }]), NOW);
    assert.deepEqual([out.gauge, out.chip], [{ f: null, color: gray }, { tone: "error", figure: "Signed out" }], "an empty gauge beside its chip");
    const keyed = sourcePlan(row([{ source: "s", identity: KEY, noWindows: "billed by the token" }]), NOW);
    assert.deepEqual([keyed.gauge, keyed.chip], [null, null], "no plan windows: nothing to draw");
    const picker = read("src/ui/harness/composer/model.js");
    assert.match(picker, /const p = sourcePlan\(accounts\.find\(\(x\) => x\.upstream === key\)\);/, "the picker draws its tabs from it");
    assert.match(picker, /p\.chip \? h\("span", \{ class: `mp-source-chip is-\$\{p\.chip\.tone\}` \}, p\.chip\.figure\)/);
  });

  test("followed off the feed: read on each (re)connect, change and save of the configuration, never two at once, again past the soonest reset", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
    /** @type {((msg: any) => void)[]} */
    const subs = [];
    const send = (/** @type {any} */ msg) => {
      for (const fn of [...subs]) fn(msg);
    };
    /** @type {{ resolve: (v: any) => void, reject: (e: any) => void }[]} */
    const pending = [];
    /** @type {string[][]} */
    const said = [];
    const stop = followAccounts(
      (fn) => {
        subs.push(fn);
        return () => subs.splice(subs.indexOf(fn), 1);
      },
      {
        read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
        onSaid: (rows) => said.push(rows.map((r) => r.upstream)),
      },
    );
    const answer = async (/** @type {any} */ rows) => {
      pending.shift()?.resolve({ agents: rows });
      await settle();
    };
    const soon = [{ upstream: "claude", account: { windows: [{ resetsAt: NOW + 10_000 }, { resetsAt: NOW - 5 }] } }, { upstream: "cx", account: null }];
    send({ type: "hello" });
    send({ type: "accounts", upstream: "claude" });
    send({ type: "record" });
    assert.equal(pending.length, 1, "a change heard while a read runs waits for it");
    await answer(soon);
    assert.equal(pending.length, 1, "then it reads once more");
    await answer(soon);
    assert.deepEqual(said, [["claude", "cx"], ["claude", "cx"]]);
    t.mock.timers.tick(10_999);
    assert.equal(pending.length, 0, "not before a second past the reset");
    t.mock.timers.tick(1);
    assert.equal(pending.length, 1, "then the windows are read as they stand after it");
    pending.shift()?.reject(new Error("the server went away"));
    await settle();
    assert.equal(said.length, 2, "a read that fails says nothing");
    send({ type: "config-changed" });
    assert.equal(pending.length, 1, "a saved configuration may have added or removed an agent");
    await answer([]);
    stop();
    send({ type: "accounts", upstream: "claude" });
    assert.deepEqual([pending.length, subs.length], [0, 0], "stopped: nothing heard");
  });
});

describe("what a turn its plan stopped keeps (core/turn-facts.js `planLimit`)", () => {
  const T = Date.UTC(2026, 9, 8, 9, 0, 0);
  /** A coding agent's turn that failed, its agent's account as the record keeps it. @param {any} failure @param {any} account @returns {any} */
  const stopped = (failure, account) => ({ id: "r1", ts: new Date(T).toISOString(), totalMs: 1000, status: "error", error: "You've hit your 5-hour limit", upstream: "claude", failure, acp: { account } });
  /** @param {any[]} windows @param {Record<string, any>} [more] */
  const kept = (windows, more = {}) => accountRecord(MAX, windows, T, more);

  test("a limit while a window was spent: the windows that ran out, when the plan is free again, whose plan it was", () => {
    assert.deepEqual(planLimit(stopped({ kind: "limit" }, kept([win("five_hour", 100, T + HOUR), weekly(64, T + DAY)]))), {
      windows: [{ id: "five_hour", label: "5-hour", resetsAt: T + HOUR }],
      freeAt: T + HOUR,
      reached: null,
      account: { kind: "account", label: "Claude Max", email: "dev@example.com" },
      upstream: "claude",
    });
    const both = planLimit(stopped({ kind: "limit" }, kept([win("five_hour", null, T + HOUR, { status: "rejected" }), weekly(100, T + DAY)])));
    assert.deepEqual([both?.windows.map((w) => w.id), both?.freeAt], [["five_hour", "seven_day"], T + DAY], "free once every one of them has reset");
    assert.equal(planLimit(stopped({ kind: "limit" }, kept([win("five_hour", 100, null)])))?.freeAt, null, "a window that names no reset: not known when");
    const workspace = planLimit(stopped({ kind: "limit" }, kept([], { reached: "workspace_owner_credits_depleted" })));
    assert.deepEqual([workspace?.windows, workspace?.freeAt, workspace?.reached], [[], null, "workspace_owner_credits_depleted"]);
  });

  test("no plan's end: another failure, a moment's rate limit with room in every window, a window reset before the turn ended", () => {
    assert.equal(planLimit(stopped({ kind: "transport" }, kept([win("five_hour", 100, T + HOUR)]))), null);
    assert.equal(planLimit(stopped({ kind: "limit" }, kept([win("five_hour", 99, T + HOUR)]))), null);
    assert.equal(planLimit(stopped({ kind: "limit" }, kept([win("five_hour", 100, T + 500)]))), null, "it reset before the turn ended");
    assert.equal(planLimit(stopped({ kind: "limit" }, null)), null, "no account said");
    assert.equal(planLimit(null), null);
  });

  test("a turn's facts keep the limit while its newest request is the one that stopped, as stored; a later one through clears it", () => {
    const rec = stopped({ kind: "limit" }, kept([win("five_hour", 100, T + HOUR)]));
    let f = foldTurnFacts(null, rec, { own: true });
    assert.deepEqual(f.limit, planLimit(rec));
    assert.deepEqual(JSON.parse(JSON.stringify(f)).limit, f.limit, "kept as the facts are stored: the card outlives the record ring");
    f = foldTurnFacts(f, { ...rec, id: "r2", ts: new Date(T + 5000).toISOString(), status: "ok", error: null, failure: null }, { own: true });
    assert.equal(f.limit, null);
  });
});

describe("the accounts through the app: Check now, a plan's windows and its end, a reset credit, /status", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  // Made once the suite runs: a run filtered to other suites leaves no folder behind.
  let root = "";
  let projDir = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-accounts-app-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    /** Claude's adapter, as the fake plays it. @param {Record<string, string>} env */
    const claude = (env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
    const cursor = { cwdDefault: projDir, permissions: "allow-all", hints: false };
    const OPS = JSON.stringify({ kind: "account", label: "Claude Pro", account: { plan: "pro", email: "ops@example.com" } });
    shim = await startApp({
      overrides: { cursorSdkLoader: () => import(FAKE_SDK) },
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "Claude", type: "acp", acp: claude({ FAKE_ACP_AUTH: "max" }) },
          { id: "spender", name: "Spender", type: "acp", acp: claude({ FAKE_ACP_AUTH: "max" }) },
          // Another person's login, its plan spent: each of its turns stops.
          { id: "spent", name: "Spent", type: "acp", acp: claude({ FAKE_ACP_AUTH: OPS, FAKE_ACP_SPENT: "1" }) },
          { id: "late", name: "Late", type: "acp", acp: claude({ FAKE_ACP_AUTH: "max", FAKE_ACP_AUTH_DELAY_MS: "1000" }) },
          { id: "nobody", name: "Nobody", type: "acp", acp: claude({ FAKE_ACP_AUTH: "none" }) },
          { id: "keyed", name: "Keyed", type: "acp", acp: claude({ FAKE_ACP_AUTH: "key" }) },
          // A gateway's login (Bedrock, say): no plan of Anthropic's.
          { id: "gate", name: "Gate", type: "acp", acp: claude({ FAKE_ACP_AUTH: JSON.stringify({ kind: "gateway", label: "Amazon Bedrock" }) }) },
          // An agent that doesn't say who it runs as (Cursor's ACP server, say).
          { id: "plain", name: "Plain", type: "acp", acp: { ...claude({}), env: {} } },
          // Its turns on Filament's client bridge: an agent process of their own.
          { id: "full", name: "Full", type: "acp", acp: { ...claude({ FAKE_ACP_AUTH: "max" }), clientBridge: "full" } },
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE_CODEX], env: { FAKE_CODEX_SPENT: "1" }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "cursor", name: "Cursor", type: "cursor-sdk", apiKey: "ck-test", acp: cursor },
          { id: "cursorslow", name: "Cursor (ops)", type: "cursor-sdk", apiKey: "ck-slow-me", acp: cursor },
          { id: "off", name: "Off", type: "acp", enabled: false, acp: claude({ FAKE_ACP_AUTH: "max" }) },
          { id: "api", name: "API", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "k", enabled: true },
        ];
        cfg.routes = ["claude", "spender", "spent", "late", "nobody", "keyed", "plain", "full", "cx", "cursor", "cursorslow"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** @returns {Promise<any[]>} */
  const rows = async () => (await (await shim.api("/api/agent-accounts")).json()).agents;
  /** Check now on one upstream: the route's answer. @param {string} id @returns {Promise<any>} */
  const check = async (id) => (await shim.api(`/api/agent-accounts/${id}/check`, { method: "POST" })).json();
  /** One turn of a chat client's, its words and its request's id. @param {string} model @param {string} text @param {string} chat */
  const turn = async (model, text, chat) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: text }] }, { "x-session-id": chat });
    return { status: res.status, id: String(res.headers.get("x-filament-request-id")), body: await res.text() };
  };

  test("every enabled coding agent's upstream and nothing else: the agent it runs, whether it says who it runs as, its sign-in command", async () => {
    assert.deepEqual((await rows()).map((r) => [r.upstream, r.name, r.type, r.agent, r.says, r.login]), [
      ["claude", "Claude", "acp", "node", null, null],
      ["spender", "Spender", "acp", "node", null, null],
      ["spent", "Spent", "acp", "node", null, null],
      ["late", "Late", "acp", "node", null, null],
      ["nobody", "Nobody", "acp", "node", null, null],
      ["keyed", "Keyed", "acp", "node", null, null],
      ["gate", "Gate", "acp", "node", null, null],
      ["plain", "Plain", "acp", "node", null, null],
      ["full", "Full", "acp", "node", null, null],
      ["cx", "Codex", "codex", "codex", true, "codex login"],
      ["cursor", "Cursor", "cursor-sdk", "cursor", true, null],
      ["cursorslow", "Cursor (ops)", "cursor-sdk", "cursor", true, null],
    ]);
  });

  test("Check now on Claude's agent: it starts and says who it runs as; the store keeps it, and the open pages hear of it", async () => {
    /** @type {string[]} */
    const heard = [];
    const off = /** @type {any} */ (shim.app).events.subscribe("accounts", (/** @type {any} */ p) => heard.push(p.upstream));
    try {
      const { agent } = await check("claude");
      assert.deepEqual(agent.account.identity, MAX);
      assert.deepEqual([agent.says, agent.account.signedOut, agent.account.identitySource, agent.account.windows, agent.account.spent], [true, false, "_auth/status_update", [], false]);
      assert.deepEqual(heard, ["claude"]);
      assert.deepEqual((await check("claude")).agent.account.identity, MAX, "asked again while it runs: its word stands");
    } finally {
      off();
    }
  });

  // (fails before: yes — the owner's of 11-10: Fable 5.2 came out, and the account's ↻ checked its sign-in and plan alone;
  // its list stayed as last asked until the agent's own Refresh, so the new model showed nowhere)
  test("Check now on an account asks that account's models again, and the open pages hear its list", async () => {
    /** @type {any[]} */
    const heard = [];
    const off = /** @type {any} */ (shim.app).events.subscribe("config", (/** @type {any} */ p) => p?.type === "models-discovered" && heard.push(p));
    try {
      await check("spender");
      const said = await until(() => heard.find((p) => p.upstream === "spender") || null, "spender's models asked again");
      assert.equal(said.ok, true, JSON.stringify(said));
      assert.ok(said.count > 0, JSON.stringify(said));
    } finally {
      off();
    }
  });

  test("Check now on the others: nobody signed in, an API key with no plan windows, an agent that doesn't say — not waited for", async () => {
    const nobody = (await check("nobody")).agent;
    assert.deepEqual([nobody.account.identity.kind, nobody.account.identity.label, nobody.account.signedOut], ["none", "Not logged in", true]);
    const keyed = (await check("keyed")).agent;
    assert.deepEqual([keyed.account.identity.label, keyed.account.identity.detail, keyed.account.noWindows], ["Anthropic API key", "env", "An Anthropic API key has no plan windows: it is billed by the token"]);
    // (fails before: no — a guard the mutation pass asked for: no agent ran on a gateway's login)
    const gate = (await check("gate")).agent;
    assert.deepEqual([gate.account.identity.kind, gate.account.noWindows], ["gateway", "Amazon Bedrock has no plan windows"]);
    const t0 = Date.now();
    const plain = (await check("plain")).agent;
    assert.deepEqual([plain.says, plain.account], [false, null]);
    assert.ok(Date.now() - t0 < 6000, `answered in ${Date.now() - t0} ms: its first word is never waited for`);
    for (const id of ["nope", "off", "api"]) assert.equal((await shim.api(`/api/agent-accounts/${id}/check`, { method: "POST" })).status, 404, `${id}: no coding agent here`);
    // (fails before: no — a guard the mutation pass asked for: Check now was never pressed again on an agent known not
    // to say, and no turn ran where the agent said nobody is signed in)
    const app = /** @type {any} */ (shim.app);
    app.acp.letGo("plain");
    assert.deepEqual([(await check("plain")).agent.says, app.acp.processInfo("plain")], [false, null], "known not to say: not started again to ask");
    const t = await turn("nobody/sonnet", "hello", "acc-nobody");
    const rec = await until(async () => {
      const r = await shim.record(t.id);
      return r?.acp && r.status ? r : null;
    }, "nobody's turn's record");
    assert.equal(rec.acp.account ?? null, null, "a record never names nobody as the account it ran on");
  });

  // (fails before: no — a guard the mutation pass asked for: Check now was never pressed while the agent ran only on a
  // turn's own process)
  test("Check now while the agent runs only a turn's own process: its word stands, and no process starts to say it again", async () => {
    const { status } = await turn("full/sonnet", "hello", "acc-full");
    assert.equal(status, 200);
    const app = /** @type {any} */ (shim.app);
    await until(() => app.acp.processInfo("full")?.identity?.label === "Claude Max", "the agent to say who it runs as");
    assert.deepEqual([(await check("full")).agent.account.identity.label, app.acp.processInfo("full").processes], ["Claude Max", 1]);
  });

  test("a turn's plan windows as Claude says them: each one's share, reset, word and state; the fullest; its record keeps them", async () => {
    const { status, id } = await turn("claude/sonnet", "~limits", "acc-limits");
    assert.equal(status, 200);
    const row = await until(async () => {
      const r = (await rows()).find((x) => x.upstream === "claude");
      return r?.account?.windows.length === 2 ? r : null;
    }, "claude's two windows");
    const [five, week] = row.account.windows;
    assert.deepEqual([five.id, five.label, five.usedPercent, five.status, five.state, five.source], ["five_hour", "5-hour", 42, "allowed", "ok", "usage_update"]);
    assert.deepEqual([week.id, week.label, week.usedPercent, week.status, week.state, week.source], ["seven_day", "Weekly", 81, "warning", "warning", "rate_limit_event"]);
    assert.ok(Math.abs(five.resetsAt - (Date.now() + 2 * HOUR)) < MIN, "its reset, from epoch seconds");
    assert.deepEqual([row.account.fullest, row.account.spent, row.account.freeAt], ["seven_day", false, null]);
    const rec = await until(async () => {
      const r = await shim.record(id);
      return r?.acp?.account ? r : null;
    }, "the turn's record");
    assert.deepEqual([rec.acp.account.label, rec.acp.account.windows.map((/** @type {any} */ w) => w.id)], ["Claude Max", ["five_hour", "seven_day"]]);
  });

  // (fails before: yes — an agent's own price for its turn was recorded as paid on any login: a turn a Claude Max plan
  // paid read as money spent, and one an API key paid was billed as a plan's)
  test("what a turn cost, by how its login pays: a plan's paid $0 and was worth the agent's figure; an API key's paid it", async () => {
    /** The turn's billing, what it paid and its list figure, once its record closed. @param {string} model @param {string} chat */
    const priced = async (model, chat) => {
      const { id } = await turn(model, "~priced", chat);
      const rec = await until(async () => {
        const r = await shim.record(id);
        return r?.totalMs != null ? r : null;
      }, `${model}'s record`);
      return [rec.billing, rec.cost, rec.listCost];
    };
    assert.deepEqual(await priced("claude/haiku", "priced-max"), ["plan", 0, 0.0309]);
    assert.deepEqual(await priced("keyed/haiku", "priced-key"), ["metered", 0.0309, 0.0309]);
    assert.deepEqual(await priced("plain/haiku", "priced-plain"), ["plan", 0, 0.0309], "an agent that says nothing of its login is billed as its upstream is");
  });

  test("a turn the plan stops: the plan's limit, its record and its facts keep the spent window, the row is spent until the reset", async () => {
    const { status, id } = await turn("spender/sonnet", "~spent", "acc-spent");
    assert.notEqual(status, 200);
    const rec = await until(async () => {
      const r = await shim.record(id);
      return r?.status === "error" && r.acp ? r : null;
    }, "the stopped turn's record");
    assert.equal(rec.failure?.kind, "limit");
    const limit = planLimit(rec);
    assert.deepEqual([limit?.windows.map((w) => [w.id, w.label]), limit?.reached, limit?.account, limit?.upstream], [[["five_hour", "5-hour"]], null, { kind: "account", label: "Claude Max", email: "dev@example.com" }, "spender"]);
    assert.deepEqual(foldTurnFacts(null, rec, { own: true }).limit, limit, "the facts carry the limit card's words");
    const row = (await rows()).find((r) => r.upstream === "spender");
    assert.deepEqual([row.account.spent, row.account.freeAt, row.account.fullest], [true, limit?.freeAt, "five_hour"]);
    assert.deepEqual(row.account.extra, { using: false, status: "rejected", resetsAt: null, off: "out_of_credits" });
  });

  test("a chat a spent plan stops goes on on another account of its agent: the same words, answered there", async () => {
    const stopped = await turn("spent/sonnet", "pick up the failing tests", "acc-moved");
    assert.notEqual(stopped.status, 200);
    const rec = await until(async () => {
      const r = await shim.record(stopped.id);
      return r?.status === "error" && r.acp ? r : null;
    }, "the stopped turn's record");
    const limit = /** @type {NonNullable<ReturnType<typeof planLimit>>} */ (planLimit(rec));
    assert.deepEqual([rec.failure?.kind, limit.account.email], ["limit", "ops@example.com"]);
    await check("claude");
    assert.ok(alternativesOf(limit, await rows()).same.some((r) => r.upstream === "claude"), "Continue on offers the agent's other account");
    // Continue on: the chat's model moved to that account, and its words sent again.
    const next = await turn("claude/sonnet", "pick up the failing tests", "acc-moved");
    assert.equal(next.status, 200);
    assert.match(next.body, /echo\(1\): pick up the failing tests/);
    const moved = await until(async () => {
      const r = await shim.record(next.id);
      return r?.status === "ok" ? r : null;
    }, "the answered turn's record");
    assert.deepEqual([moved.upstream, moved.acp?.account?.email], ["claude", "dev@example.com"]);
  });

  test("a plan that stops the turn before the agent says who it runs as: the turn waits for its word; the window heard first is that login's", async () => {
    const { status, id } = await turn("late/sonnet", "~spent", "acc-late");
    assert.notEqual(status, 200);
    const rec = await until(async () => {
      const r = await shim.record(id);
      return r?.status === "error" && r.acp ? r : null;
    }, "the stopped turn's record");
    const limit = planLimit(rec);
    assert.deepEqual([limit?.windows.map((w) => w.id), limit?.account.label], [["five_hour"], "Claude Max"]);
    const row = (await rows()).find((r) => r.upstream === "late");
    assert.deepEqual([row.account.identity.label, row.account.fullest, row.account.spent], ["Claude Max", "five_hour", true]);
  });

  test("Codex: Check now reads its account, its windows, its credits and reset credits; a reset credit frees the plan, once", async () => {
    const answer = await check("cx");
    assert.equal(answer.checked, null, "Codex says nothing of what the check found: its account says it all");
    const a = answer.agent.account;
    assert.deepEqual(a.identity, PLUS);
    assert.deepEqual(a.windows.map((/** @type {any} */ w) => [w.id, w.label, w.usedPercent, w.state]), [["primary", "5-hour", 100, "spent"], ["secondary", "Weekly", 64, "ok"]]);
    assert.deepEqual([a.spent, a.reached, a.freeAt, a.credits], [true, "rate_limit_reached", a.windows[0].resetsAt, { has: false, unlimited: false, balance: "0" }]);
    assert.equal(a.resetCredits.available, 2);
    assert.ok(a.resetCredits.nextExpiresAt > Date.now() + 9 * DAY, "the soonest expiry, ten days off");
    const used = await (await shim.api("/api/agent-accounts/cx/reset-credit", { method: "POST" })).json();
    const after = used.agent.account;
    assert.deepEqual([used.outcome, after.spent, after.reached, after.windows[0].usedPercent, after.resetCredits.available], ["reset", false, null, 0, 1]);
    assert.equal((await (await shim.api("/api/agent-accounts/cx/reset-credit", { method: "POST" })).json()).outcome, "nothingToReset");
    for (const id of ["claude", "cursor", "nope"]) assert.equal((await shim.api(`/api/agent-accounts/${id}/reset-credit`, { method: "POST" })).status, 404, `${id}: only Codex has them`);
  });

  test("Cursor: each key's owner on its own upstream, and why it has no windows", async () => {
    const [mine, theirs] = [(await check("cursor")).agent.account, (await check("cursorslow")).agent.account];
    assert.deepEqual([mine.identity.label, mine.identity.email, mine.noWindows], ["Cursor API key “Filament test key”", "dev@example.com", "Cursor doesn't publish its plan's limits"]);
    assert.deepEqual([theirs.identity.label, theirs.identity.email], ["Cursor API key “slow key”", "ops@example.com"]);
  });

  // (fails before: yes — /status named, on every Cursor upstream, the owner of the key Cursor last answered for)
  test("/status names the account each upstream runs on", async () => {
    /** A harness chat's `/status` on a model (an outside client's goes to its agent). @param {string} model */
    const said = async (model) => {
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
      assert.equal(made.status, 200, await made.clone().text());
      const res = await shim.api(`/api/sessions/${encodeURIComponent(String((await made.json()).id))}/turns`, { method: "POST", body: { content: "/status", stream: false } });
      return (await res.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
    };
    await check("cursor");
    await check("cursorslow");
    assert.match(await said("cursor/auto"), /- signed in as: Cursor API key “Filament test key” \(dev@example\.com\) · billed to its owner's plan/);
    assert.match(await said("cursorslow/auto"), /- signed in as: Cursor API key “slow key” \(ops@example\.com\)/);
    assert.match(await said("claude/sonnet"), /- signed in as: Claude Max \(dev@example\.com\) · subscription/);
    assert.match(await said("keyed/sonnet"), /- signed in as: Anthropic API key \(env\) · pay-per-token API key, not a subscription/);
    assert.match(await said("nobody/sonnet"), /- signed in: no, the agent says nobody is signed in/);
  });
});

describe("Claude's plan usage through /usage: Check now and a turn's end ask a throwaway agent", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** The report's rate limits as the fake Claude Code says them: the session at 6%, the week at 43%, Fable's at 0. */
  const USAGE = {
    limits: [
      { kind: "session", group: "session", percent: 6, resets_at: new Date(Date.now() + 2 * HOUR).toISOString(), scope: null, severity: "normal", is_active: true },
      { kind: "weekly_all", group: "weekly", percent: 43, resets_at: new Date(Date.now() + 4 * DAY).toISOString(), scope: null, severity: "normal", is_active: false },
      { kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: new Date(Date.now() + 4 * DAY).toISOString(), scope: { model: { display_name: "Fable" }, surface: null }, severity: "normal", is_active: false },
    ],
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null },
  };
  /** Claude's adapter as the fake plays it, its calls kept in a file of its own. @param {string} id @param {Record<string, string>} env */
  const claude = (id, env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: join(root, `${id}-calls.jsonl`), FAKE_ACP_ARGV: join(root, `${id}-argv.jsonl`), ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
  /** A JSONL file's lines, none before it is written. @param {string} file @returns {any[]} */
  const lines = (file) => {
    try {
      return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  /** The `/usage` prompts an upstream's agents were sent. @param {string} id */
  const asked = (id) => lines(join(root, `${id}-calls.jsonl`)).filter((c) => c.method === "/usage");
  /** @param {number} pid */
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-usage-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    const usage = JSON.stringify(USAGE);
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "meter", name: "Meter", type: "acp", acp: claude("meter", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage }) },
          { id: "broken", name: "Broken", type: "acp", acp: claude("broken", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: "fail" }) },
          { id: "quiet", name: "Quiet", type: "acp", acp: claude("quiet", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: "none" }) },
          { id: "keyed", name: "Keyed", type: "acp", acp: claude("keyed", { FAKE_ACP_AUTH: "key", FAKE_ACP_USAGE: usage }) },
          // An agent that says who it runs as but isn't Claude's adapter: it has no `/usage` to ask.
          { id: "other", name: "Other", type: "acp", acp: { ...claude("other", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage }), env: { FAKE_ACP_AUTH: "max", FAKE_ACP_ARGV: join(root, "other-argv.jsonl") } } },
          // A plan spending past its windows: /usage says what its extra usage spent.
          { id: "spendy", name: "Spendy", type: "acp", acp: claude("spendy", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify({ ...USAGE, extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 22248, utilization: null, currency: "USD" } }) }) },
        ];
        cfg.routes = ["meter", "quiet", "keyed", "other", "spendy"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(root);
  });
  /** Check now on one upstream: the route's answer. @param {string} id @returns {Promise<any>} */
  const check = async (id) => (await shim.api(`/api/agent-accounts/${id}/check`, { method: "POST" })).json();

  // (fails before: yes — the plan's share showed only as a window neared its end: Check now read who Claude runs as and
  // nothing of its plan)
  test("Check now reads every window's share at any level, from a throwaway agent whose session keeps no transcript, let go of once it answered", async () => {
    const app = /** @type {any} */ (shim.app);
    const { agent, checked } = await check("meter");
    assert.deepEqual(checked, { read: true, said: null }, "read, and the meters say it: nothing more to say");
    assert.deepEqual(agent.account.identity, MAX);
    assert.deepEqual(agent.account.windows.map((/** @type {any} */ w) => [w.id, w.label, w.usedPercent, w.status, w.state, w.source]), [
      ["five_hour", "5-hour", 6, "allowed", "ok", "/usage"],
      ["seven_day", "Weekly", 43, "allowed", "ok", "/usage"],
      ["seven_day_overage_included", "Weekly · Fable", 0, "allowed", "ok", "/usage"],
    ]);
    assert.equal(agent.account.windows[0].resetsAt, Math.round(Date.parse(USAGE.limits[0].resets_at) / 1000) * 1000);
    const [ask] = asked("meter");
    assert.deepEqual(asked("meter").map((c) => c.persist), [false], "asked once, in a session that keeps no transcript");
    assert.notEqual(ask.pid, app.acp.processInfo("meter").pid, "a throwaway agent, not the one its turns run on");
    await until(() => !alive(ask.pid), "the throwaway agent to be let go of");
  });

  // (fails before: yes — the windows moved only when Claude sent a share, near a window's end)
  test("a turn's end asks again once the last ask has stood usageEveryMs, and not before", async () => {
    const app = /** @type {any} */ (shim.app);
    const was = asked("meter").length;
    assert.ok(was >= 1, "Check now asked a moment ago");
    /** One turn of a chat client's on the meter. @param {string} text */
    const turn = async (text) =>
      (await shim.post("/v1/messages", { model: "meter/sonnet", max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: text }] }, { "x-session-id": "usage-turns" })).status;
    // Minutes from the last read, the turn's end asks nothing — what holds it is the read's clock, not the ask's. A wrong
    // ask shows only once its throwaway agent has started, and one still under way would take the next turn's place
    // (one ask at a time), so it is given two seconds to show before the interval is shortened.
    try {
      app.acp.usageRetryMs = 0;
      assert.equal(await turn("hello"), 200);
      await new Promise((r) => setTimeout(r, 2000));
      assert.equal(asked("meter").length, was, "the first turn's end, minutes from the last read, asked nothing");
      app.acp.usageEveryMs = 0;
      assert.equal(await turn("hello again"), 200);
      await until(() => asked("meter").length === was + 1, "the second turn's ask");
    } finally {
      app.acp.usageEveryMs = 10 * MIN;
      app.acp.usageRetryMs = 2 * MIN;
    }
    const row = (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ r) => r.upstream === "meter");
    assert.equal(row.account.windows.find((/** @type {any} */ w) => w.id === "five_hour").usedPercent, 6);
  });

  // A turn may run for hours: the plan's meter stood still to its end (HarnessV4_Tasks A4).
  // (fails before: yes — the plan's usage was asked for at a turn's end only, whatever the turn's length)
  test("while a turn runs the plan's usage is read again each time the last read has stood usageEveryMs; the turn's end ends that", async () => {
    const app = /** @type {any} */ (shim.app);
    const was = asked("meter").length;
    const stop = new AbortController();
    let ended = false;
    try {
      app.acp.usageEveryMs = 250;
      app.acp.usageRetryMs = 250;
      // A turn that says a word and then works on in silence, until its client lets go of it.
      const turn = fetch(`${shim.url}/v1/messages`, {
        method: "POST",
        headers: { ...shim.headers, "x-session-id": "usage-while" },
        body: JSON.stringify({ model: "meter/sonnet", max_tokens: 100, stream: true, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hang" }] }),
        signal: stop.signal,
      })
        .then((r) => r.text())
        .catch(() => "")
        .finally(() => (ended = true));
      await until(() => asked("meter").length >= was + 2, "two reads of the plan's usage while the turn runs");
      assert.equal(ended, false, "the turn still runs");
      assert.ok(asked("meter").slice(was).every((c) => c.persist === false && c.pid !== app.acp.processInfo("meter").pid), "each by a throwaway agent, never in the turn's session");
      stop.abort();
      await turn;
      // The turn's end may ask once more, as any turn's end does (one ask at a time); after it nothing asks. A clock
      // left running would ask every quarter second.
      await until(async () => !(await (await shim.api("/api/runs")).json()).runs.some((/** @type {any} */ r) => r.status === "running"), "the turn's run to end");
      const atEnd = asked("meter").length;
      await new Promise((r) => setTimeout(r, 3000));
      assert.ok(asked("meter").length <= atEnd + 1, `no turn runs, so nothing reads the plan by the clock: ${asked("meter").length - atEnd} asks in the three seconds after it`);
    } finally {
      stop.abort();
      app.acp.usageEveryMs = 10 * MIN;
      app.acp.usageRetryMs = 2 * MIN;
    }
  });

  test("two Check nows at once share one ask", async () => {
    const was = asked("meter").length;
    const [one, two] = await Promise.all([check("meter"), check("meter")]);
    assert.deepEqual([one.agent.account.windows.length, two.agent.account.windows.length, asked("meter").length], [3, 3, was + 1]);
  });

  test("a /usage that fails: Check now still answers who the agent runs as, with no window", async () => {
    const res = await shim.api("/api/agent-accounts/broken/check", { method: "POST" });
    assert.equal(res.status, 200);
    const { agent } = await res.json();
    assert.deepEqual([agent.account.identity.label, agent.account.windows], ["Claude Max", []]);
    assert.equal(asked("broken").length, 1, "it was asked");
  });

  // (fails before: no — pins the answer Claude Code gave four times in five on 2026-10-10, asked again within minutes)
  test("a /usage answer that leaves the plan's figures out changes nothing: the windows the turns said stand", async () => {
    const res = await shim.post("/v1/messages", { model: "quiet/sonnet", max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "~limits" }] }, { "x-session-id": "usage-quiet" });
    assert.equal(res.status, 200);
    const said = (/** @type {any} */ a) => a.windows.map((/** @type {any} */ w) => [w.id, w.usedPercent, w.source]);
    const turnSaid = [["five_hour", 42, "usage_update"], ["seven_day", 81, "rate_limit_event"]];
    const { agent } = await check("quiet");
    assert.deepEqual([agent.account.identity.label, said(agent.account)], ["Claude Max", turnSaid]);
    assert.ok(asked("quiet").length >= 1, "it was asked");
  });

  // (fails before: yes — the route answered the account alone: an ask that read nothing looked like one that read the
  // same, and the page said nothing either way)
  test("Check now says what it found: the plan read and as it was, an answer without it, a failed ask; nothing where there is nothing to ask", async () => {
    assert.deepEqual((await check("meter")).checked, { read: true, said: "Checked just now: Claude's plan is as it was." });
    assert.deepEqual((await check("quiet")).checked, { read: false, said: "Claude didn't give its plan's usage just now: its usage service didn't answer. It's asked again at a turn's end." });
    assert.deepEqual((await check("broken")).checked, { read: false, said: "Couldn't read Claude's plan's usage: Internal error: the usage endpoint did not answer." });
    assert.deepEqual((await check("keyed")).checked, { read: false, said: null }, "an API key's login has no plan to read");
    assert.equal(lines(join(root, "keyed-argv.jsonl")).length, 1, "the agent of its turns said it: no throwaway beside it");
  });

  // (fails before: yes — Check now said nothing of what it read; a reading that moved was told apart from one that didn't
  // by nobody)
  test("what moved, the meters show: a share or the spend that moved says nothing more; a reading as it was says so", async () => {
    const spend = (/** @type {number} */ cents, /** @type {number} */ session) => ({ ...USAGE, limits: USAGE.limits.map((l, i) => (i === 0 ? { ...l, percent: session } : l)), extra_usage: { is_enabled: true, monthly_limit: null, used_credits: cents, utilization: null, currency: "USD" } });
    const { bridge, upstream } = await restarted({ id: "moving", name: "Moving", type: "acp", acp: claude("moving", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(spend(100, 6)) }) });
    /** Check now with the plan as /usage now says it. @param {number} cents @param {number} session */
    const at = (cents, session) => bridge.checkAccount({ ...upstream, acp: claude("moving", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(spend(cents, session)) }) });
    try {
      assert.deepEqual(await at(100, 6), { read: true, said: null }, "this start's first reading");
      assert.deepEqual(await at(100, 6), { read: true, said: "Checked just now: Claude's plan is as it was." });
      assert.deepEqual(await at(250, 6), { read: true, said: null }, "the spend moved");
      assert.deepEqual(await at(250, 9), { read: true, said: null }, "the session's share moved");
      assert.deepEqual(await at(250, 9), { read: true, said: "Checked just now: Claude's plan is as it was." });
    } finally {
      bridge.shutdown();
    }
  });

  // (fails before: yes — nothing read /usage's extra usage, and a report's took the place of the last whole)
  test("a turn's word on its extra usage and /usage's spend are one: in the agent's account, and in the store", async () => {
    const app = /** @type {any} */ (shim.app);
    const t = await shim.post("/v1/messages", { model: "spendy/sonnet", max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "~spent" }] }, { "x-session-id": "usage-spendy" });
    assert.notEqual(t.status, 200, "the plan stopped the turn");
    await until(() => app.acp.accounts.get("spendy")?.extra?.off, "the turn's word on its extra usage");
    const { agent } = await check("spendy");
    const both = { using: false, status: "rejected", resetsAt: null, off: "out_of_credits", enabled: true, spent: 22248, limit: null, currency: "USD" };
    assert.deepEqual(app.acp.accounts.get("spendy").extra, both);
    assert.deepEqual(agent.account.extra, both);
  });

  // (fails before: yes — an ask that read nothing held off the next one for usageEveryMs, ten minutes, as one that read did)
  test("an ask that read nothing holds off a turn's end for usageRetryMs only", async () => {
    const app = /** @type {any} */ (shim.app);
    /** One turn on the quiet upstream. @param {string} text */
    const turn = async (text) => (await shim.post("/v1/messages", { model: "quiet/sonnet", max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: text }] }, { "x-session-id": "usage-retry" })).status;
    await check("quiet");
    const was = asked("quiet").length;
    assert.equal(await turn("hello"), 200);
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(asked("quiet").length, was, "moments after it, a turn's end asks nothing");
    try {
      app.acp.usageRetryMs = 0;
      assert.equal(await turn("hello again"), 200);
      await until(() => asked("quiet").length === was + 1, "a turn's end asking again, well within usageEveryMs");
    } finally {
      app.acp.usageRetryMs = 2 * MIN;
    }
  });

  /**
   * A bridge as Filament's next start has it: the profile the agent declared at its last start kept, nothing of it running
   * and nothing it said in memory. The first bridge's Check now starts the agent, which declares it.
   * @param {any} upstream @param {any} [later]  the upstream as the next start reads it, its agent's login changed since
   */
  const restarted = async (upstream, later = upstream) => {
    const first = new AcpBridge({});
    try {
      await first.checkAccount(upstream);
    } finally {
      first.shutdown();
    }
    const bridge = new AcpBridge({});
    bridge.profiles.put(upstream.id, first.profiles.all()[upstream.id]);
    return { bridge, upstream: later, started: () => lines(join(root, `${upstream.id}-argv.jsonl`)).length };
  };

  // (fails before: yes — with no agent running, Check now started the agent of its turns and waited for its word, then a
  // throwaway beside it: two agents, 12.7 s on a real Max login on 2026-10-10)
  test("Check now with no agent running, as after a restart: one throwaway agent says who it runs as and reads the plan and its extra usage; nothing else starts", async () => {
    const spending = { ...USAGE, extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 22248, utilization: null, currency: "USD" } };
    const { bridge, upstream, started } = await restarted({ id: "cold", name: "Cold", type: "acp", acp: claude("cold", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(spending) }) });
    const was = started();
    try {
      assert.deepEqual(await bridge.checkAccount(upstream), { read: true, said: null });
      assert.equal(started(), was + 1, "one agent started: the throwaway");
      assert.equal(bridge.processInfo("cold"), null, "no agent of its turns runs");
      const a = bridge.accounts.get("cold");
      assert.deepEqual([a?.identity?.label, a?.windows.map((/** @type {any} */ w) => [w.id, w.usedPercent])], ["Claude Max", [["five_hour", 6], ["seven_day", 43], ["seven_day_overage_included", 0]]]);
      assert.deepEqual(a?.extra, { enabled: true, spent: 22248, limit: null, currency: "USD" });
    } finally {
      bridge.shutdown();
    }
  });

  // (fails before: on Check now's answer alone, which is new — the rest guards the throwaway's own word: Claude's adapter
  // can say who it runs as a while after it starts, and /usage waits for it)
  test("a throwaway that says who it runs as a second late: /usage waits for its word", async () => {
    const { bridge, upstream } = await restarted({ id: "slowword", name: "Slow word", type: "acp", acp: claude("slowword", { FAKE_ACP_AUTH: "max", FAKE_ACP_AUTH_DELAY_MS: "1000", FAKE_ACP_USAGE: JSON.stringify(USAGE) }) });
    try {
      assert.deepEqual(await bridge.checkAccount(upstream), { read: true, said: null });
      assert.equal(bridge.accounts.get("slowword")?.windows.length, 3);
    } finally {
      bridge.shutdown();
    }
  });

  // (fails before: on Check now's answer alone, which is new — the rest guards the throwaway's word on who it runs as:
  // what was said before nothing ran is not the last word, so a login that changed since is heard, and read)
  test("a login that changed while nothing ran: the throwaway's word is heard — an API key's account now signed in to a plan reads its plan", async () => {
    const keyed = { id: "switched", name: "Switched", type: "acp", acp: claude("switched", { FAKE_ACP_AUTH: "key", FAKE_ACP_USAGE: JSON.stringify(USAGE) }) };
    const signedIn = { ...keyed, acp: claude("switched", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(USAGE) }) };
    const { bridge, upstream } = await restarted(keyed, signedIn);
    bridge.accounts.set("switched", { identity: claudeIdentity({ kind: "api_key", label: "Anthropic API key", detail: "env" }), windows: [], extra: null, at: 0 });
    try {
      assert.deepEqual(await bridge.checkAccount(upstream), { read: true, said: null });
      assert.deepEqual([bridge.accounts.get("switched")?.identity?.label, bridge.accounts.get("switched")?.windows.length], ["Claude Max", 3]);
    } finally {
      bridge.shutdown();
    }
  });

  // (fails before: yes — a Check now right after a sign-in or a sign-out joined the ask a turn's end had started in the old
  // login, and that throwaway's word on who it runs as could come after the new one: agent-logins' sign-out said Claude
  // Max)
  test("an account let go of — a sign-in, a sign-out — lets go of the ask under way, its throwaway's word unheard: the next Check now asks afresh", async () => {
    const bridge = new AcpBridge({});
    // The first ask's answer never comes and its limit is minutes away: the let-go alone ends it.
    bridge.usageWaitMs = 10 * MIN;
    const usage = JSON.stringify(USAGE);
    const upstream = { id: "stale", name: "Stale", type: "acp", acp: claude("stale", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage, FAKE_ACP_USAGE_GATE: join(root, "stale-never") }) };
    // Another account's ask under way: none of its business.
    const bystander = bridge.checkAccount({ id: "bystander", name: "Bystander", type: "acp", acp: claude("bystander", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage, FAKE_ACP_USAGE_MS: "3000" }) });
    try {
      const first = bridge.checkAccount(upstream);
      const ask = await until(() => asked("stale")[0], "the slow /usage to be asked");
      await until(() => asked("bystander")[0], "the other account's /usage to be asked");
      bridge.letGo("stale");
      // The next Check now asks afresh as the first ask ends: what ends it lets go of nothing of the fresh one. The
      // fresh ask answers once the third Check now has joined it.
      const answer = join(root, "stale-answer");
      const fresh = { ...upstream, acp: claude("stale", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage, FAKE_ACP_USAGE_GATE: answer }) };
      const second = bridge.checkAccount(fresh);
      assert.deepEqual(await first, { read: false, said: null }, "the ask let go of says nothing");
      await until(() => asked("stale").length === 2, "the fresh ask");
      const third = bridge.checkAccount(fresh);
      writeFileSync(answer, "");
      assert.deepEqual(await Promise.all([second, third]), [{ read: true, said: null }, { read: true, said: null }]);
      assert.equal(asked("stale").length, 2, "asked afresh once: the third Check now shares the fresh ask");
      await until(() => !alive(ask.pid), "the first throwaway to go");
      assert.deepEqual(await bystander, { read: true, said: null }, "the other account's ask went on");
    } finally {
      bridge.shutdown();
    }
  });

  // A throwaway's kill lands a while after the let-go: taskkill takes up to ten seconds on a busy Windows machine, and
  // the agent's pipes their close after it.
  // (fails before: yes — the ask let go of ended only once its throwaway's kill had landed, and whoever waited on it —
  // Check now, a turn's end — waited that long)
  test("an account let go of ends the ask under way at once, however long its throwaway's kill takes to land: it and a Check now joined to it say nothing, the next Check now asks afresh, and the throwaway still goes", async () => {
    const usage = JSON.stringify(USAGE);
    const never = join(root, "held-never");
    /** @param {Record<string, string>} env */
    const held = (env) => ({ id: "held", name: "Held", type: "acp", acp: claude("held", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage, ...env }) });
    const { bridge, upstream } = await restarted(held({}), held({ FAKE_ACP_USAGE_GATE: never }));
    // The ask's answer never comes and its limit is minutes away: the let-go alone ends it.
    bridge.usageWaitMs = 10 * MIN;
    // Its throwaway's kill lands once the test lets it.
    const landing = gate();
    const kill = RpcProcess.prototype.kill;
    RpcProcess.prototype.kill = function () {
      return this.env.FAKE_ACP_USAGE_GATE === never ? landing.promise.then(() => kill.call(this)) : kill.call(this);
    };
    try {
      const was = asked("held").length;
      const first = bridge.checkAccount(upstream);
      const joined = bridge.checkAccount(upstream);
      const ask = await until(() => asked("held")[was], "the /usage to be asked");
      bridge.letGo("held");
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let bound;
      const answers = await Promise.race([Promise.all([first, joined]), new Promise((resolve) => (bound = setTimeout(resolve, 1000, "no answer within a second")))]);
      clearTimeout(bound);
      assert.deepEqual(answers, [{ read: false, said: null }, { read: false, said: null }], "the ask let go of, and the Check now joined to it, say nothing at once");
      assert.ok(alive(ask.pid), "its throwaway's kill has not landed");
      assert.deepEqual(await bridge.checkAccount(held({})), { read: true, said: null }, "the next Check now asks afresh");
      assert.equal(asked("held").length, was + 2);
      landing.open();
      await until(() => !alive(ask.pid), "the throwaway to go once its kill lands");
    } finally {
      landing.open();
      RpcProcess.prototype.kill = kill;
      bridge.shutdown();
    }
  });

  // A throwaway's kill lands a while after the let-go — taskkill's while on Windows, seconds on a busy machine — and
  // what it writes until then is read.
  // (fails before: yes — what a throwaway let go of wrote as the let-go came was heard: the account took its word on who
  // it runs as, and its ask said the plan read, its windows kept)
  test("a throwaway let go of is heard no more: its word on who it runs as, its report and its answer, written as the let-go comes, unheard; the ask says nothing", async () => {
    /**
     * Let go of the upstream as its throwaway says its word: the gate opened and this thread held till the throwaway
     * removes it, the word written then and waiting unread in the pipe, and the let-go made before the bridge reads on.
     * @param {any} bridge @param {string} gate
     */
    const letGoAsItSays = (bridge, gate) => {
      writeFileSync(gate, "");
      const deadline = Date.now() + 10_000;
      while (fs.existsSync(gate)) if (Date.now() > deadline) assert.fail("the throwaway never said its word");
      bridge.letGo("unheard");
    };
    const usage = JSON.stringify(USAGE);
    const who = join(root, "unheard-who");
    const answer = join(root, "unheard-answer");
    /** @param {Record<string, string>} env */
    const unheard = (env) => ({ id: "unheard", name: "Unheard", type: "acp", acp: claude("unheard", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: usage, ...env }) });
    const { bridge, upstream } = await restarted(unheard({}), unheard({ FAKE_ACP_AUTH_GATE: who }));
    const opened = () => lines(join(root, "unheard-calls.jsonl")).filter((c) => c.method === "session/new").length;
    try {
      // Its word on who it runs as, written as the let-go comes.
      let was = opened();
      let checking = bridge.checkAccount(upstream);
      await until(() => opened() === was + 1, "the throwaway's session to open");
      letGoAsItSays(bridge, who);
      assert.deepEqual(await checking, { read: false, said: null });
      assert.equal(bridge.accounts.get("unheard"), undefined, "its word on who it runs as unheard");
      // Its report and its answer, written as the let-go comes.
      was = asked("unheard").length;
      checking = bridge.checkAccount(unheard({ FAKE_ACP_USAGE_GATE: answer }));
      await until(() => asked("unheard").length === was + 1, "the throwaway to be asked /usage");
      letGoAsItSays(bridge, answer);
      assert.deepEqual(await checking, { read: false, said: null }, "its report and its answer unheard: nothing read, nothing said");
      assert.deepEqual([bridge.accounts.get("unheard")?.identity?.label, bridge.accounts.get("unheard")?.windows], ["Claude Max", []], "said before the let-go, who it runs as is heard; none of its windows is kept");
    } finally {
      bridge.shutdown();
    }
  });

  // (fails before: yes — an ask that never heard who its agent runs as said nothing of why)
  test("a throwaway that never says who it runs as: Check now says why — its time ran out, it ended, it kept quiet", async () => {
    /** The upstream as its next start reads it, its agent saying who it runs as only a minute after it starts. @param {string} id @param {Record<string, string>} [env] */
    const late = (id, env = {}) => ({ id, name: id, type: "acp", acp: claude(id, { FAKE_ACP_AUTH: "max", FAKE_ACP_AUTH_DELAY_MS: "60000", FAKE_ACP_USAGE: JSON.stringify(USAGE), ...env }) });
    /** @param {string} id */
    const prompt = (id) => ({ id, name: id, type: "acp", acp: claude(id, { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(USAGE) }) });
    const ran = await restarted(prompt("mute"), late("mute"));
    ran.bridge.usageWaitMs = 3000;
    const ended = await restarted(prompt("ending"), late("ending", { FAKE_ACP_INIT_EXIT_MS: "300" }));
    const quiet = await restarted(prompt("silent"), late("silent"));
    quiet.bridge.usageWhoMs = 1000;
    try {
      assert.deepEqual(await ran.bridge.checkAccount(ran.upstream), { read: false, said: "Couldn't read Claude's plan's usage: it gave no answer in 3 s." });
      assert.deepEqual(await ended.bridge.checkAccount(ended.upstream), { read: false, said: "Couldn't read Claude's plan's usage: agent process exited (code 3): fake agent: gone at its start." }, "its end in its own words, said once");
      assert.deepEqual(await quiet.bridge.checkAccount(quiet.upstream), { read: false, said: "Couldn't read Claude's plan's usage: it didn't say who it runs as in 1 s." });
    } finally {
      for (const b of [ran, ended, quiet]) b.bridge.shutdown();
    }
  });

  // (fails before: yes — the ask waited for the prompt's answer, which on a real Max login on 2026-10-10 came four seconds
  // after the report)
  test("the ask ends at the report: the prompt's answer trailing it is not waited for", async () => {
    const { bridge, upstream } = await restarted({ id: "trail", name: "Trail", type: "acp", acp: claude("trail", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(USAGE), FAKE_ACP_USAGE_TAIL_MS: "20000" }) });
    try {
      const t0 = Date.now();
      assert.deepEqual(await bridge.checkAccount(upstream), { read: true, said: null });
      assert.ok(Date.now() - t0 < 10_000, `answered in ${Date.now() - t0} ms, not at the prompt's answer`);
    } finally {
      bridge.shutdown();
    }
  });

  test("an ask whose answer never comes is let go of after usageWaitMs: Check now answers without the plan's windows", async () => {
    const upstream = { id: "stuck", name: "Stuck", type: "acp", acp: claude("stuck", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(USAGE), FAKE_ACP_USAGE_MS: "60000" }) };
    // The limit counts from the throwaway agent's start (bridge.js `USAGE_WAIT_MS`), and a loaded machine's start can
    // take all of it, so that nothing was asked: that start is no part of what is tried here, which is tried again with
    // a limit twice as long.
    for (let limit = 4000; ; limit *= 2) {
      const bridge = new AcpBridge({});
      bridge.usageWaitMs = limit;
      const was = asked("stuck").length;
      try {
        const t0 = Date.now();
        const got = await bridge.checkAccount(upstream);
        const ask = asked("stuck")[was];
        if (!ask && limit < 32_000) continue;
        assert.deepEqual(got, { read: false, said: `Couldn't read Claude's plan's usage: it gave no answer in ${limit / 1000} s.` });
        assert.ok(Date.now() - t0 < limit + 11_000, `Check now answered in ${Date.now() - t0} ms, not at the agent's word`);
        assert.ok(ask, "it was asked");
        await until(() => !alive(ask.pid), "the throwaway agent to be let go of");
        assert.deepEqual([bridge.accounts.get("stuck")?.identity?.label, bridge.accounts.get("stuck")?.windows], ["Claude Max", []]);
        return;
      } finally {
        bridge.shutdown();
      }
    }
  });

  test("never asked: an API key's login, which has no plan; an agent that isn't Claude's adapter", async () => {
    // Check now asks each its models too, on its own (the owner's of 11-10): their answers are waited for, so what
    // starts after is a turn's alone.
    /** @type {string[]} */
    const listed = [];
    const off = /** @type {any} */ (shim.app).events.subscribe("config", (/** @type {any} */ p) => p?.type === "models-discovered" && listed.push(p.upstream));
    const keyed = (await check("keyed")).agent;
    assert.deepEqual([keyed.account.identity.kind, keyed.account.windows, asked("keyed")], ["api-key", [], []]);
    const other = (await check("other")).agent;
    assert.deepEqual([other.account.identity.label, other.account.windows], ["Claude Max", []]);
    await until(() => listed.includes("keyed") && listed.includes("other"), "their models asked again").finally(off);
    assert.equal(asked("other").length, 0, "no plan's ask of its /usage beside them");
    // (fails before: no — a guard the mutation pass asked for: no turn's end ran on a login with no plan, or on an agent
    // with no /usage to ask)
    const app = /** @type {any} */ (shim.app);
    /** The agents started with no model of a turn's: a check's, a throwaway. @param {string} id */
    const modelless = (id) => lines(join(root, `${id}-argv.jsonl`)).filter((a) => !a.includes("--model")).length;
    const was = { keyed: modelless("keyed"), other: modelless("other") };
    try {
      app.acp.usageRetryMs = 0;
      app.acp.usageEveryMs = 0;
      for (const id of ["keyed", "other"])
        for (const text of ["hello", "hello again"])
          assert.equal((await shim.post("/v1/messages", { model: `${id}/sonnet`, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: text }] }, { "x-session-id": `usage-${id}` })).status, 200);
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      app.acp.usageEveryMs = 10 * MIN;
      app.acp.usageRetryMs = 2 * MIN;
    }
    assert.deepEqual({ keyed: modelless("keyed"), other: modelless("other") }, was, "their turns' ends started no throwaway");
  });

  test("an ask under way ends with the bridge: its throwaway agent is let go of at shutdown", async () => {
    const bridge = new AcpBridge({});
    const upstream = { id: "slow", name: "Slow", type: "acp", acp: claude("slow", { FAKE_ACP_AUTH: "max", FAKE_ACP_USAGE: JSON.stringify(USAGE), FAKE_ACP_USAGE_MS: "60000" }) };
    const checking = bridge.checkAccount(upstream);
    const ask = await until(() => asked("slow")[0], "the slow /usage to be asked");
    const t0 = Date.now();
    bridge.shutdown();
    await checking;
    assert.ok(Date.now() - t0 < 10_000, `Check now let go of in ${Date.now() - t0} ms, not at the ask's own limit`);
    await until(() => !alive(ask.pid), "the throwaway agent to end");
    assert.deepEqual(bridge.accounts.get("slow")?.windows, [], "nothing came of it");
  });
});

describe("Filament doctor: who an ACP agent runs as", () => {
  /** A port nothing listens on: the doctor finds no server running. */
  const closedPort = () =>
    new Promise((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const { port } = /** @type {import("node:net").AddressInfo} */ (s.address());
        s.close(() => resolve(port));
      });
    });

  // (fails before: yes — the doctor's sign-in line never showed: the agent's process never kept what it said)
  test("signed in, as whom; nobody signed in, with how to sign in; an agent that doesn't say, neither — and it isn't waited for", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "filament-doctor-"));
    try {
      const cfg = defaultConfig();
      cfg.server.port = /** @type {number} */ (await closedPort());
      cfg.memory.enabled = false;
      cfg.observability.logFile = "";
      /** @param {string} id @param {Record<string, string>} env */
      const up = (id, env) => ({ id, name: id, type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env, permissions: "allow-all" } });
      // `claude-code` runs the fake under node: no sign-in line Filament knows, so its fix is Settings alone.
      cfg.upstreams = [up("max", { FAKE_ACP_AUTH: "max" }), up("claude-code", { FAKE_ACP_AUTH: "none" }), up("plain", {})];
      cfg.routes = cfg.upstreams.map((u) => ({ match: `${u.id}/*`, upstream: u.id, upstreamModel: "{1}", enabled: true }));
      writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
      const t0 = Date.now();
      const report = await runDoctor({ dataDir });
      /** @param {string} id */
      const said = (id) =>
        (report.sections.find((/** @type {any} */ s) => s.title === `Agent: ${id}`)?.items || [])
          .filter((/** @type {any} */ i) => /signed in|logged in/.test(i.what))
          .map((/** @type {any} */ i) => [i.level, i.what, i.detail, i.fix]);
      assert.deepEqual(said("max"), [["ok", "signed in: Claude Max (dev@example.com)", "", undefined]]);
      assert.deepEqual(said("claude-code"), [["fail", "not logged in", "the agent says nobody is signed in", "Sign in under Settings → Coding agents in Filament's harness"]]);
      assert.deepEqual(said("plain"), []);
      assert.ok(Date.now() - t0 < 8000, `the three in ${Date.now() - t0} ms: an agent that doesn't say is not waited for`);
    } finally {
      await removeDirs(dataDir);
    }
  });
});

describe("Filament doctor: the Filament it asks", () => {
  /**
   * A stand-in Filament listening on `host`: its version on /api/state, no models on /v1/models.
   * @param {string} host @returns {Promise<{ port: number, close: () => Promise<void> }>}
   */
  const standIn = (host) =>
    new Promise((resolve, reject) => {
      const s = httpServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(req.url === "/api/state" ? { version: "stand-in", uptimeMs: 0 } : { data: [] }));
      });
      s.once("error", reject);
      s.listen(0, host, () =>
        resolve({
          port: /** @type {import("node:net").AddressInfo} */ (s.address()).port,
          close: () =>
            new Promise((r) => {
              s.closeAllConnections();
              s.close(() => r());
            }),
        }),
      );
    });

  // (fails before: yes — the bug hunt of 10-30, DESK-9: the doctor wrote an IPv6 host into its address bare —
  // http://::1:<port>, http://:::<port> —, which no fetch parses, so a Filament that answered was said not to)
  test("a Filament on an IPv6 address is asked at it in brackets, and one on every address (::) at 127.0.0.1", async () => {
    for (const [host, at] of [["::1", "[::1]"], ["::", "127.0.0.1"]]) {
      const filament = await standIn(host);
      const dataDir = mkdtempSync(join(tmpdir(), "filament-doctor-"));
      try {
        const cfg = defaultConfig();
        cfg.server.host = host;
        cfg.server.port = filament.port;
        cfg.memory.enabled = false;
        cfg.observability.logFile = "";
        cfg.upstreams = [];
        cfg.routes = [];
        writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
        const report = await runDoctor({ dataDir });
        const said = (report.sections.find((/** @type {any} */ s) => s.title === "Server")?.items || []).map((/** @type {any} */ i) => [i.level, i.what]);
        assert.deepEqual(said, [["ok", `Filament stand-in answers at http://${at}:${filament.port}`], ["ok", "model list works (0 names)"]], host);
      } finally {
        await filament.close();
        await removeDirs(dataDir);
      }
    }
  });

  // (fails before: yes — the bug hunt of 10-30: the doctor ended through process.exit just after its last calls, which
  // on Windows can trip libuv's UV_HANDLE_CLOSING assertion as Node tears down (nodejs/node#56645): its report printed,
  // it exited 0xC0000409 — seen where a Filament answered)
  test("the CLI's doctor ends by itself once its checks are done, with its exit code; no command but start ends through process.exit", async () => {
    const cli = fileURLToPath(new URL("../bin/filament.js", import.meta.url));
    const bin = readFileSync(cli, "utf8");
    const commands = bin.slice(0, bin.indexOf("function start("));
    assert.doesNotMatch(commands, /process\.exit\(/, "a command ends by itself");
    assert.match(commands, /process\.exitCode = report\.summary\.fail \? 1 : 0;/, "the doctor's code, a problem found or none");
    const filament = await standIn("127.0.0.1");
    const dataDir = mkdtempSync(join(tmpdir(), "filament-doctor-"));
    try {
      const cfg = defaultConfig();
      cfg.server.host = "127.0.0.1";
      cfg.server.port = filament.port;
      cfg.memory.enabled = false;
      cfg.observability.logFile = "";
      cfg.upstreams = [];
      cfg.routes = [];
      writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
      /** @type {{ code: number | string | null | undefined, stdout: string }} */
      const ran = await new Promise((resolve) => execFile(process.execPath, [cli, "doctor", "--data-dir", dataDir], { timeout: 60_000 }, (e, stdout) => resolve({ code: e ? e.code : 0, stdout: String(stdout) })));
      assert.match(ran.stdout, new RegExp(`✓ Filament stand-in answers at http://127\\.0\\.0\\.1:${filament.port}`), ran.stdout);
      assert.equal(ran.code, 0, ran.stdout);
    } finally {
      await filament.close();
      await removeDirs(dataDir);
    }
  });
});

describe("the Account instrument (harness widgets/account.js)", () => {
  const NOW = new Date(2026, 9, 8, 9, 0, 0).getTime();
  /** @param {any[]} reports @param {Record<string, any>} [o] */
  const row = (reports, o) => rowAt(NOW, reports, o);
  /**
   * The instrument over one chosen agent's row, its doors recorded; Check now waits until the test lets it go. The
   * rows beside it are its own alone unless given.
   * @param {any} chosen @param {{ now?: number, rows?: any[] }} [o]
   */
  const instrument = (chosen, o = {}) => {
    const state = { row: chosen };
    /** @type {string[]} */
    const did = [];
    /** @type {() => void} */
    let release = () => {};
    const ctx = /** @type {any} */ ({
      accounts: {
        session: () => state.row,
        check: (/** @type {string} */ u) => {
          did.push(`check ${u}`);
          return new Promise((resolve) => {
            release = () => resolve(undefined);
          });
        },
        useResetCredit: async (/** @type {string} */ u) => {
          did.push(`reset credit ${u}`);
          return "reset";
        },
        manage: () => did.push("manage accounts"),
        rows: () => o.rows || [state.row],
        signIn: (/** @type {string} */ u, /** @type {any} */ then) => did.push(then ? `sign in ${u}, then ${then.label}` : `sign in ${u}`),
        switchTo: (/** @type {string} */ u) => did.push(`switch to ${u}`),
      },
    });
    const spec = accountWidget(ctx, { h: fakeH, drawIn: fakeDrawIn }, { now: () => o.now ?? NOW });
    let closed = 0;
    const open = () => spec.panel?.(fakeH, () => { closed++; });
    return { state, did, spec, open, closes: () => closed, release: () => release() };
  };
  /** The node carrying a class, under another. @param {any} el @param {string} cls @returns {any[]} */
  const classed = (el, cls) => {
    /** @type {any[]} */
    const out = [];
    /** @param {any} n */
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
      for (const k of n.kids || []) walk(k);
    };
    walk(el);
    return out;
  };

  test("the pill: shown in a coding agent's session once its agent is known to say who it runs as", () => {
    assert.equal(instrument(null).spec.visible?.(), false, "no coding agent chosen");
    assert.equal(instrument(row([], { says: false })).spec.visible?.(), false, "an agent that doesn't say");
    assert.equal(instrument(row([], { says: null })).spec.visible?.(), false, "an ACP agent never started: not known yet");
    assert.equal(instrument(row([{ source: "s", identity: MAX }], { says: null })).spec.visible?.(), true, "it said, whatever is known of it");
    const fresh = instrument(row([], { says: true })).spec;
    assert.deepEqual([fresh.visible?.(), fresh.state?.(), fresh.tone?.(), fresh.marks?.()], [true, "", "", { hollow: true }]);
    assert.equal(fresh.title?.(), "Claude hasn't said which account it runs on yet — it says when it starts");
  });

  test("its face: the fullest window's gauge with its tag and share — amber from 80 %, red when spent; the glyph alone with no windows", () => {
    const faceOf = (/** @type {any} */ r) => {
      const { spec } = instrument(r);
      const face = spec.face?.(fakeH);
      return { state: spec.state?.(), tone: spec.tone?.(), hollow: spec.marks?.().hollow, text: textOf(face), html: String(classed(face, "inst-face-gauge")[0]?.attrs.html || ""), glyph: classed(face, "inst-face-glyph").length };
    };
    const ok = faceOf(row([{ source: "s", identity: MAX, windows: [win("five_hour", 42, NOW + HOUR)] }]));
    assert.deepEqual([ok.state, ok.tone, ok.hollow, ok.text, ok.glyph], ["5h 42%", "", false, "5h|42%", 0]);
    assert.match(ok.html, /class="inst-arc"[^>]*style="stroke:var\(--color-sys-gray\)"/);
    const warn = faceOf(row([{ source: "s", identity: MAX, windows: [weekly(85, NOW + DAY)] }]));
    assert.deepEqual([warn.state, warn.tone], ["week 85%", "warn"]);
    assert.match(warn.html, /stroke:var\(--color-sys-orange\)/);
    const spent = faceOf(row([{ source: "s", identity: MAX, windows: [win("five_hour", 100, NOW + HOUR)] }]));
    assert.deepEqual([spent.state, spent.tone], ["5h spent", "error"]);
    assert.match(spent.html, /stroke:var\(--color-sys-red\)/);
    const out = faceOf(row([{ source: "s", identity: NONE }]));
    assert.deepEqual([out.state, out.tone, out.hollow, out.text], ["Signed out", "error", true, "Signed out"]);
    assert.doesNotMatch(out.html, /inst-arc/, "an empty gauge");
    const keyed = faceOf(row([{ source: "s", identity: KEY, noWindows: "billed by the token" }]));
    assert.deepEqual([keyed.state, keyed.hollow, keyed.glyph, keyed.html], ["", false, 1, ""]);
    // (fails before: no — a guard the mutation pass asked for: every account with no windows had said why)
    const early = faceOf(row([{ source: "s", identity: MAX }]));
    assert.deepEqual([early.state, early.hollow, early.glyph], ["Max", true, 0], "signed in, no window reported yet: the gauge, hollow, not the glyph");
  });

  test("its face where no share is said: the plan's name beside the hollow gauge, in the window's tone; the gauge alone where no plan is named", () => {
    const faceOf = (/** @type {any} */ r) => {
      const { spec } = instrument(r);
      return [spec.state?.(), spec.tone?.(), spec.marks?.().hollow, textOf(spec.face?.(fakeH))];
    };
    assert.deepEqual(faceOf(row([{ source: "s", identity: MAX, windows: [win("five_hour", null, NOW + HOUR, { status: "allowed" })] }])), ["Max", "", true, "Max"], "Claude's word on a window with room: no share");
    assert.deepEqual(faceOf(row([{ source: "s", identity: MAX, windows: [weekly(null, NOW + DAY, { status: "warning" })] }])), ["Max", "warn", true, "Max"]);
    assert.deepEqual(faceOf(row([{ source: "s", identity: { ...PLUS, plan: "self_serve_business_usage_based" } }])), ["Self Serve Business Usage Based", "", true, "Self Serve Business Usage Based"]);
    assert.deepEqual(faceOf(row([{ source: "s", identity: { ...MAX, plan: null }, windows: [win("five_hour", null, NOW + HOUR)] }])), ["", "", true, ""]);
  });

  test("its popover: who, the email masked until clicked, each window as a meter with its reset and pace, Check now, the accounts' page", async () => {
    // Two readings ten minutes apart: the pace.
    const s = createAgentAccounts({ now: () => clock });
    let clock = NOW - 10 * MIN;
    s.report("claude", { source: "_auth/status_update", identity: MAX });
    s.report("claude", { source: "usage_update", windows: [win("five_hour", 30, NOW + 2 * HOUR)], extra: { using: false, status: "allowed", resetsAt: null, off: null } });
    clock = NOW;
    s.report("claude", { source: "usage_update", windows: [win("five_hour", 40, NOW + 2 * HOUR)] });
    s.report("claude", { source: "rate_limit_event", windows: [weekly(85, NOW + 3 * DAY)] });
    const w = instrument({ ...rowAt(NOW, []), account: s.view("claude") });
    const body = w.open();
    assert.equal(textOf(classed(body, "inst-title")[0]), "Claude Max");
    const email = buttonsOf(body).find((b) => String(b.attrs.class).includes("inst-email"));
    assert.equal(textOf(classed(body, "inst-sub")[0]), "Claude| · Example Org| · |d••@example.com");
    email.dispatch("click");
    assert.match(textOf(classed(body, "inst-sub")[0]), /\|dev@example\.com$/, "shown once clicked");
    buttonsOf(body).find((b) => String(b.attrs.class).includes("inst-email")).dispatch("click");
    assert.match(textOf(classed(body, "inst-sub")[0]), /\|d••@example\.com$/, "and masked again");
    const meters = classed(body, "inst-meter").map(textOf);
    assert.deepEqual(meters, [
      "5-hour window|40%|Resets in 2 h · ≈ runs out in 1 h at this pace",
      `Weekly window|85%|Resets ${whenWords(NOW + 3 * DAY, NOW)}`,
    ]);
    assert.match(textOf(body), /Extra usage\|Available/);
    assert.equal(classed(body, "inst-note").length, 0, "the windows say it all");
    assert.equal(textOf(classed(body, "inst-foot-note")[0]), "Updated just now");
    const checkBtn = () => buttonsOf(body).find((b) => /Check now|Checking…/.test(textOf(b)));
    assert.equal(String(checkBtn().attrs.title), "Ask Claude who it runs as, how much of its plan is used and its models now");
    checkBtn().dispatch("click");
    assert.deepEqual([w.did, textOf(checkBtn()).endsWith("Checking…"), "disabled" in checkBtn().attrs], [["check claude"], true, true]);
    w.release();
    await settle();
    assert.deepEqual([textOf(checkBtn()).endsWith("Check now"), "disabled" in checkBtn().attrs], [true, false], "its answer drawn, it can be asked again");
    assert.equal(buttonsOf(body).some((b) => textOf(b).endsWith("Use a reset credit")), false, "Claude has no reset credits");
    buttonsOf(body).find((b) => textOf(b).startsWith("Accounts")).dispatch("click");
    assert.deepEqual([w.closes(), w.did.at(-1)], [1, "manage accounts"]);
  });

  // (fails before: yes — the Fable 5.2 re-read's finding 10: under an amber pill saying "extra usage", the popover said
  // red "It's free again at …" and drew the window, its gauge and its tile red, as of a plan that had stopped)
  test("a spent window extra usage covers: amber on the gauge, the meter, the tile and the note, which says extra usage covers it and never when it is free again", () => {
    const paying = { using: true, status: "allowed", resetsAt: null, off: null, enabled: true, spent: 100, limit: null, currency: "USD" };
    const covered = row([{ source: "s", identity: MAX, windows: [win("five_hour", 100, NOW + HOUR), weekly(40, NOW + 3 * DAY)], extra: paying }]);
    const other = row([{ source: "s", identity: MAX, windows: [win("five_hour", 100, NOW + HOUR)], extra: paying }], { upstream: "claude-work", label: "Work", added: true });
    const w = instrument(covered, { rows: [covered, other] });
    const face = w.spec.face?.(fakeH);
    const gauge = String(classed(face, "inst-face-gauge")[0]?.attrs.html || "");
    assert.deepEqual([w.spec.state?.(), w.spec.tone?.(), /sys-orange/.test(gauge), /sys-red/.test(gauge)], ["5h extra usage", "warn", true, false]);
    const body = w.open();
    const note = classed(body, "inst-note")[0];
    assert.deepEqual([textOf(note), note.attrs.class], ["Its 5-hour window is spent: extra usage covers it.", "inst-note is-warn"]);
    assert.doesNotMatch(textOf(body), /free again/);
    assert.deepEqual(classed(body, "inst-card-fig").map((x) => [textOf(x), x.attrs.class]), [["100%", "inst-card-fig is-warn"], ["40%", "inst-card-fig"]]);
    assert.deepEqual(classed(body, "inst-stack-part").map((x) => /sys-orange/.test(x.attrs.style)), [true, false], "its bar amber");
    // The account to switch to, covered too: its gauge amber.
    const sw = String(classed(body, "inst-switch-gauge")[0]?.attrs.html || "");
    assert.deepEqual([/sys-orange/.test(sw), /sys-red/.test(sw), textOf(classed(body, "inst-switch-fig")[0])], [true, false, "5h extra usage"]);
    // The Overview tile: the same window, amber.
    const tile = /** @type {any[]} */ (w.spec.tile?.(/** @type {any} */ (fakeH), "L", { open: () => {} }));
    assert.deepEqual(tile.flatMap((t) => classed(t, "ov-meter-fill").map((x) => x.attrs.class)), ["ov-meter-fill is-warn", "ov-meter-fill is-cyan"]);
    assert.equal(JSON.stringify(tile).includes("is-error"), false);
  });

  test("a spent Codex plan with reset credits: its credits, when it is free, and a reset credit offered", () => {
    const cx = row(
      [{ source: "account/rateLimits/read", identity: PLUS, windows: [win("primary", 100, NOW + HOUR)], credits: { has: false, unlimited: false, balance: "0" }, resetCredits: { available: 2, nextExpiresAt: NOW + 10 * DAY }, reached: "rate_limit_reached" }],
      { upstream: "cx", name: "Codex", type: "codex", agent: "codex", login: "codex login" },
    );
    const w = instrument(cx);
    const body = w.open();
    const text = textOf(body);
    assert.match(text, /Credits\|None/);
    assert.ok(text.includes(`Reset credits|The next one expires ${whenWords(NOW + 10 * DAY, NOW)}|2`), text);
    assert.equal(textOf(classed(body, "inst-note")[0]), `It's free again at ${whenWords(NOW + HOUR, NOW)}, in 1 h.`);
    assert.ok(String(classed(body, "inst-note")[0].attrs.class).includes("is-error"));
    const credit = buttonsOf(body).find((b) => textOf(b).endsWith("Use a reset credit"));
    assert.ok(String(credit.attrs.class).includes("is-primary"));
    credit.dispatch("click");
    assert.deepEqual([w.closes(), w.did], [1, ["reset credit cx"]], "the app's sheet asks before one is spent");
    const none = instrument({ ...cx, account: { ...cx.account, resetCredits: { available: 0, nextExpiresAt: null } } }).open();
    assert.equal(buttonsOf(none).some((b) => textOf(b).endsWith("Use a reset credit")), false, "none left: none offered");
    const later = instrument(cx, { now: NOW + 2 * HOUR }).open();
    assert.equal(textOf(classed(later, "inst-note")[0]), "It has reset since: Check now reads its new period.");
  });

  test("its notes: not said yet, nobody signed in, stopped with no window to show it, no windows and why", () => {
    const note = (/** @type {any} */ r) => textOf(classed(instrument(r).open(), "inst-note")[0]);
    assert.equal(note(row([], { says: true })), "Claude hasn't said which account it runs on yet. It says when it starts: Check now starts it.");
    assert.equal(note(row([], { name: "Codex", type: "codex" })), "Codex hasn't said which account it runs on yet. Check now asks it.");
    assert.equal(note(row([{ source: "s", identity: NONE }], { login: "codex login" })), "Nobody is signed in. Run |codex login| in a terminal, then Check now.");
    assert.equal(note(row([{ source: "s", identity: PLUS, windows: [win("primary", 20, NOW + HOUR)], reached: "workspace_owner_credits_depleted" }], { type: "codex" })), "The workspace has no credits left: add credits to it, or wait for the reset.");
    assert.equal(note(row([{ source: "s", identity: KEY, noWindows: "An Anthropic API key has no plan windows: it is billed by the token" }])), "An Anthropic API key has no plan windows: it is billed by the token");
    assert.equal(note(row([{ source: "s", identity: MAX }])), "The agent reports its plan's windows as it works: they show after its next turn.");
    const reset = instrument(row([{ source: "s", identity: MAX, windows: [win("five_hour", 90, NOW + HOUR)] }]), { now: NOW + 2 * HOUR });
    // The server said the window's state an hour before its reset; the widget's clock is past it.
    assert.equal(textOf(classed(reset.open(), "inst-meter")[0]), "5-hour window|90%|Reset");
  });

  // (fails before: yes — signed in as nobody said whom read as not said yet, in the popover and on the tile: a sign-in
  // that worked looked as one that had not)
  test("signed in, as nobody said whom yet: the popover and the tile say someone is signed in", () => {
    const s = createAgentAccounts({ now: () => NOW });
    s.signedIn("claude", "status");
    s.signedIn("cx", "sign-in");
    const claude = { ...row([], { says: true }), account: s.view("claude") };
    const codex = { ...row([], { upstream: "cx", name: "Codex", type: "codex" }), account: s.view("cx") };
    const note = (/** @type {any} */ r) => textOf(classed(instrument(r).open(), "inst-note")[0]);
    assert.equal(note(claude), "Claude is signed in, and hasn't said which account it runs on yet. It says when it starts: Check now starts it.");
    assert.equal(note(codex), "Codex is signed in, and hasn't said which account it runs on yet. Check now asks it.");
    const tile = (/** @type {any} */ r) => textOf(fakeH("div", {}, ...[instrument(r).spec.tile?.(fakeH, "L", { open: () => {} }) || []].flat()));
    assert.equal(tile(claude), "Claude is signed in, and hasn't said which account it runs on yet.");
    assert.equal(tile(row([], { says: true })), "Claude hasn't said which account it runs on yet.", "nothing known of it: as it was");
  });

  // (fails before: no — a guard the mutation pass asked for: no meter drew a window spent with no share said, or one
  // past its reset)
  test("a meter: a window spent with no share said is full; one past its reset draws no bar and no share", () => {
    const body = instrument(row([{ source: "s", identity: MAX, windows: [win("five_hour", null, NOW + HOUR, { status: "rejected" }), weekly(30, NOW - MIN)] }])).open();
    const meters = classed(body, "inst-meter").map((m) => [textOf(classed(m, "inst-card-fig")[0]), classed(m, "inst-stack")[0].attrs["aria-label"]]);
    assert.deepEqual(meters, [["Spent", "5-hour window 100%"], ["—", ""]]);
  });

  // (fails before: no — a guard the mutation pass asked for: no session had another account beside it, none signed in
  // from the popover, and no identity carried a detail beside its email or a key's name)
  test("Switch account: the same program's other accounts, one signed out signing in first; Sign in where the agent has a way", () => {
    const ways = [{ id: "claude-ai-login", name: "Claude Subscription", description: "Use Claude subscription" }];
    const me = row([{ source: "s", identity: MAX, windows: [win("five_hour", 42, NOW + HOUR)] }]);
    const ops = row([{ source: "s", identity: { ...MAX, email: "ops@example.com" }, windows: [win("five_hour", 10, NOW + HOUR)] }], { upstream: "claude-ops", label: "Ops", added: true });
    const home = row([{ source: "s", identity: NONE }], { upstream: "claude-home", label: "Home", added: true, ways });
    const old = row([{ source: "s", identity: NONE }], { upstream: "claude-old", label: "Old", added: true });
    const w = instrument(me, { rows: [me, ops, home, old] });
    const switches = classed(w.open(), "is-button");
    assert.deepEqual(switches.map((b) => [textOf(classed(b, "inst-row-label")[0]), "disabled" in b.attrs]), [["Ops", false], ["Home", false], ["Old", true]]);
    assert.equal(switches[2].attrs.title, summaryWords(old, NOW), "nobody signed in, no way of its own: its CLI's line");
    switches[1].dispatch("click");
    switches[0].dispatch("click");
    assert.deepEqual(w.did, ["sign in claude-home, then Switch to it", "switch to claude-ops"]);
    // Another program of the same agent's is not one of its accounts.
    const sdk = row([{ source: "s", identity: KEY }], { upstream: "cursor", name: "Cursor", agent: "cursor", type: "cursor-sdk" });
    const cli = row([], { upstream: "cursor-cli", name: "Cursor CLI", agent: "cursor", type: "acp", label: "CLI", added: true });
    const work = row([], { upstream: "cursor-work", name: "Cursor", agent: "cursor", type: "cursor-sdk", label: "Work", added: true });
    const c = instrument(sdk, { rows: [sdk, cli, work] }).open();
    assert.deepEqual(classed(c, "is-button").map((b) => textOf(classed(b, "inst-row-label")[0])), ["Work"]);
    // Sign in: only where the agent has a sign-in of its own; else the note names its CLI's line.
    const noWay = instrument(row([{ source: "s", identity: NONE }])).open();
    assert.equal(buttonsOf(noWay).some((b) => textOf(b).endsWith("Sign in")), false);
    const withWay = instrument(row([{ source: "s", identity: NONE }], { ways }));
    buttonsOf(withWay.open()).find((b) => textOf(b).endsWith("Sign in")).dispatch("click");
    assert.deepEqual(withWay.did, ["sign in claude"]);
    // Who: a key's name is its label's already; an email says who, whatever else the agent said.
    assert.equal(textOf(classed(instrument(row([{ source: "s", identity: KEY, noWindows: "billed by the token" }])).open(), "inst-sub")[0]), "Claude");
    assert.equal(textOf(classed(instrument(row([{ source: "s", identity: { ...MAX, detail: "SSO" } }])).open(), "inst-sub")[0]), "Claude| · Example Org| · |d••@example.com");
  });

  // (fails before: yes — the owner's words of 10-18: "When i press Check now on the account pop over widget it only
  // refreshes the current active account but does not refresh the limits of other available accounts on that coding
  // agent")
  test("Check now asks each of the agent's accounts at once: its tooltip says so, and another's word is said by its name only where its check came to nothing", () => {
    const me = row([{ source: "s", identity: MAX, windows: [win("five_hour", 42, NOW + HOUR)] }]);
    const home = row([{ source: "s", identity: { ...MAX, email: "home@example.com" } }], { upstream: "claude-home", label: "Home", added: true });
    const cli = row([], { upstream: "claude-cli", name: "Claude CLI", type: "acp-cli", label: "CLI", added: true });
    const cx = row([], { upstream: "cx", name: "Codex", type: "codex", agent: "codex" });
    assert.deepEqual(othersOf([me, home, cli, cx], me).map((x) => x.upstream), ["claude-home"], "the same agent on the same kind of upstream");
    assert.deepEqual(othersOf([me], me), []);
    const check = (/** @type {any} */ w) => buttonsOf(w.open()).find((b) => textOf(b).endsWith("Check now"));
    assert.equal(String(check(instrument(me, { rows: [me, home, cli, cx] })).attrs.title), "Ask Claude who it runs as, how much of its plan is used and its models now\nEach of its 2 accounts is asked");
    assert.equal(String(check(instrument(me)).attrs.title), "Ask Claude who it runs as, how much of its plan is used and its models now", "one account: its words alone");
    // The page: the widget's door asks the session's account and its others at once; another says a check that came
    // to nothing by its name, and a refusal names it.
    const app = read("src/ui/harness/app.js");
    assert.match(app, /session: \(\) => chosenAgent\(\),\s*check: \(upstream\) => checkAgent\(upstream\),/);
    assert.match(app, /async function checkAgent\(upstream\) \{\s*const r = state\.accounts\.find\(\(x\) => x\.upstream === upstream\);\s*await Promise\.all\(\[accountWord\(upstream, "check"\), \.\.\.\(r \? othersOf\(state\.accounts, r\) : \[\]\)\.map\(\(x\) => accountWord\(x\.upstream, "check", x\)\)\]\);\s*\}/);
    assert.match(app, /if \(beside\) \{\s*if \(r\?\.checked\?\.said && !r\.checked\.read\) toast\(`\$\{accountName\(beside\)\}: \$\{r\.checked\.said\}`\);/);
    assert.match(app, /`Couldn't check \$\{beside \? accountName\(beside\) : "the account"\}`/);
    // Settings → Coding agents and the sign-in sheet check the one account they show.
    assert.match(app, /const accountKeeper = \{\s*rows: \(\) => state\.accounts,\s*listen: \(fn\) => accountsHeard\.on\(fn\),\s*check: \(upstream\) => accountWord\(upstream, "check"\)\.then\(\(\) => \{\}\),/);
  });
});

describe("the limit card (harness conversation/interaction.js)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  const NOW = new Date(2026, 9, 8, 9, 0, 0).getTime();
  /** @param {any[]} reports @param {Record<string, any>} [o] */
  const row = (reports, o) => rowAt(NOW, reports, o);
  const FROM = row([{ source: "s", identity: MAX, windows: [win("five_hour", 100, NOW + HOUR)] }], { upstream: "claude", name: "Claude" });
  const SAME = row([{ source: "s", identity: { ...MAX, email: "ops@example.com" }, windows: [win("five_hour", 10, NOW + HOUR)] }], { upstream: "claude2", name: "Claude (ops)" });
  const OTHER = row([{ source: "s", identity: PLUS }], { upstream: "cx", name: "Codex", type: "codex", agent: "codex" });
  /** @param {Record<string, any>} [o] @returns {any} */
  const limit = (o = {}) => ({ windows: [{ id: "five_hour", label: "5-hour", resetsAt: NOW + HOUR }], freeAt: NOW + HOUR, reached: null, account: { kind: "account", label: "Claude Max", email: "dev@example.com" }, upstream: "claude", ...o });
  /**
   * The card over these rows, its ways recorded; a reset credit answers `outcome`.
   * @param {any} lim @param {any[]} rows @param {{ outcome?: string | null }} [o]
   */
  const card = (lim, rows, o = {}) => {
    /** @type {string[]} */
    const did = [];
    /** @type {number | null} */
    let armed = null;
    const el = /** @type {any} */ (limitCard(lim, {
      message: "You've hit your 5-hour limit",
      detail: "rate_limit",
      rows: () => rows,
      now: () => NOW,
      onContinue: (u) => did.push(`continue ${u}`),
      resumeAt: () => armed,
      onResume: (at) => {
        armed = at;
        did.push(at == null ? "resume off" : `resume in ${(at - NOW) / MIN} min`);
      },
      onResetCredit: async (u) => {
        did.push(`credit ${u}`);
        return o.outcome === undefined ? "reset" : o.outcome;
      },
      onRetry: () => did.push("retry"),
      onDismiss: () => did.push("dismiss"),
    }));
    /** The buttons in order. @returns {any[]} */
    const buttons = () => el.querySelectorAll("button");
    /** The one button whose words match. @param {RegExp} re */
    const button = (re) => buttons().find((b) => re.test(b.textContent));
    /** What a person sees: the buttons not hidden. */
    const shown = () => buttons().filter((b) => !b.classList.contains("hidden")).map((b) => b.textContent);
    return { el, did, button, buttons, shown };
  };

  // (fails before: yes — the review of a2e843221: a Retry the page could not send, its chat's turn still running, spent
  // the card — every way disabled, and the Resume it had armed cancelled)
  test("a Retry the page could not send leaves the card as it was, its Resume armed", () => {
    /** @type {number | null} */
    let armed = NOW + HOUR;
    const el = /** @type {any} */ (limitCard(limit({ freeAt: NOW - MIN }), { message: "m", rows: () => [], now: () => NOW, resumeAt: () => armed, onResume: (at) => void (armed = at), onRetry: () => false }));
    const retry = el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Retry");
    retry.dispatch("click");
    assert.deepEqual([!!retry.disabled, armed], [false, NOW + HOUR]);
  });

  // (fails before: yes — the review of a164c1573: the card took any answer but false as a Retry that went — one whose
  // send was refused once asked for spent it, [true, true, null]: every way disabled, the Resume it had armed cancelled)
  test("a Retry whose send is refused once asked for — its answer resolving false, or to why — leaves the card as it was, its Resume armed; one that went spends it", async () => {
    /** @param {any} answer */
    const press = async (answer) => {
      /** @type {number | null} */
      let armed = NOW + HOUR;
      const el = /** @type {any} */ (limitCard(limit({ freeAt: NOW - MIN }), { message: "m", rows: () => [], now: () => NOW, resumeAt: () => armed, onResume: (at) => void (armed = at), onRetry: () => answer }));
      const retry = el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Retry");
      retry.dispatch("click");
      const held = !!retry.disabled;
      await new Promise((r) => setImmediate(r));
      return [held, !!retry.disabled, armed];
    };
    assert.deepEqual(await press(Promise.resolve(false)), [true, false, NOW + HOUR], "held while the send answers, then as it was");
    assert.deepEqual(await press(Promise.resolve("Another tab writes this session")), [true, false, NOW + HOUR]);
    assert.deepEqual(await press(Promise.resolve(true)), [true, true, null], "it went: spent, the countdown let go");
  });

  // (fails before: yes — the hunt's lead (e): a Continue on under way stood every way down, the countdown's Cancel with it,
  // [true, true]: nothing on the card could stop a write that never answered)
  test("while a Continue on is under way, the countdown's Cancel stays live: it stops the way, and the card comes back as it stood", async () => {
    /** @type {number | null} */
    let armed = NOW + HOUR;
    /** @type {(v: boolean) => void} */
    let answer = () => {};
    const el = /** @type {any} */ (limitCard(limit(), {
      message: "m",
      rows: () => [FROM, SAME],
      now: () => NOW,
      resumeAt: () => armed,
      // The page's Cancel lets the countdown go and stops the Continue on, which answers that it was not taken.
      onResume: (at) => {
        armed = at;
        if (at == null) answer(false);
      },
      onContinue: () => new Promise((r) => (answer = r)),
    }));
    const button = (/** @type {RegExp} */ re) => el.querySelectorAll("button").find((/** @type {any} */ b) => re.test(b.textContent));
    button(/^Continue on/).dispatch("click");
    const cancel = button(/Cancel/);
    assert.deepEqual([!!button(/^Continue on/).disabled, !!cancel.disabled], [true, false], "the way under way stands down; Cancel does not");
    cancel.dispatch("click");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([!!button(/^Continue on/).disabled, armed], [false, null], "the card back, the countdown let go");
  });

  // (fails before: yes — found reading the code: a Continue on under way with no countdown armed stood every way down and
  // offered no Cancel, [true, "no Cancel"]: nothing on the card could stop a write that never answered)
  test("a Continue on under way with no countdown armed has a Cancel of its own: it stops the way, and the card comes back as it stood", async () => {
    /** @type {(v: boolean) => void} */
    let answer = () => {};
    let cancelled = 0;
    const el = /** @type {any} */ (limitCard(limit(), {
      message: "m",
      rows: () => [FROM, SAME],
      now: () => NOW,
      resumeAt: () => null,
      onResume: () => {},
      onContinue: () => new Promise((r) => (answer = r)),
      // The page stops the way, which answers that it was not taken.
      onCancel: () => {
        cancelled++;
        answer(false);
      },
    }));
    /** The button whose words match, where it shows. @param {RegExp} re */
    const button = (re) => el.querySelectorAll("button").find((/** @type {any} */ b) => re.test(b.textContent) && !b.classList.contains("hidden"));
    const before = button(/^Cancel$/) ?? null;
    button(/^Continue on/).dispatch("click");
    const cancel = button(/^Cancel$/);
    const under = [!!button(/^Continue on/).disabled, cancel ? !!cancel.disabled : "no Cancel"];
    cancel?.dispatch("click");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([before, under, cancelled, !!button(/^Continue on/).disabled, button(/^Cancel$/) ?? null], [null, [true, false], 1, false, null], "none before the way; live while it is under way; gone with it");
  });

  // (fails before: yes — the review of bbe9eab53: Continue on that the page refused, a turn running in the chat or a
  // message waiting for it, spent the card — every way disabled, the Resume it had armed cancelled — though the toast
  // said to answer it once the chat was free)
  test("a Continue on or Continue with the page could not take gives the card back as it was, its Resume armed again", async () => {
    for (const refused of [false, Promise.resolve(false)]) {
      /** @type {number | null} */
      let armed = NOW + HOUR;
      /** @type {string[]} */
      const asked = [];
      const el = /** @type {any} */ (limitCard(limit(), {
        message: "m",
        rows: () => [FROM, SAME, OTHER],
        now: () => NOW,
        resumeAt: () => armed,
        onResume: (at) => void (armed = at),
        onContinue: (u) => (asked.push(u), refused),
      }));
      const buttons = () => /** @type {any[]} */ (el.querySelectorAll("button"));
      buttons().find((b) => /^Continue on/.test(b.textContent)).dispatch("click");
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(asked, ["claude2"]);
      assert.deepEqual(buttons().filter((b) => b.disabled).map((b) => b.textContent), [], "every way stands again");
      assert.equal(armed, NOW + HOUR, "the countdown armed again");
      assert.equal(buttons().find((b) => /^Resume/.test(b.textContent))?.textContent, `Resumes at ${whenWords(NOW + HOUR, NOW)} · Cancel`);
    }
  });

  // (fails before: yes — the review of 134f74bd5: a Continue picked from a menu left open, once Retry had taken the
  // card, went all the same and gave every way back, Retry's included; and one picked while a Continue was under way
  // went a second time)
  test("a Continue picked from a menu left open — once a way took the card, or while a Continue is under way — does nothing", async () => {
    /** @type {string[]} */
    const asked = [];
    /** @type {(v: unknown) => void} */
    let answer = () => {};
    let retried = 0;
    const el = /** @type {any} */ (limitCard(limit({ freeAt: NOW - MIN }), {
      message: "m",
      rows: () => [FROM, SAME, OTHER],
      now: () => NOW,
      onContinue: (u) => (asked.push(u), new Promise((r) => (answer = r))),
      onRetry: () => ++retried,
    }));
    const buttons = () => /** @type {any[]} */ (el.querySelectorAll("button"));
    // A menu's row is no button of the card's: pressed while the card's own are disabled.
    const pick = () => buttons().find((b) => /^Continue on/.test(b.textContent)).dispatch("click");
    pick();
    pick();
    assert.deepEqual(asked, ["claude2"], "one Continue at a time");
    answer(false);
    await settle();
    assert.deepEqual(buttons().filter((b) => b.disabled).map((b) => b.textContent), [], "refused: the card given back");
    buttons().find((b) => b.textContent === "Retry").dispatch("click");
    pick();
    await settle();
    assert.deepEqual([asked, retried], [["claude2"], 1], "Retry took the card: the row picked after it sends nothing");
    assert.deepEqual(buttons().filter((b) => !b.disabled && /^(Continue|Retry|Resume)/.test(b.textContent)).map((b) => b.textContent), [], "and nothing comes back");
  });

  // (fails before: yes — the review of 19650663a: a card a Continue on spent stayed spent where its words were refused
  // after they went — its Resume armed again behind a Cancel nobody could press — and let go of the countdown itself,
  // after the page had armed it again)
  test("a card a Continue on spent is given back by the page, and a card another way spent is not", async () => {
    /** @type {() => void} */
    let back = () => {};
    let armed = /** @type {number | null} */ (NOW + HOUR);
    const el = /** @type {any} */ (limitCard(limit({ freeAt: NOW - MIN }), {
      message: "m",
      rows: () => [FROM, SAME],
      now: () => NOW,
      resumeAt: () => armed,
      onResume: (at) => void (armed = at),
      onContinue: async () => true,
      onRetry: () => true,
      watchResume: (_p, b) => void (back = b),
    }));
    const buttons = () => /** @type {any[]} */ (el.querySelectorAll("button"));
    buttons().find((b) => /^Continue on/.test(b.textContent)).dispatch("click");
    await settle();
    assert.equal(armed, NOW + HOUR, "the countdown is the page's to let go");
    assert.ok(buttons().find((b) => /^Continue on/.test(b.textContent)).disabled, "spent");
    back();
    assert.deepEqual(buttons().filter((b) => b.disabled).map((b) => b.textContent), [], "given back");
    buttons().find((b) => b.textContent === "Retry").dispatch("click");
    back();
    assert.ok(buttons().find((b) => /^Continue on/.test(b.textContent)).disabled, "Retry spent it: nothing to give back");
  });

  // (fails before: yes — the review of 134f74bd5: the card said the countdown only as it was pressed, so one drawn while
  // a Continue on held it, or one whose countdown fired, said the opposite of the page's)
  test("its Resume says the page's countdown as the page changes it away from the card", () => {
    /** @type {number | null} */
    let armed = null;
    /** @type {() => void} */
    let paint = () => {};
    const el = /** @type {any} */ (limitCard(limit(), { message: "m", rows: () => [FROM], now: () => NOW, resumeAt: () => armed, onResume: (at) => void (armed = at), watchResume: (p) => void (paint = p) }));
    const resume = el.querySelectorAll("button").find((/** @type {any} */ b) => /^Resume/.test(b.textContent));
    armed = NOW + HOUR;
    paint();
    assert.equal(resume.textContent, `Resumes at ${whenWords(NOW + HOUR, NOW)} · Cancel`);
    armed = null;
    paint();
    assert.equal(resume.textContent, `Resume at ${whenWords(NOW + HOUR, NOW)}`, "fired, or let go");
  });

  // (fails before: yes — found reading the code: the card read its reset once, as it was drawn — its reset come on
  // screen, it still offered "Resume at 9:00 AM", a time gone, no Retry, and said "It's free again at 9:00 AM, in 1 s.")
  test("its reset come while it is on screen brings Retry in the countdown's place, and never a Resume at a time gone: at its time, or as the page says the countdown again", async () => {
    let clock = NOW;
    /** @type {number | null} */
    let armed = null;
    /** @type {() => void} */
    let paint = () => {};
    /** The card over these rows, on the page, its clock the test's. @param {any[]} rows @param {number} freeAt */
    const onPage = (rows, freeAt) => {
      const el = /** @type {any} */ (limitCard(limit({ freeAt }), { message: "m", rows: () => rows, now: () => clock, onContinue: () => false, resumeAt: () => armed, onResume: (at) => void (armed = at), onRetry: () => true, watchResume: (p) => void (paint = p) }));
      doc.document.body.append(el);
      const buttons = () => /** @type {any[]} */ (el.querySelectorAll("button"));
      return {
        el,
        shown: () => buttons().filter((b) => !b.classList.contains("hidden")).map((b) => b.textContent),
        retry: () => buttons().find((b) => b.textContent === "Retry"),
        line: () => el.querySelector(".ix-limit-line").textContent,
      };
    };
    // None armed: at its time the card brings Retry — the way on, where Resume was — and says the plan has reset.
    const a = onPage([FROM], NOW + 40);
    assert.deepEqual(a.shown(), [`Resume at ${whenWords(NOW + 40, NOW)}`, "Show details"]);
    clock = NOW + 40;
    await new Promise((r) => setTimeout(r, 100));
    const one = [a.shown(), !!a.retry()?.classList.contains("primary"), a.line()];
    // Armed: the countdown says itself until it fires, a second after the reset; then Retry stands in its place.
    clock = NOW;
    const b = onPage([FROM, SAME], NOW + HOUR);
    armed = NOW + HOUR;
    clock = NOW + HOUR;
    paint();
    const armedNow = b.shown();
    armed = null;
    paint();
    a.el.remove();
    b.el.remove();
    assert.deepEqual(one, [["Retry", "Show details"], true, "It has reset since: the turn can go again."]);
    assert.deepEqual(armedNow, ["Continue on Claude (ops)", `Resumes at ${whenWords(NOW + HOUR, NOW + HOUR)} · Cancel`, "Retry", "Show details"]);
    assert.deepEqual([b.shown(), !!b.retry()?.classList.contains("primary")], [["Continue on Claude (ops)", "Retry", "Show details"], false], "fired: no Resume at a time gone; Continue on stays the way first offered");
  });

  // (fails before: yes — the card never heard its countdown fire: a Retry pressed after "continue" went sent a second
  // message, [null, [], 1]; a way taken was said nowhere, and the card drawn again offered its ways anew)
  test("a way taken — the page's countdown that fired, a Continue on or a Retry that went — is said in the ways' place, and the card offers none again, drawn again too", async () => {
    /** The way taken, as the page keeps it on the turn. @type {any} */
    let kept = null;
    let retried = 0;
    /** @type {() => void} */
    let paint = () => {};
    const draw = () => /** @type {any} */ (limitCard(limit({ freeAt: NOW - MIN }), {
      message: "m",
      rows: () => [FROM, SAME],
      now: () => NOW,
      onContinue: async () => true,
      onRetry: () => (++retried, true),
      taken: () => kept,
      onTaken: (way) => void (kept = way),
      watchResume: (p) => void (paint = p),
    }));
    /** What the card says it took, and the ways it still offers. @param {any} el */
    const seen = (el) => {
      const said = el.querySelector(".ix-limit-taken");
      const ways = el.querySelectorAll("button").filter((/** @type {any} */ b) => !b.disabled && /^(Continue|Retry|Resume)/.test(b.textContent));
      return [said && !said.classList.contains("hidden") ? said.textContent : null, ways.map((/** @type {any} */ b) => b.textContent)];
    };
    const press = (/** @type {any} */ el, /** @type {RegExp} */ re) => el.querySelectorAll("button").find((/** @type {any} */ b) => re.test(b.textContent)).dispatch("click");
    // The countdown fired: the page keeps its way on the turn, and says the card again — a Retry pressed after sends nothing.
    const a = draw();
    kept = { by: "resume", said: "“continue” went at the reset" };
    paint();
    press(a, /^Retry$/);
    const fired = [...seen(a), retried];
    // A Continue on that went, and the card drawn again; a Retry that went.
    kept = null;
    const b = draw();
    press(b, /^Continue on/);
    await settle();
    const continued = [...seen(b), kept?.by];
    const redrawn = seen(draw());
    kept = null;
    const c = draw();
    press(c, /^Retry$/);
    assert.deepEqual([fired, continued, redrawn, seen(c)], [
      ["“continue” went at the reset", [], 0],
      ["Continued on Claude (ops)", [], "continue"],
      ["Continued on Claude (ops)", []],
      ["Sent again", []],
    ]);
  });

  test("its words and its ways: Continue on the agent's other account first, Continue with another agent, Resume at the reset", async () => {
    const c = card(limit(), [FROM, SAME, OTHER]);
    assert.equal(c.el.querySelector(".ix-limit-title").textContent, "Claude Max's 5-hour window is spent");
    assert.equal(c.el.querySelector(".ix-limit-line").textContent, `It's free again at ${whenWords(NOW + HOUR, NOW)}, in 1 h.`);
    assert.deepEqual(c.shown(), ["Continue on Claude (ops)", "Continue with Codex", `Resume at ${whenWords(NOW + HOUR, NOW)}`, "Show details", "Dismiss"], "Retry waits for the reset");
    assert.deepEqual([c.button(/^Continue on/).classList.contains("primary"), c.button(/^Continue with/).classList.contains("primary"), c.button(/^Resume/).classList.contains("primary")], [true, false, false]);
    assert.equal(c.button(/^Continue on/).getAttribute("title"), summaryWords(SAME, NOW));
    c.button(/^Resume/).dispatch("click");
    c.button(/^Continue on/).dispatch("click");
    await settle();
    assert.deepEqual(c.did, ["resume in 60 min", "continue claude2"], "a Continue leaves the countdown to the page, which holds it while it takes the way");
    assert.deepEqual(c.buttons().filter((b) => b.disabled).map((b) => b.textContent), ["Continue on Claude (ops)", "Continue with Codex", `Resumes at ${whenWords(NOW + HOUR, NOW)} · Cancel`, "Retry"], "and stands the other ways down, the countdown said as the page has it");
    assert.equal(card(limit(), [FROM, OTHER]).button(/^Continue with/).classList.contains("primary"), true, "no other account: another agent comes first");
  });

  // (fails before: yes — an agent signed in as nobody said whom was no way on: the card offered Resume alone)
  test("another agent signed in as nobody said whom is a way on: Continue with it, its title saying it is signed in", async () => {
    const s = createAgentAccounts({ now: () => NOW });
    s.signedIn("agy", "sign-in");
    const quiet = { ...row([], { upstream: "agy", name: "Antigravity", agent: "antigravity", says: false }), account: s.view("agy") };
    const c = card(limit(), [FROM, quiet]);
    assert.deepEqual(c.shown(), ["Continue with Antigravity", `Resume at ${whenWords(NOW + HOUR, NOW)}`, "Show details", "Dismiss"]);
    assert.equal(c.button(/^Continue with/).getAttribute("title"), "Antigravity is signed in — it doesn't say which account it runs on");
    c.button(/^Continue with/).dispatch("click");
    await settle();
    assert.deepEqual(c.did, ["continue agy"]);
  });

  test("Resume, the only way on: armed, it says when it sends and offers the cancel; pressed again, it lets go", () => {
    const c = card(limit(), [FROM]);
    const resume = c.button(/^Resume/);
    assert.equal(resume.classList.contains("primary"), true);
    assert.match(resume.title, /once the plan is free again — while this tab stays open/);
    resume.dispatch("click");
    assert.equal(resume.textContent, `Resumes at ${whenWords(NOW + HOUR, NOW)} · Cancel`);
    assert.equal(resume.title, "Cancel: nothing is sent at the reset");
    resume.dispatch("click");
    assert.equal(resume.textContent, `Resume at ${whenWords(NOW + HOUR, NOW)}`);
    assert.deepEqual(c.did, ["resume in 60 min", "resume off"]);
  });

  test("a plan free again, or a limit with no reset said: Retry at once, and no Resume", () => {
    const free = card(limit({ freeAt: NOW - 1 }), [FROM]);
    assert.equal(free.el.querySelector(".ix-limit-line").textContent, "It has reset since: the turn can go again.");
    assert.deepEqual(free.shown(), ["Retry", "Show details", "Dismiss"]);
    free.button(/^Retry$/).dispatch("click");
    assert.deepEqual([free.did, free.button(/^Retry$/).disabled], [["retry"], true]);
    const workspace = card(limit({ windows: [], freeAt: null, reached: "workspace_owner_usage_limit_reached", upstream: "cx", account: { kind: "account", label: "ChatGPT Plus", email: null } }), [OTHER]);
    assert.equal(workspace.el.querySelector(".ix-limit-title").textContent, "ChatGPT Plus has reached its plan's limit");
    assert.equal(workspace.el.querySelector(".ix-limit-line").textContent, "The workspace's spend limit is reached: raise it, or wait for the reset.");
    assert.deepEqual(workspace.shown(), ["Retry", "Show details", "Dismiss"]);
  });

  test("a spent Codex plan with reset credits: a credit that worked makes Retry the way on; one that didn't changes nothing", async () => {
    const cx = row(
      [{ source: "s", identity: PLUS, windows: [win("primary", 100, NOW + HOUR)], resetCredits: { available: 2, nextExpiresAt: null }, reached: "rate_limit_reached" }],
      { upstream: "cx", name: "Codex", type: "codex", agent: "codex" },
    );
    const lim = limit({ upstream: "cx", windows: [{ id: "primary", label: "5-hour", resetsAt: NOW + HOUR }], reached: "rate_limit_reached" });
    const c = card(lim, [cx]);
    assert.deepEqual(c.shown(), [`Resume at ${whenWords(NOW + HOUR, NOW)}`, "Use a reset credit", "Show details", "Dismiss"]);
    assert.equal(c.button(/reset credit/).getAttribute("title"), "2 left: resets the plan's windows now");
    c.button(/^Resume/).dispatch("click");
    c.button(/reset credit/).dispatch("click");
    await settle();
    assert.deepEqual(c.did, ["resume in 60 min", "credit cx", "resume off"], "the countdown has nothing left to wait for");
    assert.deepEqual(c.shown(), ["Retry", "Show details", "Dismiss"]);
    assert.deepEqual([c.button(/^Retry$/).classList.contains("primary"), c.button(/^Retry$/).classList.contains("ghost")], [true, false]);
    c.button(/^Retry$/).dispatch("click");
    assert.equal(c.button(/reset credit/).disabled, true, "a way taken stands it down too");
    const refused = card(lim, [cx], { outcome: "noCredit" });
    refused.button(/reset credit/).dispatch("click");
    await settle();
    assert.deepEqual(refused.shown(), [`Resume at ${whenWords(NOW + HOUR, NOW)}`, "Use a reset credit", "Show details", "Dismiss"]);
    // (fails before: no — a guard the mutation pass asked for: no credit had already reset the plan)
    const already = card(lim, [cx], { outcome: "alreadyRedeemed" });
    already.button(/reset credit/).dispatch("click");
    await settle();
    assert.deepEqual(already.shown(), ["Retry", "Show details", "Dismiss"], "a credit that had already reset it: the plan is free");
    // None offered: not Codex's, not spent, or none left.
    assert.equal(card(limit(), [FROM]).button(/reset credit/), undefined);
    const fresh = row([{ source: "s", identity: PLUS, windows: [win("primary", 20, NOW + HOUR)], resetCredits: { available: 2, nextExpiresAt: null } }], { upstream: "cx", type: "codex", agent: "codex" });
    assert.equal(card(lim, [fresh]).button(/reset credit/), undefined);
    const spentOut = row([{ source: "s", identity: PLUS, windows: [win("primary", 100, NOW + HOUR)], resetCredits: { available: 0, nextExpiresAt: null } }], { upstream: "cx", type: "codex", agent: "codex" });
    assert.equal(card(lim, [spentOut]).button(/reset credit/), undefined);
  });

  // (fails before: yes — the lead of 11-02, verified: past the reset — the card drawn after it, or it come on screen —
  // "Use a reset credit" stood beside Retry, its account not yet checked again)
  test("a reset credit is offered only while the plan's reset is still to come: drawn after it, or as it comes on screen, the card offers Retry, and no credit — the account not yet checked again", () => {
    const cx = row(
      [{ source: "s", identity: PLUS, windows: [win("primary", 100, NOW + HOUR)], resetCredits: { available: 2, nextExpiresAt: null }, reached: "rate_limit_reached" }],
      { upstream: "cx", name: "Codex", type: "codex", agent: "codex" },
    );
    let clock = NOW;
    /** @type {() => void} */
    let paint = () => {};
    /** The card for a Codex limit free at `freeAt`, its account still read as spent. @param {number} freeAt */
    const draw = (freeAt) => /** @type {any} */ (limitCard(limit({ upstream: "cx", windows: [{ id: "primary", label: "5-hour", resetsAt: freeAt }], freeAt, reached: "rate_limit_reached" }), {
      message: "m",
      rows: () => [cx],
      now: () => clock,
      resumeAt: () => null,
      onResume: () => {},
      onResetCredit: async () => "reset",
      onRetry: () => true,
      watchResume: (p) => void (paint = p),
    }));
    const shown = (/** @type {any} */ el) => el.querySelectorAll("button").filter((/** @type {any} */ b) => !b.classList.contains("hidden")).map((/** @type {any} */ b) => b.textContent);
    const after = shown(draw(NOW - MIN));
    const before = draw(NOW + HOUR);
    const was = shown(before);
    clock = NOW + HOUR;
    paint();
    assert.deepEqual([after, was, shown(before)], [
      ["Retry", "Show details"],
      [`Resume at ${whenWords(NOW + HOUR, NOW)}`, "Use a reset credit", "Show details"],
      ["Retry", "Show details"],
    ]);
  });

  test("Show details: the agent's own words; Dismiss", () => {
    const c = card(limit(), [FROM]);
    const detail = c.el.querySelector(".ix-detail");
    assert.equal(detail.classList.contains("hidden"), true);
    c.button(/^Show details$/).dispatch("click");
    assert.deepEqual([detail.classList.contains("hidden"), detail.textContent], [false, "You've hit your 5-hour limit\n\nrate_limit"]);
    assert.ok(c.button(/^Hide details$/));
    c.button(/^Dismiss$/).dispatch("click");
    assert.deepEqual(c.did, ["dismiss"]);
  });
});

describe("Home → Health: a coding agent's card (the console's pages/home.js)", () => {
  /**
   * Home's Health pane on the recording DOM over these agents' rows; `answers` stands in for the server by path.
   * @param {any[]} rows @param {{ upstreams: any[], agents?: any[], answers?: Record<string, (o: any) => any> }} o
   */
  const health = async (rows, { upstreams, agents = [], answers = {} }) => {
    /** @type {[string, string][]} */
    const toasts = [];
    Object.assign(uiState, {
      homePane: "health",
      requests: [],
      summary: {},
      keys: [],
      // The page starts with none: the pane reads them with its other reads.
      accounts: [],
      schema: { upstreamTypes: { acp: { keyless: true, agent: true }, codex: { keyless: true, agent: true }, "cursor-sdk": { keyless: false, agent: true } } },
      config: { server: { host: "127.0.0.1", port: 20300 }, upstreams, routes: [], rules: {} },
    });
    /** @type {Record<string, (o: any) => any>} */
    const said = {
      "/usage/upstreams?hours=24": () => ({ upstreams: {}, health: {} }),
      "/acp/agents": () => ({ agents }),
      "/agent-accounts": () => ({ agents: rows }),
      ...answers,
    };
    const later = () => new Promise(() => {});
    bindUi({
      h: fakeH, drawIn: fakeDrawIn, fmt, HOME_PANES,
      api: (/** @type {string} */ path, /** @type {any} */ o) => (said[path] ? Promise.resolve().then(() => said[path](o)) : later()),
      memStatus: later,
      startFacts: () => null,
      goto: (/** @type {string} */ _tab, /** @type {string} */ label) => fakeH("a", {}, label),
      go() {}, render() {}, toast: (/** @type {string} */ msg, /** @type {string} */ kind = "ok") => toasts.push([msg, kind]),
      empty: (/** @type {string} */ title) => fakeH("div", {}, title),
      copyline: (/** @type {string} */ text) => fakeH("code", { class: "copyline" }, text),
      secretLine: (/** @type {string} */ key) => fakeH("code", { class: "secret" }, `${key.slice(0, 3)}…`),
      requestsTable: () => fakeH("table"), liveTree: () => [], liveRow: () => fakeH("div"), startLiveTicker() {}, routeMeaning: () => "",
      store: { get: () => null, set() {} },
    });
    const page = overview();
    await settle();
    /** The card of one upstream, found by its name. @param {string} name */
    const cardOf = (name) => findAll(page, "sub-card").find((c) => textOf(c).startsWith(`${name}|`));
    return { page, cardOf, toasts };
  };
  /** Every node carrying a class. @param {any} el @param {string} cls @returns {any[]} */
  const findAll = (el, cls) => {
    /** @type {any[]} */
    const out = [];
    /** @param {any} n */
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
      for (const k of n.kids || []) walk(k);
    };
    walk(el);
    return out;
  };
  // The page reads the clock itself: each test's rows are as of its start.
  /** @param {number} now @param {any[]} reports @param {Record<string, any>} [o] */
  const row = (now, reports, o) => rowAt(now, reports, o);
  const claudeUp = { id: "claude", name: "Claude", type: "acp", acp: {} };

  test("who pays, each window's share with its reset and its bar, the extra usage, how fresh; the email masked until clicked", async () => {
    const NOW = Date.now();
    const r = row(NOW,[{ source: "s", identity: MAX, windows: [win("five_hour", 42, NOW + 72 * MIN), weekly(85, NOW + 3 * DAY)], extra: { using: false, status: "allowed", resetsAt: null, off: null } }]);
    const { cardOf } = await health([r], { upstreams: [claudeUp], agents: [{ id: "claude", installed: true, loggedIn: true }] });
    const card = cardOf("Claude");
    const text = textOf(card);
    assert.ok(text.startsWith("Claude|agent|near its limit|coding agent · its own login|Paid by|Claude Max|Example Org|d••@example.com"), text);
    assert.ok(text.includes("|5-hour window|42%|resets in 1 h 12 m|"), text);
    assert.ok(text.includes(`|Weekly window|85%|resets ${whenWords(NOW + 3 * DAY, NOW)}|`), text);
    assert.ok(text.includes("|Extra usage|Available|"), text);
    assert.deepEqual(findAll(card, "quota-bar").map((b) => [b.kids[0].attrs.class, b.kids[0].attrs.style]), [["", "width:42%"], ["warn", "width:85%"]]);
    assert.match(text, /\|updated just now\|/);
    const email = findAll(card, "golink")[0];
    email.dispatch("click");
    assert.ok(textOf(cardOf("Claude")).includes("|Claude Max|Example Org|dev@example.com"), "shown once clicked, drawn again");
    findAll(cardOf("Claude"), "golink")[0].dispatch("click");
    assert.ok(textOf(cardOf("Claude")).includes("|d••@example.com"));
  });

  // (fails before: yes — a week spent past which extra usage pays said "plan spent" in red, the account still serving)
  // (the Fable 5.2 re-read's finding 10: the bar was red under the amber pill; a covered window is amber wherever it shows)
  test("a spent week extra usage pays past: the pill says it is on extra usage, the week's bar still full, and amber as the pill is", async () => {
    const NOW = Date.now();
    const r = row(NOW, [{ source: "s", identity: MAX, windows: [weekly(100, NOW + 3 * DAY, { status: "rejected" })], extra: { using: true, status: "allowed", resetsAt: null, off: null, enabled: true, spent: 169361, limit: null, currency: "USD" } }]);
    const { cardOf } = await health([r], { upstreams: [claudeUp], agents: [{ id: "claude", installed: true, loggedIn: true }] });
    const text = textOf(cardOf("Claude"));
    assert.ok(text.startsWith("Claude|agent|on extra usage|"), text);
    assert.deepEqual(findAll(cardOf("Claude"), "quota-bar")[0].kids[0].attrs, { class: "warn", style: "width:100%" });
    assert.equal(findAll(cardOf("Claude"), "quota-bar")[0].attrs.title, "Weekly window: spent, extra usage covers it");
  });

  test("a spent Codex plan: the pill, the spent bar, its credits and reset credits; signed out: how to sign in; one that doesn't say", async () => {
    const NOW = Date.now();
    const cx = row(
      NOW,
      [{ source: "s", identity: PLUS, windows: [win("primary", 100, NOW + HOUR), win("secondary", 64, NOW + 3 * DAY, { kind: "weekly", label: "Weekly", windowMins: 10080 })], credits: { has: false, unlimited: false, balance: "0" }, resetCredits: { available: 2, nextExpiresAt: NOW + 10 * DAY }, reached: "rate_limit_reached" }],
      { upstream: "cx", name: "Codex", type: "codex", agent: "codex", login: "codex login" },
    );
    const out = row(NOW, [{ source: "s", identity: NONE }], { upstream: "out", name: "Signed out", type: "codex", agent: "codex", login: "codex login" });
    const plain = row(NOW, [], { upstream: "plain", name: "Plain", says: false, login: null });
    const upstreams = [{ id: "cx", name: "Codex", type: "codex" }, { id: "out", name: "Signed out", type: "codex" }, { id: "plain", name: "Plain", type: "acp", acp: {} }];
    const { cardOf } = await health([cx, out, plain], { upstreams });
    const spent = textOf(cardOf("Codex"));
    assert.ok(spent.startsWith("Codex|agent|plan spent|"), spent);
    assert.ok(spent.includes("|Credits|none|"), spent);
    assert.ok(spent.includes(`|Reset credits|2|the next one expires ${whenWords(NOW + 10 * DAY, NOW)}|`), spent);
    assert.deepEqual(findAll(cardOf("Codex"), "quota-bar")[0].kids[0].attrs, { class: "bad", style: "width:100%" });
    assert.doesNotMatch(spent, /Stopped/, "the spent window says it");
    const signedOut = textOf(cardOf("Signed out"));
    assert.ok(signedOut.startsWith("Signed out|agent|not signed in|"), signedOut);
    assert.ok(signedOut.includes("|Paid by|nobody is signed in|To fix|run codex login in a terminal, then Check now|"), signedOut);
    assert.ok(textOf(cardOf("Plain")).includes("|Plan limits|kept by the agent itself: it doesn't say its account or its plan's windows|"));
  });

  // (fails before: no — a guard the mutation pass asked for: no agent's CLI said nobody was signed in before the agent
  // did, and no window was spent with no share said, or past its reset)
  test("before the agent says, its CLI's word on the login; a window spent with no share is a full bar, one reset none", async () => {
    const NOW = Date.now();
    const quiet = await health([row(NOW, [])], { upstreams: [claudeUp], agents: [{ id: "claude", installed: true, loggedIn: false }] });
    const said = textOf(quiet.cardOf("Claude"));
    assert.ok(said.startsWith("Claude|agent|not signed in|") && said.includes("|Paid by|nobody is signed in|"), said);
    const odd = row(NOW, [{ source: "s", identity: MAX, windows: [win("five_hour", null, NOW + HOUR, { status: "rejected" }), weekly(30, NOW - MIN)] }]);
    const { cardOf } = await health([odd], { upstreams: [claudeUp], agents: [{ id: "claude", installed: true, loggedIn: true }] });
    const text = textOf(cardOf("Claude"));
    assert.ok(text.includes("|5-hour window|spent|") && text.includes("|Weekly window|reset|its new period shows once the agent reports it|"), text);
    assert.deepEqual(findAll(cardOf("Claude"), "quota-bar").map((b) => [b.kids[0].attrs.class, b.kids[0].attrs.style]), [["bad", "width:100%"]]);
  });

  test("Check now asks the agent and draws its answer at once; one that fails says so and keeps what the route still said", async () => {
    const before = row(Date.now(), [], { upstream: "claude" });
    const afterRow = row(Date.now(), [{ source: "_auth/status_update", identity: MAX }], { upstream: "claude" });
    const said = "Claude didn't give its plan's usage just now: its usage service didn't answer.";
    /** @type {any[]} */
    const asked = [];
    const { cardOf, toasts } = await health([before], {
      upstreams: [claudeUp],
      answers: {
        "/agent-accounts/claude/check": (o) => {
          asked.push(o);
          return { agent: afterRow, checked: { read: false, said } };
        },
      },
    });
    assert.ok(textOf(cardOf("Claude")).includes("|Plan limits|Claude hasn't said which account it runs on yet — it says when it starts|"));
    const button = buttonsOf(cardOf("Claude")).find((b) => textOf(b) === "Check now");
    assert.equal(String(button.attrs.title), "Ask Claude who it runs as, how much of its plan is used and its models now");
    button.dispatch("click");
    assert.deepEqual([button.disabled, button.textContent], [true, "Checking…"]);
    await settle();
    assert.deepEqual(asked, [{ method: "POST" }]);
    assert.equal(uiState.accounts[0], afterRow, "the answer kept");
    assert.ok(textOf(cardOf("Claude")).includes("|Paid by|Claude Max|"), "and drawn");
    // (fails before: yes — what the check found went unsaid: an ask that read nothing looked like one that read the same)
    assert.deepEqual(toasts, [[said, "ok"]], "and what the check found, said");
    const failing = await health([before], {
      upstreams: [claudeUp],
      answers: {
        "/agent-accounts/claude/check": () => {
          throw Object.assign(new Error("the agent didn't start"), { body: { agent: afterRow } });
        },
      },
    });
    buttonsOf(failing.cardOf("Claude")).find((b) => textOf(b) === "Check now").dispatch("click");
    await settle();
    assert.deepEqual(failing.toasts, [["Couldn't check the account: the agent didn't start", "err"]]);
    assert.ok(textOf(failing.cardOf("Claude")).includes("|Paid by|Claude Max|"));
  });

  test("the console follows the accounts off its feed and draws Health again as they move", () => {
    const app = read("src/ui/app.js");
    assert.match(app, /followAccounts\(onEvents, \{ read: \(\) => api\("\/agent-accounts"\), onSaid: \(rows\) => \{ state\.accounts = rows; if \(state\.tab === "overview" && state\.homePane === "health" && state\.live && !state\.dirty\) scheduleRender\(false\); \} \}\);/);
  });
});

describe("the harness's wiring of the accounts (source contracts: the composer and the page need a browser)", () => {
  test("the plan's notice: the chosen agent's, put away per window and period in this browser", () => {
    const composer = read("src/ui/harness/composer/composer.js");
    assert.match(composer, /const away = \(\) => awayKeys\(store\.get\(PLAN_AWAY_KEY\)\);/);
    assert.match(composer, /store\.set\(PLAN_AWAY_KEY, JSON\.stringify\(putAway\(away\(\), planNotice\.key\)\)\);/);
    const app = read("src/ui/harness/app.js");
    assert.match(app, /followAccounts\(onBus, \{ read: \(\) => api\("\/agent-accounts"\), onSaid: \(rows\) => \{ state\.accounts = rows; accountsRead = true; accountsMoved\(\); pickFirstModel\(\); \} \}\);/);
    assert.match(app, /composer\.setPlanNotice\(noticeOf\(chosenAgent\(\)\)\);/);
    // The catalogue or the session's view can say the model is a coding agent's after its name: the notice hears that.
    assert.match(composer, /if \(raw !== markedName \|\| modelIsAgent !== markedAgent\) \{\s*markedName = raw;\s*markedAgent = modelIsAgent;\s*cb\.onModel\?\.\(raw\);/);
  });

  // (fails before: yes — Check now's answer kept the account and said nothing of what the check found)
  test("Check now's answer: the account kept at once, and what the check found said", () => {
    const app = read("src/ui/harness/app.js");
    assert.match(app, /const r = await api\(`\/agent-accounts\/\$\{encodeURIComponent\(upstream\)\}\/\$\{what\}`, \{ method: "POST" \}\);\s*keepAccount\(r\?\.agent\);\s*if \(beside\) \{[\s\S]*?\n    \} else if \(r\?\.checked\?\.said\) toast\(r\.checked\.said\);/);
  });

  test("a reset credit is spent only once the person says so on the sheet, and the limit card hears Codex's word", () => {
    const app = read("src/ui/harness/app.js");
    assert.match(app, /const yes = await confirmDialog\(\{\s*title: "Use a reset credit\?"/);
    assert.match(app, /if \(!yes\) return null;\s*const r = await accountWord\(upstream, "reset-credit"\);\s*if \(r\) toast\(resetOutcomeWords\(r\.outcome\)\);\s*return r \? String\(r\.outcome \|\| ""\) : null;/);
  });
});
