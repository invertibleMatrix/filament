// @ts-check
// The tray's card page (HarnessV3-Native NA-D9, the harness's since NA3b), drawn on the fake DOM: its head's pill and
// line — what needs you first —, Now (the harness's own rows, a row opening its chat; the model calls in flight; the day
// in a line), Today (the alerts but memory's, the figures, the coding agents' plans, where the money went, failover),
// Requests, Upstreams (a coding agent's plan, how Filament is set up), a Filament that does not answer, its buttons in the
// app and in a browser, and what each tick reads.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { createNow } from "../src/ui/harness/now-list.js";
import { ACCOUNTS_MS, CHATS_MS, cardAlerts, cardView, chatFactsOf, EVERY_MS, flightRows, headFacts, holdersOf, nowWords, PARTS, planWords, READS, readCard, requestRow, routeOf, upKind, upName, upState } from "../src/ui/tray-card.js";

const mk = /** @type {any} */ (fakeH);
const UPS = [
  { id: "anthropic", name: "Anthropic", type: "anthropic", enabled: true },
  { id: "claude", name: "Claude Code (agent via ACP)", type: "acp", enabled: true },
  { id: "old", name: "Old", type: "openai", enabled: false },
];
/** @param {any} [extra] */
const data = (extra = {}) => ({
  state: { version: "0.9.4", uptimeMs: 3 * 3_600_000 + 720_000, config: { upstreams: UPS, routes: [{ enabled: true }, { enabled: false }], observability: { storeBodies: "summary" } } },
  summary: { requests: 40, errors: 1, cacheHitRate: 0.5, cost: 1.25, tokens: { cacheRead: 100, cacheWrite: 10 }, byModel: {} },
  days: { today: "2026-10-22", days: [{ day: "2026-10-22", requests: 12, errors: 0, input: 1000, cacheRead: 9000, cacheWrite: 500, output: 800, cacheHitRate: 0.9, cost: 0.42 }] },
  live: { active: [] },
  reqs: { requests: [] },
  ups: { upstreams: {}, health: {} },
  failover: { enabled: true, routesWithBackups: [] },
  alerts: { alerts: [] },
  ...extra,
});
/** A Now as the page holds it, with nothing in it. */
const quietNow = { needs: 0, works: 0, done: [], fill: (/** @type {any} */ host) => host.replaceChildren() };
/** @param {any} [o] */
const view = (o = {}) => ({ part: "today", data: data(), at: Date.parse("2026-10-22T12:04:31"), app: { owned: true, state: "up", port: 20300 }, port: 20300, now: quietNow, ...o });
/** @type {string[]} */
let acted = [];
const acts = { act: (/** @type {string} */ id, /** @type {any} */ route) => void acted.push(route ? `${id} ${route}` : id), setFailover: (/** @type {boolean} */ on) => void acted.push(`failover ${on}`), choose: (/** @type {string} */ p) => void acted.push(`part ${p}`), open: (/** @type {string} */ p) => void acted.push(`open ${p}`) };

/** The harness's Now over a fake Filament: a chat whose turn waits for a yes, one whose agent works, one done. */
async function harnessNow(/** @type {string[]} */ opened = []) {
  const t = Date.now();
  const runs = [
    { id: "r1", kind: "agent-turn", status: "paused", startedAt: t - 60_000, endedAt: t - 30_000, events: 3, meta: { chain: "c1", model: "claude-sonnet-5-5" } },
    { id: "r2", kind: "coding-agent", status: "running", startedAt: t - 240_000, endedAt: null, events: 2, meta: { chain: "c2", model: "opus", upstream: "claude" } },
    { id: "r3", kind: "agent-turn", status: "done", startedAt: t - 900_000, endedAt: t - 600_000, events: 9, meta: { chain: "c3", model: "glm-5.3" } },
  ];
  const chats = [
    { id: "c1", title: "Parser refactor", cwd: "H:\\work\\shop-api", when: new Date(t).toISOString(), unread: false },
    { id: "c2", title: "Release notes", projectName: "site", when: new Date(t).toISOString(), unread: false },
    { id: "c3", title: "Fix the CSV export", projectName: "shop-api", when: new Date(t - 600_000).toISOString(), unread: true },
  ];
  /** @param {string} p */
  const call = async (p) => {
    if (p.startsWith("/runs/r1/events")) return { events: [{ n: 3, type: "ask", kind: "permission", id: "a1", question: "Bash npm test", ts: t - 30_000 }] };
    if (p.startsWith("/runs/r2/events")) return { events: [{ n: 2, type: "round-start", round: 4 }, { n: 2, type: "tool-start", round: 4, id: "x", name: "Bash", card: null }] };
    return { events: [] };
  };
  const facts = chatFactsOf(chats);
  const now = createNow({ h: mk, drawIn: fakeDrawIn, call, chats: facts, unread: () => new Set(chats.filter((c) => c.unread).map((c) => c.id)), holders: () => new Map(), onOpen: (r) => void opened.push(routeOf(r)), onSeen: () => {} });
  await now.update(/** @type {any} */ (runs));
  return now;
}

