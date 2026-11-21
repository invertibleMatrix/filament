// W9 Phase A — Traffic lists EVERY model call, labelled by one server-side classifier, while the accounting that
// gives "your spend" its meaning stays exactly as it was.
//
// Every assertion here goes through the real HTTP surface rather than calling the functions directly, on purpose:
// while this was being written a helper was referenced by two endpoints but never defined, which passes
// `node --check`, passes a module-load probe, and only fails when a request actually arrives. A unit test that
// imports the module would have missed it too.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { TRAFFIC_SOURCES } from "../src/schema.js";
import { recordSource, headersAreInternal, recordInScope, TRAFFIC_SOURCE_KEYS } from "../src/usage.js";
import { isMemoryRecord } from "../src/daily.js";
import { houseAuth } from "../src/services/house.js";
import { uiSrc } from "./helpers/ui-src.js";

let app, fake, port, fakePort, dataDir;

before(async () => {
  fake = createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m1", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 7, output_tokens: 2 } }));
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r)); fakePort = fake.address().port;
  dataDir = mkdtempSync(join(tmpdir(), "filament-scope-"));
  const cfg = defaultConfig();
  cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.observability.storeBodies = "full"; // so the body-withholding rule has something to withhold
  cfg.upstreams = [{ id: "fake", name: "fake", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: "up-secret", authStyle: "x-api-key" }];
  cfg.routes = [{ match: "claude-*", upstream: "fake", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } });
  port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });

const H = { "content-type": "application/json", "x-api-key": "k" };
const send = (extra = {}) => fetch(`http://127.0.0.1:${port}/v1/messages`, {
  method: "POST", headers: { ...H, ...extra },
  body: JSON.stringify({ model: "claude-fable-5", max_tokens: 20, stream: false, messages: [{ role: "user", content: "hi" }] }),
});
// One of Filament's own calls (memory, a ping): it presents the house key, which is what makes its tags count.
const houseSend = (extra = {}) => send({ ...houseAuth(), ...extra });
const get = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`, { headers: H })).json();
const reqs = async (qs = "") => (await get(`/api/requests?${qs}`)).requests;

// ---------------------------------------------------------------- the classifier

test("the source enum in the schema and the classifier's outputs are the same set", () => {
  // The dashboard builds its tabs and its source filter from `schema.trafficSources`, so a source the classifier can
  // return but the schema does not name is a row the user cannot filter or label — and the reverse is a dead tab.
  const produced = new Set([
    recordSource({}),
    recordSource({ memoryFor: { purpose: "learn" } }),
    recordSource({ ua: "filament-memory/0.1" }),
    recordSource({ ua: "filament-ping/0.1" }),
    recordSource({ ua: "filament-assistant/0.1" }),
    recordSource({ ua: "filament-housekeeping/0.1" }),
    recordSource({ replayOf: "abc" }),
    recordSource({ agent: { model: "m" } }),
    recordSource({ agentOf: "abc" }),
    // A sub-agent is an agent-loop parent too; its lineage names it first.
    recordSource({ subagentOf: "abc", agent: { model: "m" } }),
    // A compaction's fork rides the developer's lineage but is no sub-agent's run (HarnessV3-FixRound decision 27).
    recordSource({ subagentOf: "owner", forkFor: "compaction" }),
  ]);
  assert.equal(recordSource({ subagentOf: "owner", forkFor: "compaction" }), "compaction");
  assert.equal(recordSource({ subagentOf: "owner" }), "subagent", "Enhance's fork stays the developer's sub-agent");
  assert.deepEqual([...produced].sort(), [...TRAFFIC_SOURCE_KEYS].sort(), `classifier produces ${[...produced].sort()} vs schema ${TRAFFIC_SOURCE_KEYS.sort()}`);
  for (const k of TRAFFIC_SOURCE_KEYS) {
    assert.ok(TRAFFIC_SOURCES[k]?.label, `${k} has a label the UI can show`);
    assert.ok(TRAFFIC_SOURCES[k]?.hint, `${k} explains itself`);
  }
});

test("one rule decides 'Filament made this call', whether it looks at a record or at inbound headers", () => {
  // Two entry points because the body-capture decision runs BEFORE the record is tagged: if these disagreed, an
  // internal call would either store its prompt or a client call would lose its body.
  const cases = [
    [{ ua: "filament-memory/0.1" }, { "user-agent": "filament-memory/0.1" }],
    [{ ua: "filament-ping/0.1" }, { "user-agent": "filament-ping/0.1" }],
    [{ ua: "filament-assistant/0.1" }, { "user-agent": "filament-assistant/0.1" }],
    [{ ua: "filament-housekeeping/0.1" }, { "user-agent": "filament-housekeeping/0.1" }],
    [{ memoryFor: { purpose: "engine" } }, { "x-filament-memory-purpose": "engine" }],
    [{ ua: "OpenCode/3.12.3" }, { "user-agent": "OpenCode/3.12.3" }],
    [{}, {}],
  ];
  for (const [rec, headers] of cases) {
    const fromRecord = recordSource(rec) !== "client";
    assert.equal(headersAreInternal(headers), fromRecord, `${JSON.stringify(headers)}: headers say ${headersAreInternal(headers)}, record says ${recordSource(rec)}`);
  }
  assert.equal(headersAreInternal(null), false, "no headers is not internal");
});

test("scope defaults to client, and 'all' is the only way to widen it", () => {
  const mem = { memoryFor: { purpose: "compact" } }, client = { ua: "OpenCode/1" };
  assert.equal(recordInScope(mem), false, "a memory call is out of scope by default");
  assert.equal(recordInScope(client), true);
  assert.equal(recordInScope(mem, "all"), true);
  assert.equal(recordInScope(mem, "memory"), true);
  assert.equal(recordInScope(client, "memory"), false);
  assert.equal(recordInScope(mem, "nonsense"), false, "an unrecognised scope narrows, it never widens");
});

// ---------------------------------------------------------------- the HTTP surface

test("Traffic can list every call, and each row says who made it", async () => {
  await send({ "x-session-id": "scope-client" });
  await houseSend({ "user-agent": "filament-memory/0.1", "x-filament-memory-purpose": "compact", "x-filament-memory-for": "chain-9", "x-session-id": "memory-1" });
  await houseSend({ "user-agent": "filament-ping/0.1", "x-session-id": "ping-1" });

  const all = await reqs("limit=50&scope=all");
  const sources = all.map((r) => r.source);
  assert.ok(sources.includes("client"), `a client call is listed: ${sources}`);
  assert.ok(sources.includes("memory"), `memory's own call is listed too — the whole point: ${sources}`);
  assert.ok(sources.includes("ping"), `a health ping is listed: ${sources}`);
  assert.ok(all.every((r) => TRAFFIC_SOURCE_KEYS.includes(r.source)), "every row carries a source the schema names");

  const compact = all.find((r) => r.memoryFor?.purpose === "compact");
  assert.equal(compact.source, "memory");
  assert.equal(compact.memoryFor.chain, "chain-9", "the session it was for");

  // Default is unchanged: every existing consumer of /api/requests still sees client traffic only.
  const def = await reqs("limit=50");
  assert.ok(!def.some((r) => r.source === "memory"), "the default scope still excludes memory's own calls");
  assert.ok(def.some((r) => r.source === "client"), "and still includes the client's");

  assert.equal((await reqs("limit=50&scope=memory")).every((r) => r.source === "memory"), true, "scope=memory is only memory");
  assert.equal((await reqs("limit=50&scope=all&source=ping")).every((r) => r.source === "ping"), true, "source filter");
  const byPurpose = await reqs("limit=50&scope=all&purpose=compact");
  assert.ok(byPurpose.length >= 1 && byPurpose.every((r) => r.memoryFor?.purpose === "compact"), "purpose filter");
  assert.equal((await reqs("limit=50&scope=nonsense")).some((r) => r.source === "memory"), false, "an unrecognised scope falls back to client, not to all");

  // The memory page's own endpoint keeps working: same records, narrower door.
  const memTraffic = (await get("/api/memory/traffic?limit=50")).requests;
  assert.ok(memTraffic.some((r) => r.memoryFor?.purpose === "compact"), "/api/memory/traffic is unchanged");
});

