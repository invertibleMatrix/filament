// @ts-check
// HarnessV3-ACP AC3-7, the harness's side of more than one account for a coding agent: Settings → Coding agents — a
// card per agent, each account's row and what it offers, Add account, Rename, Remove, Sign out; the sign-in sheet,
// from its start to how it ended; the Account instrument's Sign in, Show and Switch account; and a turn its agent's
// login refused — its facts, and its banner's Sign in with the banner's one resend. AC3-8, the agents themselves: each
// card's mark, chips, models and menu, an agent turned off and on, gone, updated and removed; the list to add from
// with its search and the registry's line; the install sheet, from its command to how the install ended; and the
// page's keeper of the agents. DOM-free: the fake `h` (the page's stub document for the banner), a stand-in sheet,
// dialog, menu and terminal view, the routes answered here.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderAgents } from "../src/ui/harness/settings/agents.js";
import { openSignIn } from "../src/ui/harness/sign-in.js";
import { openInstall } from "../src/ui/harness/install-sheet.js";
import { installWords, keepCodingAgents, makerWords, markTile, modelCount } from "../src/ui/harness/lib/coding-agents.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { accountWidget } from "../src/ui/harness/widgets/account.js";
import { errorBanner } from "../src/ui/harness/conversation/interaction.js";
import { accountName, checkWords, resetWords, signedOutBanner, summaryWords } from "../src/ui/lib/accounts.js";
import { foldTurnFacts } from "../src/core/turn-facts.js";
import { createAgentAccounts } from "../src/services/agent-accounts.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";

