import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Archive } from "../src/services/memory/archive.js";
import { messageHash } from "../src/services/memory/brain.js";
import { projectIdOf } from "../src/core/project-id.js";
import { benchBrain, replay } from "../scripts/memory-bench.mjs";

const BENCH = fileURLToPath(new URL("../scripts/memory-bench.mjs", import.meta.url));
const FACT = "The staging server runs in eu-west-2 behind the api-gateway.";
const ASK = "which region does the staging server run in, and what sits in front of it?";

/**
 * A Filament data folder whose archive holds one project's confirmed fact and one session of `turns` (the person's
 * words and the reply), as a live run left it: the session's briefing stored, and a block kept on each of its messages.
 * Nothing is encrypted (no secret.key), as an archive with encryption off.
 * @param {[string, string][]} turns
 */
function seeded(turns) {
  const dir = mkdtempSync(join(tmpdir(), "filament-bench-"));
  const cwd = join(dir, "acme");
  mkdirSync(cwd);
  mkdirSync(join(dir, "memory"));
  const archive = new Archive({ file: join(dir, "memory", "archive.db") });
  try {
    const chain = archive.chainForKey("h:bench-seed", { cwd, client: "claude-code", model: "claude-x" });
    archive.items.add({ projectId: projectIdOf(cwd), kind: "fact", text: FACT, status: "confirmed" });
    for (const [text, reply] of turns) {
      const user = { role: "user", content: text };
      const t = archive.beginTurn(chain.id, { userMessage: user, model: "claude-x", client: "claude-code" });
      archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: reply }] } });
      // What the live run kept: replayed under this session's own key, these are placed again and nothing is looked up.
      archive.setBlock(chain.id, messageHash(user), "<memory>an old block</memory>");
    }
    archive.setBriefing(chain.id, "<memory>an old briefing</memory>");
  } finally {
    archive.close();
  }
  return dir;
}

/** The bench's total row, from its output: turns, injected, used. @param {string} out */
function totals(out) {
  const row = out.split("\n").find((l) => /^total\b/.test(l));
  assert.ok(row, `the bench printed its total row:\n${out}`);
  const [turns, injected, used] = row.trim().split(/\s+/).slice(1, 4).map(Number);
  return { turns, injected, used };
}

// (fails before: yes — the bench did not start: it imported `enginePython`, which the engine's module no longer has;
// its brain was built with no `enabled: true`, which is memory off, so every turn came back silent and it reported 0
// injected whatever the archive held; and it replayed under each session's own key, so what the live run stored was
// placed again and no lookup of today's brain was counted)
test("the replay bench's brain is on: a seeded archive's session replays with what memory finds injected, and used by its reply", () => {
  const dir = seeded([
    [ASK, FACT],
    ["good — now let's look at how we deploy it", "Sure — where do you want to start?"],
  ]);
  try {
    const r = spawnSync(process.execPath, [BENCH, "--data-dir", dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 sessions, 2 turns, engine off/);
    const t = totals(r.stdout);
    assert.equal(t.turns, 2);
    assert.ok(t.injected > 0, `the brain injected what it found:\n${r.stdout}`);
    assert.ok(t.used > 0, `the reply that followed used it:\n${r.stdout}`);
    assert.match(r.stdout, /briefings: 1 /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — a dry run keeps nothing on the session, so each of its turns built the briefing again, a turn's
// lookup served again what the briefing had shown, where a live session's skips it, and under a key of its own the
// session was no longer the one being worked in: its own turns, the replies judged among them, were recalled to it as
// a past session's words)
test("a replayed session is briefed once, as a live one is, never recalled its own turns, and no later turn's lookup serves again what its briefing showed", async () => {
  const dir = seeded([
    [ASK, FACT],
    [`again: ${ASK}`, FACT],
    [`once more, ${ASK}`, FACT],
  ]);
  const archive = new Archive({ file: join(dir, "memory", "archive.db") });
  const brain = benchBrain({ archive });
  try {
    assert.equal(brain.cfg().off, false, "memory is on in the bench's brain");
    const { totals: t } = await replay({ archive, brain });
    assert.equal(t.turns, 3);
    assert.equal(t.briefings, 1, "the briefing is built on the session's first turn alone");
    assert.equal(t.injected, 1, "the fact alone is injected, by the briefing: no turn's lookup recalls the session's own words");
    assert.equal(t.used, 1, "the fact rides the briefing, no turn's lookup serves it again, and no reply is recalled to its own session");
  } finally {
    brain.stop();
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
