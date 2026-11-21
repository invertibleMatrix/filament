// @ts-check
// The golden wire corpus. Every case in fixtures/golden/cases.js runs through a real Filament against scripted fake
// upstreams; for each step the harness captures (1) what the client got back, (2) what every upstream received and
// (3) the records Filament wrote, strips the volatile parts (ids, times, ports, paths) and compares the result with
// fixtures/golden/expected/<profile>.<case>.json. Behaviour-preserving work leaves every file byte-identical;
// `UPDATE_GOLDEN=1 npm test` regenerates them and the resulting diff is what a reviewer reads.
// The normaliser itself is tested: each profile runs twice on fresh processes and ports and must capture the same.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startApp, fakeUpstream, parseSse, FIXTURES } from "./helpers/app.js";
import { profiles, cases } from "./fixtures/golden/cases.js";

const EXPECTED_DIR = join(FIXTURES, "golden", "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";
mkdirSync(EXPECTED_DIR, { recursive: true });

// ---- one profile = one Filament + its fakes ---------------------------------------------------------------------------
async function bootProfile(name) {
  const p = profiles[name];
  const fakes = {};
  const urls = {};
  for (const [id, mk] of Object.entries(p.fakes)) {
    fakes[id] = await fakeUpstream(mk());
    urls[id] = fakes[id].url;
  }
  const app = await startApp({
    memory: p.memory,
    summarizer: p.summarizer || "",
    configure: (cfg, ctx) => p.configure(cfg, urls, ctx),
  });
  return {
    name,
    app,
    fakes,
    urls,
    dataDir: app.dataDir,
    async stop() {
      await app.stop();
      for (const f of Object.values(fakes)) await f.close();
    },
  };
}

const ALL = "/api/requests?limit=300&scope=all";
// Records finish a little after the reply (memory's bookkeeping is asynchronous): wait until none is pending and
// the list has been the same three polls in a row.
async function settledRecords(app, sinceIds) {
  let last = null,
    same = 0;
  for (let i = 0; i < 80; i++) {
    const list = (await (await app.api(ALL)).json()).requests.filter((r) => !sinceIds.has(r.id));
    const pending = list.some((r) => r.status === "pending");
    const snap = JSON.stringify(list);
    same = !pending && snap === last ? same + 1 : 0;
    if (same >= 2) return list;
    last = snap;
    await new Promise((r) => setTimeout(r, 30));
  }
  return (await (await app.api(ALL)).json()).requests.filter((r) => !sinceIds.has(r.id));
}

const VOLATILE_RESPONSE_HEADERS = new Set([
  "date",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
]);
const VOLATILE_UPSTREAM_HEADERS = new Set(["host", "content-length", "connection"]);
const pickHeaders = (h, drop) => {
  const out = {};
  for (const [k, v] of Object.entries(h)) if (!drop.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  return sortKeys(out);
};
const tryJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

async function runStep(env, step) {
  const before = new Set((await (await env.app.api(ALL)).json()).requests.map((r) => r.id));
  const marks = Object.fromEntries(Object.entries(env.fakes).map(([id, f]) => [id, f.received.length]));
  let res;
  if (step.run) {
    // A scripted flow (a native session's create + turns, say): the step drives the app itself and returns the
    // reply that stands for it; the records and upstream calls around it are captured exactly as around a post.
    const out = await step.run(env);
    res = { status: out?.status ?? 200, headers: new Map(), text: async () => JSON.stringify(out?.body ?? null), headersGet: () => "application/json" };
  } else if (step.get) {
    res = await env.app.api(step.get, { headers: step.headers || {} });
  } else {
    res = await env.app.post(step.post, step.body, step.headers || {});
  }
  const text = await res.text();
  const ct = step.run ? "application/json" : res.headers.get("content-type") || "";
  const back = {
    status: res.status,
    headers: step.run ? {} : pickHeaders(Object.fromEntries(res.headers.entries()), VOLATILE_RESPONSE_HEADERS),
    body: ct.includes("text/event-stream") ? parseSse(text) : tryJson(text),
  };
  const list = await settledRecords(env.app, before);
  const records = [];
  for (const r of list.sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : String(a.model).localeCompare(String(b.model)),
  ))
    records.push(await env.app.record(r.id));
  const upstream = {};
  for (const [id, f] of Object.entries(env.fakes)) {
    // Upstream model listings are a background cache refresh (startup, TTL), not part of any step's wire.
    const calls = f.received
      .slice(marks[id])
      .filter((c) => c.kind !== "models")
      .map((c) => ({
        method: c.method,
        path: c.path,
        headers: pickHeaders(c.headers, VOLATILE_UPSTREAM_HEADERS),
        body: c.body,
      }));
    if (calls.length) upstream[id] = calls;
  }
  return {
    request: step.run
      ? { method: "RUN", path: step.name || "run" }
      : step.get
        ? { method: "GET", path: step.get, headers: step.headers || {} }
        : { method: "POST", path: step.post, headers: step.headers || {}, body: step.body },
    back,
    upstream,
    records,
  };
}

// ---- the normaliser ----------------------------------------------------------------------------------------------------
// Two kinds of volatility: values that are volatile by their key (times, durations, throughput) and tokens that are
// volatile by construction (record ids, session ids, ports, temp paths). The first is a key list; the second is a
// token table built from the run itself, numbered in order of first appearance so the same run shape yields the same
// placeholders. Every mask below fires on at least one case; a mask nothing needs is a blind spot (whatever it would
// match is invisible), so a mask is added with the case that needs it, never in advance.
// Measured durations and clocks are volatile by their key. Knobs that merely end in Ms (timeoutMs, heartbeatMs,
// windowMs…) are settings, not measurements, and stay.
const VOLATILE_KEYS =
  /^(ts|at|created|created_at|createdAt|startedAt|finishedAt|endedAt|updatedAt|lastAt|last_at|first_at|firstAt|firstByte|firstByteAt|handed|hashAt|userTextAt|ms|totalMs|ttftMs|durationMs|elapsedMs|latencyMs|waitMs|waitedMs|queueMs|firstByteMs|afterMs|blockingMs|streamMs|apiMs|wallMs|toolMs|engineMs|sinceOutputMs|cooldownLeftMs|tokensPerSec|tps|outTps|speed|uptimeMs|uptime|t0|t1|_t0|seq|pid|since|expiresAt|lastSeen|when|time|elapsed|duration|latency|mtimeMs)$/;
const LOCAL_IDS = /\b(msg_filament_|chatcmpl-filament-|resp_filament_)[a-z0-9]+/g;
// The Responses bridge mints its own ids from the clock and randomness.
const RESPONSES_IDS = /\b(resp_|msg_)(?!fake\b)[a-z0-9]{20,}\b/g;
// Trim jobs and memory's own calls are named from the clock (`trim-<base36 time>`, `memory-<base36 time>`).
const CLOCK_NAMES = /\b(trim|memory)-[a-z0-9]{8}\b/g;
// `/cost` prints wall-clock durations to one decimal.
const COST_DURATION = /(Total duration \((?:API|wall)\):\s+)\d+(?:\.\d+)?s/g;
// …and how long ago the last request was, on its prompt-cache line: a tenth of a second apart under load.
const CACHE_IDLE = /(last activity )\d+(?:\.\d+)?s( ago)/g;
// Record ids are masked through the token table (every record the run produced is known); one that reaches a reply
// without a record behind it is a leak the self-test must see, so there is no catch-all pattern for them.
const PORT = /(127\.0\.0\.1|localhost):\d{2,5}/g;
// Agent session ids are the agent's (random); the conversation key hashes the temp cwd.
const AGENT_SESSION = /\bsess_[a-z0-9]+/g;
const CONV_HASH = /\b(conversation) [0-9a-f]{16}\b/g;

function buildTokens(env, steps) {
  const tokens = new Map();
  const add = (s, placeholder) => {
    if (s && !tokens.has(s)) tokens.set(s, placeholder);
  };
  add(env.app.url, "<app>");
  for (const [id, u] of Object.entries(env.urls)) add(u, `<fake:${id}>`);
  add(env.dataDir, "<dataDir>");
  add(env.dataDir.replace(/\\/g, "/"), "<dataDir>");
  add(env.dataDir.replace(/\\/g, "\\\\"), "<dataDir>");
  // Git Bash's spelling, which the Environment section gives beside Windows' (C:\x is /c/x — HarnessV3-Tools TL-D1).
  add(env.dataDir.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, "/"), "<dataDir>");
  let rec = 0,
    chain = 0;
  for (const s of steps)
    for (const r of s.records) {
      add(r.id, `<rec:${++rec}>`);
      for (const c of [r.memory?.chain, r.memory?.chainId, r.memory?.trim?.chain, r.project, r.memory?.project].filter(Boolean))
        if (!tokens.has(c)) add(c, `<chain:${++chain}>`);
    }
  return [...tokens.entries()].sort((a, b) => b[0].length - a[0].length);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function normaliseString(s, tokens) {
  let out = s;
  for (const [from, to] of tokens) if (out.includes(from)) out = out.split(from).join(to);
  return out
    .replace(LOCAL_IDS, "$1<id>")
    .replace(PORT, "$1:<port>")
    .replace(AGENT_SESSION, "sess_<id>")
    .replace(CONV_HASH, "$1 <hash>")
    .replace(RESPONSES_IDS, "$1<id>")
    .replace(COST_DURATION, "$1<s>")
    .replace(CACHE_IDLE, "$1<s>$2")
    .replace(CLOCK_NAMES, "$1-<id>");
}
// Key order is part of the wire: what the client and the provider receive is pinned as serialised (`sort: false`).
// A record is Filament's own object, read by field name, so its keys are sorted and only its fields and values count —
// otherwise one definition of the record's shape (a Phase 3 step) would rewrite every golden for nothing.
const THROUGHPUT_KEYS = /^(tps|outTps|tokensPerSec)$/;
// A clock object (a session turn's `view.timing`, BUG-19): every number in it is a measurement; its keys — which
// phases a turn has — and a null (no page stamp) are the contract and stay.
const CLOCK_OBJECTS = /^(timing)$/;
const clockMasked = (/** @type {any} */ v) =>
  typeof v === "number" ? "<n>" : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, clockMasked(v[k])])) : v;