// (fails before: yes — no card page; NA-D9 — and the card made the harness's, NA3b)
describe("the tray's card", () => {
  test("its head: what needs you, then what works, then the calls in flight, then failures; not answering, restarting; its line", () => {
    assert.deepEqual(headFacts(view()), { pill: "Running", tone: "ok", line: "v0.9.4 · port 20300 · up 3.2 h" });
    assert.deepEqual(headFacts(view({ now: { ...quietNow, needs: 2, works: 3 } })).pill, "2 need you", "what needs you before all");
    assert.equal(headFacts(view({ now: { ...quietNow, needs: 1 } })).pill, "1 needs you");
    assert.deepEqual(headFacts(view({ now: { ...quietNow, works: 3 } })), { pill: "3 working", tone: "accent", line: "v0.9.4 · port 20300 · up 3.2 h" });
    assert.equal(headFacts(view({ data: data({ live: { active: [{ id: "a" }, { id: "b", parentId: "a" }, { id: "c" }] } }) })).pill, "2 in flight", "a call under a turn is that turn's");
    assert.deepEqual(headFacts(view({ data: data({ summary: { requests: 10, errors: 2 } }) })).tone, "warn");
    assert.deepEqual(headFacts(view({ data: null })), { pill: "Not answering", tone: "err", line: "port 20300" });
    assert.deepEqual(headFacts(view({ data: null, app: { owned: true, state: "restarting", port: 20301 } })), { pill: "Restarting…", tone: "warn", line: "port 20301" });
    assert.deepEqual(PARTS.map((p) => p.label), ["Now", "Today", "Requests", "Upstreams"], "Now first; memory is not the card's");
    assert.deepEqual([EVERY_MS, CHATS_MS, ACCOUNTS_MS], [3000, 15_000, 60_000]);
  });

  test("Now: the harness's own rows — needs you, working, done, with its words and projects —, a row opening its chat", async () => {
    /** @type {string[]} */
    const opened = [];
    const now = await harnessNow(opened);
    assert.deepEqual([now.needs, now.works, now.done.length], [1, 1, 1]);
    const el = cardView(mk, view({ part: "now", now }), acts);
    const t = textOf(el);
    for (const want of ["Needs you", "Parser refactor", "shop-api", "waits for your yes: Bash npm test", "Working", "Release notes", "site", "round 4", "Done", "Fix the CSV export", "finished"]) assert.ok(t.includes(want), want);
    assert.ok(t.indexOf("Needs you") < t.indexOf("Working") && t.indexOf("Working") < t.indexOf("Done"));
    assert.equal(headFacts(view({ part: "now", now })).pill, "1 needs you");
    el.querySelector("now-row").dispatch("click");
    assert.deepEqual(opened, ["#/task/c1"], "its chat, in the harness");
    assert.equal(routeOf({ chain: "c 2", thread: "t1" }), "#/task/c%202/side", "a thread on its chat's Sub Agents view");
    assert.equal(routeOf({ chain: "c2", thread: null, team: "Reviewers" }), "#/task/c2/team", "a team's lead on the Team view");
  });

  test("Now, quiet: the harness's line for it; the model calls in flight with their speed; the day in a line that shows Today", () => {
    acted = [];
    const el = cardView(mk, view({ part: "now" }), acts);
    const t = textOf(el);
    assert.ok(t.includes("Nothing running"), t);
    assert.ok(t.includes("Today|$0.42 · 11.3K tokens · 12 requests"), t);
    buttonsOf(el).find((b) => b.attrs.class === "tc-day").dispatch("click");
    assert.deepEqual(acted, ["part today"]);
    const busy = textOf(cardView(mk, view({ part: "now", data: data({ live: { active: [{ id: "t1", source: "anthropic", model: "claude-sonnet-5-5", liveTpsNow: 70 }] } }) }), acts));
    assert.ok(busy.includes("Model calls now") && busy.includes("70 tok/s"), busy);
    assert.ok(!busy.includes("Nothing running"), "a call in flight is not nothing");
  });

  test("the model calls in flight: each turn its model, what it does, its speed; its sub-agents under it", () => {
    const active = [
      { id: "t1", source: "agent-loop", model: "claude-sonnet-5-5", now: { what: "tool", name: "bash", args: "npm test", forMs: 12_000 } },
      { id: "c1", parentId: "t1", source: "anthropic", model: "claude-sonnet-5-5", liveTpsNow: 0, liveTpsWriting: 61 },
      { id: "s1", parentId: "t1", source: "subagent", model: "glm-5.3", now: { what: "model", model: "glm-5.3", forMs: 3000 } },
      { id: "s2", parentId: "t1", source: "subagent", model: "glm-5.3", now: { what: "model", model: "glm-5.3-flash", forMs: 1000 } },
      { id: "c2", parentId: "s1", source: "zai", liveTpsNow: 88 },
    ];
    const rows = flightRows(mk, active);
    assert.equal(rows.length, 3, "the three turns; their calls are their speeds");
    assert.deepEqual(rows.map((r) => textOf(r)), ["claude-sonnet-5-5|running bash npm test · 12 s|61 tok/s", "glm-5.3|thinking · 3 s|88 tok/s", "glm-5.3|calling glm-5.3-flash · 1 s|"], "its own model's call is its thinking, another's is named");
    assert.match(rows[0].attrs.class, /tc-still/, "an average, not writing now");
    assert.match(rows[1].attrs.class, /tc-depth-1/);
    assert.equal(nowWords({ what: "waiting", why: "asks you", forMs: 65_000 }), "asks you · 1 min 5 s");
    assert.equal(nowWords(null), "");
  });

  test("Today: the alerts first but memory's, the day's four figures, failover as a switch; no setup line", () => {
    const el = cardView(mk, view({ data: data({ alerts: { alerts: [{ id: "1", kind: "budget", text: "older" }, { id: "m", kind: "memory", text: "the engine stopped" }, { id: "2", kind: "failover", text: "a request was served by backup" }] } }) }), acts);
    const t = textOf(el);
    for (const want of ["Requests today", "|12|", "0 errors · 40 in 24 h", "Tokens today", "11.3K", "10.5K in · 800 out", "Cache hit", "90%", "Cost today", "$0.42", "API models only · $1.25 in 24 h", "Use a route's backups when its provider fails", "No route has a backup yet"]) assert.ok(t.includes(want), want);
    assert.ok(!t.includes("the engine stopped"), "memory's alert is not the card's");
    assert.deepEqual(cardAlerts([{ kind: "memory" }, { kind: "flow" }]).map((a) => a.kind), ["flow"]);
    assert.ok(!t.includes("agents reach Filament at"), "the setup line is Upstreams'");
    assert.ok(t.indexOf("a request was served by backup") < t.indexOf("older"), "the newest alert first");
    assert.ok(t.indexOf("older") < t.indexOf("Requests today"), "the alerts above the figures");
    assert.ok(/** @type {any} */ (JSON.stringify(el)).includes('"role":"switch"'));
  });

  test("Today: the coding agents' plans, the fullest window first; where the money went, the three dearest models", () => {
    const accounts = { agents: [
      { upstream: "claude", name: "Claude Code (agent via ACP)", account: { identity: { label: "Claude Max" }, windows: [{ label: "weekly", usedPercent: 41, state: "ok" }, { label: "5h", usedPercent: 92, state: "warning", resetsAt: 0 }] } },
      { upstream: "codex", name: "Codex", account: { windows: [] } },
    ] };
    const byModel = { a: { cost: 0.1, requests: 1 }, b: { cost: 2.5, requests: 9 }, c: { cost: 0, requests: 4 }, d: { cost: 0.4, requests: 2 }, e: { cost: 0.2, requests: 3 } };
    const t = textOf(cardView(mk, view({ data: data({ accounts, summary: { ...data().summary, byModel } }) }), acts));
    assert.ok(t.includes("Plans|Claude Code|Claude Max · 5h 92% · weekly 41%|near its limit"), t);
    assert.ok(!t.includes("Codex"), "an agent that said no plan has no row");
    assert.ok(t.includes("Where it went · 24 h|b|9 requests|$2.50|d|2 requests|$0.40|e|3 requests|$0.20"), t);
    assert.deepEqual(planWords({ windows: [{ label: "5h", usedPercent: 100, state: "spent", resetsAt: Date.parse("2026-10-22T14:00:00") }, { label: "old", state: "reset" }] }), { words: "5h 100% · free again at 14:00", state: "spent" });
    assert.deepEqual(planWords(null), { words: "", state: "" });
  });

  // (fails before: yes — the Fable 5.2 re-read's finding 10: a window extra usage covers read "spent" in red with "free
  // again at", as of a plan that had stopped, while the harness's pill said amber "extra usage")
  test("Today: a plan whose spent window extra usage covers says so in amber, and never when it is free again", () => {
    const resetsAt = Date.parse("2026-10-22T14:00:00");
    const account = { identity: { label: "Claude Max" }, extraCovers: true, spent: false, windows: [{ label: "5h", usedPercent: 100, state: "spent", resetsAt }, { label: "weekly", usedPercent: 41, state: "ok" }] };
    assert.deepEqual(planWords(account), { words: "5h 100% · weekly 41%", state: "covered" });
    const el = cardView(mk, view({ data: data({ accounts: { agents: [{ upstream: "claude", name: "Claude Code (agent via ACP)", account }] } }) }), acts);
    assert.ok(textOf(el).includes("Plans|Claude Code|Claude Max · 5h 100% · weekly 41%|extra usage covers it"), textOf(el));
    assert.ok(JSON.stringify(el).includes('"class":"tc-pill is-warn"') && !JSON.stringify(el).includes('"class":"tc-pill is-err"'), "amber, not red");
    // Uncovered, it is spent and says when it is free again, as before.
    assert.deepEqual(planWords({ ...account, extraCovers: false, spent: true }), { words: "5h 100% · weekly 41% · free again at 14:00", state: "spent" });
  });

  test("Today: a whole-body request log is said; failover's routes are named by their upstreams", () => {
    const el = cardView(mk, view({ data: data({ state: { ...data().state, config: { ...data().state.config, observability: { storeBodies: "full" } } }, failover: { enabled: false, routesWithBackups: [{ match: "claude-*", chain: ["anthropic", "claude"] }] } }) }), acts);
    const t = textOf(el);
    assert.ok(t.includes("storeBodies is full"));
    assert.ok(t.includes("claude-*: Anthropic → Claude Code"));
  });

  test("Requests: each its time, provider, speed, cache and tokens, its status as a pill; a backup's attempt and a child call marked", () => {
    const r = requestRow(mk, { ts: "2026-10-22T12:00:01", model: "claude-sonnet-5-5", upstream: "anthropic", attempt: 2, status: "ok", ttftMs: 820, tps: 64, tokens: { input: 100, cacheRead: 900, output: 80 } }, UPS);
    assert.match(textOf(r), /claude-sonnet-5-5\|.*via Anthropic \(#2\) · 820 ms to first token · 64 tok\/s · 90% cached · 1K in \/ 80 out\|ok/);
    const child = requestRow(mk, { ts: "x", model: "glm", source: "subagent", status: "error", httpStatus: 529, estimatedTokens: true, tokens: {} }, UPS);
    assert.match(textOf(child), /^› sub-agent glm\|/);
    assert.match(textOf(child), /n\/a cached · ~0 in \/ ~0 out\|error 529$/);
    assert.match(child.attrs.class, /tc-child/);
    assert.ok(textOf(cardView(mk, view({ part: "requests" }), acts)).includes("No requests yet."));
    const list = textOf(cardView(mk, view({ part: "requests", data: data({ reqs: { requests: [{ status: "ok", tokens: {} }, { status: "error", tokens: {} }] } }) }), acts));
    assert.ok(list.includes("1 of 2 succeeded"));
    assert.equal(textOf(requestRow(mk, { ts: "2026-10-22T12:00:01", model: "m", upstream: "agent-loop", status: "pending", tokens: {} }, UPS)).replace(/^m\|\S+ /, ""), "· via Filament agent loop · in flight|pending");
  });

  test("Upstreams: each on its state over the day; a coding agent's plan in its row; how Filament is set up under them", () => {
    assert.deepEqual(upState(null, { coolingDown: true }), { word: "cooling down", tone: "warn" });
    assert.deepEqual(upState({ errorRate: 0 }, { quotaExceeded: true }), { word: "quota used up", tone: "err" });
    assert.deepEqual([upState(null, null).word, upState({ errorRate: 0.01 }, null).word, upState({ errorRate: 0.05 }, null).word, upState({ errorRate: 0.2 }, null).word], ["no traffic", "healthy", "degraded", "failing"]);
    assert.equal(upName("claude", UPS), "Claude Code");
    assert.equal(upKind(UPS[1]), "coding agent");
    const accounts = { agents: [{ upstream: "claude", account: { windows: [{ label: "5h", usedPercent: 62, state: "ok" }] } }] };
    const t = textOf(cardView(mk, view({ part: "upstreams", data: data({ accounts, ups: { upstreams: { anthropic: { requests: 5, errorRate: 0, input: 1000, output: 200, cost: 0.05 }, claude: { requests: 2, errorRate: 0, input: 10, output: 5, cost: 0 } }, health: {} } }) }), acts));
    assert.ok(t.includes("Anthropic|Anthropic API · 5 requests · 1.2K tokens · $0.05|healthy"), t);
    assert.ok(t.includes("Claude Code|coding agent · 2 requests · 15 tokens · 5h 62%|healthy"), t);
    assert.ok(!t.includes("Old|"));
    assert.ok(t.includes("1 upstream off, not shown. 2 on · 1 coding agent · 1 route · agents reach Filament at http://127.0.0.1:20300/v1"), t);
  });

  test("not answering: said in place of the parts, with who starts it again", () => {
    assert.ok(textOf(cardView(mk, view({ data: null }), acts)).includes("Filament does not answer on port 20300. The app starts it again by itself."));
    assert.ok(textOf(cardView(mk, view({ data: null, app: { owned: false, state: "gone", port: 20300 } }), acts)).includes("It was started elsewhere: if nothing answers soon, the app starts Filament itself."));
    assert.ok(textOf(cardView(mk, view({ data: null, app: { owned: true, state: "restarting", port: 20300 } }), acts)).includes("Filament is restarting: the card fills again once it answers."));
  });

  // (fails before: yes — the owner's of 11-17: the card's button said "Open the harness", where the app is Filament)
  test("in the app: ×, Restart, Dashboard and Open Filament are the app's; Restart only where the app runs Filament and can", () => {
    acted = [];
    const el = cardView(mk, view(), acts);
    const b = buttonsOf(el);
    const by = (/** @type {string} */ label) => b.find((x) => textOf(x).includes(label) || x.attrs["aria-label"] === label);
    for (const label of ["Hide the card", "Restart", "Dashboard", "Open Filament"]) by(label).dispatch("click");
    assert.deepEqual(acted, ["hide", "restart", "dashboard", "harness"]);
    assert.match(by("Open Filament").attrs.class, /is-primary/, "the one blue");
    assert.equal(b.some((x) => textOf(x).includes("harness")), false, "no button names the harness");
    assert.ok("disabled" in by("Restart").attrs === false);
    for (const app of [{ owned: false, state: "attached", port: 1 }, { owned: true, state: "restarting", port: 1 }]) {
      const r = buttonsOf(cardView(mk, view({ app }), acts)).find((x) => textOf(x).includes("Restart"));
      assert.ok("disabled" in r.attrs, JSON.stringify(app));
    }
    acted = [];
    b.find((x) => textOf(x) === "Now").dispatch("click");
    assert.deepEqual(acted, ["part now"]);
  });

  test("in a browser: no × and no Restart; Dashboard and Open Filament go there", () => {
    acted = [];
    const browser = { setFailover: acts.setFailover, choose: acts.choose, open: acts.open };
    const b = buttonsOf(cardView(mk, view({ app: null }), browser));
    assert.equal(b.some((x) => x.attrs["aria-label"] === "Hide the card"), false);
    assert.equal(b.some((x) => textOf(x).includes("Restart")), false);
    b.find((x) => textOf(x).includes("Dashboard")).dispatch("click");
    b.find((x) => textOf(x).includes("Open Filament")).dispatch("click");
    assert.deepEqual(acted, ["open /", "open /ui/harness.html"]);
  });

  test("a tick asks what the head and Now need and the part in view's; the chats and plans only when due; memory never", async () => {
    /** @param {string} part @param {any} [due] */
    const asked = async (part, due) => {
      /** @type {string[]} */
      const paths = [];
      const d = await readCard(async (/** @type {string} */ p) => (paths.push(p), p === "/alerts" ? Promise.reject(new Error("503")) : { p }), part, due);
      return { paths, d: /** @type {any} */ (d) };
    };
    const now = await asked("now");
    assert.deepEqual(now.paths, ["/state", "/usage/summary", "/usage/days?limit=1", "/live", "/runs?limit=50", "/sessions/holders"]);
    const today = await asked("today", { chats: true, accounts: true });
    assert.deepEqual(today.paths.slice(6), ["/failover", "/alerts", "/memory/sessions?limit=200&kind=interactive,fork,team", "/agent-accounts"]);
    assert.equal(today.d.alerts, undefined, "one that does not answer is left out");
    assert.deepEqual((await asked("requests")).paths.slice(6), ["/requests?limit=12"]);
    assert.deepEqual((await asked("upstreams")).paths.slice(6), ["/usage/upstreams?hours=24"]);
    for (const part of Object.keys(READS)) for (const [, p] of READS[part]) assert.ok(!/^\/memory\/(status|usage)/.test(p), p);
    assert.equal(await readCard(async () => Promise.reject(new Error("down"))), null);
  });

  test("the chats' facts and who holds a turn, as the harness names them", () => {
    const f = chatFactsOf([{ id: "c1", title: "", preview: "fix the parser", cwd: "H:\\work\\shop-api\\", when: "2026-10-22T10:00:00Z", unread: true }]);
    assert.deepEqual(f("c1"), { title: "fix the parser", project: "shop-api", when: Date.parse("2026-10-22T10:00:00Z"), unread: true });
    assert.equal(f("nope"), null);
    assert.deepEqual([...holdersOf({ holders: [{ chainId: "c1", window: "w", client: "Claude Code", label: "x", since: 5 }] })], [["c1", { window: "w", client: "Claude Code", label: "x", since: 5, own: null }]]);
  });

  test("its page: the harness's tokens and the kit's look; nothing of its own fetches outside readCard and the harness's Now", () => {
    const html = readFileSync(new URL("../src/ui/tray-card.html", import.meta.url), "utf8");
    for (const css of ["/ui/harness/zc.css", "/ui/harness.css", "/ui/harness/instruments.css", "/ui/tray-card.css"]) assert.ok(html.includes(css), css);
    assert.match(html, /<main id="card" class="inst inst-traycard"/);
    const src = readFileSync(new URL("../src/ui/tray-card.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /innerHTML|\bfetch\(/);
  });
});
