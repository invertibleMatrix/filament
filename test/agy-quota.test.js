// @ts-check
// HarnessV3-ACP AC3-6: Antigravity's plan quota, which agy says nothing of over ACP, read from Google's quota service
// with the Google sign-in agy keeps (adapters/agents/agy-quota.js): the sign-in from its file or the system's keyring,
// the service's answers as windows of model groups (core/agent-limits.js `agyQuotaWindows`), a group's window spent
// stopping its models alone (`bounds`: the store, a failure's cause, a turn's record), agy's own word on when its quota
// resets, and the whole path through the app against the fake agy 1.5 with a stand-in for Google — Check now, the
// account's identity and plan's tier, and its windows after a turn.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { accountRecord, agyIdentity, agyQuotaWindows, bounds, meteredApart } from "../src/core/agent-limits.js";
import { AGY_QUOTA_HOSTS, agySignIn, agyTokenFile, credentialScript, credentialText, keptText, readAgyQuota, readSignIn, signInExpired } from "../src/adapters/agents/agy-quota.js";
import { createAgentAccounts } from "../src/services/agent-accounts.js";
import { agentCause } from "../src/adapters/agents/acp/failures.js";
import { planLimit } from "../src/core/turn-facts.js";
import { checkWords, notYetWords } from "../src/ui/lib/accounts.js";
import { startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ACP = join(FIXTURES, "fake-acp-agent.mjs");
const WEEK_MINS = 7 * 24 * 60;
/** Not a real token: what the tests watch for in every word Filament says. */
const TOKEN = "ya29.not-a-real-token-for-tests";

/** Google's quota summary as it answered agy 1.5.14's sign-in under Filament's name (11-22). */
const SUMMARY = {
  groups: [
    {
      displayName: "Claude and GPT models",
      description: "Models within this group: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B",
      buckets: [{ bucketId: "3p-weekly", displayName: "Weekly Limit Remaining", window: "weekly", resetTime: "2026-11-29T16:05:39Z", remainingFraction: 1 }],
    },
  ],
  description: "Within each group, models share a weekly limit.",
};
/** Its models' quota as the same day's answer had it: Gemini's on its tiered model, agy's own helpers without a reset. */
const MODELS = {
  models: {
    "gemini-3.8-flash-tiered": { displayName: "Gemini 3.8 Flash", modelProvider: "MODEL_PROVIDER_GOOGLE", quotaInfo: { remainingFraction: 0.9662192, resetTime: "2026-11-28T17:16:32Z" } },
    "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)", modelProvider: "MODEL_PROVIDER_GOOGLE" },
    "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6", modelProvider: "MODEL_PROVIDER_ANTHROPIC", quotaInfo: { remainingFraction: 1, resetTime: "2026-11-29T16:05:39Z" } },
    tab_flash_lite_preview: { quotaInfo: { remainingFraction: 1 } },
  },
};
/** @type {import("../src/core/agent-limits.js").PlanWindow} */
const CLAUDE_GPT = { id: "3p-weekly", kind: "weekly", label: "Weekly · Claude and GPT", usedPercent: 0, resetsAt: Date.parse("2026-11-29T16:05:39Z"), windowMins: WEEK_MINS, status: null, models: ["claude-*", "gpt-*"] };
/** @type {import("../src/core/agent-limits.js").PlanWindow} */
const GEMINI = { id: "gemini-models", kind: "weekly", label: "Weekly · Gemini", usedPercent: 3.4, resetsAt: Date.parse("2026-11-28T17:16:32Z"), windowMins: WEEK_MINS, status: null, models: ["gemini-*"] };

/** agy's sign-in as it keeps it (read live on 1.5.14), its access token the tests' own. @param {Record<string, any>} [more] */
const kept = (more = {}) => JSON.stringify({ token: { access_token: TOKEN, token_type: "Bearer", refresh_token: "1//not-real", expiry: "2026-11-22T17:04:25.8676259Z", expires_in: 3599 }, auth_method: "consumer", id_token_email: "person@example.com", ...more });

