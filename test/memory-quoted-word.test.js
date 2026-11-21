// The person's words an agent quoted (origin `capture`, the memory plan's d1) are the user's word wherever memory weighs
// one (d3): the briefing's rules, the dossier's pool, the engine copy's pin, a merge's survivor, the curator's retire
// (`userBacked`) and a learned value in its slot. An older quote of theirs never replaces their newer way; `@mem
// procedure` keeps the steps on the lines under it (d3's review).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { mirrorArgs } from "../src/services/memory/outbox.js";
import { survivorOrder } from "../src/services/memory/curator.js";
import { userBacked } from "../src/services/memory/brain.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { world } from "./fixtures/memory-world.mjs";

/** An archive in a temp folder, closed and removed whatever the body does. @param {(file: string) => void} body */
function inFolder(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-quoted-"));
  try {
    body(join(dir, "archive.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// (fails before: yes, each line — `capture` was not the user's word in curator.js, outbox.js, archive.js or brain.js)
test("the person's quoted words win a merge over a learned claim, their engine copy is pinned and stated, a decision of theirs earns the dossier, and the curator asks before retiring them", () =>
  inFolder((file) => {
    const c = (/** @type {any} */ o) => ({ id: o.id, created_at: o.id, origin: "learner", status: "inferred", ...o });
    assert.equal([c({ id: 1 }), c({ id: 2, origin: "capture" })].sort((x, y) => survivorOrder(x, y, new Map()))[0].id, 2, "a merge keeps the user's quoted words over an older learned claim");
    const copy = (/** @type {string} */ origin) => mirrorArgs({ id: 7, kind: "preference", text: "Tabs over spaces.", origin, status: "inferred" });
    assert.deepEqual([copy("capture").pin, copy("capture").veracity], [true, "stated"]);
    assert.deepEqual([copy("model").pin, copy("model").veracity], [false, "inferred"], "a model's note is neither");
    assert.equal(userBacked({ origin: "capture", status: "inferred" }), true, "the curator asks the user before retiring it, and a suspicion never lowers it");
    assert.equal(userBacked({ origin: "learner", status: "inferred" }), false);
    const a = new Archive({ file, key: null });
    try {
      const theirs = a.items.add({ projectId: "p", kind: "decision", text: "We deploy from the release branch only.", origin: "capture", quoted: { quote: "we deploy from the release branch only", turn: 1, by: "model" } }).id;
      a.items.add({ projectId: "p", kind: "decision", text: "The cache sits in front of the API.", origin: "learner" });
      const rule = a.items.add({ projectId: "p", kind: "rule", text: "Never force-push to main.", origin: "capture" }).id;
      const pool = a.items.dossierPool("p").map((/** @type {any} */ r) => r.id);
      assert.deepEqual(pool, [theirs], "their decision earns a place unsaid again, a learned one not yet, and their rule is left to the briefing's rules");
      assert.ok(!pool.includes(rule));
    } finally {
      a.close();
    }
  }));

// (fails before: yes — the learned value superseded the user's quoted one)
test("a learned value never replaces the person's quoted words in its slot", () =>
  world({}, async (w) => {
    const s = w.session("s-slot");
    const { prep } = await s.send("we use bun for installs in this repo, not npm");
    const theirs = await w.svc.brain.remember("The project installs with bun.", { kind: "fact", projectId: prep.project, chainId: prep.chain, turnId: prep.turn, by: "model", quote: "we use bun for installs in this repo" });
    assert.equal(theirs.heard, true);
    const slot = { slot: "project · package manager", value: "bun", multi: false };
    w.svc.archive.items.setSlot(theirs.itemId, slot);
    const later = await s.send("ok, carry on");
    const filed = await w.svc.brain.fileLearned({ projectId: later.prep.project, chainId: later.prep.chain, turnId: later.prep.turn, kind: "fact", text: "The project installs with npm.", importance: 0.6, slot: { ...slot, value: "npm" } }, { via: "filament-idle" });
    assert.deepEqual([filed.filed, w.svc.archive.items.get(theirs.itemId).status], ["dismissed", "inferred"], "theirs stands, the learned one is filed dismissed");
  }));

// (fails before: yes — the older way superseded the person's newer one)
test("an agent's quote of the person's older way to do a thing never replaces the way they kept since, nor asks them about it", () =>
  world({}, async (w) => {
    const s = w.session("s-ways");
    const OLD = "How to release: 1. npm version patch 2. npm publish";
    const first = await s.send(OLD);
    // Said a minute before the way they keep now.
    w.svc.archive.db.prepare("UPDATE turns SET started_at = started_at - 60000 WHERE id = ?").run(first.prep.turn);
    const kept = await s.remember("How to release: 1. npm run release 2. git push --tags", { kind: "procedure" });
    const now = await s.send("release it");
    const old = await w.svc.brain.remember(OLD, { kind: "procedure", projectId: now.prep.project, chainId: now.prep.chain, turnId: now.prep.turn, by: "model", quote: OLD });
    assert.equal(old.heard, true, "their words, quoted");
    assert.equal(old.retired, true, JSON.stringify(old));
    assert.equal(w.svc.archive.items.get(kept.item.itemId).status, "confirmed", "the way they kept since stands");
    assert.deepEqual(w.svc.archive.inbox.list({}).map((/** @type {any} */ q) => q.kind), [], "nothing asked: their newer word is the answer");
    // Their quoted words newer than a way on file replace it, as before.
    const NEW = "How to release: 1. npm run release 2. git push --tags 3. gh release create";
    const said = await s.send(NEW);
    const newer = await w.svc.brain.remember(NEW, { kind: "procedure", projectId: said.prep.project, chainId: said.prep.chain, turnId: said.prep.turn, by: "model", quote: NEW });
    assert.deepEqual(newer.replaced, [`i${kept.item.itemId}`]);
  }));

// (fails before: yes — the steps under the first line were dropped and the procedure refused)
test("@mem procedure keeps the steps on the lines under it; @mem rule keeps its lines too", () =>
  world({}, async (w) => {
    const { sit } = await w.session("s-cmd").send("hello");
    const r = await memoryCommand(w.svc, "@mem procedure How to release:\n1. npm run build\n2. npm publish", sit);
    assert.match(r.text, /Stored as a procedure/, r.text);
    const it = w.svc.archive.items.list({}).find((/** @type {any} */ x) => x.kind === "procedure");
    assert.equal(it?.text, "How to release: 1. npm run build 2. npm publish");
    const rule = await memoryCommand(w.svc, "@mem rule Never force-push:\nmain and release/* are protected.", sit);
    assert.match(rule.text, /Stored as a rule/);
    assert.ok(w.svc.archive.items.list({}).some((/** @type {any} */ x) => x.kind === "rule" && x.text === "Never force-push: main and release/* are protected."));
  }));
