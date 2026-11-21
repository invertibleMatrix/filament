// @ts-check
// The sidebar's poll held the browser's connections (BUG-14/15/19, 2026-09-30). Every 5 s it asked for the full
// request record of each listed run it had no session for — hundreds of KB each, ~25 at once — and a run whose record
// had left the in-memory ring answered 404 and was asked again on every poll, forever. With the page's long-lived
// streams (events, the session's live topic, a running turn's reply and run) holding four of the browser's six
// connections per host, the rest waited: a steer typed mid-turn reached the server 30–60 s late, a sub-agent window
// stayed on "Loading…". A run now says its session in its own meta, and the sidebar reads it from the runs list it
// already polls: no record is fetched for a run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let root;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-sidebar-"));
  up = await fakeUpstream(async () => anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "Nothing to do." }], usage: { input_tokens: 30, output_tokens: 7 } }));
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, root]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test("an agent turn's run names its session in its meta — the same chain as its record", async () => {
  const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 200, stream: false, messages: [{ role: "user", content: "hello" }] }, { "x-filament-cwd": root, "x-session-id": "sidebar-1" });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String(r.headers.get("x-filament-request-id"));
  const rec = await shim.record(id);
  assert.ok(rec.memory?.chain, "the turn has a session");
  const { runs } = await (await shim.api("/api/runs?limit=10")).json();
  const run = (runs || []).find((/** @type {any} */ x) => x.id === id);
  assert.ok(run, "the run is listed");
  assert.equal(run.meta?.chain, rec.memory.chain, "the sidebar can read the session off the runs list");
});

// (fails before: yes — a run whose meta named no session had its record fetched, three at a time, retried with backoff)
test("the sidebar reads each run's session from the runs list alone: no record is fetched for a run", () => {
  const src = readFileSync("src/ui/harness/sidebar.js", "utf8");
  assert.match(src, /run\.meta\?\.chain/, "the run's own meta");
  assert.doesNotMatch(src, /\/requests\//, "no record fetch");
  assert.doesNotMatch(src, /chainOfRun|runRetry/);
  assert.doesNotMatch(readFileSync("src/ui/harness/state.js", "utf8"), /runRetry/);
});

// (fails before: yes — a failed load wrote its words once, and the next redraw, a run's or a holder's within seconds,
// replaced them with "no open projects": an archive another build wrote left the sidebar silent)
test("the sidebar keeps a failed load's words in place of the tree until a load succeeds", () => {
  const src = readFileSync("src/ui/harness/sidebar.js", "utf8");
  // The list is drawn in place (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost): what a
  // draw puts in it is `listNodes`'s, the failure first of all it holds.
  assert.match(src, /function drawLists\(\) \{\s*atWorkParts\.clear\(\);\s*morphChildren\(list, listNodes\(\)\);/, "a draw is the list's nodes, drawn in place");
  const nodes = src.slice(src.indexOf("  function listNodes() {"));
  assert.match(nodes, /^  function listNodes\(\) \{[^]*?if \(loadFailed\) return \[h\("div", \{ class: "muted pad" \}, loadFailed\)\];\s*const sessions = shownSessions\(\);/, "a draw says the failure before anything of the list");
  assert.match(src, /loadFailed = `the sessions list failed: \$\{/, "a failed load is kept");
  assert.match(src, /loadFailed = null;\s*draw\(\);\s*cb\.onChanged\(\);/, "a load that succeeds clears it");
});

test("the console's api errors carry the HTTP status: a caller tells \"not there\" (404) from \"not reachable now\"", async () => {
  const { createApi } = await import("../src/ui/lib/api.js");
  const stub = (/** @type {number} */ status) => createApi({ fetchImpl: async () => ({ ok: status < 400, status, statusText: `S${status}`, json: async () => ({ error: "nope" }) }) });
  await assert.rejects(() => stub(404)("/requests/x"), (e) => /** @type {any} */ (e).status === 404, "the error carries the status");
  await assert.rejects(() => stub(503)("/requests/x"), (e) => /** @type {any} */ (e).status === 503);
});