/**
 * A stand-in for Google's quota service: each host's answer to each call, by `<host>|<call>`, and the calls it was
 * asked, with the client's name. An answer is JSON (200), or `{ status, body }`.
 * @param {Record<string, any>} answers
 */
const google = (answers) => {
  /** @type {{ url: string, agent: string, auth: string, body: string }[]} */
  const calls = [];
  /** @param {string} url @param {any} init */
  const fetch = async (url, init) => {
    calls.push({ url, agent: init.headers["User-Agent"], auth: init.headers.Authorization, body: init.body });
    const [host, op] = url.split("/v1internal:");
    const a = answers[`${host}|${op}`] ?? { status: 404, body: { error: { code: 404, message: "Not found." } } };
    const status = a && typeof a.status === "number" && "body" in a ? a.status : 200;
    const body = status === 200 && !("body" in a) ? a : a.body;
    return { status, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
};
const D = AGY_QUOTA_HOSTS.daily;
const P = AGY_QUOTA_HOSTS.prod;

describe("Antigravity's plan as Google's quota service says it (core/agent-limits.js)", () => {
  test("its summary's groups and its models' quota as windows: each group's bucket bounds the models it names; Gemini's from its tiered model, weekly as the summary says", () => {
    assert.deepEqual(agyQuotaWindows(SUMMARY, MODELS), [CLAUDE_GPT, GEMINI]);
  });

  test("a bucket switched off or with no share is none; a spent one is refused; a summary that says no weekly limit leaves Gemini's of no length", () => {
    const summary = {
      groups: [{ displayName: "Claude and GPT models", buckets: [{ bucketId: "off", window: "weekly", remainingFraction: 0.2, disabled: true }, { bucketId: "nothing", window: "weekly" }, { bucketId: "3p-5h", window: "5h", remainingFraction: 0, resetTime: "2026-11-23T01:00:00Z" }] }],
    };
    assert.deepEqual(agyQuotaWindows(summary, MODELS), [
      { id: "3p-5h", kind: "session", label: "5-hour · Claude and GPT", usedPercent: 100, resetsAt: Date.parse("2026-11-23T01:00:00Z"), windowMins: 300, status: "rejected", models: ["claude-*", "gpt-*"] },
      { id: "gemini-models", kind: "other", label: "Gemini", usedPercent: 3.4, resetsAt: GEMINI.resetsAt, windowMins: null, status: null, models: ["gemini-*"] },
    ]);
  });

  test("with no summary each family's most used model says its window; nothing from nothing", () => {
    const models = { models: { ...MODELS.models, "claude-opus-4-6": { modelProvider: "MODEL_PROVIDER_ANTHROPIC", quotaInfo: { remainingFraction: 0.25, resetTime: "2026-11-29T16:05:39Z" } } } };
    assert.deepEqual(
      agyQuotaWindows(null, models).map((w) => [w.id, w.label, w.usedPercent, w.models]),
      [["gemini-models", "Gemini", 3.4, ["gemini-*"]], ["claude-models", "Claude", 75, ["claude-*"]]],
    );
    assert.deepEqual(agyQuotaWindows(null, null), []);
    assert.deepEqual(agyQuotaWindows({ groups: "x" }, { models: [] }), []);
  });

  test("a window bounds its models alone, by id or the start of it, whatever agent prefix the route gives; one that names none bounds every model", () => {
    assert.equal(bounds(CLAUDE_GPT, "claude-sonnet-4-6"), true);
    assert.equal(bounds(CLAUDE_GPT, "antigravity/GPT-OSS-120B-medium"), true);
    assert.equal(bounds(CLAUDE_GPT, "gemini-3.8-flash-high"), false);
    assert.equal(bounds({ models: ["gemini-3.8-flash-high"] }, "gemini-3.8-flash-high"), true);
    assert.equal(bounds({ models: ["gemini-3.8-flash-high"] }, "gemini-3.8-flash-low"), false);
    assert.equal(bounds(/** @type {any} */ ({ id: "five_hour" }), "anything"), true);
    assert.equal(bounds(CLAUDE_GPT, null), true, "a turn whose model isn't known: every window may be its");
    assert.equal(meteredApart({ windows: [CLAUDE_GPT, GEMINI] }, "gemini-3.8-flash-high"), true);
    assert.equal(meteredApart({ windows: [CLAUDE_GPT] }, "gemini-3.8-flash-high"), false, "no group bounds it");
    assert.equal(meteredApart(/** @type {any} */ ({ windows: [{ id: "five_hour" }] }), "claude-opus-4-6"), false, "a plan of one allowance");
    assert.equal(meteredApart({ windows: [GEMINI] }, null), false);
  });

  test("who it is, as agy's sign-in names it: a Google account or Gemini Enterprise, the tier agy named, an email only where it is one", () => {
    assert.deepEqual(agyIdentity({ email: "person@example.com", method: "consumer", tier: " Antigravity Starter Quota " }), { kind: "account", label: "Google account", plan: "Antigravity Starter Quota", email: "person@example.com", organization: null, detail: null, billing: "plan" });
    assert.deepEqual(agyIdentity({ email: "nope", method: "business", tier: "" }), { kind: "account", label: "Gemini Enterprise", plan: null, email: null, organization: null, detail: null, billing: "plan" });
  });
});

describe("agy's Google sign-in and Google's answers (adapters/agents/agy-quota.js)", () => {
  test("what agy keeps, read: its access token, expiry, email and way in; plain, or behind go-keyring's marks; nothing from what holds no token", () => {
    assert.deepEqual(readSignIn(kept(), "file"), { access: TOKEN, expiresAt: Date.parse("2026-11-22T17:04:25.8676259Z"), email: "person@example.com", method: "consumer", from: "file" });
    assert.equal(keptText(`go-keyring-base64:${Buffer.from("hello").toString("base64")}`), "hello");
    assert.equal(keptText(`go-keyring-encoded:${Buffer.from("hello").toString("hex")}`), "hello");
    assert.equal(readSignIn(`go-keyring-base64:${Buffer.from(kept()).toString("base64")}`, "keyring")?.access, TOKEN);
    assert.equal(readSignIn(JSON.stringify({ token: {} }), "file"), null);
    assert.equal(readSignIn("not json", "file"), null);
    const odd = readSignIn(kept({ id_token_email: 5, auth_method: "" }), "file");
    assert.deepEqual([odd?.email, odd?.method], [null, null]);
  });

  test("Windows' credential as text, whether go-keyring wrote it as UTF-8 or Windows' tools as UTF-16; its script names one target, quoted", () => {
    assert.equal(credentialText(Buffer.from('{"a":1}', "utf8")), '{"a":1}');
    assert.equal(credentialText(Buffer.from('{"a":1}', "utf16le")), '{"a":1}');
    const script = credentialScript("gemini:it's");
    assert.match(script, /CredReadW/);
    assert.match(script, /\[FilamentKeyring\]::Read\('gemini:it''s'\)/);
  });

  test("an added account's sign-in is its folder's file alone; the Default account's the later-expiring of its file and the keyring's", async () => {
    const files = new Map([[agyTokenFile("/work"), kept()]]);
    /** @param {string} f */
    const read = async (f) => {
      if (files.has(f)) return /** @type {string} */ (files.get(f));
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    };
    let asked = 0;
    const later = kept({ token: { access_token: "ya29.later", expiry: "2026-11-23T01:00:00Z" } });
    const keyring = async () => (asked++, `go-keyring-base64:${Buffer.from(later).toString("base64")}`);
    assert.equal((await agySignIn({ home: "/work", read, keyring }))?.from, "file");
    assert.equal(await agySignIn({ home: "/elsewhere", read, keyring }), null);
    assert.equal(asked, 0, "an added account's sign-in is never the keyring's");
    assert.equal(agyTokenFile(null), join(homedir(), ".gemini", "antigravity-acp", "antigravity-oauth-token"));
    assert.equal((await agySignIn({ read, keyring }))?.access, "ya29.later", "the Default account's, from the keyring");
    files.set(agyTokenFile(null), kept());
    assert.equal((await agySignIn({ read, keyring }))?.access, "ya29.later", "the keyring's expires later");
    files.set(agyTokenFile(null), kept({ token: { access_token: "ya29.filed", expiry: "2026-11-24T00:00:00Z" } }));
    assert.equal((await agySignIn({ read, keyring }))?.access, "ya29.filed", "the file's expires later");
    const broken = async () => {
      throw new Error("The keychain couldn't be read");
    };
    assert.equal((await agySignIn({ read, keyring: broken }))?.from, "file", "a keyring that can't be read beside a file is no failure");
    files.delete(agyTokenFile(null));
    await assert.rejects(agySignIn({ read, keyring: broken }), /keychain/);
    await assert.rejects(agySignIn({ read: async () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })), keyring }), /denied/);
  });

  test("a sign-in expires a minute early: an ask under way would outlive it", () => {
    const s = /** @type {any} */ (readSignIn(kept(), "file"));
    assert.equal(signInExpired(s, s.expiresAt - 61_000), false);
    assert.equal(signInExpired(s, s.expiresAt - 59_000), true);
    assert.equal(signInExpired({ ...s, expiresAt: null }), false, "one that says no expiry is tried");
  });

  test("both calls on both hosts under Filament's own name with agy's version; the host that meters the sign-in's way first, the other's for what it leaves out", async () => {
    const g = google({
      [`${D}|retrieveUserQuotaSummary`]: { ...SUMMARY, groups: [{ ...SUMMARY.groups[0], buckets: [{ ...SUMMARY.groups[0].buckets[0], remainingFraction: 0.5 }] }] },
      [`${D}|fetchAvailableModels`]: { status: 503, body: { error: { message: "Unavailable." } } },
      [`${P}|retrieveUserQuotaSummary`]: SUMMARY,
      [`${P}|fetchAvailableModels`]: MODELS,
    });
    const signIn = /** @type {any} */ (readSignIn(kept(), "file"));
    const windows = await readAgyQuota({ signIn, agyVersion: "1.5.14", filamentVersion: "9.9.9", platform: "win32", arch: "x64", fetch: g.fetch });
    assert.deepEqual(windows, [{ ...CLAUDE_GPT, usedPercent: 50 }, GEMINI], "the daily host's summary; the other's models, where the daily's failed");
    assert.equal(g.calls.length, 4);
    for (const c of g.calls) {
      assert.equal(c.agent, "Filament/9.9.9 antigravity/1.5.14 windows/amd64");
      assert.equal(c.auth, `Bearer ${TOKEN}`);
      assert.equal(c.body, "{}");
    }
    const business = google({ [`${P}|retrieveUserQuotaSummary`]: SUMMARY, [`${D}|retrieveUserQuotaSummary`]: { ...SUMMARY, groups: [{ ...SUMMARY.groups[0], buckets: [{ ...SUMMARY.groups[0].buckets[0], remainingFraction: 0.5 }] }] } });
    const w = await readAgyQuota({ signIn: { ...signIn, method: "business" }, agyVersion: "1.5.14", filamentVersion: "9.9.9", platform: "darwin", arch: "arm64", fetch: business.fetch });
    assert.deepEqual(w.map((x) => x.usedPercent), [0], "Gemini Enterprise's host first");
    assert.equal(business.calls[0].agent, "Filament/9.9.9 antigravity/1.5.14 darwin/arm64");
  });

  test("no host answering is a failure in words, never with the sign-in's token; a refused sign-in says it renews with agy's next run", async () => {
    const signIn = /** @type {any} */ (readSignIn(kept(), "file"));
    const refused = google(Object.fromEntries([D, P].flatMap((h) => ["retrieveUserQuotaSummary", "fetchAvailableModels"].map((op) => [`${h}|${op}`, { status: 401, body: { error: { message: `Bad token ${TOKEN}.` } } }]))));
    await assert.rejects(readAgyQuota({ signIn, agyVersion: "1.5.14", filamentVersion: "1", fetch: refused.fetch }), (e) => {
      assert.equal(/** @type {any} */ (e).message, "Google refused its sign-in (401): it renews when Antigravity next runs");
      return true;
    });
    const plain = google(Object.fromEntries([D, P].flatMap((h) => ["retrieveUserQuotaSummary", "fetchAvailableModels"].map((op) => [`${h}|${op}`, { status: 403, body: { error: { message: "The caller does not have permission. See more." } } }]))));
    await assert.rejects(readAgyQuota({ signIn, agyVersion: "1.5.14", filamentVersion: "1", fetch: plain.fetch }), /^Error: Google answered 403: The caller does not have permission$/);
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(readAgyQuota({ signIn, agyVersion: "1.5.14", filamentVersion: "1", fetch: down }), /fetch failed/);
  });
});

