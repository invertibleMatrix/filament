// @ts-check
// Who asked, kept by the day (the owner's Usage stats of 11-12): which client sent the model calls and which project
// they were booked on answered only over the request ring, the newest few hundred records, so "who used what in the
// last 30 days" had no answer. A day of the usage file may carry sums by client and by project now — beside its rows
// and hours, the file's version as it was: a day without them reads as having none, and the last release reads a file
// that has them.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DailyUsage, localDay, WHO_KEEPS, WHO_OTHER } from "../src/services/daily-usage.js";
import { UsageStore, clientOf, HARNESS_CLIENT, OWN_CLIENT } from "../src/services/records.js";
import { STORE_FILES } from "../src/services/store-files.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "daily-who-"));
  made.push(d);
  return d;
};
const DAY = 86_400_000;
/** A finished call, so many days back, of a client and a project. @param {any} [o] */
const call = (o = {}) => ({
  ts: new Date(Date.now() - (o.back || 0) * DAY).toISOString(),
  status: "ok",
  upstream: "anthropic",
  model: "claude-sonnet-5",
  tokens: { input: 100, cacheRead: 900, cacheWrite: 50, output: 20 },
  cost: 0.01,
  listCost: 0.01,
  billing: "metered",
  totalMs: 900,
  ttftMs: 100,
  ua: "OpenCode/2.4",
  ...o,
});
/** The store as records.js makes it, its who the record's own words. @param {any} [o] */
const store = (o = {}) => new DailyUsage({ persist: false, who: (/** @type {any} */ r) => ({ client: r.ua ? String(r.ua).split("/")[0] : null, project: r.project || null }), ...o });

// (fails before: yes — the store kept rows by upstream and model alone: `who` was no option and no day had `clients`)
test("a day keeps what each client and each project asked for, beside its rows and hours", () => {
  const d = store();
  d.add(call({ project: "p1" }));
  d.add(call({ project: "p1", cost: 0, listCost: 0.5, billing: "plan" }));
  d.add(call({ ua: "claude-cli/2.1", project: "p2", status: "error", tokens: { input: 7, output: 0 }, cost: null, listCost: null }));
  d.add(call({ ua: "", project: null }));
  const day = d.days[localDay()];
  assert.deepEqual(Object.keys(day).filter((k) => typeof day[k] === "object").sort(), ["clients", "hours", "projects", "rows"], "the parts ride the day beside rows and hours");
  assert.deepEqual(day.clients.OpenCode, { requests: 2, input: 200, output: 40, cacheRead: 1800, cacheWrite: 100, cost: 0.01, costN: 2, listCost: 0.51, listCostN: 2, planListCost: 0.5 });
  assert.deepEqual(day.clients["claude-cli"], { requests: 1, input: 7, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costN: 0, listCost: 0, listCostN: 0, planListCost: 0 }, "a call with no price counts none");
  assert.equal(day.clients.unknown.requests, 1, "a call that names no client is unknown's");
  assert.deepEqual(Object.keys(day.projects).sort(), ["none", "p1", "p2"], "a call booked on no project is none's");
  assert.equal(day.projects.p1.requests, 2);
  // Every call is in each part once: the parts add up to the day.
  for (const part of ["clients", "projects"]) assert.equal(Object.values(day[part]).reduce((n, b) => n + b.requests, 0), day.requests, part);

  const who = d.who();
  assert.equal(who.since, localDay());
  assert.deepEqual([who.days, who.requests], [1, 4]);
  assert.deepEqual(who.clients.map((c) => [c.name, c.requests, c.totalTokens]), [["OpenCode", 2, 2140], ["unknown", 1, 1070], ["claude-cli", 1, 7]], "the biggest by tokens first");
  assert.deepEqual(who.projects.map((p) => [p.id, p.requests]), [["p1", 2], ["none", 1], ["p2", 1]]);
  assert.equal(who.clients[0].cost, 0.01);
  assert.equal(who.clients[0].planListCost, 0.5);
});