const NOW = new Date(2026, 9, 8, 9, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Every reaction already set off has run. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

/** @type {any} */
const MAX = { kind: "account", label: "Claude Max", plan: "max", email: "dev@example.com", organization: "Example Org", detail: null, billing: "plan" };
/** @type {any} */
const NONE = { kind: "none", label: "Not signed in", plan: null, email: null, organization: null, detail: null, billing: null };
/** @type {any} */
const PLUS = { kind: "account", label: "ChatGPT Plus", plan: "plus", email: "dev@example.com", organization: null, detail: null, billing: "plan" };
/** @type {any} */
const CURSOR_KEY = { kind: "api-key", label: "Cursor API key", plan: null, email: null, organization: null, detail: null, billing: "plan" };
/** Claude's two ways, as its adapter names them. */
const CLAUDE_WAYS = [
  { id: "claude-ai-login", name: "Claude Subscription", description: "Use your Claude subscription" },
  { id: "console-login", name: "Anthropic Console", description: "Use Anthropic Console (API usage billing)" },
];
/** @param {string} id @param {number | null} usedPercent @param {number | null} resetsAt @param {Record<string, any>} [more] @returns {any} */
const win = (id, usedPercent, resetsAt, more = {}) => ({ id, kind: "session", label: "5-hour", usedPercent, resetsAt, windowMins: 300, status: null, ...more });
/** @param {number | null} usedPercent @param {number | null} resetsAt @returns {any} */
const weekly = (usedPercent, resetsAt) => win("seven_day", usedPercent, resetsAt, { kind: "weekly", label: "Weekly", windowMins: 10080 });

/**
 * An account's row as the server says it (app/agent-logins.js `state` over the accounts' store): Claude Code's
 * Default to start from, its account read after these reports.
 * @param {Record<string, any>} [o] @param {any[]} [reports] @returns {any}
 */
const acct = (o = {}, reports = []) => {
  const upstream = o.upstream || "claude-code";
  const s = createAgentAccounts({ now: () => NOW });
  for (const r of reports) s.report(upstream, r);
  return {
    upstream, name: "Claude Code", type: "acp", agent: "claude-code", agentName: "Claude Code", says: true, login: "claude auth login",
    label: "Default", added: false, home: null, style: "folder", oneAccount: null, ways: CLAUDE_WAYS, signsOut: true, signingIn: null,
    lastSignIn: null, ...o, account: s.view(upstream),
  };
};
/** An added Claude Code account. @param {string} label @param {Record<string, any>} [o] @param {any[]} [reports] */
const added = (label, o = {}, reports = []) =>
  acct({ upstream: `claude-code-${label.toLowerCase()}`, name: `Claude Code · ${label}`, label, added: true, home: `D:/accounts/claude-code-${label.toLowerCase()}`, ...o }, reports);
/**
 * An account someone is signed in to, as nobody said whom (services/agent-accounts.js `signedIn`: a sign-in that ended
 * well, a session its agent opened), on an agent that keeps who it runs as to itself unless `o` says otherwise.
 * @param {Record<string, any>} [o] @returns {any}
 */
const unnamed = (o = {}) => {
  const row = acct({ says: false, ...o });
  const s = createAgentAccounts({ now: () => NOW });
  s.signedIn(row.upstream, "sign-in");
  return { ...row, account: s.view(row.upstream) };
};
/** A key an ACP agent reads from a variable, as its way to sign in. */
const KEYED_WAY = { id: "fake-key", name: "Fake API key", description: "A key from the fake's dashboard", kind: "key", label: "Your Fake API key" };
/** Antigravity's Default account, with the way it signs in by itself. @param {Record<string, any>} [o] */
const agy = (o = {}) => ({ upstream: "antigravity-acp", name: "Antigravity", agent: "antigravity-acp", agentName: "Antigravity", login: null, ways: [{ id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" }], ...o });
const SIGNED_IN = [{ source: "_auth/status_update", identity: MAX, windows: [win("five_hour", 42, NOW + 2 * HOUR), weekly(85, NOW + 3 * DAY)] }];
const SIGNED_OUT = [{ source: "_auth/status_update", identity: NONE }];
const HELD_WORDS = "Runs on the ANTHROPIC_API_KEY Filament was started with. Nothing here changes it.";
/** Claude on a key from Filament's environment, which holds it (HarnessV3-ACP AF1). */
const HELD = [{
  source: "_auth/status_update",
  identity: { kind: "api-key", label: "Anthropic API key", plan: null, email: null, organization: null, detail: "ANTHROPIC_API_KEY", billing: "metered", held: HELD_WORDS },
  noWindows: "An Anthropic API key has no plan windows: it is billed by the token",
}];
/** A sign-in under way in a terminal. @param {Record<string, any>} [o] @returns {any} */
const inTerminal = (o = {}) => ({ kind: "terminal", way: "console-login", name: "Anthropic Console", terminal: "term-1", line: "claude auth login --console", at: NOW, ...o });

/**
 * The page's accounts as the app keeps them (`AccountKeeper`): a new read hands every listener, a route's answer
 * kept in place of its row; Check now waits until released.
 * @param {any[]} rows
 */
const keeperOf = (rows) => {
  let list = rows;
  /** @type {Set<() => void>} */
  const fns = new Set();
  /** @type {string[]} */
  const did = [];
  let release = () => {};
  const hand = () => { for (const fn of [...fns]) fn(); };
  return {
    did,
    /** @param {any[]} next */
    set: (next) => { list = next; hand(); },
    listeners: () => fns.size,
    release: () => release(),
    keeper: {
      rows: () => list,
      listen: (/** @type {() => void} */ fn) => { fns.add(fn); return () => { fns.delete(fn); }; },
      check: (/** @type {string} */ u) => {
        did.push(`check ${u}`);
        return new Promise((resolve) => { release = () => resolve(undefined); });
      },
      keep: (/** @type {any} */ row) => {
        did.push(`keep ${row.upstream}`);
        list = list.some((x) => x.upstream === row.upstream) ? list.map((x) => (x.upstream === row.upstream ? row : x)) : [...list, row];
        hand();
      },
    },
  };
};

/**
 * Settings → Coding agents' entries as the app keeps them (`AgentsKeeper`), made from the accounts as they stand: an
 * agent connected per agent the rows run (Cursor's SDK route one of its own), nothing to add.
 * @param {{ rows: () => any[] }} accounts
 */
const agentsOf = (accounts) => {
  /** @type {Set<Function>} */
  const fns = new Set();
  const now = () => {
    /** @type {Map<string, any[]>} */
    const by = new Map();
    for (const r of accounts.rows()) {
      const id = r.type === "cursor-sdk" ? "cursor-sdk" : r.agent;
      by.set(id, [...(by.get(id) || []), r]);
    }
    return {
      entries: [...by].map(([id, rows]) => ({
        id, name: rows[0].agentName, about: "", authors: [], license: null, docs: null, from: "filament", mark: null, version: null,
        state: "connected", upstreams: rows.map((r) => r.upstream), primary: (rows.find((r) => !r.off) || rows[0]).upstream, installed: null, update: null,
        install: null, download: null, unavailable: false, gone: false, installing: null, lastInstall: null, models: null,
        asking: false, modelsError: null, profile: null,
      })),
      registry: { at: NOW, asking: false, error: null },
      computer: "windows-x86_64",
    };
  };
  return {
    listeners: () => fns.size,
    keeper: { now, listen: (/** @type {Function} */ fn) => { fns.add(fn); return () => { fns.delete(fn); }; }, keep: () => {} },
  };
};

/**
 * Settings → Coding agents' entries as the page keeps them (`AgentsKeeper`), over the list a test hands it (null
 * before the page's first read): a new read hands every hook, and a route's answer is kept in its place.
 * @param {any} list
 */
const listKeeper = (list) => {
  let now = list;
  /** @type {Set<Function>} */
  const fns = new Set();
  const hand = () => { for (const fn of [...fns]) fn(now); };
  return {
    listeners: () => fns.size,
    /** @param {any} next */
    set: (next) => { now = next; hand(); },
    keeper: {
      now: () => now,
      listen: (/** @type {Function} */ fn) => { fns.add(fn); if (now) fn(now); return () => { fns.delete(fn); }; },
      keep: (/** @type {any} */ x) => {
        if (!Array.isArray(x?.entries)) return;
        now = { entries: x.entries, registry: x.registry, computer: x.computer ?? null };
        hand();
      },
    },
  };
};

/** The accounts' routes as a test answers them: a thrown Error is a refusal in its words. @param {(method: string, path: string, body: any) => any} [answer] */
const routes = (answer) => {
  /** @type {[string, string, any][]} */
  const calls = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    const out = await answer?.(method, path, init.body);
    if (out instanceof Error) throw out;
    return out;
  };
  return { calls, api };
};

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** Every node under `n` wearing a class. @param {any} n @param {string} cls */
const every = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** The first. @param {any} n @param {string} cls */
const one = (n, cls) => every(n, cls)[0];
/** The button under `n` whose words, or whose label, are these. @param {any} n @param {string} words */
const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words || b.attrs["aria-label"] === words);
/** An account's row on the page. @param {any} n @param {string} upstream */
const rowOf = (n, upstream) => all(n, (x) => x.attrs?.["data-upstream"] === upstream)[0];

/**
 * Settings → Coding agents over these rows: the routes answered by `answer`, the sheet's answer `confirm`, every
 * dialog, menu, copy, toast, sign-in, install and page opened kept.
 * @param {any[]} rows
 * @param {{ answer?: (method: string, path: string, body: any) => any, confirm?: boolean, agents?: any }} [o]
 *   `agents`: the entries as the server sends them (else one connected per agent the rows run)
 */
function settings(rows, o = {}) {
  const k = keeperOf(rows);
  const a = /** @type {any} */ ("agents" in o ? listKeeper(o.agents) : agentsOf(k.keeper));
  const { calls, api } = routes(o.answer);
  /** @type {string[]} */
  const signIns = [];
  /** @type {string[]} */
  const credits = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const asked = [];
  /** @type {any[]} */
  const dialogs = [];
  /** @type {{ items: any[], opts: any }[]} */
  const menus = [];
  /** @type {string[]} */
  const copied = [];
  /** @type {string[]} */
  const installs = [];
  /** @type {string[]} */
  const opened = [];
  const body = /** @type {any} */ (fakeH("div", {}));
  renderAgents(body, {
    accounts: /** @type {any} */ (k.keeper),
    agents: /** @type {any} */ (a.keeper),
    signIn: (u) => signIns.push(u),
    install: (id) => installs.push(id),
    useResetCredit: async (u) => credits.push(u),
    onToast: (msg, kind) => toasts.push([msg, kind]),
    now: () => NOW,
  }, {
    h: /** @type {any} */ (fakeH),
    api,
    confirm: async (d) => {
      asked.push(d);
      return o.confirm ?? true;
    },
    dialog: /** @type {any} */ ((/** @type {any} */ d) => {
      const x = { ...d, closed: false, close() { x.closed = true; } };
      dialogs.push(x);
      return x;
    }),
    menu: /** @type {any} */ ((/** @type {any[]} */ items, /** @type {any} */ opts) => {
      // As the menu does: a pick closes it, then runs.
      const picks = items.map((i) => (typeof i?.onClick === "function" ? { ...i, onClick: () => { opts?.onClose?.(); return i.onClick(); } } : i));
      menus.push({ items: picks, opts });
      return { el: null, close() {} };
    }),
    copy: async (text) => { copied.push(text); },
    open: (url) => opened.push(url),
    subscribe: () => () => {},
  });
  return { body, k, a, calls, signIns, credits, toasts, asked, dialogs, menus, copied, installs, opened };
}

describe("Settings → Coding agents", () => {
  // The group says what a person is doing there (HarnessV4_Settings_Plan HS-D5).
  test("Settings lists Coding agents first under Models and agents, on the accounts' cyan robot", () => {
    assert.deepEqual(SECTIONS.find((s) => s.id === "agents"), { id: "agents", group: "Models and agents", label: "Coding agents", icon: "bot" });
  });

  test("a card per agent — Cursor's CLI and its SDK apart — its Default first, then the added ones by name; how each keeps more than one account, and Add account where it can", () => {
    const cursorCli = acct({ upstream: "cursor-cli", name: "Cursor CLI", agent: "cursor", agentName: "Cursor CLI", login: "agent login", style: null, oneAccount: "Cursor CLI keeps one login on a computer: its CLI reads it from one place", ways: [], signsOut: false }, SIGNED_OUT);
    const cursorSdk = acct({ upstream: "cursor", name: "Cursor", type: "cursor-sdk", agent: "cursor", agentName: "Cursor", login: null, style: "key", ways: [{ id: "cursor", name: "Cursor", description: "Sign in on Cursor's page" }] });
    const codex = acct({ upstream: "cx", name: "Codex", type: "codex", agent: "codex", agentName: "Codex", login: "codex login", ways: [{ id: "chatgpt", name: "ChatGPT", description: "" }] });
    const p = settings([added("Work"), acct({}, SIGNED_IN), codex, cursorCli, cursorSdk, added("Alpha")]);
    const cards = every(p.body, "cag-card");
    assert.deepEqual(cards.map((c) => [c.attrs["data-agent"], textOf(one(c, "cag-head"))]), [
      // Each wears its mark: here, with no registry icon, its name's first letter.
      ["claude-code", "C|Claude Code|Each account signs in on its own: add one for each login you use.|Add account"],
      ["codex", "C|Codex|Each account signs in on its own: add one for each login you use.|Add account"],
      ["cursor", "C|Cursor CLI|Cursor CLI keeps one login on a computer: its CLI reads it from one place."],
      ["cursor-sdk", "C|Cursor|Each account signs in on Cursor's page, which makes it a key of its own.|Add account"],
    ]);
    assert.deepEqual(every(cards[0], "cag-row").map((r) => r.attrs["data-upstream"]), ["claude-code", "claude-code-alpha", "claude-code-work"]);
  });

  test("an account's row: where it stands, who it runs as with the email masked until clicked, a meter per window of its plan, when it was heard", () => {
    const p = settings([acct({}, SIGNED_IN)]);
    const r = rowOf(p.body, "claude-code");
    assert.ok(r.attrs.class.includes("is-in"));
    assert.equal(textOf(one(r, "cag-top")), "Default|Claude Max|Example Org|d••@example.com");
    btn(r, "d••@example.com").dispatch("click");
    const shown = rowOf(p.body, "claude-code");
    assert.equal(textOf(one(shown, "cag-top")), "Default|Claude Max|Example Org|dev@example.com", "shown once clicked");
    assert.equal(btn(shown, "dev@example.com").attrs["aria-pressed"], "true");
    const meters = every(shown, "cag-win");
    assert.deepEqual(meters.map((m) => [textOf(m), m.attrs.class, one(m, "cag-win-fill").attrs.style]), [["5h|42%", "cag-win", "width:42%"], ["week|85%", "cag-win is-warn", "width:85%"]]);
    assert.equal(meters[0].attrs.title, `5-hour window: 42% used, ${resetWords(NOW + 2 * HOUR, NOW)}`);
    // (fails before: no — a guard the mutation pass asked for: no window had reset when its row was drawn)
    const reset = rowOf(settings([acct({}, [{ ...SIGNED_IN[0], windows: [win("five_hour", 42, NOW - HOUR), weekly(85, NOW + 3 * DAY)] }])]).body, "claude-code");
    assert.deepEqual(every(reset, "cag-win").map((m) => textOf(m)), ["week|85%"], "a window past its reset draws no meter");
    assert.equal(textOf(one(shown, "cag-age")), "Updated just now");
    // Signed in: Sign out, Check now, and its menu.
    assert.deepEqual(buttonsOf(one(shown, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]), ["Sign out", checkWords(acct()), "More"]);
  });

  // (fails before: yes — the Fable 5.2 re-read's finding 10: a window extra usage covers drew its meter red here, as of
  // a plan that had stopped, while the chat's pill said amber "extra usage")
  test("an account's row: a spent window extra usage covers draws its meter amber and says so; uncovered, red", () => {
    const spent = { ...SIGNED_IN[0], windows: [win("five_hour", 100, NOW + 2 * HOUR), weekly(40, NOW + 3 * DAY)] };
    const paying = { using: true, status: "allowed", resetsAt: null, off: null, enabled: true, spent: 100, limit: null, currency: "USD" };
    /** @param {any[]} reports */
    const meters = (reports) => every(rowOf(settings([acct({}, reports)]).body, "claude-code"), "cag-win").map((m) => [textOf(m), m.attrs.class, m.attrs.title]);
    assert.deepEqual(meters([{ ...spent, extra: paying }])[0], ["5h|100%", "cag-win is-warn", `5-hour window: 100% used, extra usage covers it, ${resetWords(NOW + 2 * HOUR, NOW)}`]);
    assert.deepEqual(meters([spent])[0], ["5h|100%", "cag-win is-error", `5-hour window: 100% used, ${resetWords(NOW + 2 * HOUR, NOW)}`]);
  });

  test("a key from outside the account holds it: its words in place of Sign out and Sign in again (HarnessV3-ACP AF1)", () => {
    const p = settings([acct({}, HELD)]);
    const r = rowOf(p.body, "claude-code");
    assert.ok(r.attrs.class.includes("is-in"), "it runs as someone: the key");
    assert.equal(textOf(one(r, "cag-held")), HELD_WORDS);
    assert.deepEqual(buttonsOf(one(r, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]), [checkWords(acct()), "More"], "no Sign out");
    btn(r, "More").dispatch("click");
    assert.deepEqual(p.menus[0].items.map((i) => i.label), ["Turn off"], "no Sign in again: its menu turns it off alone");
  });

  // The owner's of 11-11 (key-models.test.js): an account on an Anthropic API key also offers the models Anthropic
  // lists for the key and Claude Code does not; nothing on its row said which, or why none came.
  // (fails before: yes — the row had no such line)
  test("an account on an API key says which models come from the key, or why they could not be asked for, in one quiet line; any other account says nothing", () => {
    const KEYED = [{ source: "_auth/status_update", identity: { kind: "api-key", label: "Anthropic API key", plan: null, email: null, organization: null, detail: null, billing: "metered" } }];
    const got = rowOf(settings([added("Credits", { keyModels: { names: ["claude-fable-5-2", "claude-haiku-5-5"], note: null } }, KEYED)]).body, "claude-code-credits");
    assert.equal(textOf(one(got, "cag-key")), "From its API key: claude-fable-5-2, claude-haiku-5-5. Claude Code does not list them itself.");
    assert.deepEqual(String(one(got, "cag-key").attrs.class).split(/\s+/), ["cag-quiet", "cag-key"], "quiet");
    const single = rowOf(settings([added("Credits", { keyModels: { names: ["claude-fable-5-2"], note: null } }, KEYED)]).body, "claude-code-credits");
    assert.equal(textOf(one(single, "cag-key")), "From its API key: claude-fable-5-2. Claude Code does not list it itself.");
    const many = rowOf(settings([added("Credits", { keyModels: { names: ["a", "b", "c", "d", "e", "f"], note: null } }, KEYED)]).body, "claude-code-credits");
    assert.equal(textOf(one(many, "cag-key")), "From its API key: a, b, c, d and 2 more. Claude Code does not list them itself.");
    const note = "Anthropic's list of the models this account's API key can use was refused (401 authentication_error): only the models Claude Code lists itself are offered.";
    const refused = rowOf(settings([added("Credits", { keyModels: { names: [], note } }, KEYED)]).body, "claude-code-credits");
    assert.equal(textOf(one(refused, "cag-key")), note);
    assert.equal(every(refused, "cag-failed").length, 0, "no error's line: its own list stands");
    assert.equal(every(rowOf(settings([acct({}, SIGNED_IN)]).body, "claude-code"), "cag-key").length, 0);
    assert.equal(every(rowOf(settings([added("Credits", { off: true, keyModels: { names: ["claude-fable-5-2"], note: null } }, KEYED)]).body, "claude-code-credits"), "cag-key").length, 0, "turned off: nothing runs on it");
  });

  test("nobody signed in: Sign in, the page's one blue button; not heard from: a quiet Sign in; no sign-in of its own: its CLI's line to copy; a failed sign-in says why", async () => {
    const quiet = added("Alpha");
    const cli = acct({ upstream: "gem", name: "Gemini", agent: "gemini", agentName: "Gemini", login: "gemini", style: null, oneAccount: "Gemini keeps one login on a computer", ways: [], signsOut: false }, SIGNED_OUT);
    const failed = added("Work", { lastSignIn: { outcome: "failed", error: "the program ended with code 2", at: NOW } }, SIGNED_OUT);
    const p = settings([failed, quiet, cli, acct({ upstream: "plain", says: false })]);
    const out = rowOf(p.body, "claude-code-work");
    assert.ok(out.attrs.class.includes("is-out"));
    assert.equal(textOf(one(out, "cag-top")), "Work|Nobody is signed in");
    assert.equal(textOf(one(out, "cag-failed")), "The last sign-in didn't finish: the program ended with code 2.");
    const signIn = btn(out, "Sign in");
    assert.ok(signIn.attrs.class.includes("zc-btn-v-default"));
    signIn.dispatch("click");
    assert.deepEqual(p.signIns, ["claude-code-work"]);
    const alpha = rowOf(p.body, "claude-code-alpha");
    assert.ok(alpha.attrs.class.includes("is-unknown"));
    assert.equal(textOf(one(alpha, "cag-top")), "Alpha|Not heard from yet: Check now asks it");
    assert.ok(btn(alpha, "Sign in").attrs.class.includes("zc-btn-v-secondary"));
    assert.equal(textOf(one(rowOf(p.body, "plain"), "cag-top")), "Default|It doesn't say which account it runs on");
    const gem = rowOf(p.body, "gem");
    assert.equal(btn(gem, "Sign in"), undefined, "no way of its own: no Sign in");
    assert.equal(textOf(one(gem, "cag-line")), "Sign in with its own CLI, then Check now:|gemini");
    btn(gem, "Copy the line").dispatch("click");
    await settle();
    assert.deepEqual([p.copied, p.toasts], [["gemini"], [["The line copied", undefined]]]);
  });

  // (fails before: yes — the owner's of 11-11, Antigravity's card after a sign-in that worked: its row grey, "It
  // doesn't say which account it runs on", with Sign in — a sign-in that ended well kept nothing, and the row had no
  // state for someone signed in whom nobody named)
  test("signed in, as its agent doesn't say whom: green, in those words, with Sign out and Sign in again in its menu — never Sign in", () => {
    const p = settings([unnamed(agy()), unnamed({ upstream: "claude-code-alpha", name: "Claude Code · Alpha", label: "Alpha", added: true, says: null })]);
    const r = rowOf(p.body, "antigravity-acp");
    assert.deepEqual(r.attrs.class.split(" "), ["cag-row", "is-in"]);
    assert.equal(textOf(one(r, "cag-top")), "Default|Signed in. It doesn't say which account");
    assert.equal(textOf(one(r, "cag-age")), "Updated just now");
    assert.deepEqual(buttonsOf(one(r, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]), ["Sign out", checkWords(unnamed(agy())), "More"]);
    btn(r, "More").dispatch("click");
    assert.deepEqual(p.menus[0].items.map((i) => i.label), ["Sign in again…", "Turn off"]);
    // One whose agent hasn't started yet: its CLI said yes, and Check now asks it as whom.
    const alpha = rowOf(p.body, "claude-code-alpha");
    assert.deepEqual([alpha.attrs.class.split(" "), textOf(one(alpha, "cag-top"))], [["cag-row", "is-in"], "Alpha|Signed in: Check now asks it as whom"]);
    assert.equal(summaryWords(unnamed(agy()), NOW), "Antigravity is signed in — it doesn't say which account it runs on");
    assert.equal(summaryWords(unnamed({ says: null }), NOW), "Claude Code is signed in, and hasn't said which account it runs on yet — it says when it starts");
    // Signed out again, its own way: nobody, with Sign in.
    const out = settings([{ ...unnamed(agy()), account: acct({}, [{ source: "sign-out", identity: NONE }]).account }]);
    assert.equal(textOf(one(rowOf(out.body, "antigravity-acp"), "cag-top")), "Default|Nobody is signed in");
    assert.ok(btn(rowOf(out.body, "antigravity-acp"), "Sign in"));
  });

  // (fails before: yes — the re-read's finding 4: a key kept for an agent with no sign-out of its own had no Sign out
  // on its row, and one nothing had checked read as signed in on the sign-in's word)
  test("a key Filament keeps for an account: kept and not yet tried, its row says so; Sign out wherever one is kept, in the words of what it forgets; none kept and no sign-out of its agent's, none offered", async () => {
    const keyed = (/** @type {Record<string, any>} */ o = {}) => ({ upstream: "keyed", name: "Keyed", agent: "keyed", agentName: "Keyed", says: false, login: null, ways: [KEYED_WAY], signsOut: false, keyKept: true, ...o });
    const p = settings([
      acct(keyed({ lastSignIn: { outcome: "key-kept", error: null, at: NOW } })),
      unnamed(keyed({ upstream: "keyed-in", agent: "keyed-in" })),
      unnamed(keyed({ upstream: "keyed-none", agent: "keyed-none", keyKept: false })),
      // A turn then refused it: nobody is signed in, and the key is still there to forget.
      acct(keyed({ upstream: "keyed-out", agent: "keyed-out", lastSignIn: { outcome: "key-kept", error: null, at: NOW } }), [{ source: "turn", identity: NONE }]),
    ]);
    const fresh = rowOf(p.body, "keyed");
    assert.deepEqual([fresh.attrs.class.split(" "), textOf(one(fresh, "cag-top")), textOf(one(fresh, "cag-held"))], [["cag-row", "is-unknown"], "Default|It doesn't say which account it runs on", "Key kept; its next turn tries it."]);
    assert.deepEqual(buttonsOf(one(fresh, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]), ["Sign in", "Sign out", checkWords(acct(keyed())), "More"]);
    const signedIn = rowOf(p.body, "keyed-in");
    assert.deepEqual(buttonsOf(one(signedIn, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]), ["Sign out", checkWords(acct(keyed())), "More"]);
    assert.equal(one(signedIn, "cag-held"), undefined, "no end to speak of: no line");
    btn(signedIn, "Sign out").dispatch("click");
    await settle();
    assert.deepEqual(p.asked[0], { title: "Sign out of Keyed?", description: "Filament forgets the key it keeps for this account. Sign in takes one again.", confirmLabel: "Sign out", destructive: true });
    assert.deepEqual(p.calls, [["POST", "/agent-accounts/keyed-in/sign-out", undefined]]);
    assert.equal(btn(rowOf(p.body, "keyed-none"), "Sign out"), undefined);
    const refused = rowOf(p.body, "keyed-out");
    assert.deepEqual([textOf(one(refused, "cag-top")), one(refused, "cag-held")], ["Default|Nobody is signed in", undefined], "tried since, and refused: the row says that alone");
    assert.deepEqual(buttonsOf(one(refused, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]), ["Sign in", "Sign out", checkWords(acct(keyed())), "More"]);
  });

  test("a sign-in under way: Show brings its sheet back, Cancel stops it through its route", async () => {
    const signing = acct({ signingIn: inTerminal() }, SIGNED_OUT);
    const stopped = acct({ lastSignIn: { outcome: "cancelled", error: null, at: NOW + 1 } }, SIGNED_OUT);
    const p = settings([signing], { answer: (method, path) => (method === "POST" && path === "/agent-accounts/claude-code/sign-in/cancel" ? { ok: true, agent: stopped } : new Error("no route")) });
    const r = rowOf(p.body, "claude-code");
    assert.ok(r.attrs.class.includes("is-signing"));
    assert.equal(textOf(one(r, "cag-top")), "Default|Signing in · Anthropic Console");
    assert.deepEqual(buttonsOf(one(r, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]).slice(0, 2), ["Show", "Cancel"]);
    btn(r, "Show").dispatch("click");
    assert.deepEqual(p.signIns, ["claude-code"]);
    btn(r, "Cancel").dispatch("click");
    await settle();
    assert.deepEqual(p.calls, [["POST", "/agent-accounts/claude-code/sign-in/cancel", undefined]]);
    assert.ok(rowOf(p.body, "claude-code").attrs.class.includes("is-out"), "the route's answer drawn at once");
  });

  test("Sign out asks first, in the words of what it signs out — the Default its CLI on this computer, an added one its folder, a key its key; a refusal is said", async () => {
    const out = acct({}, SIGNED_OUT);
    const p = settings([acct({}, SIGNED_IN), added("Work", {}, SIGNED_IN), acct({ upstream: "cursor", name: "Cursor", type: "cursor-sdk", agent: "cursor", agentName: "Cursor", style: "key" }, [{ source: "s", identity: CURSOR_KEY }])], {
      answer: (method, path) => (path === "/agent-accounts/claude-code/sign-out" ? { ok: true, agent: out } : new Error("a turn is running on it")),
    });
    btn(rowOf(p.body, "claude-code"), "Sign out").dispatch("click");
    await settle();
    assert.deepEqual(p.asked[0], { title: "Sign out of Claude Code?", description: "This signs Claude Code out on this computer — its own CLI too, wherever you use it.", confirmLabel: "Sign out", destructive: true });
    assert.deepEqual(p.calls, [["POST", "/agent-accounts/claude-code/sign-out", undefined]]);
    assert.ok(rowOf(p.body, "claude-code").attrs.class.includes("is-out"), "the account as the route answered");
    btn(rowOf(p.body, "claude-code-work"), "Sign out").dispatch("click");
    await settle();
    assert.equal(p.asked[1].title, "Sign out of Claude Code · Work?");
    assert.equal(p.asked[1].description, "Its sign-in goes from the folder Filament keeps for it. Sign in brings one back.");
    assert.deepEqual(p.toasts, [["Couldn't sign out: a turn is running on it", "err"]]);
    btn(rowOf(p.body, "cursor"), "Sign out").dispatch("click");
    await settle();
    assert.equal(p.asked[2].description, "Filament forgets the key Cursor made for this account. The key stays valid at Cursor until it expires, or until you revoke it in Cursor's dashboard.");
    const no = settings([acct({}, SIGNED_IN)], { confirm: false });
    btn(rowOf(no.body, "claude-code"), "Sign out").dispatch("click");
    await settle();
    assert.deepEqual(no.calls, [], "asked, and declined: nothing is sent");
  });

  test("Check now asks the agent through the page's keeper, its button waiting meanwhile", async () => {
    const p = settings([acct({}, SIGNED_IN)]);
    btn(rowOf(p.body, "claude-code"), checkWords(acct())).dispatch("click");
    assert.deepEqual(p.k.did, ["check claude-code"]);
    const waiting = btn(rowOf(p.body, "claude-code"), "Checking…");
    assert.ok("disabled" in waiting.attrs && waiting.attrs.class.includes("is-busy"));
    assert.ok("disabled" in btn(rowOf(p.body, "claude-code"), "Sign out").attrs, "the row's other buttons wait too");
    p.k.release();
    await settle();
    assert.equal("disabled" in btn(rowOf(p.body, "claude-code"), checkWords(acct())).attrs, false);
  });

  test("Add account names a new one, adds it beside the agent's Default and opens its sign-in; an empty name or a refusal stays on the dialog", async () => {
    const fresh = added("Personal");
    const p = settings([acct({}, SIGNED_IN)], {
      answer: (method, path, body) => (body?.name === "Personal" ? { ok: true, agent: fresh } : new Error("Claude Code already has an account named Work")),
    });
    btn(p.body, "Add account").dispatch("click");
    const d = p.dialogs[0];
    assert.deepEqual([d.title, d.description, d.actions.map((/** @type {any} */ a) => a.label)], [
      "Add a Claude Code account",
      "Name it so you can tell it apart — Work, Personal. You sign it in next; it keeps a login of its own.",
      ["Cancel", "Add and sign in"],
    ]);
    const input = one(d.body, "cag-name-input");
    d.actions[1].onClick();
    await settle();
    assert.equal(textOf(one(d.body, "cag-error")), "Name the account.");
    assert.deepEqual(p.calls, []);
    input.value = "Work";
    d.actions[1].onClick();
    await settle();
    assert.equal(textOf(one(d.body, "cag-error")), "Claude Code already has an account named Work.");
    assert.equal(d.closed, false);
    input.value = "  Personal ";
    input.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.deepEqual(p.calls.at(-1), ["POST", "/agent-accounts", { from: "claude-code", name: "Personal" }]);
    assert.equal(d.closed, true);
    assert.deepEqual([p.k.did, p.signIns], [["keep claude-code-personal"], ["claude-code-personal"]], "kept, then signed in at once");
    assert.deepEqual(every(p.body, "cag-row").map((r) => r.attrs["data-upstream"]), ["claude-code", "claude-code-personal"]);
    const key = settings([acct({ upstream: "cursor", type: "cursor-sdk", agent: "cursor", agentName: "Cursor", style: "key" })]);
    btn(key.body, "Add account").dispatch("click");
    assert.equal(key.dialogs[0].description, "Name it so you can tell it apart — Work, Personal. You sign it in next, on Cursor's page.");
  });

  test("an account's menu: Sign in again where someone is signed in; Turn off; Rename and Remove for an added one — a rename's refusal stays on its dialog, a removal asks first", async () => {
    const renamed = added("Job", { upstream: "claude-code-work" }, SIGNED_IN);
    const p = settings([acct({}, SIGNED_IN), added("Work", {}, SIGNED_IN), added("Spare")], {
      answer: (method, path, body) =>
        method === "PATCH" ? (body.name === "Job" ? { ok: true, agent: renamed } : new Error("Claude Code already has an account named Default"))
          : method === "DELETE" ? new Error("a turn is running on it") : null,
    });
    btn(rowOf(p.body, "claude-code"), "More").dispatch("click");
    assert.deepEqual(p.menus[0].items.map((i) => i.label), ["Sign in again…", "Turn off"], "a Default is neither renamed nor removed");
    p.menus[0].items[0].onClick();
    assert.deepEqual(p.signIns, ["claude-code"]);
    btn(rowOf(p.body, "claude-code-work"), "More").dispatch("click");
    assert.deepEqual(p.menus[1].items.map((i) => [i.label, i.variant]), [["Sign in again…", undefined], ["Turn off", undefined], ["Rename…", undefined], ["Remove…", "destructive"]]);
    p.menus[1].items[2].onClick();
    const d = p.dialogs[0];
    assert.deepEqual([d.title, one(d.body, "cag-name-input").value], ["Rename Claude Code · Work", "Work"]);
    one(d.body, "cag-name-input").value = "Default";
    d.actions[1].onClick();
    await settle();
    assert.equal(textOf(one(d.body, "cag-error")), "Claude Code already has an account named Default.");
    one(d.body, "cag-name-input").value = "Job";
    d.actions[1].onClick();
    await settle();
    assert.deepEqual([p.calls.at(-1), d.closed], [["PATCH", "/agent-accounts/claude-code-work", { name: "Job" }], true]);
    assert.equal(textOf(one(rowOf(p.body, "claude-code-work"), "cag-label")), "Job");
    btn(rowOf(p.body, "claude-code-spare"), "More").dispatch("click");
    assert.deepEqual(p.menus[2].items.map((i) => i.label), ["Turn off", "Rename…", "Remove…"], "nobody signed in yet: nothing to sign in again");
    p.menus[2].items[2].onClick();
    await settle();
    assert.deepEqual(p.asked[0], { title: "Remove Claude Code · Spare?", description: "Its sign-in on this computer goes with it.", confirmLabel: "Remove", destructive: true });
    assert.deepEqual(p.calls.at(-1), ["DELETE", "/agent-accounts/claude-code-spare", undefined]);
    assert.deepEqual(p.toasts, [["Couldn't remove Claude Code · Spare: a turn is running on it", "err"]]);
  });

  // (fails before: yes — the owner's of 11-05: every ⋯ menu here closed a couple of seconds after it opened: each read of
  // the accounts drew the cards anew, the ⋯ with them, and the menu let go of a button no longer on the page)
  test("a ⋯ menu open holds the page as it stands: a read meanwhile is drawn once the menu closes", () => {
    const p = settings([acct({}, SIGNED_IN), added("Work", {}, SIGNED_IN)]);
    const more = btn(rowOf(p.body, "claude-code-work"), "More");
    more.dispatch("click");
    p.k.set([acct({}, SIGNED_IN), added("Work", {}, SIGNED_OUT)]);
    assert.equal(btn(rowOf(p.body, "claude-code-work"), "More"), more, "the account's ⋯ the menu stands on stays");
    assert.equal(typeof p.menus[0].opts.onClose, "function", "the page hears the menu go");
    p.menus[0].opts.onClose();
    assert.notEqual(btn(rowOf(p.body, "claude-code-work"), "More"), more, "closed: the read is drawn");
    assert.ok(!rowOf(p.body, "claude-code-work").attrs.class.includes("is-in"), "signed out, as the read said");
    // The agent's own ⋯ the same.
    const agentMore = btn(one(p.body, "cag-card"), "More for Claude Code");
    agentMore.dispatch("click");
    p.k.set([acct({}, SIGNED_OUT), added("Work", {}, SIGNED_OUT)]);
    assert.equal(btn(one(p.body, "cag-card"), "More for Claude Code"), agentMore);
    p.menus[1].opts.onClose();
    assert.notEqual(btn(one(p.body, "cag-card"), "More for Claude Code"), agentMore);
    // (the review of ac2a5d8ef) Two open at once, one over the other: the page holds until both went.
    const a = btn(rowOf(p.body, "claude-code-work"), "More");
    a.dispatch("click");
    const b = btn(one(p.body, "cag-card"), "More for Claude Code");
    b.dispatch("click");
    p.k.set([acct({}, SIGNED_IN), added("Work", {}, SIGNED_IN)]);
    p.menus[3].opts.onClose();
    assert.equal(btn(rowOf(p.body, "claude-code-work"), "More"), a, "the one under it still stands on its ⋯");
    p.menus[2].opts.onClose();
    assert.ok(rowOf(p.body, "claude-code-work").attrs.class.includes("is-in"), "both went: the read is drawn");
  });

  // (fails before: yes — the owner's of 11-05: an account could only be signed out, never set aside with its sign-in kept)
  test("an account turned off keeps its sign-in: its row says so, with Turn on, and no Check now; its menu keeps Rename and Remove", async () => {
    const p = settings([acct({}, SIGNED_IN), added("Work", {}, SIGNED_IN)], {
      answer: (_method, path) => (path.endsWith("/off") ? { ok: true, agent: added("Work", { off: true }, SIGNED_IN) } : path.endsWith("/on") ? { ok: true, agent: added("Work", {}, SIGNED_IN) } : null),
    });
    btn(rowOf(p.body, "claude-code-work"), "More").dispatch("click");
    const turnOff = p.menus[0].items.find((i) => i.label === "Turn off");
    assert.deepEqual([turnOff?.desc, turnOff?.icon], ["Filament stops using it; its sign-in is kept", "circleSlash"]);
    turnOff.onClick();
    await settle();
    assert.deepEqual(p.calls.at(-1), ["POST", "/agent-accounts/claude-code-work/off", undefined]);
    const r = rowOf(p.body, "claude-code-work");
    assert.ok(r.attrs.class.includes("is-off"), r.attrs.class);
    assert.equal(textOf(one(r, "cag-who")), "Turned off: Filament doesn't use it. Its sign-in is kept.");
    assert.deepEqual([every(r, "cag-win").length, buttonsOf(one(r, "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"])], [0, ["Turn on", "More"]], "no windows, no Check now");
    btn(r, "More").dispatch("click");
    assert.deepEqual(p.menus[1].items.map((i) => i.label), ["Rename…", "Remove…"]);
    p.menus[1].opts.onClose();
    btn(r, "Turn on").dispatch("click");
    await settle();
    assert.deepEqual(p.calls.at(-1), ["POST", "/agent-accounts/claude-code-work/on", undefined]);
    assert.ok(rowOf(p.body, "claude-code-work").attrs.class.includes("is-in"), "on again, signed in as it was");
    assert.ok(rowOf(p.body, "claude-code").attrs.class.includes("is-in"), "the Default as it was");
  });

  test("the section follows the page's accounts while it shows and lets go once put away; with no agent, where to connect one", () => {
    const p = settings([acct()]);
    p.k.set([acct({}, SIGNED_IN)]);
    assert.ok(rowOf(p.body, "claude-code").attrs.class.includes("is-in"), "a new read drawn");
    p.body.kids[0].isConnected = false;
    p.k.set([acct({}, SIGNED_OUT)]);
    assert.deepEqual([p.k.listeners(), p.a.listeners()], [0, 0], "put away: it lets go of the accounts and the agents");
    assert.equal(textOf(one(settings([]).body, "cag-empty")), "No coding agent is connected yet. Connect one below.");
  });
});

/**
 * The sign-in sheet for an account over these rows: the routes answered by `answer`, a stand-in sheet and terminal
 * view, every page opened, copy and toast kept.
 * @param {any[]} rows @param {string} upstream
 * @param {{ answer?: (method: string, path: string, body: any) => any, then?: { label: string, run: () => void } }} [o]
 */
function signInSheet(rows, upstream, o = {}) {
  const k = keeperOf(rows);
  const { calls, api } = routes(o.answer);
  /** @type {any[]} */
  const sheets = [];
  /** @type {{ id: string, focused: number, disposed: number }[]} */
  const views = [];
  /** @type {string[]} */
  const opened = [];
  /** @type {string[]} */
  const copied = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  openSignIn(upstream, { keeper: /** @type {any} */ (k.keeper), onToast: (msg, kind) => toasts.push([msg, kind]), then: o.then }, {
    h: /** @type {any} */ (fakeH),
    api,
    sheet: /** @type {any} */ ((/** @type {any} */ x) => {
      const s = { ...x, closed: false, close() { if (s.closed) return; s.closed = true; x.onClose?.(); } };
      sheets.push(s);
      return s;
    }),
    show: /** @type {any} */ ((/** @type {any} */ _el, /** @type {string} */ id) => {
      const v = { id, focused: 0, disposed: 0, focus() { v.focused++; }, ended: () => false, dispose() { v.disposed++; } };
      views.push(v);
      return v;
    }),
    open: (url) => opened.push(url),
    copy: async (text) => { copied.push(text); },
  });
  const s = sheets[0];
  return {
    k, calls, views, opened, copied, toasts, sheet: s,
    /** The sheet's words. */ said: () => textOf(s.body),
    /** Its foot's buttons. */ foot: () => buttonsOf(s.foot).map(textOf),
    /** A foot's button. @param {string} words */ press: (words) => btn(s.foot, words).dispatch("click"),
  };
}

describe("an agent's models fold (HarnessV4_Settings_Plan HS-D12, HC-49)", () => {
  // (fails before: yes — an agent's models were tuned only in the console's model table)
  test("collapsed and read on its first open: the rows a provider's page shows, for the Default account's models", async () => {
    const fam = { id: "claude-code/sonnet", name: "Sonnet", kind: "chat", lead: "claude-code/sonnet", members: [{ id: "claude-code/sonnet", name: "sonnet", source: "discovered" }] };
    const p = settings([acct({}, SIGNED_IN), added("Work")], {
      answer: (method, path) => {
        if (path === "/upstreams") return { version: 3, upstreams: [{ id: "claude-code", name: "Claude Code", type: "acp", agent: true, enabled: true, prefix: null, routes: [], hiddenModels: [], models: [], pricing: {}, rules: {} }] };
        if (path.startsWith("/models/caps")) return { models: [{ id: "claude-code/sonnet", caps: null }], families: [fam], errors: [] };
        if (path.startsWith("/models")) return { models: [], upstreams: { "claude-code": { all: ["sonnet"], listed: ["sonnet"] } } };
        if (path.startsWith("/usage/days")) return { total: { rows: [] } };
        return undefined;
      },
    });
    const card = every(p.body, "cag-card").find((c) => c.attrs["data-agent"] === "claude-code");
    const fold = one(card, "cag-mrows");
    assert.equal(textOf(fold), "Models: in the picker or not, add one by name, tune one|Its Default account's models. An account added starts from this list and keeps its own.");
    assert.equal(p.calls.length, 0, "nothing is read while it is folded");
    fold.open = true;
    fold.ontoggle();
    for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
    const rows = one(fold, "mrows");
    assert.equal(rows.attrs["data-upstream"], "claude-code");
    assert.match(textOf(rows), /Sonnet/);
    assert.match(textOf(rows), /\|plan\|/, "an agent's turns are paid by its plan");
    fold.ontoggle();
    assert.equal(every(fold, "mrows").length, 1, "built once");
  });

  // (fails before: yes — the review of 4e913bf96: with its Default turned off, the fold said its Default's models of another account's)
  test("its Default turned off: the fold names the models of the account it runs on", () => {
    const p = settings([acct({ off: true }, SIGNED_IN), added("Work", {}, SIGNED_IN)]);
    const card = every(p.body, "cag-card").find((c) => c.attrs["data-agent"] === "claude-code");
    assert.equal(textOf(one(card, "cag-mrows")), "Models: in the picker or not, add one by name, tune one|The models of the account it runs on, its Default turned off. Each account keeps its own list.");
  });
});

describe("the sign-in sheet", () => {
  test("Claude's two ways named first, the first chosen; Continue starts the one picked in a terminal on the sheet, its line beside it, the terminal taking the keys; ended well, who it runs as", async () => {
    const signIn = inTerminal();
    const p = signInSheet([acct({}, SIGNED_OUT)], "claude-code", {
      answer: (method, path, body) => (body?.way === "console-login" ? { ok: true, signIn, agent: acct({ signingIn: signIn }, SIGNED_OUT) } : { ok: true, choose: CLAUDE_WAYS, agent: acct({}, SIGNED_OUT) }),
    });
    assert.deepEqual([p.sheet.label, p.sheet.class, textOf(p.sheet.head)], ["Sign in", "tk-sheet", "Sign in|Claude Code"]);
    assert.equal(p.said(), "Starting the sign-in…");
    await settle();
    assert.equal(p.said(), "How do you want to sign in?|Claude Subscription|Use your Claude subscription|Anthropic Console|Use Anthropic Console (API usage billing)");
    const ways = () => every(p.sheet.body, "si-way");
    assert.deepEqual(ways().map((w) => w.attrs["aria-checked"]), ["true", "false"]);
    ways()[1].dispatch("click");
    assert.deepEqual(ways().map((w) => w.attrs["aria-checked"]), ["false", "true"]);
    assert.deepEqual(p.foot(), ["Cancel", "Continue"]);
    p.press("Continue");
    await settle();
    assert.deepEqual(p.calls.map(([m, path, body]) => [m, path, body]), [
      ["POST", "/agent-accounts/claude-code/sign-in", {}],
      ["POST", "/agent-accounts/claude-code/sign-in", { way: "console-login" }],
    ]);
    assert.equal(p.said(), "Signing in with Anthropic Console: follow the steps in the terminal below. It may open a page in your browser.|Or run it in a terminal of your own|claude auth login --console");
    assert.deepEqual([p.views.length, p.views[0].id, p.views[0].focused], [1, "term-1", 1]);
    assert.equal(textOf(one(p.sheet.foot, "tk-foot-note")), "Closing this sheet leaves it running.");
    assert.deepEqual(p.foot(), ["Cancel sign-in"]);
    // The feed's word that it is under way changes nothing here: the terminal keeps the keys.
    const lead = one(p.sheet.body, "tk-lead");
    p.k.set([acct({ signingIn: signIn }, SIGNED_OUT)]);
    assert.deepEqual([p.views.length, p.views[0].focused], [1, 1]);
    // (fails before: no — a guard the mutation pass asked for: nothing checked that the sheet itself stays as it was)
    assert.equal(one(p.sheet.body, "tk-lead"), lead, "nor is the sheet painted again");
    p.k.set([acct({ lastSignIn: { outcome: "signed-in", error: null, at: NOW + 1000 } }, SIGNED_IN)]);
    assert.equal(p.said(), "Signed in|Claude Max|d••@example.com");
    assert.equal(p.views[0].disposed, 1, "its terminal let go");
    btn(p.sheet.body, "d••@example.com").dispatch("click");
    assert.equal(p.said(), "Signed in|Claude Max|dev@example.com");
    assert.deepEqual(p.foot(), ["Done"]);
    p.press("Done");
    assert.deepEqual([p.sheet.closed, p.k.listeners()], [true, 0]);
  });

  test("a sign-in under way is shown again, not started anew; an end older than it is not its end; one that failed keeps its terminal and says why, and Try again starts afresh", async () => {
    const signIn = inTerminal();
    const p = signInSheet([acct({ signingIn: signIn }, SIGNED_OUT)], "claude-code", {
      answer: () => ({ ok: true, choose: CLAUDE_WAYS, agent: acct({}, SIGNED_OUT) }),
    });
    assert.deepEqual([p.calls, p.views.map((v) => v.id)], [[], ["term-1"]]);
    p.k.set([acct({ lastSignIn: { outcome: "failed", error: "an older one failed", at: NOW - 5000 } }, SIGNED_OUT)]);
    assert.ok(p.said().startsWith("Signing in with Anthropic Console"), "an end from before it started is not its end");
    p.k.set([acct({ lastSignIn: { outcome: "failed", error: "the program ended with code 2", at: NOW + 5000 } }, SIGNED_OUT)]);
    assert.equal(p.said(), "The sign-in didn't finish|The program ended with code 2.");
    assert.ok(one(p.sheet.body, "tk-term"), "its terminal stays, with what the program said");
    assert.equal(p.views[0].disposed, 0);
    assert.deepEqual(p.foot(), ["Close", "Try again"]);
    p.press("Try again");
    await settle();
    assert.deepEqual([p.views[0].disposed, p.calls], [1, [["POST", "/agent-accounts/claude-code/sign-in", {}]]]);
    assert.ok(p.said().startsWith("How do you want to sign in?"));
  });

  // (fails before: no — a guard the mutation pass asked for: no account was signed out while its sheet showed a
  // sign-in)
  test("signed out while its sign-in showed: Signed out, and Sign in starts afresh", async () => {
    const p = signInSheet([acct({ signingIn: inTerminal() }, SIGNED_OUT)], "claude-code", {
      answer: () => ({ ok: true, choose: CLAUDE_WAYS, agent: acct({}, SIGNED_OUT) }),
    });
    p.k.set([acct({ lastSignIn: { outcome: "signed-out", error: null, at: NOW + 5000 } }, SIGNED_OUT)]);
    assert.equal(p.said(), "Signed out");
    assert.deepEqual(p.foot(), ["Close", "Sign in"]);
    p.press("Sign in");
    await settle();
    assert.deepEqual(p.calls, [["POST", "/agent-accounts/claude-code/sign-in", {}]]);
  });

  test("a page sign-in: Codex's code way — the code to type, Open the sign-in page, Copy link, its wait; Cancel sign-in stops it through its route and closes the sheet", async () => {
    const codex = acct({ upstream: "cx", name: "Codex", type: "codex", agent: "codex", agentName: "Codex", login: "codex login" });
    const signIn = { kind: "browser", way: "chatgpt-code", name: "ChatGPT on another device", url: "https://auth.example.test/codex/device", code: "FAKE-1234", line: "codex login", at: NOW };
    const p = signInSheet([codex], "cx", { answer: (method, path) => (path.endsWith("/cancel") ? { ok: true, agent: codex } : { ok: true, signIn, agent: { ...codex, signingIn: signIn } }) });
    await settle();
    assert.equal(p.said(), "Signing in with ChatGPT on another device: open the sign-in page in any browser, sign in, and type this code there:|FAKE-1234|Open the sign-in page|Copy link|Waiting for you to sign in on the page — up to 15 minutes.|Or sign in with its CLI, in a terminal|codex login");
    assert.equal(p.views.length, 0, "no terminal");
    btn(p.sheet.body, "Open the sign-in page").dispatch("click");
    btn(p.sheet.body, "Copy link").dispatch("click");
    btn(one(p.sheet.body, "si-code"), "Copy the code").dispatch("click");
    await settle();
    assert.deepEqual([p.opened, p.copied, p.toasts], [["https://auth.example.test/codex/device"], ["https://auth.example.test/codex/device", "FAKE-1234"], [["The link copied", undefined], ["The code copied", undefined]]]);
    p.press("Cancel sign-in");
    await settle();
    assert.deepEqual(p.calls.at(-1), ["POST", "/agent-accounts/cx/sign-in/cancel", undefined]);
    assert.deepEqual([p.sheet.closed, p.k.listeners()], [true, 0]);
    const here = signInSheet([codex], "cx", { answer: () => ({ ok: true, signIn: { ...signIn, way: "chatgpt", name: "ChatGPT", code: null } }) });
    await settle();
    assert.ok(here.said().startsWith("Signing in with ChatGPT: open the sign-in page and sign in there. This sheet follows it.|Open the sign-in page|Copy link|"), here.said());
  });

  // (fails before: yes — the review of 11-10: the sheet had no field for a key, so a way that signs in with one — Codex's
  // OpenAI API key, an ACP agent's key it reads from a variable — could not be taken)
  test("a key's way: its field under the ways, picked; Sign in with nothing in it asks nothing; the key goes in the sign-in's body alone and leaves the field; the sheet waits for its end, then says who it runs as", async () => {
    const codex = acct({ upstream: "cx", name: "Codex", type: "codex", agent: "codex", agentName: "Codex", login: "codex login" });
    const keyWay = { id: "api-key", name: "OpenAI API key", description: "Paste a key from your OpenAI account", kind: "key", label: "OpenAI API key" };
    const ways = [{ id: "chatgpt", name: "ChatGPT", description: "Sign in on ChatGPT's page, in this computer's browser" }, keyWay];
    const signIn = { kind: "key", way: "api-key", name: "OpenAI API key", at: NOW };
    const p = signInSheet([codex], "cx", { answer: (method, path, body) => (body?.key ? { ok: true, signIn, agent: codex } : { ok: true, choose: ways, agent: codex }) });
    await settle();
    assert.equal(every(p.sheet.body, "si-key-in").length, 0, "no field while ChatGPT's way is picked");
    assert.deepEqual(p.foot(), ["Cancel", "Continue"]);
    every(p.sheet.body, "si-way")[1].dispatch("click");
    const field = one(p.sheet.body, "si-key-in");
    assert.deepEqual([field.tag, field.attrs.type, field.attrs.autocomplete, field.attrs["aria-label"]], ["input", "password", "off", "OpenAI API key"]);
    assert.equal(textOf(one(p.sheet.body, "si-key")), "OpenAI API key", "the field's label, the agent's own words");
    assert.deepEqual(p.foot(), ["Cancel", "Sign in"]);
    p.press("Sign in");
    await settle();
    assert.equal(p.calls.length, 1, "an empty field asks nothing");
    field.value = "  sk-test-0123  ";
    field.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.deepEqual(p.calls.at(-1), ["POST", "/agent-accounts/cx/sign-in", { way: "api-key", key: "sk-test-0123" }]);
    assert.equal(field.value, "", "the field keeps no key once it went");
    assert.equal(p.said(), "Signing in with OpenAI API key…");
    assert.ok(!JSON.stringify(p.sheet.body).includes("sk-test-0123"), "nor does the sheet");
    const keyed = [{ source: "account/read", identity: { kind: "api-key", label: "OpenAI API key", plan: null, email: null, organization: null, detail: null, billing: "metered" } }];
    p.k.set([acct({ upstream: "cx", name: "Codex", type: "codex", agent: "codex", agentName: "Codex", login: "codex login", lastSignIn: { outcome: "signed-in", error: null, at: NOW + 1 } }, keyed)]);
    assert.equal(p.said(), "Signed in|OpenAI API key");
  });

  // (fails before: yes — the re-read's finding 4: an end that says a key is kept and nothing checked it read as a
  // sign-in that didn't finish, with Try again; before it there was no such end, and the sheet said Signed in)
  test("a key nothing here can check: Key kept, its next turn tries it — never Signed in — with Done, or the refused turn's Send again", async () => {
    const keyed = acct({ upstream: "keyed", name: "Keyed", agent: "keyed", agentName: "Keyed", says: false, login: null, ways: [KEYED_WAY], signsOut: false });
    const signIn = { kind: "key", way: "fake-key", name: "Fake API key", at: NOW };
    const kept = { ...keyed, keyKept: true, lastSignIn: { outcome: "key-kept", error: null, at: NOW + 1 } };
    const answer = (/** @type {string} */ _method, /** @type {string} */ _path, /** @type {any} */ body) => (body?.key ? { ok: true, signIn, agent: keyed } : { ok: true, choose: [KEYED_WAY], agent: keyed });
    const p = signInSheet([keyed], "keyed", { answer });
    await settle();
    const field = one(p.sheet.body, "si-key-in");
    field.value = "fk-test-0123";
    field.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.equal(p.said(), "Signing in with Fake API key…");
    p.k.set([kept]);
    assert.equal(p.said(), "Key kept|Its next turn tries it.");
    assert.deepEqual(p.foot(), ["Done"]);
    let sent = 0;
    const turn = signInSheet([keyed], "keyed", { answer, then: { label: "Send again", run: () => { sent++; } } });
    await settle();
    const again = one(turn.sheet.body, "si-key-in");
    again.value = "fk-test-0123";
    again.dispatch("keydown", { key: "Enter" });
    await settle();
    turn.k.set([kept]);
    assert.deepEqual(turn.foot(), ["Close", "Send again"]);
    turn.press("Send again");
    assert.deepEqual([turn.sheet.closed, sent], [true, 1]);
  });

  // (fails before: yes — a page sign-in was always one with a page of Filament's to open: an ACP agent's own one, which it
  // opens itself, drew an empty link)
  test("a sign-in the agent carries out itself: no page to open here, the agent's own words, and its wait", async () => {
    const agent = acct({ upstream: "oauthy", name: "Oauthy", type: "acp", agent: "oauthy", agentName: "Oauthy", login: null });
    const signIn = { kind: "browser", way: "browser-login", name: "Log in", url: null, code: null, line: null, at: NOW };
    const p = signInSheet([agent], "oauthy", { answer: () => ({ ok: true, signIn, agent: { ...agent, signingIn: signIn } }) });
    await settle();
    assert.equal(p.said(), "Signing in with Log in: Oauthy carries it out itself, and may open its sign-in page in your browser — finish there. This sheet follows it.|Waiting for the sign-in to finish — up to 15 minutes.");
    assert.equal(btn(p.sheet.body, "Open the sign-in page"), undefined);
    assert.deepEqual(p.foot(), ["Cancel sign-in"]);
  });

  test("where Filament can't open a terminal: the line to run, Check now, and who is signed in once the agent says so", async () => {
    const p = signInSheet([acct({}, SIGNED_OUT)], "claude-code", { answer: () => ({ ok: true, line: "claude auth login", agent: acct({}, SIGNED_OUT) }) });
    await settle();
    assert.equal(p.said(), "Filament can't open a terminal on this computer. Run this in a terminal of your own, then Check now:|claude auth login|Nobody is signed in yet.");
    assert.deepEqual(p.foot(), ["Done", "Check now"]);
    p.press("Check now");
    assert.deepEqual([p.k.did, p.foot()], [["check claude-code"], ["Done", "Checking…"]]);
    p.k.set([acct({}, SIGNED_IN)]);
    assert.equal(textOf(one(p.sheet.body, "si-now")), "Now signed in as |Claude Max|d••@example.com");
    p.k.release();
    await settle();
    assert.deepEqual(p.foot(), ["Done", "Check now"]);
  });

  // (fails before: yes — an account signed in as nobody said whom read "Nobody is signed in yet.")
  test("where Filament can't open a terminal and its agent doesn't say who it runs as: once someone is signed in, it says so", async () => {
    const out = acct({ says: false }, SIGNED_OUT);
    const p = signInSheet([out], "claude-code", { answer: () => ({ ok: true, line: "claude auth login", agent: out }) });
    await settle();
    assert.equal(textOf(one(p.sheet.body, "si-now")), "Nobody is signed in yet.");
    p.k.set([unnamed()]);
    assert.equal(textOf(one(p.sheet.body, "si-now")), "Now signed in.");
  });

  test("a refused start says why, with Try again; closing the sheet leaves a sign-in running and lets go of the page's accounts", async () => {
    let refuse = true;
    const p = signInSheet([acct({}, SIGNED_OUT)], "claude-code", {
      answer: () => (refuse ? new Error("Claude Code is in a turn") : { ok: true, signIn: inTerminal(), agent: acct({ signingIn: inTerminal() }, SIGNED_OUT) }),
    });
    await settle();
    assert.equal(p.said(), "The sign-in can't start|Claude Code is in a turn.");
    assert.deepEqual(p.foot(), ["Close", "Try again"]);
    refuse = false;
    p.press("Try again");
    await settle();
    assert.equal(p.views[0].id, "term-1");
    p.sheet.close();
    assert.deepEqual([p.views[0].disposed, p.k.listeners(), p.calls.filter(([, path]) => path.endsWith("/cancel"))], [1, 0, []], "closed: nothing cancelled");
  });

  test("from a refused turn: once signed in, Send again in Done's place closes the sheet and sends", async () => {
    let sent = 0;
    const p = signInSheet([acct({}, SIGNED_OUT)], "claude-code", {
      answer: () => ({ ok: true, signIn: inTerminal(), agent: acct({ signingIn: inTerminal() }, SIGNED_OUT) }),
      then: { label: "Send again", run: () => { sent++; } },
    });
    await settle();
    p.k.set([acct({ lastSignIn: { outcome: "signed-in", error: null, at: NOW + 1 } }, SIGNED_IN)]);
    assert.deepEqual(p.foot(), ["Close", "Send again"]);
    p.press("Send again");
    assert.deepEqual([p.sheet.closed, sent], [true, 1]);
  });
});

describe("the Account instrument signs in and switches accounts", () => {
  /**
   * The instrument over the session's account and the page's rows; what it asked of the page recorded.
   * @param {any} chosen @param {any[]} [rows]
   */
  const instrument = (chosen, rows = [chosen]) => {
    /** @type {string[]} */
    const did = [];
    /** What a sign-in sheet was handed to offer once signed in. @type {(() => void)[]} */
    const thens = [];
    const ctx = /** @type {any} */ ({
      accounts: {
        session: () => chosen,
        rows: () => rows,
        check: async (/** @type {string} */ u) => { did.push(`check ${u}`); },
        useResetCredit: async () => null,
        manage: () => did.push("manage accounts"),
        signIn: (/** @type {string} */ u, /** @type {{ label: string, run: () => void } | undefined} */ then) => {
          did.push(then ? `sign in ${u}, then ${then.label}` : `sign in ${u}`);
          if (then) thens.push(then.run);
        },
        switchTo: (/** @type {string} */ u) => did.push(`switch to ${u}`),
      },
    });
    const spec = accountWidget(ctx, { h: fakeH, drawIn: fakeDrawIn }, { now: () => NOW });
    let closes = 0;
    const body = spec.panel?.(fakeH, () => { closes++; });
    return { body, did, thens, closes: () => closes };
  };
  /** An action of the instrument's, by its words. @param {any} body @param {string} words */
  const action = (body, words) => buttonsOf(body).find((b) => textOf(b).endsWith(words));

  test("nobody signed in where the agent signs in on the sheet: Sign in, the one blue button; a sign-in under way: Show; an agent without one names its line", () => {
    const out = instrument(acct({}, SIGNED_OUT));
    assert.equal(textOf(one(out.body, "inst-note")), "Nobody is signed in.");
    const signIn = action(out.body, "Sign in");
    assert.ok(signIn.attrs.class.includes("is-primary"));
    assert.equal(signIn.attrs.title, "Sign Claude Code in");
    signIn.dispatch("click");
    assert.deepEqual([out.did, out.closes()], [["sign in claude-code"], 1]);
    const signing = instrument(acct({ signingIn: inTerminal() }, SIGNED_OUT));
    assert.equal(textOf(one(signing.body, "inst-note")), "Signing in through Anthropic Console: Show brings the sign-in back.");
    assert.equal(action(signing.body, "Sign in"), undefined);
    action(signing.body, "Show").dispatch("click");
    assert.deepEqual(signing.did, ["sign in claude-code"]);
    const cli = instrument(acct({ login: "agent login", ways: [] }, SIGNED_OUT));
    assert.equal(textOf(one(cli.body, "inst-note")), "Nobody is signed in. Run |agent login| in a terminal, then Check now.");
    assert.equal(action(cli.body, "Sign in"), undefined);
  });

  test("a key from outside the account: the instrument says what holds it, where it would say it has no windows (HarnessV3-ACP AF1)", () => {
    const held = instrument(acct({}, HELD));
    assert.equal(textOf(one(held.body, "inst-note")), HELD_WORDS);
  });

  /** The rows under Switch account. @param {any} body @returns {any[]} */
  const switchRows = (body) => every(every(body, "inst-section").find((s) => textOf(s).startsWith("Switch account|")), "is-button");

  test("Switch account: the agent's other accounts of its kind, each with its gauge — the person's glyph with nothing to gauge — and who it runs as; picked, the session's next turn runs on it", () => {
    const spare = added("Spare");
    const busy = added("Busy", {}, SIGNED_IN);
    const sdk = acct({ upstream: "cursor", type: "cursor-sdk", agent: "cursor", agentName: "Cursor" });
    const w = instrument(acct({}, SIGNED_IN), [acct({}, SIGNED_IN), sdk, spare, busy]);
    const rows = switchRows(w.body);
    assert.deepEqual(rows.map(textOf), ["Spare|Not heard from yet", "Busy|Claude Max|week 85%"]);
    assert.deepEqual(rows.map((r) => [!!one(r, "inst-switch-glyph"), !!one(r, "inst-switch-gauge")]), [[true, false], [false, true]]);
    assert.equal(rows[1].attrs.title, `${summaryWords(busy, NOW)}\nThe session's next turn runs on it`);
    rows[0].dispatch("click");
    assert.deepEqual([w.did, w.closes()], [["switch to claude-code-spare"], 1]);
    assert.equal(textOf(instrument(acct({}, SIGNED_IN), [acct({}, SIGNED_IN), sdk]).body).includes("Switch account"), false, "no other account of its kind: no list");
  });

  test("Switch account to one nobody is signed in to: Sign in first, its sheet then offering the switch; one with no sign-in here is dimmed and says its CLI's line", () => {
    const work = added("Work", {}, SIGNED_OUT);
    const w = instrument(acct({}, SIGNED_IN), [acct({}, SIGNED_IN), work]);
    const [row] = switchRows(w.body);
    assert.equal(textOf(row), "Work|Nobody is signed in|Sign in");
    assert.ok(one(row, "is-act"), "Sign in in the accent, in Signed out's place");
    assert.equal(row.attrs.title, "Sign Claude Code · Work in; then the session's next turn can run on it");
    assert.equal(row.attrs.disabled, undefined);
    row.dispatch("click");
    assert.deepEqual([w.did, w.closes()], [["sign in claude-code-work, then Switch to it"], 1], "nothing switched yet");
    w.thens[0]();
    assert.deepEqual(w.did.slice(1), ["switch to claude-code-work"], "the sheet's Switch to it switches");
    const bare = added("Bare", { ways: [] }, SIGNED_OUT);
    const [dim] = switchRows(instrument(acct({}, SIGNED_IN), [acct({}, SIGNED_IN), bare]).body);
    assert.deepEqual([textOf(dim), dim.attrs.disabled, dim.attrs.title], ["Bare|Nobody is signed in", "", summaryWords(bare, NOW)]);
    assert.equal(summaryWords(bare, NOW), "Claude Code · Bare: nobody is signed in — run `claude auth login` in a terminal");
    assert.equal(summaryWords(work, NOW), "Claude Code · Work: nobody is signed in — sign in under Settings → Coding agents");
  });

  // (fails before: yes — an account signed in as nobody said whom read "Not heard from yet")
  test("Switch account to one signed in as nobody said whom: Signed in", () => {
    const spare = unnamed({ upstream: "claude-code-spare", name: "Claude Code · Spare", label: "Spare", added: true, says: null });
    const [row] = switchRows(instrument(acct({}, SIGNED_IN), [acct({}, SIGNED_IN), spare]).body);
    assert.deepEqual([textOf(row), row.attrs.title], ["Spare|Signed in", `${summaryWords(spare, NOW)}\nThe session's next turn runs on it`]);
  });

  test("an account by its agent and its name: the agent alone for its Default", () => {
    assert.deepEqual([accountName(acct()), accountName(added("Work"))], ["Claude Code", "Claude Code · Work"]);
  });
});

describe("a turn its agent's login refused", () => {
  const T = Date.UTC(2026, 9, 8, 9, 0, 0);
  /** A coding agent's turn that failed. @param {any} failure @returns {any} */
  const failed = (failure) => ({ id: "r1", ts: new Date(T).toISOString(), totalMs: 1000, status: "error", error: "Claude Code is not signed in", upstream: "claude-code", failure });

  test("its facts keep the account to sign in, stored as they are; another failure keeps none, and a later request through clears it", () => {
    let f = foldTurnFacts(null, failed({ kind: "auth" }), { own: true });
    assert.deepEqual(f.signIn, { upstream: "claude-code" });
    assert.deepEqual(JSON.parse(JSON.stringify(f)).signIn, f.signIn);
    assert.equal(foldTurnFacts(null, failed({ kind: "transport" }), { own: true }).signIn, null);
    // (fails before: yes — the review of 11-19: Cursor's free plan asked for its Cloud Agent drew "Nobody is signed in")
    assert.equal(foldTurnFacts(null, failed({ kind: "auth", signedIn: true }), { own: true }).signIn, null, "signed in, its plan or credit refused it");
    f = foldTurnFacts(f, { ...failed(null), id: "r2", ts: new Date(T + 5000).toISOString(), status: "ok", error: null }, { own: true });
    assert.equal(f.signIn, null);
  });

  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  test("its banner offers Sign in, handed the banner's one resend: Send again sends once and stands Retry down; after Retry, the sheet's resend sends nothing", () => {
    let sent = 0;
    /** @type {(() => void)[]} */
    const handed = [];
    const banner = () => /** @type {any} */ (errorBanner("Claude Code is not signed in", { onRetry: () => { sent++; }, onSignIn: (resend) => handed.push(resend) }));
    const el = banner();
    /** @param {any} b @param {string} words @returns {any} */
    const button = (b, words) => b.querySelectorAll("button").find((/** @type {any} */ x) => x.textContent === words);
    assert.deepEqual(el.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["Copy", "Sign in", "Retry"], "nothing was said under it: no fold to show");
    assert.ok(button(el, "Sign in").classList.contains("primary"));
    button(el, "Sign in").dispatch("click");
    assert.equal(sent, 0, "Sign in opens the sheet; nothing is sent yet");
    handed[0]();
    handed[0]();
    assert.equal(sent, 1, "sent once");
    assert.deepEqual([button(el, "Retry").disabled, button(el, "Sign in").disabled], [true, true]);
    const other = banner();
    button(other, "Sign in").dispatch("click");
    button(other, "Retry").dispatch("click");
    handed[1]();
    assert.equal(sent, 2, "Retry spent the banner's one resend");
    assert.equal(/** @type {any} */ (errorBanner("x", { onRetry: () => {} })).querySelectorAll("button").some((/** @type {any} */ b) => b.textContent === "Sign in"), false);
  });

  test("its banner says it in a person's words beside its Sign in, the agent's own message under the details; both of the timeline's banners take them", () => {
    const error = "ACP agent \"claude-code-work\" failed: Claude Code · Work is not signed in.";
    assert.deepEqual(signedOutBanner(error, "{\"error\":1}", added("Work")), {
      message: "Nobody is signed in to Claude Code · Work. Sign in, then send your message again.",
      detail: `${error}\n\n{"error":1}`,
    });
    assert.deepEqual(signedOutBanner("not signed in", "", null), {
      message: "Nobody is signed in to the agent's account. Sign in, then send your message again.",
      detail: "not signed in",
    });
    const src = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.equal(src.split("errorBanner(w.message, { detail: w.detail,").length - 1, 2);
  });

  // (fails before: yes — AC3's drive, run 3: the Northwind account's login expired mid-drive, Claude saying "OAuth
  // session expired and could not be refreshed", and the banner said nobody was signed in to it)
  test("a login the agent says expired reads as one that did, beside its Sign in; its words stay under the details", () => {
    const error = "Internal error: Failed to authenticate: OAuth session expired and could not be refreshed";
    assert.deepEqual(signedOutBanner(error, "", added("Northwind")), {
      message: "The sign-in to Claude Code · Northwind has expired. Sign in again, then send your message again.",
      detail: error,
    });
    assert.equal(signedOutBanner("auth failed", "Your login could not be refreshed", null).message, "The sign-in to the agent's account has expired. Sign in again, then send your message again.", "the server's body says it too");
    assert.equal(signedOutBanner("Invalid API key · Please run /login", "", added("Work")).message, "Nobody is signed in to Claude Code · Work. Sign in, then send your message again.");
  });
});

// ---- AC3-8: the agents themselves ----------------------------------------------------------------------------------

/** What Claude Code's adapter declares, as its profile says it. */
const PROFILE = {
  sessions: { load: true, list: true, resume: true, fork: false, close: true, delete: false, additionalDirectories: false, subagents: false },
  prompt: { image: true, audio: false, embeddedContext: true },
  mcp: { http: true },
  steering: true,
  promptQueueing: false,
  rawMessages: true,
  account: true,
};
/** The registry's age, as the page reads it. */
const REGISTRY = { at: NOW - 3 * HOUR, asking: false, error: null };
/**
 * An entry of Settings → Coding agents as the server sends it: by default the registry's npm agent, not on this
 * computer.
 * @param {Record<string, any>} [o] @returns {any}
 */
const agent = (o = {}) => ({
  id: "npx-agent", name: "Npx Agent", about: "An agent npm installs.", authors: ["Fake Co"], license: "MIT", docs: "https://example.test/npx",
  from: "registry", mark: "npx-agent", version: "1.0.0", state: "missing", upstreams: [], primary: null, installed: null, runs: null, update: null,
  install: { way: "npx", line: "npm install --global --prefix D:\\agents\\npx-agent\\1.0.0 @fake/npx-agent@1.0.0", needs: null },
  download: null, unavailable: false, gone: false, installing: null, lastInstall: null, models: null, asking: false, modelsError: null,
  profile: null, ...o,
});
/** Claude Code's entry, connected on the rows' Default. @param {Record<string, any>} [o] */
const claude = (o = {}) =>
  agent({
    id: "claude-code", name: "Claude Code", about: "Anthropic's coding agent.", authors: ["Anthropic"], license: "proprietary",
    docs: "https://docs.claude.com/en/docs/claude-code", from: "filament", mark: "claude-acp", version: null, state: "connected",
    upstreams: ["claude-code"], primary: "claude-code", install: { way: "npm", line: "npm install -g @agentclientprotocol/claude-agent-acp", needs: null },
    models: { count: 3, at: NOW - 2 * 60_000 }, profile: PROFILE, ...o,
  });
/** The npm agent installed by Filament and connected, the registry listing a newer version. @param {Record<string, any>} [o] */
const npxOn = (o = {}) =>
  agent({ state: "connected", upstreams: ["npx-agent"], primary: "npx-agent", version: "1.1.0", installed: { version: "1.0.0", at: NOW - DAY }, update: "1.1.0", models: { count: 2, at: NOW }, ...o });
/** Its one account, which says nothing of who it runs as. */
const npxRow = () =>
  acct({
    upstream: "npx-agent", name: "Npx Agent", agent: "npx-agent", agentName: "Npx Agent", says: false, login: null, style: null,
    oneAccount: "Npx Agent runs on the login it keeps itself: Filament knows no way to give it a second account", ways: [], signsOut: false,
  });
/** The entries as `GET /api/coding-agents` answers them. @param {any[]} entries @param {any} [registry] */
const listOf = (entries, registry = REGISTRY) => ({ entries, registry, computer: "windows-x86_64" });
/** A menu's items in words: a label in brackets, a separator a dash. @param {any[]} items */
const menuWords = (items) => items.map((i) => (i.type === "separator" ? "—" : i.type === "label" ? `[${i.label}]` : i.label));

describe("Settings → Coding agents: the agents (AC3-8)", () => {
  test("a card per agent connected, then each turned off; each wears its registry mark, says what it does in a chat and how many models it lists, Refresh asking again", async () => {
    const codexOff = agent({
      id: "codex", name: "Codex", about: "OpenAI's coding agent.", authors: ["OpenAI"], license: "Apache-2.0", docs: "https://developers.openai.com/codex",
      from: "filament", mark: null, version: null, state: "off", upstreams: ["cx"], primary: "cx", install: { way: "npm", line: "npm install -g @openai/codex", needs: null },
    });
    const p = settings([acct({}, SIGNED_IN)], { agents: listOf([codexOff, claude(), agent()]), answer: () => listOf([codexOff, claude({ asking: true }), agent()]) });
    const cards = every(p.body, "cag-card");
    assert.deepEqual(cards.map((c) => [c.attrs["data-agent"], c.attrs.class]), [["claude-code", "cag-card"], ["codex", "cag-card is-off"]], "connected first");
    assert.equal(textOf(one(p.body, "cag-h")), "Your agents|2");
    assert.equal(one(cards[0], "cag-mark-glyph").attrs.style, `-webkit-mask-image: url("/api/coding-agents/icons/claude-acp"); mask-image: url("/api/coding-agents/icons/claude-acp")`);
    assert.equal(textOf(one(cards[0], "cag-head")), "Claude Code|Each account signs in on its own: add one for each login you use.|Add account");
    const chips = every(cards[0], "cag-chip");
    assert.deepEqual(chips.map(textOf), ["reopens chats", "lists chats", "mid-turn messages", "images", "files", "Filament's tools"], "the ones a chat feels");
    assert.equal(chips[3].attrs.title, "Pasted images go through.");
    assert.equal(textOf(one(cards[0], "cag-models")), "3 models · 2 min ago");
    btn(cards[0], "Ask for its models again").dispatch("click");
    await settle();
    assert.deepEqual(p.calls, [["POST", "/coding-agents/claude-code/models", undefined]]);
    const asking = every(p.body, "cag-card")[0];
    assert.equal(textOf(one(asking, "cag-models")), "Asking for its models…");
    assert.equal(btn(asking, "Asking for its models…").attrs.disabled, "");
    assert.equal(textOf(cards[1]), "C|Codex|Turned off — its accounts and their logins are kept.|Turn on", "a mark-less agent wears its initial");
  });

  test("Turn on brings a turned-off agent back, its button waiting while asked; a refusal is said in the server's words", async () => {
    let refuse = true;
    const p = settings([acct({}, SIGNED_IN)], {
      agents: listOf([claude({ state: "off" })]),
      answer: () => (refuse ? new Error("there is already an upstream with the id claude-code that isn't Claude Code") : listOf([claude()])),
    });
    btn(one(p.body, "cag-card"), "Turn on").dispatch("click");
    assert.equal(btn(one(p.body, "cag-card"), "Turning on…").attrs.disabled, "");
    await settle();
    assert.deepEqual(p.toasts, [["Couldn't turn Claude Code on: there is already an upstream with the id claude-code that isn't Claude Code", "err"]]);
    refuse = false;
    btn(one(p.body, "cag-card"), "Turn on").dispatch("click");
    await settle();
    assert.deepEqual([p.calls.map(([m, path]) => `${m} ${path}`), p.toasts.at(-1)], [["POST /coding-agents/claude-code/connect", "POST /coding-agents/claude-code/connect"], ["Claude Code is on again", undefined]]);
    assert.equal(one(p.body, "cag-card").attrs.class, "cag-card");
  });

  test("a card's menu: the version Filament installed and its Update, its website, Turn off; Remove from this computer asks first, then says where its folder stays", async () => {
    const p = settings([npxRow()], {
      agents: listOf([npxOn()]),
      answer: (method) =>
        method === "DELETE"
          ? { folder: null, kept: "D:\\agents\\npx-agent is still in use: it is deleted when Filament next starts", ...listOf([agent()]) }
          : listOf([npxOn({ state: "off" })]),
    });
    const more = () => btn(one(p.body, "cag-card"), "More for Npx Agent");
    more().dispatch("click");
    const items = p.menus[0].items;
    assert.deepEqual(menuWords(items), ["[Installed by Filament · 1.0.0]", "Update to 1.1.0…", "Its website", "Turn off", "—", "Remove from this computer…"]);
    assert.deepEqual([items[3].desc, items[5].variant], ["Its accounts and their logins are kept", "destructive"]);
    items[1].onClick();
    items[2].onClick();
    assert.deepEqual([p.installs, p.opened], [["npx-agent"], ["https://example.test/npx"]]);
    items[3].onClick();
    await settle();
    assert.deepEqual([p.calls.at(-1), p.toasts.at(-1)], [["POST", "/coding-agents/npx-agent/off", undefined], ["Npx Agent is turned off", undefined]]);
    assert.equal(one(p.body, "cag-card").attrs.class, "cag-card is-off");
    more().dispatch("click");
    assert.deepEqual(menuWords(p.menus[1].items), ["[Installed by Filament · 1.0.0]", "Its website", "—", "Remove from this computer…"], "turned off: no Update, no Turn off");
    p.menus[1].items[3].onClick();
    await settle();
    assert.deepEqual(p.asked.at(-1), {
      title: "Remove Npx Agent from this computer?",
      description: "Filament deletes the copy it installed, and forgets its accounts and its models. Your chats with it stay.",
      confirmLabel: "Remove",
      destructive: true,
    });
    assert.deepEqual([p.calls.at(-1), p.toasts.at(-1)], [["DELETE", "/coding-agents/npx-agent", undefined], ["Npx Agent is removed; D:\\agents\\npx-agent is still in use: it is deleted when Filament next starts", undefined]]);
    assert.deepEqual([every(p.body, "cag-card").length, every(one(p.body, "cag-adds"), "cag-item").map((i) => i.attrs["data-agent"])], [0, ["npx-agent"]], "back on the list to add");
    const kept = settings([npxRow()], { agents: listOf([npxOn()]), confirm: false });
    btn(one(kept.body, "cag-card"), "More for Npx Agent").dispatch("click");
    kept.menus[0].items[5].onClick();
    await settle();
    assert.deepEqual(kept.calls, [], "declined: nothing removed");
  });

  // (fails before: yes — the Fable 5.2 re-read's finding 7: only the list to add drew what an entry says of itself, so a
  // Gemini CLI connection's card never said Google retired it, and turned off it said "its accounts and their logins
  // are kept" of a connection the next start takes from the settings)
  test("an agent Filament drives no more says so on its card, on and off: what turning it off does, when it leaves the settings, what goes and what stays; one holding settings of the person's says it stays", async () => {
    const WHY = "Gemini CLI: Google retired it for Antigravity (June 2026), so Filament runs Google's models on Antigravity.";
    const LEAVES = "leaves your settings the next time Filament starts, and its route with it: neither holds a setting of yours. Gemini CLI itself and its sign-in stay on this computer.";
    const row = () => acct({
      upstream: "gemini", name: "Gemini CLI", agent: "gemini", agentName: "Gemini CLI", says: false, login: null, style: null,
      oneAccount: "Gemini CLI runs on the login it keeps itself: Filament knows no way to give it a second account", ways: [], signsOut: false,
    });
    /** A Gemini CLI connection, made by hand as the server lists it. @param {Record<string, any>} [o] */
    const gem = (o = {}) =>
      agent({ id: "gemini", name: "Gemini CLI", about: WHY, authors: [], license: null, docs: null, from: "config", mark: null, version: null, state: "connected", upstreams: ["gemini"], primary: "gemini", install: null, retired: { leaves: true }, ...o });
    const p = settings([row()], { agents: listOf([gem()]), answer: () => listOf([gem({ state: "off" })]) });
    const on = one(p.body, "cag-card");
    assert.equal(textOf(one(on, "cag-callout")), `${WHY} This connection still runs as it is set up. Turned off, it ${LEAVES}`);
    assert.equal(one(on, "cag-callout").attrs.role, "note");
    btn(on, "More for Gemini CLI").dispatch("click");
    assert.deepEqual(p.menus[0].items.map((/** @type {any} */ i) => [i.label, i.desc]), [["Turn off", "It leaves your settings the next time Filament starts"]]);
    p.menus[0].items[0].onClick();
    await settle();
    assert.equal(textOf(one(p.body, "cag-card")), `G|Gemini CLI|Turned off. ${WHY} It ${LEAVES} Turn it on to keep it.|Turn on`);
    // One that holds settings of the person's stays, on and off, and says so.
    const kept = settings([row()], { agents: listOf([gem({ retired: { leaves: false } })]), answer: () => listOf([gem({ state: "off", retired: { leaves: false } })]) });
    assert.equal(textOf(one(kept.body, "cag-callout")), `${WHY} This connection still runs as it is set up. Turned off, it stays in your settings: it holds settings of yours.`);
    btn(one(kept.body, "cag-card"), "More for Gemini CLI").dispatch("click");
    assert.equal(kept.menus[0].items[0].desc, "Its accounts and their logins are kept");
    kept.menus[0].items[0].onClick();
    await settle();
    assert.equal(textOf(one(kept.body, "cag-card")), `G|Gemini CLI|Turned off. ${WHY} It stays in your settings: it holds settings of yours.|Turn on`);
    // Off and never turned off in Settings, it stands on the list to add, with the same words whole.
    const listed = settings([], { agents: listOf([gem({ state: "ready", upstreams: ["gemini"] }), gem({ id: "gemini-kept", state: "missing", retired: { leaves: false } })]) });
    assert.deepEqual(every(listed.body, "cag-item-about").map((x) => [textOf(x), x.attrs.title === textOf(x)]), [
      [`${WHY} It ${LEAVES} Connect it to keep it.`, true],
      [`${WHY} It stays in your settings: it holds settings of yours.`, true],
    ]);
    // Any other agent's card is as it was: what it says of itself stays on the list to add.
    const plain = settings([acct({}, SIGNED_IN)], { agents: listOf([claude(), claude({ id: "codex", name: "Codex", state: "off", upstreams: ["cx"], primary: "cx" })]) });
    assert.deepEqual(every(plain.body, "cag-card").map((c) => [one(c, "cag-callout"), textOf(one(c, "cag-style"))]), [
      [undefined, "Each account signs in on its own: add one for each login you use."],
      [undefined, "Turned off — its accounts and their logins are kept."],
    ]);
  });

  test("an agent npm installed here (HarnessV3-ACP AF3): its menu says its version, and the registry's newer one is its Update; under way and failed, its card says an update's words", () => {
    const line = "npm install -g @agentclientprotocol/claude-agent-acp@0.87.0";
    /** Claude Code's adapter 0.76.0, the registry's 0.87.0. @param {Record<string, any>} [o] */
    const older = (o = {}) => claude({ runs: "0.76.0", update: "0.87.0", install: { way: "npm", line, needs: null }, ...o });
    const p = settings([acct({}, SIGNED_IN)], { agents: listOf([older()]) });
    const more = () => btn(one(p.body, "cag-card"), "More for Claude Code");
    more().dispatch("click");
    assert.deepEqual(menuWords(p.menus[0].items), ["[Version 0.76.0]", "Update to 0.87.0…", "Its website", "Turn off"]);
    p.menus[0].items[1].onClick();
    assert.deepEqual(p.installs, ["claude-code"]);
    p.a.set(listOf([older({ installing: { terminal: "t1", line, at: NOW, version: "0.87.0" } })]));
    assert.equal(textOf(one(p.body, "cag-note")), "Updating to 0.87.0…|Show");
    p.a.set(listOf([older({ lastInstall: { outcome: "failed", error: "the install ended with code 1", at: NOW } })]));
    assert.equal(textOf(one(p.body, "cag-failed")), "The last update didn't finish: the install ended with code 1.");
    p.a.set(listOf([claude({ runs: "0.87.0" })]));
    more().dispatch("click");
    assert.deepEqual(menuWords(p.menus[1].items), ["[Version 0.87.0]", "Its website", "Turn off"], "updated: no Update");
  });

  test("an agent whose program is gone says so, with what brings it back, its accounts offering nothing that starts it; an update under way shows on its card with Show, and one that failed says why", () => {
    const p = settings([acct({}, SIGNED_IN), npxRow()], {
      agents: listOf([claude({ gone: true }), npxOn({ installing: { terminal: "t1", line: "npm install …", at: NOW, version: "1.1.0" } })]),
    });
    const [cc, npx] = every(p.body, "cag-card");
    assert.equal(textOf(one(cc, "cag-callout")), "Claude Code's program isn't on this computer any more: its turns can't start.|Install…");
    /** What an account's row offers, by each button's words or label. @param {any} card @param {string} upstream */
    const offers = (card, upstream) => buttonsOf(one(rowOf(card, upstream), "cag-acts")).map((b) => textOf(b) || b.attrs["aria-label"]);
    assert.deepEqual([textOf(one(rowOf(cc, "claude-code"), "cag-who")), offers(cc, "claude-code")], ["Claude Max|Example Org|d••@example.com", []], "who it ran as; no Sign out, no Check now");
    const quiet = settings([acct()], { agents: listOf([claude({ gone: true })]) });
    assert.deepEqual([textOf(one(quiet.body, "cag-who")), offers(quiet.body, "claude-code")], ["Not heard from yet", []], "no Sign in, and no Check now to wait for");
    btn(one(cc, "cag-callout"), "Install…").dispatch("click");
    assert.equal(textOf(one(npx, "cag-note")), "Updating to 1.1.0…|Show");
    btn(one(npx, "cag-note"), "Show").dispatch("click");
    assert.deepEqual(p.installs, ["claude-code", "npx-agent"]);
    p.a.set(listOf([claude(), npxOn({ lastInstall: { outcome: "failed", error: "the install ended with code 1", at: NOW } })]));
    const after = every(p.body, "cag-card");
    assert.equal(one(after[0], "cag-callout"), undefined);
    assert.deepEqual(offers(after[0], "claude-code"), ["Sign out", "Ask Claude who it runs as, how much of its plan is used and its models now", "More"], "back: all of it");
    assert.equal(textOf(one(after[1], "cag-failed")), "The last update didn't finish: the install ended with code 1.");
  });

  test("Add a coding agent: the ones Filament knows, then the registry's line and its agents; each says who makes it and how it installs, and offers one thing", async () => {
    const gem = agent({
      id: "gemini", name: "Gemini CLI", about: "Google's coding agent.", authors: ["Google"], license: "Apache-2.0", from: "filament", mark: "gemini",
      version: null, state: "ready", install: { way: "npm", line: "npm install -g @google/gemini-cli", needs: null },
    });
    const cursor = agent({
      id: "cursor", name: "Cursor CLI", about: "Cursor's agent in a terminal.", authors: [], license: null, from: "filament", mark: "cursor", version: null,
      install: { way: "script", line: "irm 'https://cursor.com/install?win32=true' | iex", needs: null },
    });
    const uv = agent({ id: "uv-agent", name: "Uv Agent", about: "An agent uv installs.", mark: null, version: "2.0.0", install: { way: "uvx", line: "uv tool install --force fake-uv-agent==2.0.0", needs: "uv" } });
    const bin = agent({ id: "bin-agent", name: "Bin Agent", about: "Downloaded from its maker.", authors: [], license: null, version: "0.3.0", install: null, download: { url: "https://example.test/bin-agent.zip", program: "bin-agent" } });
    const far = agent({ id: "far-agent", name: "Far Agent", about: "Made for another computer.", authors: ["A", "B", "C"], license: null, version: "0.1.0", install: null, unavailable: true });
    const failed = agent({ id: "line-agent", name: "Line Agent", lastInstall: { outcome: "failed", error: "the install ended with code 1", at: NOW } });
    const busy = agent({ id: "busy-agent", name: "Busy Agent", installing: { terminal: "t9", line: "npm install …", at: NOW, version: "1.0.0" } });
    const p = settings([acct({}, SIGNED_IN)], {
      agents: listOf([claude(), gem, cursor, agent(), uv, bin, far, failed, busy]),
      answer: () => listOf([claude(), { ...gem, state: "connected", upstreams: ["gemini"], primary: "gemini" }]),
    });
    const adds = one(p.body, "cag-adds");
    assert.deepEqual(adds.kids.map((/** @type {any} */ k) => k.attrs.class), ["cag-group", "cag-reg", "cag-group"]);
    /** @param {string} id */
    const item = (id) => all(p.body, (x) => x.attrs?.class === "cag-item" && x.attrs["data-agent"] === id)[0];
    assert.deepEqual(every(adds, "cag-item").map((i) => i.attrs["data-agent"]), ["gemini", "cursor", "npx-agent", "uv-agent", "bin-agent", "far-agent", "line-agent", "busy-agent"]);
    assert.deepEqual(["gemini", "cursor", "npx-agent", "uv-agent", "bin-agent", "far-agent", "line-agent", "busy-agent"].map((id) => textOf(item(id))), [
      "Gemini CLI|Google's coding agent.|By Google · Apache-2.0 · npm, for the whole computer|Connect",
      "Cursor CLI|Cursor's agent in a terminal.|Cursor CLI's install script|Install…",
      "Npx Agent|1.0.0|An agent npm installs.|By Fake Co · MIT · npm, in Filament's folder|Install…",
      "U|Uv Agent|2.0.0|An agent uv installs.|By Fake Co · MIT · uv, in Filament's folder|Needs uv",
      "Bin Agent|0.3.0|Downloaded from its maker.|A program to download|Connect shows here once |bin-agent| is on your PATH.|Download",
      "Far Agent|0.1.0|Made for another computer.|By A, B and others · No build for this computer|Not made for this computer",
      "Line Agent|1.0.0|An agent npm installs.|By Fake Co · MIT · npm, in Filament's folder|The last install didn't finish: the install ended with code 1.|Install…",
      "Busy Agent|1.0.0|An agent npm installs.|By Fake Co · MIT · npm, in Filament's folder|Installing…|Show",
    ]);
    assert.deepEqual(
      [one(item("uv-agent"), "cag-link").attrs.href, one(item("bin-agent"), "cag-link").attrs.href, one(item("bin-agent"), "cag-link").attrs.target],
      ["https://docs.astral.sh/uv/getting-started/installation/", "https://example.test/bin-agent.zip", "_blank"],
    );
    assert.equal(textOf(one(p.body, "cag-reg")), "From ACP's registry|updated 3 h ago|Refresh");
    btn(item("npx-agent"), "Install…").dispatch("click");
    btn(item("busy-agent"), "Show").dispatch("click");
    assert.deepEqual(p.installs, ["npx-agent", "busy-agent"]);
    btn(item("gemini"), "Connect").dispatch("click");
    assert.equal(btn(item("gemini"), "Connecting…").attrs.disabled, "");
    await settle();
    assert.deepEqual([p.calls, p.toasts], [[["POST", "/coding-agents/gemini/connect", undefined]], [["Gemini CLI is connected", undefined]]]);
    assert.deepEqual(every(p.body, "cag-card").map((c) => c.attrs["data-agent"]), ["claude-code", "gemini"]);
  });

  // (fails before: yes — a program to download offered only its raw archive's link and "Connect shows here once … is on
  // your PATH"; one Filament downloads read as npm's)
  test("a program Filament downloads into its own folder: its row says so and offers Install…, with no PATH to wait on", () => {
    const line = "https://example.test/bin-agent-0.3.0.zip";
    const p = settings([], { agents: listOf([agent({ id: "bin-agent", name: "Bin Agent", about: "Downloaded from its maker.", authors: [], license: null, version: "0.3.0", install: { way: "binary", line, needs: null } })]) });
    const row = all(p.body, (x) => x.attrs?.class === "cag-item" && x.attrs["data-agent"] === "bin-agent")[0];
    assert.equal(textOf(row), "Bin Agent|0.3.0|Downloaded from its maker.|A download, in Filament's folder|Install…");
    btn(row, "Install…").dispatch("click");
    assert.deepEqual(p.installs, ["bin-agent"]);
  });

  test("the search narrows the list to add by the starts of words in its name, id, maker or what an agent says of itself; nothing matching says so", () => {
    const p = settings([], {
      agents: listOf([
        agent(),
        agent({ id: "uv-agent", name: "Uv Agent", about: "A Python agent.", authors: ["Snake Inc"] }),
        agent({ id: "gemini", name: "Gemini CLI", about: "Google's coding agent.", from: "filament", authors: ["Google"] }),
        agent({ id: "vt", name: "VT Code", about: "Token-efficient context management.", authors: ["vinhnx"] }),
      ]),
    });
    const search = one(p.body, "cag-search");
    const shown = () => every(one(p.body, "cag-adds"), "cag-item").map((i) => i.attrs["data-agent"]);
    assert.deepEqual([search.attrs.placeholder, search.attrs["aria-label"], shown()], ["Search agents", "Search the coding agents", ["gemini", "npx-agent", "uv-agent", "vt"]]);
    const each = /** @type {[string, string[]][]} */ ([["snake", ["uv-agent"]], ["GOOGLE cli", ["gemini"]], ["agent npm", ["npx-agent"]], ["uv-agent", ["uv-agent"]], ["gem", ["gemini"]], ["manage", ["vt"]]]);
    for (const [q, ids] of each) {
      search.value = q;
      search.dispatch("input");
      assert.deepEqual(shown(), ids, q);
    }
    search.value = "zzz";
    search.dispatch("input");
    assert.deepEqual([shown(), textOf(one(p.body, "cag-none"))], [[], "No agent to add matches “zzz”."]);
    assert.ok(one(p.body, "cag-reg"), "the registry's line stays");
  });

  test("before the page's first read the section waits; the registry's line reads Reading… before its first copy and Updating… after, says why a read failed, and Refresh asks again", async () => {
    const p = settings([], { agents: null, answer: () => listOf([], { at: NOW, asking: false, error: null }) });
    assert.deepEqual([textOf(one(p.body, "cag-list")), one(p.body, "cag-adds").kids], ["Reading your agents…", []]);
    /** @param {any} registry */
    const line = (registry) => {
      p.a.set(listOf([], registry));
      return textOf(one(p.body, "cag-reg"));
    };
    assert.equal(line({ at: null, asking: true, error: null }), "From ACP's registry|Reading…");
    assert.equal(line({ at: NOW - 2 * DAY, asking: true, error: null }), "From ACP's registry|Updating…");
    assert.equal(line({ at: NOW - 2 * DAY, asking: false, error: "it answered 503" }), "From ACP's registry|updated 2 d ago|Refresh|The last read failed: it answered 503.");
    assert.equal(line({ at: null, asking: false, error: "it answered 503" }), "From ACP's registry|Refresh|It couldn't be read: it answered 503.");
    btn(one(p.body, "cag-reg"), "Refresh").dispatch("click");
    await settle();
    assert.deepEqual([p.calls, textOf(one(p.body, "cag-reg"))], [[["POST", "/coding-agents/registry/refresh", undefined]], "From ACP's registry|updated just now|Refresh"]);
    assert.equal(textOf(one(p.body, "cag-empty")), "No coding agent is connected yet. Connect one below.");
  });

  test("a spent plan that holds a reset credit offers one, which the app asks for on its sheet; none held, none offered", async () => {
    const spent = { source: "account/rateLimits/updated", identity: PLUS, windows: [win("primary", 100, NOW + HOUR)], resetCredits: { available: 2, nextExpiresAt: null } };
    /** @param {any[]} reports */
    const codex = (reports) =>
      acct({ upstream: "cx", name: "Codex", type: "codex", agent: "codex", agentName: "Codex", login: "codex login", ways: [{ id: "chatgpt", name: "ChatGPT", description: "" }] }, reports);
    const p = settings([codex([spent])]);
    const r = rowOf(p.body, "cx");
    assert.deepEqual(buttonsOf(one(r, "cag-acts")).map((b) => textOf(b)).slice(0, 2), ["Use a reset credit", "Sign out"]);
    btn(r, "Use a reset credit").dispatch("click");
    await settle();
    assert.deepEqual(p.credits, ["cx"]);
    const none = settings([codex([{ ...spent, resetCredits: { available: 0, nextExpiresAt: null } }])]);
    assert.equal(btn(rowOf(none.body, "cx"), "Use a reset credit"), undefined);
  });
});

/**
 * The install sheet for an agent over these entries and accounts: the routes answered by `answer`, a stand-in sheet
 * and terminal view, every copy, toast and sign-in kept.
 * @param {any} list @param {string} id @param {{ rows?: any[], answer?: (method: string, path: string, body: any) => any }} [o]
 */
function installSheet(list, id, o = {}) {
  const a = listKeeper(list);
  const k = keeperOf(o.rows || []);
  const { calls, api } = routes(o.answer);
  /** @type {any[]} */
  const sheets = [];
  /** @type {{ id: string, focused: number, disposed: number }[]} */
  const views = [];
  /** @type {string[]} */
  const copied = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {string[]} */
  const signIns = [];
  openInstall(id, { agents: /** @type {any} */ (a.keeper), accounts: /** @type {any} */ (k.keeper), signIn: (u) => signIns.push(u), onToast: (msg, kind) => toasts.push([msg, kind]) }, {
    h: /** @type {any} */ (fakeH),
    api,
    sheet: /** @type {any} */ ((/** @type {any} */ x) => {
      const s = { ...x, closed: false, close() { if (s.closed) return; s.closed = true; x.onClose?.(); } };
      sheets.push(s);
      return s;
    }),
    show: /** @type {any} */ ((/** @type {any} */ _el, /** @type {string} */ tid) => {
      const v = { id: tid, focused: 0, disposed: 0, focus() { v.focused++; }, ended: () => false, dispose() { v.disposed++; } };
      views.push(v);
      return v;
    }),
    copy: async (text) => { copied.push(text); },
  });
  const s = sheets[0];
  return {
    a, k, calls, views, copied, toasts, signIns, sheet: s,
    /** The sheet's words. */ said: () => textOf(s.body),
    /** Its foot's buttons. */ foot: () => buttonsOf(s.foot).map(textOf),
    /** A foot's button. @param {string} words */ press: (words) => btn(s.foot, words).dispatch("click"),
  };
}

describe("the install sheet (AC3-8)", () => {
  test("its command shown whole first, with where it installs; Install runs it in a terminal on the sheet; ended well, connected, its models said as they come", async () => {
    const installing = { terminal: "term-7", line: agent().install.line, at: NOW, version: "1.0.0" };
    const p = installSheet(listOf([agent()]), "npx-agent", { answer: () => ({ installing, ...listOf([agent({ installing })]) }) });
    assert.deepEqual([p.sheet.label, p.sheet.class, textOf(p.sheet.head)], ["Install Npx Agent", "tk-sheet", "Install|Npx Agent · 1.0.0"]);
    assert.equal(p.said(), `Filament runs this in a terminal here:|${installing.line}|npm installs Npx Agent 1.0.0 into Filament's own folder. Nothing else on this computer changes.`);
    assert.deepEqual(p.foot(), ["Cancel", "Install"]);
    btn(p.sheet.body, "Copy the command").dispatch("click");
    await settle();
    assert.deepEqual([p.copied, p.toasts], [[installing.line], [["The command copied", undefined]]]);
    p.press("Install");
    assert.equal(p.said(), "Starting the install…");
    await settle();
    assert.deepEqual(p.calls, [["POST", "/coding-agents/npx-agent/install", undefined]]);
    assert.equal(p.said(), `Installing Npx Agent: its installer's progress shows below.|${installing.line}`);
    assert.deepEqual([p.views.map((v) => v.id), p.views[0].focused], [["term-7"], 1]);
    assert.equal(textOf(one(p.sheet.foot, "tk-foot-note")), "Closing this sheet leaves it running.");
    assert.deepEqual(p.foot(), ["Cancel install"]);
    const ended = agent({ state: "connected", upstreams: ["npx-agent"], primary: "npx-agent", installed: { version: "1.0.0", at: NOW + 1 }, asking: true, lastInstall: { outcome: "installed", error: null, at: NOW + 1000 } });
    p.a.set(listOf([ended]));
    assert.deepEqual([p.said(), p.views[0].disposed], ["Installed and connected|Asking for its models…", 1]);
    p.a.set(listOf([{ ...ended, asking: false, models: { count: 2, at: NOW + 2000 } }]));
    assert.deepEqual([p.said(), p.foot()], ["Installed and connected|2 models ready in the picker.", ["Done"]]);
    p.press("Done");
    assert.deepEqual([p.sheet.closed, p.a.listeners(), p.k.listeners()], [true, 0, 0]);
  });

  test("an agent Filament knows installs for the whole computer, its maker's way; once connected, Sign in where nobody is signed in, beside Done where its account isn't heard from yet", async () => {
    const installing = { terminal: "term-8", line: "npm install -g @agentclientprotocol/claude-agent-acp", at: NOW, version: null };
    const fresh = claude({ state: "missing", upstreams: [], primary: null, models: null, profile: null });
    const p = installSheet(listOf([fresh]), "claude-code", { rows: [acct({}, SIGNED_OUT)], answer: () => ({ installing, ...listOf([{ ...fresh, installing }]) }) });
    assert.equal(textOf(p.sheet.head), "Install|Claude Code");
    assert.equal(p.said(), "Filament runs this in a terminal here:|npm install -g @agentclientprotocol/claude-agent-acp|npm installs Claude Code for the whole computer, where your own terminals find it too.");
    p.press("Install");
    await settle();
    p.a.set(listOf([claude({ lastInstall: { outcome: "installed", error: null, at: NOW + 1000 } })]));
    assert.deepEqual([p.said(), p.foot()], ["Installed and connected|3 models ready in the picker.|Nobody is signed in yet.", ["Close", "Sign in"]]);
    p.k.set([acct()]);
    assert.deepEqual([p.said(), p.foot()], ["Installed and connected|3 models ready in the picker.", ["Sign in", "Done"]], "not heard from yet");
    p.k.set([acct({}, SIGNED_IN)]);
    assert.deepEqual([p.said(), p.foot()], ["Installed and connected|3 models ready in the picker.|It runs as Claude Max.", ["Done"]]);
    p.k.set([acct({}, SIGNED_OUT)]);
    p.press("Sign in");
    assert.deepEqual([p.sheet.closed, p.signIns], [true, ["claude-code"]]);
  });

  // (fails before: yes — an account signed in as nobody said whom was offered Sign in, as one not heard from)
  test("once connected, an account signed in as its agent doesn't say whom: said so, with Done alone", async () => {
    const installing = { terminal: "term-9", line: "npm install -g @agentclientprotocol/claude-agent-acp", at: NOW, version: null };
    const fresh = claude({ state: "missing", upstreams: [], primary: null, models: null, profile: null });
    const p = installSheet(listOf([fresh]), "claude-code", { rows: [unnamed()], answer: () => ({ installing, ...listOf([{ ...fresh, installing }]) }) });
    p.press("Install");
    await settle();
    p.a.set(listOf([claude({ lastInstall: { outcome: "installed", error: null, at: NOW + 1000 } })]));
    assert.deepEqual([p.said(), p.foot()], ["Installed and connected|3 models ready in the picker.|It is signed in.", ["Done"]]);
  });

  test("an install under way is shown, not started anew; Cancel install stops it through its route; an end older than it is not its end; stopped or failed, its terminal kept, and Try again starts afresh", async () => {
    const installing = { terminal: "term-9", line: agent().install.line, at: NOW, version: "1.0.0" };
    const again = { ...installing, terminal: "term-10", at: NOW + 5000 };
    const p = installSheet(listOf([agent({ installing })]), "npx-agent", {
      answer: (method, path) => (path.endsWith("/cancel") ? { stopped: true, ...listOf([agent({ installing })]) } : { installing: again, ...listOf([agent({ installing: again })]) }),
    });
    assert.deepEqual([p.calls, p.views.map((v) => v.id)], [[], ["term-9"]]);
    p.press("Cancel install");
    assert.deepEqual(p.foot(), ["Stopping…"]);
    await settle();
    assert.deepEqual([p.calls, p.foot()], [[["POST", "/coding-agents/npx-agent/install/cancel", undefined]], ["Cancel install"]]);
    p.a.set(listOf([agent({ lastInstall: { outcome: "cancelled", error: null, at: NOW - 5000 } })]));
    assert.ok(p.said().startsWith("Installing Npx Agent"), "an end from before it started is not its end");
    p.a.set(listOf([agent({ lastInstall: { outcome: "cancelled", error: null, at: NOW + 1000 } })]));
    assert.equal(p.said(), "The install was stopped");
    assert.ok(one(p.sheet.body, "tk-term"), "its terminal stays, with what the installer said");
    assert.deepEqual([p.views[0].disposed, p.foot()], [0, ["Close", "Try again"]]);
    p.press("Try again");
    await settle();
    assert.deepEqual([p.views.map((v) => v.id), p.views[0].disposed], [["term-9", "term-10"], 1]);
    p.a.set(listOf([agent({ lastInstall: { outcome: "failed", error: "the install ended with code 1", at: NOW + 6000 } })]));
    assert.equal(p.said(), "The install didn't finish|The install ended with code 1.");
  });

  test("where Filament can't open a terminal: the line to run in a terminal of one's own, then Connect — its refusal said on the sheet, its success the install's", async () => {
    let refuse = true;
    const connected = agent({ state: "connected", upstreams: ["npx-agent"], primary: "npx-agent", installed: { version: "1.0.0", at: NOW }, asking: true });
    const p = installSheet(listOf([agent()]), "npx-agent", {
      answer: (method, path) =>
        path.endsWith("/connect")
          ? (refuse ? new Error("Npx Agent isn't on this computer: install it first") : listOf([connected]))
          : { line: agent().install.line, ...listOf([agent()]) },
    });
    p.press("Install");
    await settle();
    const lead = `Filament can't open a terminal on this computer. Run this in a terminal of your own, then Connect:|${agent().install.line}`;
    assert.deepEqual([p.said(), p.views.length, p.foot()], [lead, 0, ["Done", "Connect"]]);
    p.press("Connect");
    assert.deepEqual(p.foot(), ["Done", "Connecting…"]);
    await settle();
    assert.equal(p.said(), `${lead}|Npx Agent isn't on this computer: install it first.`);
    refuse = false;
    p.press("Connect");
    await settle();
    assert.deepEqual([p.said(), p.foot()], ["Installed and connected|Asking for its models…", ["Done"]]);
    assert.deepEqual(p.calls.map(([m, path]) => `${m} ${path}`), ["POST /coding-agents/npx-agent/install", "POST /coding-agents/npx-agent/connect", "POST /coding-agents/npx-agent/connect"]);
  });

  test("an update: an update's words, from the version installed to the registry's; a refused start says why, with Try again; ended, the version it updated to", async () => {
    let refuse = true;
    const installing = { terminal: "term-11", line: "npm install --global --prefix D:\\agents\\npx-agent\\1.1.0 @fake/npx-agent@1.1.0", at: NOW, version: "1.1.0" };
    const on = npxOn({ install: { way: "npx", line: installing.line, needs: null } });
    const p = installSheet(listOf([on]), "npx-agent", {
      answer: () => (refuse ? new Error("Npx Agent installs with npm, which isn't on this computer") : { installing, ...listOf([{ ...on, installing }]) }),
    });
    assert.deepEqual([p.sheet.label, textOf(p.sheet.head), p.foot()], ["Update Npx Agent", "Update|Npx Agent · 1.1.0", ["Cancel", "Update"]]);
    assert.equal(p.said(), `Updating Npx Agent from 1.0.0 to 1.1.0. Filament runs this in a terminal here:|${installing.line}|npm installs Npx Agent 1.1.0 into Filament's own folder. Nothing else on this computer changes.`);
    p.press("Update");
    await settle();
    assert.deepEqual([p.said(), p.foot()], ["The update can't start|Npx Agent installs with npm, which isn't on this computer.", ["Close", "Try again"]]);
    refuse = false;
    p.press("Try again");
    await settle();
    assert.deepEqual([p.said(), p.foot()], [`Updating Npx Agent: its installer's progress shows below.|${installing.line}`, ["Cancel update"]]);
    p.a.set(listOf([npxOn({ installed: { version: "1.1.0", at: NOW + 1 }, update: null, lastInstall: { outcome: "installed", error: null, at: NOW + 1000 } })]));
    assert.deepEqual([p.said(), textOf(p.sheet.head)], ["Updated to 1.1.0|2 models ready in the picker.", "Update|Npx Agent · 1.1.0"], "the version it updated to, though the registry lists no newer one now");
  });

  test("an agent npm installed here, updated (HarnessV3-ACP AF3): from its version to the registry's, for the whole computer; ended, the version it updated to", async () => {
    const line = "npm install -g @agentclientprotocol/claude-agent-acp@0.87.0";
    const installing = { terminal: "term-13", line, at: NOW, version: "0.87.0" };
    const older = claude({ runs: "0.76.0", update: "0.87.0", install: { way: "npm", line, needs: null } });
    const p = installSheet(listOf([older]), "claude-code", { rows: [acct({}, SIGNED_IN)], answer: () => ({ installing, ...listOf([{ ...older, installing }]) }) });
    assert.deepEqual([p.sheet.label, textOf(p.sheet.head), p.foot()], ["Update Claude Code", "Update|Claude Code · 0.87.0", ["Cancel", "Update"]]);
    assert.equal(p.said(), `Updating Claude Code from 0.76.0 to 0.87.0. Filament runs this in a terminal here:|${line}|npm installs Claude Code for the whole computer, where your own terminals find it too.`);
    p.a.set(listOf([{ ...older, runs: "0.80.0" }]));
    assert.ok(p.said().startsWith("Updating Claude Code from 0.80.0 to 0.87.0."), "updated meanwhile, from its version now");
    p.press("Update");
    await settle();
    assert.deepEqual([p.said(), p.foot()], [`Updating Claude Code: its installer's progress shows below.|${line}`, ["Cancel update"]]);
    p.a.set(listOf([claude({ runs: "0.87.0", lastInstall: { outcome: "installed", error: null, at: NOW + 1000 } })]));
    assert.equal(p.said(), "Updated to 0.87.0|3 models ready in the picker.|It runs as Claude Max.");
  });

  test("closing the sheet while it installs leaves the install running, and lets go of the page's agents, its accounts and the terminal", () => {
    const installing = { terminal: "term-12", line: agent().install.line, at: NOW, version: "1.0.0" };
    const p = installSheet(listOf([agent({ installing })]), "npx-agent");
    p.sheet.close();
    assert.deepEqual([p.calls, p.views[0].disposed, p.a.listeners(), p.k.listeners()], [[], 1, 0, 0]);
  });

  // (fails before: yes — a program's download read as npm's install: "npm installs Bin Agent 0.3.0 into Filament's own
  // folder")
  test("a program's download: its address shown first, with where it goes and what is checked; Install fetches it in a terminal on the sheet, its progress there", async () => {
    const line = "https://example.test/bin-agent-0.3.0.zip";
    const bin = agent({ id: "bin-agent", name: "Bin Agent", version: "0.3.0", install: { way: "binary", line, needs: null } });
    const installing = { terminal: "term-9", line, at: NOW, version: "0.3.0" };
    const p = installSheet(listOf([bin]), "bin-agent", { answer: () => ({ installing, ...listOf([{ ...bin, installing }]) }) });
    assert.equal(p.said(), `Filament downloads this in a terminal here:|${line}|Filament downloads Bin Agent 0.3.0 from its maker into its own folder and unpacks it there, its checksum checked where ACP's registry gives one. Nothing else on this computer changes.`);
    btn(p.sheet.body, "Copy the address").dispatch("click");
    await settle();
    assert.deepEqual(p.copied, [line]);
    p.press("Install");
    await settle();
    assert.equal(p.said(), `Installing Bin Agent: its download's progress shows below.|${line}`);
    assert.deepEqual(p.views.map((v) => v.id), ["term-9"]);
  });

  test("an agent it can't install here says so — downloaded from its maker, then Connect; one whose installer is missing names it, Install held; one not read yet waits", () => {
    const bin = installSheet(listOf([agent({ install: null, download: { url: "https://example.test/bin.zip", program: "bin-agent" } })]), "npx-agent");
    assert.deepEqual([bin.said(), bin.foot()], ["Filament can't install Npx Agent on this computer|Download it from its maker, then Connect.", ["Close"]]);
    const needs = installSheet(listOf([agent({ install: { ...agent().install, needs: "npm" } })]), "npx-agent");
    assert.ok(needs.said().endsWith("|It needs npm, which isn't on this computer yet."), needs.said());
    assert.equal(btn(needs.sheet.foot, "Install").attrs.disabled, "");
    const early = installSheet(null, "npx-agent");
    assert.deepEqual([early.sheet.label, early.said(), early.foot()], ["Install npx-agent", "Reading the agent…", ["Cancel"]]);
    early.a.set(listOf([agent()]));
    assert.deepEqual(early.foot(), ["Cancel", "Install"], "read: its command");
  });
});

describe("the page's coding agents, as it keeps them (lib/coding-agents.js)", () => {
  test("read while someone looks and again whenever an entry may have moved, one read at a time; a failed read keeps the last; a route's answer kept in place; nobody looking, nothing read", async () => {
    /** @type {((msg: any) => void) | null} */
    let bus = null;
    let unsubscribed = 0;
    const subscribe = (/** @type {(msg: any) => void} */ fn) => {
      bus = fn;
      return () => {
        bus = null;
        unsubscribed++;
      };
    };
    /** @type {{ resolve: (v: any) => void, reject: (e: any) => void }[]} */
    const reads = [];
    const keeper = keepCodingAgents(subscribe, () => new Promise((resolve, reject) => reads.push({ resolve, reject })));
    assert.deepEqual([keeper.now(), reads.length, bus], [null, 0, null], "nobody looking");
    /** @type {number[]} */
    const heard = [];
    const off = keeper.listen((l) => heard.push(l.entries.length));
    assert.deepEqual([reads.length, typeof bus], [1, "function"]);
    const tell = (/** @type {string} */ type) => /** @type {any} */ (bus)({ type });
    tell("coding-agents");
    tell("accounts");
    tell("models-discovered");
    assert.equal(reads.length, 1, "one read at a time");
    reads[0].resolve(listOf([agent()]));
    await settle();
    assert.deepEqual([heard, reads.length], [[1], 2], "the moves heard meanwhile read once more");
    reads[1].reject(new Error("offline"));
    await settle();
    assert.deepEqual([heard, keeper.now()?.entries.length], [[1], 1], "a failed read keeps the last");
    tell("config-changed");
    reads[2].resolve(listOf([agent(), claude()]));
    await settle();
    /** @type {number[]} */
    const late = [];
    const off2 = keeper.listen((l) => late.push(l.entries.length));
    assert.deepEqual([heard, late, reads.length], [[1, 2], [2], 3], "a new hook hears the last read at once, and reads nothing more");
    keeper.keep({ stopped: true, ...listOf([claude()]) });
    keeper.keep({ error: "not a list" });
    assert.deepEqual([heard, late, keeper.now()?.computer], [[1, 2, 1], [2, 1], "windows-x86_64"]);
    off();
    assert.equal(unsubscribed, 0, "someone still looks");
    off2();
    assert.deepEqual([unsubscribed, bus], [1, null]);
    // (fails before: no — a guard the mutation pass asked for: no agent's models answered while nothing else moved, and
    // nobody stopped looking while a read was under way)
    const off3 = keeper.listen(() => {});
    assert.equal(reads.length, 4, "looked at again, read again");
    reads[3].resolve(listOf([claude()]));
    await settle();
    tell("accounts");
    assert.equal(reads.length, 4, "an account's change moves no entry");
    tell("models-discovered");
    assert.equal(reads.length, 5, "an agent's models answered: read again");
    tell("coding-agents");
    off3();
    reads[4].resolve(listOf([claude()]));
    await settle();
    assert.equal(reads.length, 5, "nobody looks once the read ends: the move heard meanwhile reads nothing");
  });

  test("an agent's words — how it installs, who makes it (by name), its models — and its mark: the registry's icon, or its name's first letter", () => {
    // (fails before: yes — a program Filament downloads said nothing of how it installs)
    assert.deepEqual(
      ["npm", "script", "npx", "uvx", "binary"].map((way) => installWords(agent({ name: "X", install: { way, line: "", needs: null } }))),
      ["npm, for the whole computer", "X's install script", "npm, in Filament's folder", "uv, in Filament's folder", "A download, in Filament's folder"],
    );
    assert.deepEqual(
      [installWords(agent({ install: null, download: { url: "https://example.test/x", program: "x" } })), installWords(agent({ install: null, unavailable: true })), installWords(agent({ install: null }))],
      ["A program to download", "No build for this computer", ""],
    );
    assert.deepEqual([makerWords(agent()), makerWords(agent({ authors: ["A", "B", "C"], license: null })), makerWords(agent({ authors: [], license: null }))], ["By Fake Co · MIT", "By A, B and others", ""]);
    assert.deepEqual(
      [
        makerWords(agent({ authors: ["Augment Code <support@augmentcode.com>", "Ana (https://ana.example)"] })),
        makerWords(agent({ authors: ["enquiries@fast-agent.example"], license: null })),
        makerWords(agent({ authors: ["Snowflake (Cortex)"], license: null })),
      ],
      ["By Augment Code, Ana · MIT", "By enquiries@fast-agent.example", "By Snowflake (Cortex)"],
      "an author's address isn't on the page, unless it's all the registry names them by",
    );
    assert.deepEqual([modelCount(1), modelCount(2), modelCount(0)], ["1 model", "2 models", "0 models"]);
    assert.deepEqual([textOf(markTile(fakeH, { mark: null, name: "  42 agents" })), textOf(markTile(fakeH, { mark: null, name: "—" }))], ["4", "?"]);
    assert.equal(markTile(fakeH, { mark: "a b", name: "x" }).kids[0].attrs.style, `-webkit-mask-image: url("/api/coding-agents/icons/a%20b"); mask-image: url("/api/coding-agents/icons/a%20b")`);
  });
});