describe("a group's window spent stops its models alone", () => {
  const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
  const R = T0 + 3 * 24 * 3_600_000;
  const spentGroup = { ...CLAUDE_GPT, usedPercent: 100, status: /** @type {const} */ ("rejected"), resetsAt: R };
  const id = agyIdentity({ email: "person@example.com", method: "consumer", tier: "Antigravity Starter Quota" });

  test("the store: shown spent, and the account not — free of no reset, its other models still with room", () => {
    const s = createAgentAccounts({ now: () => T0, log: () => {} });
    s.report("agy", { source: "Google's quota service", identity: id, windows: [spentGroup, { ...GEMINI, resetsAt: R }] });
    const v = /** @type {any} */ (s.view("agy"));
    assert.deepEqual(v.windows.map((/** @type {any} */ w) => [w.id, w.state]), [["3p-weekly", "spent"], ["gemini-models", "ok"]]);
    assert.deepEqual([v.spent, v.freeAt], [false, null]);
    s.report("cl", { source: "x", identity: id, windows: [{ ...spentGroup, models: undefined }] });
    assert.equal(/** @type {any} */ (s.view("cl")).spent, true, "a window of every model spends the account");
  });

  test("a whole reading is the plan's whole set: a window it no longer names is gone from the store; any other reading keeps it", () => {
    const s = createAgentAccounts({ now: () => T0, log: () => {} });
    s.report("agy", { source: "Google's quota service", identity: id, windows: [CLAUDE_GPT, { ...GEMINI, id: "gemini-weekly" }], whole: true });
    s.report("agy", { source: "Google's quota service", windows: [CLAUDE_GPT, GEMINI], whole: true });
    assert.deepEqual(/** @type {any} */ (s.view("agy")).windows.map((/** @type {any} */ w) => w.id), ["3p-weekly", "gemini-models"]);
    s.report("agy", { source: "x", windows: [CLAUDE_GPT] });
    assert.deepEqual(/** @type {any} */ (s.view("agy")).windows.map((/** @type {any} */ w) => w.id), ["3p-weekly", "gemini-models"]);
  });

  test("Gemini's window from its models is one window whether or not the summary answered: the length known is kept", () => {
    const [noSummary] = agyQuotaWindows(null, MODELS).filter((w) => w.id === "gemini-models");
    assert.deepEqual([noSummary.kind, noSummary.windowMins], ["other", null]);
    const s = createAgentAccounts({ now: () => T0, log: () => {} });
    s.report("agy", { source: "Google's quota service", identity: id, windows: agyQuotaWindows(SUMMARY, MODELS), whole: true });
    s.report("agy", { source: "Google's quota service", windows: agyQuotaWindows(null, MODELS), whole: true });
    const gemini = /** @type {any} */ (s.view("agy")).windows.find((/** @type {any} */ w) => w.id === "gemini-models");
    assert.deepEqual([gemini.kind, gemini.label, gemini.windowMins], ["weekly", "Weekly · Gemini", WEEK_MINS]);
  });

  test("a failure: an out until the group resets for its models; agy's own word on when, for the others; a rate where it said none", () => {
    const account = { spent: false, freeAt: null, windows: [{ state: "spent", models: spentGroup.models, resetsAt: R }] };
    const quota = Object.assign(new Error("Internal error"), { code: -32603, data: { details: "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h10m40s." } });
    assert.deepEqual(agentCause(quota, account, "claude-sonnet-4-6"), { kind: "out", resets: R });
    const before = Date.now();
    const c = /** @type {any} */ (agentCause(quota, account, "gemini-3.8-flash-high"));
    assert.equal(c.kind, "out");
    assert.ok(c.resets >= before + 7_840_000 && c.resets <= Date.now() + 7_840_000, "in 2 h 10 min 40 s, as agy said");
    assert.deepEqual(agentCause(new Error("Rate limited"), account, "gemini-3.8-flash-high"), { kind: "rate", resets: null });
  });

  test("a turn's record: its plan stopped it where the spent window bounds its model", () => {
    const rec = (/** @type {string} */ model) => ({ id: "r1", ts: new Date(T0).toISOString(), totalMs: 1000, status: "error", upstream: "agy", upstreamModel: model, failure: { kind: "limit" }, acp: { account: accountRecord(id, [spentGroup, GEMINI], T0) } });
    assert.deepEqual(planLimit(rec("claude-opus-4-6"))?.windows, [{ id: "3p-weekly", label: "Weekly · Claude and GPT", resetsAt: R }]);
    assert.equal(planLimit(rec("gemini-3.8-flash-high")), null, "Gemini's turn: no plan's end");
  });

  test("the words Check now and an account with no window yet say for Antigravity", () => {
    const row = /** @type {any} */ ({ type: "acp", agent: "antigravity-acp" });
    assert.match(checkWords(row), /Google/);
    assert.match(notYetWords(row), /read from Google after its turns/);
  });
});