// (fails before: yes)
test("one day keeps 40 clients and 200 projects by name: the rest are one `other`, and a name is data", () => {
  const d = store();
  for (let i = 0; i < WHO_KEEPS.clients + 5; i++) d.add(call({ ua: `tool-${i}/1`, project: `p-${i}` }));
  d.add(call({ ua: "tool-3/1", project: "p-3" }));
  d.add(call({ ua: "late/1", project: "p-late" }));
  const day = d.days[localDay()];
  assert.equal(Object.keys(day.clients).length, WHO_KEEPS.clients + 1, "40 names and the rest");
  assert.equal(day.clients[WHO_OTHER].requests, 6, "the 41st to the 45th, and the one after");
  assert.equal(day.clients["tool-3"].requests, 2, "a name the day has keeps counting");
  assert.equal(Object.keys(day.projects).length, WHO_KEEPS.clients + 6, "projects have room for 200");
  for (let i = 0; i < WHO_KEEPS.projects; i++) d.add(call({ ua: "tool-0/1", project: `q-${i}` }));
  assert.equal(Object.keys(day.projects).length, WHO_KEEPS.projects + 1);
  assert.ok(day.projects[WHO_OTHER].requests > 0);

  // A long user agent is kept by its first 80 characters; one named like an object's own parts is a name like any.
  const hostile = store();
  hostile.add(call({ ua: `${"x".repeat(5000)}/1` }));
  hostile.add(call({ ua: "__proto__/1", project: "constructor" }));
  hostile.add(call({ ua: "__proto__/1", project: "constructor" }));
  hostile.add(call({ ua: "toString/1", project: "__proto__" }));
  const h = hostile.days[localDay()];
  assert.deepEqual(Object.keys(h.clients).map((k) => k.length).sort((a, b) => a - b), [8, 9, 80]);
  assert.equal(/** @type {any} */ (Object.prototype).requests, undefined, "nothing was written on every object");
  assert.equal(hostile.who().clients.find((c) => c.name === "__proto__")?.requests, 2);
  assert.equal(hostile.who().projects.find((p) => p.id === "constructor")?.requests, 2);
  assert.equal(hostile.who().projects.find((p) => p.id === "__proto__")?.requests, 1);
  // Read back from its file, the same.
  const again = JSON.parse(JSON.stringify(h));
  assert.equal(Object.getOwnPropertyDescriptor(again.clients, "__proto__")?.value.requests, 2);
});

// (fails before: yes — `who` read as undefined)
test("who asked over a span: the days that carry it added up, since the first day that does", () => {
  const d = store();
  d.add(call({ back: 0, project: "p1" }));
  d.add(call({ back: 1, project: "p1" }));
  d.add(call({ back: 1, ua: "claude-cli/1", project: "p2" }));
  d.add(call({ back: 9, project: "p9" }));
  // A day from before this was kept: its sums and rows, no parts.
  const old = localDay(new Date(Date.now() - 20 * DAY));
  d.days[old] = { ...JSON.parse(JSON.stringify(d.days[localDay()])), requests: 7 };
  delete d.days[old].clients;
  delete d.days[old].projects;
  const first = localDay(new Date(Date.now() - 9 * DAY));
  const all = d.who();
  assert.equal(all.since, first, "the first day on record that carries who asked");
  assert.deepEqual([all.days, all.requests], [3, 4], "the old day carries none, and its calls are not among these");
  assert.deepEqual(all.clients.map((c) => [c.name, c.requests]), [["OpenCode", 3], ["claude-cli", 1]]);
  const week = d.who({ from: localDay(new Date(Date.now() - 6 * DAY)) });
  assert.equal(week.since, first, "since is the file's, whatever the span");
  assert.deepEqual([week.days, week.requests], [2, 3]);
  assert.deepEqual(week.projects.map((p) => [p.id, p.requests]), [["p1", 2], ["p2", 1]]);
  const before = d.who({ to: old });
  assert.deepEqual([before.since, before.days, before.requests, before.clients, before.projects], [first, 0, 0, [], []]);
  // A store that keeps none: memory's own, and the general one of a build before this.
  const none = new DailyUsage({ persist: false });
  none.add(call());
  assert.deepEqual(none.who(), { since: null, days: 0, requests: 0, clients: [], projects: [] });
  assert.equal("clients" in none.days[localDay()], false);
});