function normalise(value, tokens, key = "", sort = true) {
  if (CLOCK_OBJECTS.test(key) && value && typeof value === "object" && !Array.isArray(value)) return clockMasked(value);
  if (typeof value === "string") return normaliseString(value, tokens);
  if (typeof value === "number") return VOLATILE_KEYS.test(key) ? "<n>" : value;
  if (Array.isArray(value)) return value.map((v) => normalise(v, tokens, key, sort));
  if (value && typeof value === "object") {
    const out = {};
    // A reply Filament wrote itself (input 0): its output count is an estimate over text that embeds run-specific
    // ids — replaced here, but the estimate ran on the raw text, so the number is unstable by construction. A
    // pinned 0 stays pinned (nothing was estimated).
    const selfWritten = key === "usage" && value.input_tokens === 0 && value.output_tokens !== 0;
    for (const k of sort ? Object.keys(value).sort() : Object.keys(value))
      out[k] =
        selfWritten && k === "output_tokens" && typeof value[k] === "number"
          ? "<n>"
          : // The prompt and tools beside a session's history (HarnessV3-Launch LD-D17) are estimated over the loop's
            // system prompt, whose Environment section names the run's temp folder three ways: the same kind of
            // estimate, unstable by construction. A 0 stays pinned (nothing rides beside the history).
            k === "fixedTokens" && typeof value[k] === "number" && value[k] > 0
            ? "<n>"
          : // A throughput rating is null or a number by the clock alone (computeTps rates nothing under 200 ms): a
            // fast fake turn sits on that line, and a loaded machine tips it over (BUG-24) — both read the same.
            THROUGHPUT_KEYS.test(k) && (value[k] === null || typeof value[k] === "number")
            ? "<n>"
          : VOLATILE_KEYS.test(k) && typeof value[k] !== "object"
          ? typeof value[k] === "number"
            ? "<n>"
            : typeof value[k] === "string"
              ? "<t>"
              : value[k]
          : normalise(value[k], tokens, k, sort);
    return out;
  }
  return value;
}
const normaliseStep = (s, tokens) => ({
  request: normalise(s.request, tokens, "", false),
  back: normalise(s.back, tokens, "", false),
  upstream: normalise(s.upstream, tokens, "", false),
  records: normalise(s.records, tokens),
});
function sortKeys(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

// ---- the run -------------------------------------------------------------------------------------------------------------
async function captureProfile(profileName) {
  const env = await bootProfile(profileName);
  const out = {};
  try {
    for (const c of cases.filter((c) => c.profile === profileName)) {
      const steps = [];
      for (const step of c.steps) steps.push(await runStep(env, step));
      const tokens = buildTokens(env, steps);
      out[c.name] = steps.map((s) => normaliseStep(s, tokens));
    }
  } finally {
    await env.stop();
  }
  return out;
}

const expectedPath = (profile, name) => join(EXPECTED_DIR, `${profile}.${name}.json`);
const stable = (v) => JSON.stringify(v, null, 2) + "\n";

// (fails before: yes — the expected files of two cases removed with the request path's auto-fit ladder outlived them,
// holding records in a shape no build writes now; HarnessV3-AtHome AH-C1)
test("golden: every expected file belongs to a case", () => {
  const known = new Set(cases.map((c) => `${c.profile}.${c.name}.json`));
  const orphans = readdirSync(EXPECTED_DIR).filter((f) => !/\.(?:actual|run1|run2)\.json$/.test(f) && !known.has(f));
  assert.deepEqual(orphans, []);
});

for (const profileName of Object.keys(profiles)) {
  describe(`golden: ${profileName}`, () => {
    let run1 = null,
      run2 = null;
    before(async () => {
      run1 = await captureProfile(profileName);
      run2 = await captureProfile(profileName);
    });

    test("the normaliser removes every volatile part (two fresh runs capture the same)", () => {
      for (const name of Object.keys(run1)) {
        const a = stable(run1[name]),
          b = stable(run2[name]);
        if (a !== b) {
          writeFileSync(join(EXPECTED_DIR, `${profileName}.${name}.run1.json`), a);
          writeFileSync(join(EXPECTED_DIR, `${profileName}.${name}.run2.json`), b);
          assert.fail(
            `${profileName}.${name}: two runs differ — a volatile field escaped the normaliser (see *.run1.json / *.run2.json)`,
          );
        }
      }
    });

    for (const c of cases.filter((c) => c.profile === profileName)) {
      test(`${c.name} matches its golden`, () => {
        const actual = stable(run1[c.name]);
        const file = expectedPath(profileName, c.name);
        const actualFile = file.replace(/\.json$/, ".actual.json");
        if (UPDATE) {
          writeFileSync(file, actual);
          if (existsSync(actualFile)) rmSync(actualFile);
          return;
        }
        if (!existsSync(file)) {
          // A case with no fixture must not write its own and pass vacuously — new cases are accepted by hand
          // (UPDATE_GOLDEN=1), the way changed ones are.
          assert.fail(`${profileName}.${c.name}: no golden fixture — run with UPDATE_GOLDEN=1 to create it`);
        }
        const expected = readFileSync(file, "utf8");
        if (actual !== expected) {
          writeFileSync(actualFile, actual);
          assert.fail(
            `${profileName}.${c.name}: capture differs from ${file} — compare with ${actualFile}; if the change is intended, rerun with UPDATE_GOLDEN=1`,
          );
        }
        if (existsSync(actualFile)) rmSync(actualFile);
      });
    }
  });
}