test("a memory call records which client request caused it", async () => {
  const parent = await send({ "x-session-id": "scope-parent" });
  const parentId = parent.headers.get("x-filament-request-id");
  assert.ok(parentId, "the parent request has an id");
  /** @type {any[]} */
  const starts = [];
  const hear = (/** @type {any} */ e) => void (e.type === "start" && starts.push(e.record));
  app.usage.on("event", hear);
  await houseSend({ "user-agent": "filament-memory/0.1", "x-filament-memory-purpose": "learn", "x-filament-parent-request": parentId, "x-filament-job": "job-1", "x-session-id": "memory-2" });
  app.usage.off("event", hear);
  // (fails before: yes — HarnessV4_Tasks U3-11: the job was put on the record after its start was said, so a job that
  // sums its calls' records heard of a call only at its first byte, or not before its summary landed)
  assert.deepEqual(starts.map((r) => r.jobId), ["job-1"], "the record's start names its job");

  const all = await reqs("limit=50&scope=all");
  const child = all.find((r) => r.memoryFor?.parent === parentId);
  assert.ok(child, "the child names its parent — without this a compaction and its slices can only be matched by hand");
  assert.equal(child.parentRequest, parentId);
  assert.equal(child.jobId, "job-1", "and the job that was running it");
  const detail = await get(`/api/requests/${child.id}`);
  assert.equal(detail.parentRequest, parentId, "the drawer can link back too");
});

test("Filament's own calls keep their prompts out of the stored bodies until asked", async () => {
  // `storeBodies: "full"` is on for this whole file, so this is the rule doing the work, not the setting being off.
  await send({ "x-session-id": "body-client" });
  await houseSend({ "user-agent": "filament-memory/0.1", "x-filament-memory-purpose": "learn", "x-session-id": "memory-3" });

  const all = await reqs("limit=50&scope=all");
  const client = all.find((r) => r.clientSession === "body-client");
  const internal = all.find((r) => r.clientSession === "memory-3");
  const cd = await get(`/api/requests/${client.id}`);
  const id = await get(`/api/requests/${internal.id}`);

  assert.ok(cd.shapedBody || cd.inboundBody, "a client's body is still stored under storeBodies: full");
  assert.equal(id.shapedBody, undefined, "memory's learning PROMPT is your conversation text: not stored by default");
  assert.equal(id.inboundBody, undefined);
  assert.ok(/storeInternalBodies/.test(id.bodyWithheld || ""), `and the record says why, not just nothing: ${id.bodyWithheld}`);
  // `hasBodies` is a list-view field (publicRecord), which is what the drawer's body section keys off.
  assert.equal(internal.hasBodies, false, "so the drawer does not offer a body tab that is empty");
  assert.equal(client.hasBodies, true, "while a client's request still advertises its body");

  // Opt in, and it is stored — the knob has to actually work in both directions.
  app.config.observability.storeInternalBodies = true;
  await houseSend({ "user-agent": "filament-memory/0.1", "x-filament-memory-purpose": "learn", "x-session-id": "memory-4" });
  const withBody = (await reqs("limit=50&scope=all")).find((r) => r.clientSession === "memory-4");
  const wd = await get(`/api/requests/${withBody.id}`);
  assert.ok(wd.shapedBody || wd.inboundBody, "storeInternalBodies: true stores them");
  assert.equal(wd.bodyWithheld, undefined);
  app.config.observability.storeInternalBodies = false;
});