// A span's read holds as many names as a day does: a year of days with 40 new names each is not 14,600 rows.
test("a span's answer keeps as many names as one day: the smallest go under `other`", () => {
  const d = store();
  for (let back = 0; back < 3; back++) for (let i = 0; i < 30; i++) d.add(call({ back, ua: `t${back}-${i}/1`, tokens: { input: 1000 - i, output: 0 }, project: "p" }));
  const who = d.who();
  assert.equal(who.clients.length, WHO_KEEPS.clients + 1);
  assert.equal(who.clients.at(-1)?.name, WHO_OTHER, "the rest, last");
  assert.equal(who.clients.reduce((n, c) => n + c.requests, 0), 90, "and nothing is lost");
  assert.equal(who.clients.at(-1)?.requests, 50);
});

// (fails before: yes — the days had no parts, so nothing was written)
test("the file's version stays 2, a file of before reads as it did, and the days' view is as it was", async () => {
  assert.equal(STORE_FILES.usage.version, 2, "a day's optional parts change no version: another version's file is set aside whole");
  const dir = folder();
  const d = store({ dataDir: dir, persist: true });
  d.add(call({ project: "p1" }));
  d.add(call({ back: 2, ua: "claude-cli/1", project: "p2" }));
  await d.flush();
  const text = readFileSync(join(dir, "daily-usage.json"), "utf8");
  const file = JSON.parse(text);
  assert.equal(file.version, 2);
  assert.equal(text, JSON.stringify({ version: file.version, savedAt: file.savedAt, days: d.days }), "the file is one stringify of the whole, parts and all");
  assert.deepEqual(Object.keys(file.days[localDay()].clients), ["OpenCode"]);
  // The view of a day, and the aggregate, carry no part: what /usage/days answers is as it was.
  for (const day of d.list()) assert.deepEqual(Object.keys(day).filter((k) => k === "clients" || k === "projects"), []);
  assert.equal("clients" in d.aggregate(), false);
  // Read again, the parts are there; what is added after lands on them.
  const again = store({ dataDir: dir, persist: true });
  assert.deepEqual(again.who(), d.who());
  again.add(call({ project: "p1" }));
  assert.equal(again.who().clients.find((c) => c.name === "OpenCode")?.requests, 2);
  await again.flush();

  // A file as the last release wrote it — no part on any day — reads whole, and says none was kept.
  const before = folder();
  const plain = new DailyUsage({ persist: false });
  plain.add(call());
  plain.add(call({ back: 3 }));
  writeFileSync(join(before, "daily-usage.json"), JSON.stringify({ version: 2, savedAt: new Date().toISOString(), days: plain.days }));
  /** @type {string[]} */
  const said = [];
  const read = store({ dataDir: before, persist: true, log: (/** @type {string} */ _l, /** @type {string} */ m) => said.push(m) });
  assert.deepEqual(said, [], "nothing set aside, nothing said");
  assert.deepEqual(read.list(), plain.list());
  assert.deepEqual(read.who(), { since: null, days: 0, requests: 0, clients: [], projects: [] });
  // From its next call on, that day carries them: the calls counted before are the day's, and not among who asked.
  read.add(call({ project: "p1" }));
  const who = read.who();
  assert.deepEqual([who.since, who.days, who.requests, who.clients[0].requests], [localDay(), 1, 2, 1]);
});