describe("Antigravity's plan through the app (fake agy 1.5, a stand-in for Google)", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-agy-quota-"));
  const projDir = join(root, "project");
  const work = join(root, "work-account");
  /** @type {any} */
  let shim;
  /** What the stand-in sign-in finds, by the account's folder (null: the Default account's). @type {(home: string | null) => any} */
  let signIns = () => null;
  /** @type {(string | null)[]} */
  const askedFor = [];
  const g = google({ [`${D}|retrieveUserQuotaSummary`]: SUMMARY, [`${D}|fetchAvailableModels`]: MODELS });
  /** The fake as a program the catalogue knows by its name (`agy`): beside a shim of npm's kind on Windows. @param {string} name */
  const programNamed = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    if (process.platform === "win32") {
      copyFileSync(FAKE_ACP, join(dir, "fake-acp-agent.mjs"));
      copyFileSync(join(FIXTURES, "person-words.mjs"), join(dir, "person-words.mjs"));
      writeFileSync(join(dir, `${name}.cmd`), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
      return join(dir, `${name}.cmd`);
    }
    writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ACP}" "$@"\n`);
    chmodSync(join(dir, name), 0o755);
    return join(dir, name);
  };
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(work);
    const agy = programNamed("agy");
    const acp = (/** @type {Record<string, any>} */ more = {}) => ({ command: agy, args: [], env: { FAKE_ACP_AGY: "1", FAKE_ACP_AGY_STEER: "1" }, cwdDefault: projDir, permissions: "allow-all", hints: false, ...more });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "agy", name: "Antigravity", type: "acp", acp: acp() },
          { id: "agywork", name: "Antigravity (Work)", type: "acp", acp: acp({ home: work, account: "Work" }) },
        ];
        cfg.routes = ["agy", "agywork"].map((u) => ({ match: `${u}/*`, upstream: u, upstreamModel: "{1}", enabled: true }));
      },
      overrides: {
        agyQuota: {
          signIn: async (/** @type {{ home: string | null }} */ { home }) => (askedFor.push(home), signIns(home)),
          read: (/** @type {any} */ o) => readAgyQuota({ ...o, fetch: g.fetch }),
        },
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(root);
  });
  /** Check now on one upstream: the route's answer. @param {string} id @returns {Promise<any>} */
  const check = async (id) => (await shim.api(`/api/agent-accounts/${id}/check`, { method: "POST" })).json();
  /** An upstream's health as the Usage page reads it. @param {string} id @returns {Promise<any>} */
  const healthOf = async (id) => (await (await shim.api("/api/usage/upstreams?hours=1")).json()).health[id];
  /** @param {string} id @returns {Promise<any>} */
  const row = async (id) => (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ r) => r.upstream === id);

  test("an expired sign-in names the account and waits for agy's next run; Google is not asked", async () => {
    signIns = (home) => (home ? null : { ...readSignIn(kept(), "file"), expiresAt: Date.now() - 1000 });
    const r = await check("agy");
    assert.deepEqual(r.checked, { read: false, said: "Antigravity's Google sign-in here has expired: Antigravity renews it as it next runs, and its plan's quota is read then." });
    assert.deepEqual([r.agent.account.identity.label, r.agent.account.identity.email], ["Google account", "person@example.com"]);
    assert.equal(g.calls.length, 0);
    assert.equal(askedFor.at(-1), null, "the Default account's sign-in");
  });

  test("Check now reads the plan's windows from Google under Filament's name and agy's version; the same again says so", async () => {
    signIns = (home) => (home ? null : { ...readSignIn(kept(), "file"), expiresAt: Date.now() + 3_600_000 });
    const r = await check("agy");
    assert.deepEqual(r.checked, { read: true, said: null });
    assert.deepEqual(r.agent.account.windows.map((/** @type {any} */ w) => [w.id, w.label, w.usedPercent, w.state, w.models]), [
      ["3p-weekly", "Weekly · Claude and GPT", 0, "ok", ["claude-*", "gpt-*"]],
      ["gemini-models", "Weekly · Gemini", 3.4, "ok", ["gemini-*"]],
    ]);
    assert.ok(g.calls.length >= 2);
    assert.ok(g.calls.every((c) => /^Filament\/\S+ antigravity\/1\.5\.14 \S+\/\S+$/.test(c.agent)), g.calls[0].agent);
    assert.deepEqual((await check("agy")).checked, { read: true, said: "Checked just now: Antigravity's plan is as it was." });
    const text = JSON.stringify(await (await shim.api("/api/agent-accounts")).json());
    assert.ok(!text.includes(TOKEN), "the sign-in's token is in no answer");
  });

  test("an added account's sign-in is read from its folder; none kept is said, and nothing is asked of Google", async () => {
    const calls = g.calls.length;
    const r = await check("agywork");
    assert.equal(askedFor.at(-1), work);
    assert.deepEqual(r.checked, { read: false, said: "Antigravity keeps no Google sign-in for this account, so there's no plan's quota to read: a Gemini API key or Agent Platform is billed by use." });
    assert.equal(g.calls.length, calls);
  });

  test("a session it opens names the plan's tier, and a turn's end reads the plan again once it is due", async () => {
    shim.app.acp.usageEveryMs = 0;
    shim.app.acp.usageRetryMs = 0;
    const calls = g.calls.length;
    const res = await shim.post("/v1/messages", { model: "agy/gemini-3.8-flash-high", max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "say hello" }] }, { "x-session-id": "agy-quota-1" });
    assert.equal(res.status, 200, await res.text());
    const plan = await until(async () => (await row("agy"))?.account?.identity?.plan || null, "the plan's tier");
    assert.equal(plan, "Google AI Plus", "as the fake agy names it");
    await until(async () => g.calls.length > calls || null, "the plan read again");
    assert.equal((await row("agy")).account.identity.email, "person@example.com", "the same account, its windows kept");
    assert.equal((await row("agy")).account.windows.length, 2);
  });

  test("an allowance used up on a model its plan meters apart holds no wall on the agent; one with no group read yet is held as agy says", async () => {
    /** @param {string} model @param {string} chat */
    const fail = async (model, chat) => {
      const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "~agyquota" }] }, { "x-session-id": chat });
      await res.text();
      assert.notEqual(res.status, 200);
    };
    await fail("agy/gemini-3.8-flash-high", "agy-quota-2");
    assert.equal((await healthOf("agy"))?.wall ?? null, null, "Gemini's group is metered apart: the agent still serves the others'");
    const before = Date.now();
    await fail("agywork/gemini-3.8-flash-high", "agy-quota-3");
    const wall = (await healthOf("agywork"))?.wall;
    assert.equal(wall?.kind, "out", "no group read: the whole agent is held");
    assert.ok(wall.until >= before + 7_840_000 && wall.until <= Date.now() + 7_840_000, `until agy's own word: ${wall.until - before}`);
  });
});