test("the money pages keep meaning 'your traffic' unless asked otherwise", async () => {
  const client = await get("/api/usage/summary?hours=1");
  const all = await get("/api/usage/summary?hours=1&scope=all");
  assert.ok(all.requests > client.requests, `scope=all counts memory's calls too (${all.requests} vs ${client.requests})`);
  const memOnly = await get("/api/usage/summary?hours=1&scope=memory");
  assert.equal(client.requests + memOnly.requests, all.requests, "the two scopes partition the whole, so nothing is double counted");

  // The daily rollups are the durable accounting and are deliberately NOT merged: the on-disk split has a stamped
  // migration marker, and folding memory in would redefine every historical total.
  const days = await get("/api/usage/days?limit=1");
  assert.ok(days.days, "the durable per-day store still answers");
  assert.equal(isMemoryRecord({ memoryFor: { purpose: "learn" } }), true, "the accounting predicate is untouched");
});

// app.js is browser-only and no test can import it, which is how a stray `${D}` once killed the Traffic drawer for
// every request while 420 tests passed. This is the seam that exists instead: read the source and pin the invariants
// the review found broken. It caught a real P1 — `(state.reqFilter ||= {}).tab = "memory"` built a PARTIAL filter, so
// `F.status` was undefined, the status ternary fell through to "pending only", and the Memory tab rendered empty while
// its dropdown still read "all statuses". One click from the Usage page, in any fresh session.
test("a source or purpose filter implies scope=all, so it can never silently return nothing", async () => {
  // `purpose` only exists on memory's own calls, so `?purpose=compact` inside the default client scope matched zero
  // rows and read as "there were no compaction calls" rather than "you asked for two contradictory things". An explicit scope
  // still wins, so `?scope=client&source=memory` stays honestly empty.
  const bySource = await reqs("limit=50&source=memory");
  assert.ok(bySource.length >= 1, `?source=memory with no scope finds them (${bySource.length})`);
  assert.ok(bySource.every((r) => r.source === "memory"), "and only them");
  const byPurpose = await reqs("limit=50&purpose=compact");
  assert.ok(byPurpose.length >= 1, `?purpose=compact with no scope finds the compaction calls (${byPurpose.length})`);
  const contradictory = await reqs("limit=50&scope=client&source=memory");
  assert.equal(contradictory.length, 0, "an explicit scope is respected even when it cannot match");
});