// The last release's own store, read from git where this checkout has its tag: a file this build wrote reads there.
// (The same proof, run from a folder outside the repository, is in the builder's report of 11-12.)
test("the last release (v0.9.75) reads a file this build wrote, parts and all", async (t) => {
  let source = "";
  try {
    source = execFileSync("git", ["show", "v0.9.75:src/services/daily-usage.js"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return t.skip("this checkout has no v0.9.75 to read the last release's store from");
  }
  const dir = folder();
  writeFileSync(join(dir, "released.mjs"), source);
  const released = await import(pathToFileURL(join(dir, "released.mjs")).href);
  const d = store({ dataDir: dir, persist: true });
  for (const back of [0, 0, 1, 5]) d.add(call({ back, project: `p${back}` }));
  d.add(call({ ua: "claude-cli/1", upstream: "claude-code", model: "sonnet", cost: 0, listCost: 0.4, billing: "plan" }));
  await d.flush();
  /** @type {string[]} */
  const said = [];
  const old = new released.DailyUsage({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => said.push(m) });
  assert.deepEqual(said, [], "it sets nothing aside");
  // Its aggregate and its file for a spreadsheet are this build's; its days carry the parts beside their sums, unread.
  assert.deepEqual(old.aggregate(), d.aggregate());
  assert.equal(old.csv(), d.csv());
  const strip = (/** @type {any[]} */ days) => days.map(({ clients, projects, ...day }) => day);
  assert.deepEqual(strip(old.list()), d.list());
  assert.deepEqual(Object.keys(old.list()[0].clients).sort(), ["OpenCode", "claude-cli"], "a day's view there spreads them in: harmless, read by nothing");
  // What it counts and saves over the file keeps the parts it does not know, and this build reads the file again.
  old.add(call({ ua: "OpenCode/2.4" }));
  await old.flush();
  const back = store({ dataDir: dir, persist: true });
  assert.equal(back.list()[0].requests, 4, "the release's own call is in the day");
  const who = back.who();
  assert.deepEqual([who.days, who.requests], [3, 6]);
  assert.equal(who.clients.reduce((n, c) => n + c.requests, 0), 5, "and not among who asked: that build kept no such sum");
});

// (fails before: yes — `clientOf` was a closure inside summary(), and the days kept nothing of it)
test("the request store books each call on the client that began its turn, and summary() says the same names", () => {
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 50 } });
  const ok = { status: "ok", httpStatus: 200 };
  /** A turn with one round under it, and a sub-agent's turn under that with a round of its own. @param {any} first */
  const turn = (first) => {
    const parent = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ...first });
    const round = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "node" });
    round.agentOf = parent.id;
    const sub = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "filament-subagent/0.1" });
    sub.subagentOf = parent.id;
    sub.agent = { rounds: 1, roundIds: [] };
    const subRound = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "node" });
    subRound.agentOf = sub.id;
    subRound.memory = { project: first.project };
    for (const r of [round, subRound]) u.finish(r, { ...ok, tokens: { input: 10, output: 5 } }, {});
    parent.agent = { rounds: 1, roundIds: [] };
    for (const r of [sub, parent]) u.finish(r, { ...ok, tokens: { input: 10, output: 5 } }, {});
  };
  turn({ ua: "OpenCode/2.4 (win32)", project: "p-open" });
  turn({ ua: "Mozilla/5.0 (Windows NT 10.0)", api: "session", project: "p-harness" });
  const lone = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "node" });
  lone.agentOf = "req_gone";
  u.finish(lone, { ...ok, tokens: { input: 10, output: 5 } }, {});
  u.finish(u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "claude-cli/2.1.0 (external)" }), { ...ok, tokens: { input: 10, output: 5 } }, {});
  const want = { OpenCode: 2, [HARNESS_CLIENT]: 2, [OWN_CLIENT]: 1, "claude-cli": 1 };
  const s = u.summary(24 * 3600 * 1000);
  assert.deepEqual(Object.fromEntries(Object.entries(s.byClient).map(([k, v]) => [k, /** @type {any} */ (v).requests])), want, "summary(), as before");
  const who = u.dailyStore.who();
  assert.deepEqual(Object.fromEntries(who.clients.map((c) => [c.name, c.requests])), want, "and the days, by the same rule");
  assert.deepEqual(Object.fromEntries(who.projects.map((p) => [p.id, p.requests])), { none: 4, "p-open": 1, "p-harness": 1 }, "a project is the record's own, as By project reads it");
  assert.equal(who.requests, u.dailyStore.aggregate().requests, "model calls alone, as the day counts them");
  assert.deepEqual(u.memDailyStore.who(), { since: null, days: 0, requests: 0, clients: [], projects: [] }, "memory's own store keeps none");
  // The rule, by itself: up through what began a call, to the request nothing began.
  const kept = new Map([["a", { id: "a", ua: "Zed/1.0" }], ["b", { id: "b", agentOf: "a", ua: "node" }], ["s", { id: "s", api: "session", ua: "Mozilla/5.0" }]]);
  const up = (/** @type {string} */ id) => kept.get(id);
  assert.equal(clientOf({ id: "c", subagentOf: "b", ua: "node" }, up), "Zed");
  assert.equal(clientOf({ id: "d", parentRequest: "s", ua: "node" }, up), HARNESS_CLIENT);
  assert.equal(clientOf({ id: "e", agentOf: "gone", ua: "node" }, up), OWN_CLIENT);
  assert.equal(clientOf({ id: "f" }, up), "unknown");
});
