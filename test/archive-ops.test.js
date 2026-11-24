// W9: archive-level operations as durable operations.
//
// Deletes, backups, restores and reindexes are methods on the long-lived MemoryService, so the recorder is a plain
// hook (`memory.onArchiveOp`) with no forwarder — unlike the learner and the engine, which are rebuilt. The import path
// is deliberately not covered here: it already runs as a `job` op via startJob, and recording it twice would put one
// import on the System tab twice.
//
// It is a NEW file rather than an append, for the same reason as the other three: appends have been silently reverted
// mid-run twice tonight, and a mutation test that passes against a file that no longer contains the test proves nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "../src/memory-service.js";
import { WIRED_OP_KINDS, DEFAULT_OP_KINDS } from "../src/ops.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

// Distinctive strings that must never reach a durable operation: a session title and a project name are user-authored.
const TITLE = "The login crash investigation notes";
const PROJECT = "payments-migration";
const FORBIDDEN = [TITLE, PROJECT];

let dir;
const services = []; // every MemoryService this file opens, so a failed assertion can never strand one (an open archive hangs the process)
before(() => { dir = mkdtempSync(join(tmpdir(), "filament-archiveops-")); });
after(async () => { for (const x of services) { try { await x.shutdown(); } catch {} } rmSync(dir, { recursive: true, force: true }); });

// A real MemoryService over a real archive, memory enabled, no engine (no Mnemosyne install in the temp dir).
const svc = () => {
  const s = new MemoryService({ getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem-" + Math.random().toString(36).slice(2, 8)), backups: { enabled: true, folder: join(dir, "backups-" + Math.random().toString(36).slice(2, 8)), keep: 3 } } }), dataDir: dir, log: () => {} });
  const seen = [];
  s.onArchiveOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  s.start();
  services.push(s);
  return { s, seen };
};
const seedChain = (s) => {
  const ch = s.archive.chainForKey("k1", { cwd: `C:\\proj\\${PROJECT}`, client: "claude-code", model: "m" });
  const t = s.archive.beginTurn(ch.id, { requestId: "r1", userMessage: { role: "user", content: "sort the login crash" } });
  s.archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "guarded the null" }, requestId: "r1", outputChars: 40 });
  return ch;
};

test("deleting a session records a warn-level op with counts and the id, and no user text", async () => {
  const { s, seen } = svc();
  const ch = seedChain(s);
  s.archive.setTitle(ch.id, TITLE);
  const r = await s.deleteSession(ch.id);
  assert.ok(r, "the delete itself still works");
  const op = seen.find((o) => o.sub === "delete-chain");
  assert.ok(op, `the delete is recorded: ${seen.map((o) => o.sub).join(" → ")}`);
  assert.equal(op.level, "warn", "destructive operations are warnings, so the badge counts them");
  assert.equal(op.detail.chainId, ch.id);
  assert.equal(typeof op.detail.turns, "number");
  assert.equal(op.ref.chainId, ch.id, "linked to the session it deleted");
  const flat = JSON.stringify(seen);
  for (const bad of FORBIDDEN) assert.ok(!flat.includes(bad), `no user-authored text ("${bad}") in the durable op`);
  await s.shutdown();
});

test("deleting a project records every session it took down", async () => {
  const { s, seen } = svc();
  const ch = seedChain(s);
  const projectId = ch.project_id || s.archive.getChain(ch.id)?.project_id;
  const r = await s.deleteProject(projectId);
  assert.ok(r, "the delete itself still works");
  const op = seen.find((o) => o.sub === "delete-project");
  assert.ok(op, "the project delete is recorded");
  assert.equal(op.level, "warn", "the most destructive archive operation is a warning");
  assert.equal(typeof op.detail.chains, "number", "and says how many sessions went with it");
  assert.ok(!JSON.stringify(seen).includes(PROJECT), "without the project name — it is user-authored");
  await s.shutdown();
});

// (fails before: yes — the bug hunt of 10-30, SUB-6: nothing outside the archive heard which sessions a delete took, so
// the sub-agent registry kept theirs)
test("a deleted session with the team beside it, and a deleted project's sessions, are named to onSessionsDeleted; a hook that throws breaks no delete", async () => {
  const { s } = svc();
  /** @type {string[][]} */
  const heard = [];
  s.onSessionsDeleted = (ids) => heard.push(ids);
  const ch = seedChain(s);
  const team = s.archive.chainForKey("k-team", { cwd: `C:\\proj\\${PROJECT}`, client: "claude-code", model: "m" });
  s.archive.link(team.id, ch.id, "beside", 1);
  await s.deleteSession(ch.id);
  assert.deepEqual(heard, [[ch.id, team.id]], "the chat and the team beside it");
  const two = seedChain(s);
  await s.deleteProject(s.archive.getChain(two.id)?.project_id);
  assert.deepEqual(heard[1], [two.id], "every session of the project");
  s.onSessionsDeleted = () => { throw new Error("disk on fire"); };
  const three = seedChain(s);
  assert.ok(await s.deleteSession(three.id), "the delete completed though the hook threw");
  await s.shutdown();
});