test("the dashboard reads the response shapes the server actually sends", () => {
  // app.js has no test seam, so a wrong key is silent: the Live tab read `(await api("/live")).live` while the
  // endpoint returns `{ active, agents }`, so it would have rendered "Nothing in flight" forever with every test green.
  // These assertions compare the two files as text, which is the only way to catch that class without a browser.
  const ui = uiSrc();
  // The routes are the table rows of http/admin/* (Phase 4.2); the seam reads them all.
  const srv = ["system", "traffic", "config", "upstreams", "memory"]
    .map((f) => readFileSync(new URL(`../src/http/admin/${f}.js`, import.meta.url), "utf8"))
    .join("\n");
  assert.ok(/"\/live",[\s\S]{0,200}active: nestLive\(usage\.live\(\)/.test(srv), "the server's /live answers with `active` (each request nested under its turn, R6)");
  assert.ok(/api\("\/live"\)\)\.active/.test(ui), "and the UI reads `active`, not some other key");
  assert.ok(!/api\("\/live"\)\)\.live\b/.test(ui), "no stale read of a `.live` key that does not exist");
  // Same discipline for the other two feeds the new tabs depend on.
  assert.ok(/"\/ops\?/.test(ui) && /"\/ops",/.test(srv), "the System tab's endpoint exists on both sides");
  assert.ok(/"\/acp\/status"/.test(ui) && /"\/acp\/status",/.test(srv), "and so does the Agents tab's");
  // (fails before: yes — the owner's rules of 10-31 took /trim, whose passes the Compactions tab listed)
  assert.ok(!/"\/trim\/passes/.test(ui) && !/"\/trim\/passes",/.test(srv), "no Compactions tab, and no route for it");
  // The Live tab's engine panel: pinned from BOTH ends, because this was the one Phase E deliverable that shipped
  // code-present but unobserved (no scratch had Mnemosyne installed, so `installed:false` and the section correctly
  // rendered nothing — which looks identical to a view that reads the wrong keys).
  assert.ok(/"\/jobs",/.test(srv), "the server has the cheap /jobs endpoint");
  const lvAt = ui.indexOf("function liveView");
  assert.ok(lvAt > 0, "found liveView");
  const lv = ui.slice(lvAt, lvAt + 4000);
  assert.ok(/api\("\/jobs"\)/.test(lv), "and the Live tab polls it");
  assert.ok(!/api\("\/memory\/status"\)/.test(lv), "not the heavy /memory/status, which runs nine archive COUNT(*) scans every 1.5 s");
  for (const f of ["eng.pending", "eng.calls", "eng.state"]) assert.ok(lv.includes(f), `the Live tab renders ${f}, which engineLive() supplies`);
  assert.ok(/calls in flight/.test(lv), "and labels the in-flight count in words, not just a number");
  // The WIRING, not just the endpoints. A tab's loader once was defined, its route worked, the e2e tests passed —
  // and nothing ever called it, so the tab rendered "No compactions yet" forever with 465 tests green.
  // A shape test cannot catch that; only asserting the loader is invoked can.
  const at = ui.indexOf("async function loadAll");
  assert.ok(at > 0, "found loadAll");
  const boot = ui.slice(at, at + 4000); // loadAll is long; a too-small window here would report a false failure
  for (const fn of ["loadRequests()", "loadOps()"]) {
    assert.ok(boot.includes(fn), `loadAll must call ${fn}, or the tab it feeds is permanently empty`);
  }
  // And the tab must actually consume what the loader stored.
  assert.ok(/state\.ops\b/.test(ui) && /opsTable\(/.test(ui), "the System tab reads state.ops");
});

// (fails before: yes — the owner's word of 11-05: a price card's maxConcurrency capped nothing, yet the catalogue showed
// it as the model's cap) No concurrency column: a model's agents at once is its row's, under its provider in Settings.
test("the Models catalogue carries no concurrency column; the health table shows each model's learned cap", () => {
  const ui = uiSrc();
  assert.ok(!ui.includes('"concurrency"'), "no catalogue header names the column");
  assert.ok(!ui.includes("max_concurrency"), "nothing reads a price card's cap");
  assert.ok(/hb\?\.ceilings\?\.length/.test(ui) && ui.includes("concurrent"), "the health table shows each model's learned concurrency cap");
  assert.ok(/Clear the cooldown and any learned concurrency cap/.test(ui), "reset forgets the learned cap, not only the cooldown");
});

test("Traffic's filter defaults cover every key the view reads, and nothing builds a partial filter", () => {
  const src = uiSrc();
  // Comments are stripped first: the rule is written down in a comment that quotes the forbidden pattern verbatim,
  // and a guard that trips over its own documentation is a guard nobody keeps.
  const code = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.equal(/\(state\.reqFilter \|\|= \{\}\)/.test(code), false, "no caller may build a partial reqFilter object; use setReqFilter()");
  const defaults = src.match(/const REQ_FILTER_DEFAULTS = \{([^}]*)\}/)?.[1];
  assert.ok(defaults, "REQ_FILTER_DEFAULTS is the one place the defaults are written down");
  const keys = new Set([...defaults.matchAll(/(\w+):/g)].map((m) => m[1]));
  const from = src.indexOf("export function requests");
  const to = src.indexOf("\nexport function ", from + 10);
  assert.ok(from > 0 && to > from, "found the Traffic view");
  const view = src.slice(from, to);
  assert.ok(view.includes("setReqFilter()"), "the view builds its filter through setReqFilter, so the defaults are merged");
  const used = new Set([...view.matchAll(/\bF\.(\w+)/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !keys.has(k));
  assert.deepEqual(missing, [], `views.requests reads F.${missing.join(", F.")} with no default, so it is undefined on a fresh session`);
  // Every tab that is NOT a list of model calls must be excluded from isRequestView, or it inherits the status,
  // upstream, source and grouping controls — which do nothing there. This is the assertion that catches a dropped
  // `&& !isLiveTab`: that edit was silently lost once and shipped the Live tab wearing the request filters.
  const ivLine = view.split("\n").find((l) => l.includes("const isRequestView"));
  assert.ok(ivLine, "isRequestView is defined once, not re-derived per control");
  for (const flag of ["isOpsTab", "isAgentsTab", "isLiveTab"]) {
    assert.ok(ivLine.includes(`!${flag}`), `isRequestView must exclude ${flag}, or that tab shows filters that do nothing`);
  }
  assert.ok(view.includes("isRequestView || isAllTab ? ["), "and the toolbar is driven by it rather than a hand-written list of tabs");
});

test("the drawer explains a withheld body instead of naming the wrong knob", () => {
  // The docs promise this. Before the fix the drawer said "Bodies not stored (observability.storeBodies)" even when
  // storeBodies was `full` and the real reason was storeInternalBodies — advice that changes nothing.
  const src = uiSrc();
  assert.ok(src.includes("d.bodyWithheld ||"), "the drawer renders the record's own reason");
  const at = src.indexOf("d.bodyWithheld ||");
  assert.ok(at > 0 && at > src.indexOf("function openRequest"), "and it is inside the request drawer, not only in a row tooltip");
});

test("the Agents tab renders agent operations as history, not only the live snapshot", () => {
  // `/api/acp/status` is a snapshot: it can say what is true right now but never what happened. The lifecycle
  // operations are the durable half, and agentsView is browser-only with no test seam — so a section that reads the
  // wrong key renders nothing and looks exactly like "no agent activity yet". This pins the keys against the shape
  // OpLog.record actually produces (kind/sub/level/title/detail/ref), which the e2e test in acp.test.js proves exists.
  const src = uiSrc();
  const from = src.indexOf("function agentsView");
  const to = src.indexOf("\nfunction ", from + 10);
  assert.ok(from > 0 && to > from, "found agentsView");
  const view = src.slice(from, to);
  assert.ok(view.includes('filter((o) => o.kind === "agent")'), "the section reads the agent operations out of state.ops");
  assert.ok(view.includes("state.ops"), "from the shared operation feed the SSE stream and loadOps both fill");
  for (const key of ["o.ts", "o.title", "o.sub", "o.level", "o.detail", "o.ref?.upstreamId"]) {
    assert.ok(view.includes(key), `agentsView renders \`${key}\`, a field OpLog.record actually sets`);
  }
  assert.ok(/Agent activity/.test(view), "and the section is titled, so it is findable on a long page");
  // The producer is only useful if the chip is not dimmed: `wired` comes from the server, so a kind the server has
  // not wired shows an honest "nothing emits this yet" chip instead of an empty list that looks like missing data.
  assert.ok(src.includes("state.opWired"), "the chip row knows which kinds have a producer");
  assert.ok(/class: `\$\{shownKinds\.has\(k\) \? "active" : ""\}\$\{wired \? "" : " unwired"\}`/.test(src), "and dims the ones that do not");
  // The tab holds two kinds of row, so the badge and the export both have to count both. A badge that counted only the
  // turns read "Agents · 3" on a tab showing nine rows, and Export handed back a file missing every permission
  // decision and process exit on screen — found in the browser, pinned here so it cannot quietly come back.
  const at = src.indexOf("const TAB_COUNTS");
  assert.ok(at > 0, "found the tab-count map");
  const counts = src.slice(at, at + 1200);
  assert.match(counts, /agents: all\.filter\(\(r\) => r\.acp\)\.length \+ \(state\.ops \|\| \[\]\)\.filter\(\(o\) => o\.kind === "agent"\)\.length/,
    "the Agents badge counts turns AND lifecycle events");
  assert.ok(/const agentRows = isAgentsTab/.test(src), "the Agents rows are merged for Export and Show-more");
  const vrAt = src.indexOf("const visRows");
  assert.ok(vrAt > 0, "found visRows");
  assert.ok(src.slice(vrAt, vrAt + 400).includes("isAgentsTab ? agentRows"), "and visRows actually uses the merged set, not the turns alone");
});