test("a backup and a restore are both durable, with counts and durations", async () => {
  const { s, seen } = svc();
  seedChain(s);
  const b = await s.backup();
  assert.ok(b && b.bytes >= 0, "the backup ran");
  const bop = seen.find((o) => o.sub === "backup" && o.level !== "error");
  assert.ok(bop, "a successful backup is recorded");
  assert.ok(typeof bop.ms === "number" && bop.ms >= 0, "with how long it took");
  assert.equal(typeof bop.detail.bytes, "number");
  assert.ok(bop.detail.files >= 1, `at least the archive database: ${JSON.stringify(bop.detail)}`);

  const before = seen.length;
  const out = await s.restore(b.dir);
  const rop = seen.slice(before).find((o) => o.sub === "restore");
  assert.ok(rop, "the restore is recorded too — it replaces the live databases, so it should be durable and dated");
  assert.equal(rop.level, "warn", "and it is a warning, because it overwrites the live data");
  assert.equal(typeof rop.ms, "number");
  await s.shutdown();
});

test("a reindex with no engine records the failure at level error, not a silent no-op", async () => {
  const { s, seen } = svc();
  seedChain(s);
  // No engine is installed in the temp folder, so store is null and the reindex cannot run.
  await s.reindex().then(() => { throw new Error("should have failed"); }, () => {});
  const op = seen.find((o) => o.sub === "reindex");
  assert.ok(op, "the attempted reindex is recorded");
  assert.equal(op.level, "error", "a reindex that cannot run is an error, so it reaches the badge");
  assert.ok(op.detail.error, "with the reason");
  await s.shutdown();
});

test("a throwing recorder cannot break an archive operation, and no recorder is fine", async () => {
  const { s } = svc();
  s.onArchiveOp = () => { throw new Error("disk on fire"); };
  const ch = seedChain(s);
  const r = await s.deleteSession(ch.id); // must not throw
  assert.ok(r, "the delete completed even though the recorder threw");
  await s.shutdown();

  const { s: s2 } = svc(); // no onArchiveOp at all
  const ch2 = seedChain(s2);
  const r2 = await s2.deleteSession(ch2.id);
  assert.ok(r2, "and with observability off entirely, the archive operation is identical");
  await s2.shutdown();
});

// ------------------------------------------------------------------ through the server
let app, port, srvDir;
before(async () => {
  srvDir = mkdtempSync(join(tmpdir(), "filament-archiveops-srv-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  writeFileSync(join(srvDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir: srvDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(srvDir, { recursive: true, force: true }); });

test("the server injects the archive recorder, and calling it lands as an `archive` operation", async () => {
  assert.equal(typeof app.memory.onArchiveOp, "function", "the memory service was given a recorder for archive operations");
  // (fails before: yes — the bug hunt of 10-30, SUB-6)
  assert.equal(typeof app.memory.onSessionsDeleted, "function", "and the sub-agent registry hears which sessions a delete took");
  assert.ok(WIRED_OP_KINDS.includes("archive"), "`archive` is declared wired, so its chip is not dimmed");
  assert.ok(DEFAULT_OP_KINDS.includes("archive"), "and shown by default");

  app.memory.onArchiveOp("memory backed up (48 KB, 3 file(s))", { sub: "backup", ms: 1200, detail: { bytes: 49152, files: 3, reason: "manual" } });
  await new Promise((r) => setTimeout(r, 80));
  const j = await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=50&kinds=archive`, { headers: { "content-type": "application/json", "x-api-key": "k" } })).json();
  const op = (j.ops || []).find((o) => o.kind === "archive");
  assert.ok(op, `the recorded operation is retrievable: ${JSON.stringify((j.ops || []).map((o) => o.title)).slice(0, 200)}`);
  assert.equal(op.sub, "backup");
  assert.equal(op.detail.bytes, 49152);
  assert.ok((j.wired || []).includes("archive"), "and the API tells the UI it is wired");
  await app.ops.flush();
  const onDisk = existsSync(join(srvDir, "ops.jsonl")) ? readFileSync(join(srvDir, "ops.jsonl"), "utf8") : "";
  assert.ok(/"kind":"archive"/.test(onDisk), "an archive operation persists");
});
