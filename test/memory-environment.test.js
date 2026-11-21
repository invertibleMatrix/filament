// @ts-check
// The environment check (HarnessV3-Memory M3-4, MD-5): a claim whose value the request's own environment contradicts —
// its folder, its lockfiles, the tools it offers, its platform — is held back from the autopilot while the contradiction
// holds, labelled where search shows it, and recorded once as a `contested` event. Contested is no status: the claim
// stands, and comes back when the environment no longer says otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestEnv, managersOf, environmentSays, toolNamesOf } from "../src/services/memory/request-env.js";
import { valuesOf } from "../src/services/memory/values.js";
import { world, lineWith } from "./fixtures/memory-world.mjs";

const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };

/** A fresh folder with these files, removed after `fn`. @param {Record<string, string>} files @param {(dir: string) => Promise<void> | void} fn */
async function folder(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "filament-env-"));
  try {
    for (const [p, body] of Object.entries(files)) writeFileSync(join(dir, p), body);
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the request's environment: platform from <env> or the frozen Environment, file tools by kind, tool names in any format", () => {
  assert.equal(requestEnv({ systemText: "<env>\nWorking directory: C:\\p\nPlatform: win32\n</env>" }).platform, "win32");
  assert.equal(requestEnv({ systemText: "no env here", environment: { path: { platform: "darwin" } } }).platform, "darwin");
  assert.equal(requestEnv({ systemText: "Platform: plan9" }).platform, null, "a platform it does not know is none");
  assert.equal(requestEnv({ tools: ["Bash", "Read"] }).fileTools, true);
  assert.equal(requestEnv({ tools: ["str_replace_based_edit_tool"] }).fileTools, true);
  assert.equal(requestEnv({ tools: ["Bash", "WebFetch"] }).fileTools, false);
  assert.equal(requestEnv({ tools: [] }).fileTools, null, "no tools at all says nothing about file tools");
  assert.deepEqual(toolNamesOf({ tools: [{ name: "Read" }, { type: "function", function: { name: "write_file" } }] }), ["Read", "write_file"]);
  assert.deepEqual(toolNamesOf({ tools: [{ name: "x" }] }, { tools: [{ type: "function", name: "apply_patch" }] }), ["apply_patch"], "a Responses body's own tools");
});

test("the folder's package manager: one lockfile per ecosystem names it, two name none, packageManager wins", async () => {
  await folder({ "package.json": "{}", "bun.lock": "{}", "uv.lock": "" }, (dir) => {
    assert.deepEqual(Object.fromEntries(managersOf(dir)), { node: { manager: "bun", source: "bun.lock" }, python: { manager: "uv", source: "uv.lock" } });
  });
  await folder({ "pnpm-lock.yaml": "", "yarn.lock": "" }, (dir) => {
    assert.deepEqual([...managersOf(dir)], [], "two node lockfiles: which one runs is not known");
  });
  await folder({ "package.json": '{"packageManager":"pnpm@9.1.0"}', "yarn.lock": "" }, (dir) => {
    assert.deepEqual(managersOf(dir).get("node"), { manager: "pnpm", source: "package.json's packageManager" });
  });
  await folder({ "package.json": "{}", "bun.lock": "{}" }, (dir) => {
    assert.equal(managersOf(dir).get("node")?.manager, "bun");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    const later = new Date(Date.now() + 60_000);
    utimesSync(dir, later, later); // a folder's entries changing moves its mtime; set it so a coarse clock cannot hide the move
    assert.equal(managersOf(dir).get("node"), undefined, "the folder is read again once its entries change");
  });
});

test("what the environment says against a claim: only this project's values, and only a real rival", () => {
  const env = { project: "p", cwd: "C:\\proj", platform: "win32", fileTools: true, managers: new Map([["node", { manager: "bun", source: "bun.lock" }]]) };
  const says = (/** @type {string} */ text) => environmentSays(valuesOf(text), env)?.says ?? null;
  assert.equal(says("this project uses pnpm as its package manager"), "bun (bun.lock)");
  assert.equal(says("this project uses bun for installs"), null, "the same manager");
  assert.equal(says("this project uses poetry for its Python packages"), null, "another ecosystem: both can hold");
  assert.equal(says("the frontend uses yarn"), null, "another subject's manager");
  assert.equal(says("this project is checked out at D:\\old\\proj"), "the working folder is C:\\proj");
  assert.equal(says("the working directory is C:\\proj\\packages\\api"), null, "inside the working folder");
  assert.equal(says("the team's notes vault lives at D:\\vault\\notes"), null, "another folder");
  assert.equal(says("There are no file tools in this session."), "file tools are offered");
  assert.equal(says("we're on macOS"), "the platform is win32");
  assert.equal(says("we're on Windows"), null);
});

test("a package manager the lockfile contradicts is held back while it does, labelled in search, and recorded once", () =>
  folder({ "package.json": '{"name":"x"}', "bun.lock": "{}" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      await w.session("a").remember("this project uses pnpm as its package manager");
      const { seen, sit, prep } = await w.session("b").send("which package manager does this project use?");
      assert.equal(lineWith(seen, "uses pnpm"), null, "held back, and so are the words that said it");
      const said = w.svc.archive.items.list({}).find((x) => /uses pnpm/.test(x.text));
      assert.equal(w.svc.archive.items.events(said.id).filter((e) => e.action === "contested").length, 1, "the autopilot records it: its own project's environment says otherwise");
      const scope = w.svc.scope({ role: "model", project: sit.project.id, chain: prep.chain, turn: prep.turn });
      const hit = (await scope.search("package manager pnpm", { project: true })).find((it) => /uses pnpm/.test(it.text) && /^i\d+$/.test(it.id));
      assert.deepEqual([hit?.flags, hit?.held], [["contested: the environment says bun (bun.lock)"], true]);
      const brief = await w.svc.scope({ role: "agent", project: sit.project.id }).brief({ purpose: "subagent", task: "which package manager does this project use? package manager pnpm" });
      assert.ok(brief.count > 0 && !/uses \[?pnpm/.test(brief.text), `a sub-agent's brief never holds a held claim, nor the quote that said it: ${brief.text}`);
      await w.session("c").send("which package manager does this project use again?");
      const it = w.svc.archive.items.list({}).find((x) => /uses pnpm/.test(x.text));
      assert.equal(it.status, "confirmed", "contested is no status: the claim stands");
      assert.deepEqual(w.svc.archive.items.events(it.id).filter((e) => e.action === "contested").map((e) => e.detail), [{ class: "package manager", value: "pnpm", says: "bun (bun.lock)" }], "once");
      w.svc.brain.contestedSeen.clear(); // as a restarted process: nothing seen in this one
      await w.session("c2").send("which package manager does this project use, once more?");
      assert.equal(w.svc.archive.items.events(it.id).filter((e) => e.action === "contested").length, 1, "once across a restart: the history says it is recorded");
      unlinkSync(join(dir, "bun.lock"));
      const later = new Date(Date.now() + 60_000);
      utimesSync(dir, later, later);
      const { seen: after } = await w.session("d").send("which package manager does this project use?");
      assert.ok(lineWith(after, "uses pnpm"), "the lockfile gone, nothing says otherwise: served again");
    })));

test("the environment speaks for its own project: another project's folder is held back here, never contested", () =>
  world({ cwd: "C:\\evals\\alpha" }, async (w) => {
    await w.session("a").remember("this project is checked out at C:\\evals\\alpha and the deploy scripts build there");
    const ask = "where do the deploy scripts build?";
    assert.ok(lineWith((await w.session("b").send(ask)).seen, "checked out at"), "its own project: served");
    const beta = w.session("c", { cwd: "C:\\evals\\beta" });
    const { seen, sit, prep } = await beta.send(ask);
    assert.equal(lineWith(seen, "checked out at"), null, "another project's folder would mislead here");
    const it = w.svc.archive.items.list({}).find((x) => /checked out at/.test(x.text));
    assert.deepEqual(w.svc.archive.items.events(it.id).filter((e) => e.action === "contested"), [], "nothing here says it is wrong where it was said");
    const scope = w.svc.scope({ role: "model", project: sit.project.id, chain: prep.chain, turn: prep.turn });
    const hit = (await scope.search(ask)).find((x) => x.id === `i${it.id}`);
    assert.deepEqual([hit?.flags, hit?.held], [["of another project: here the working folder is C:\\evals\\beta"], true], "a search of every project's memory: labelled");
    assert.equal((await scope.search(ask, { project: true })).find((x) => x.id === `i${it.id}`), undefined, "a search of this project's: not there");
  }));

test("'no file tools' is held back from a request that offers file tools, and served to one that offers none", () =>
  world({}, async (w) => {
    await w.session("a").remember("there are no file tools in this setup, so paste file contents into the chat");
    const ask = async (/** @type {string} */ id, /** @type {any[]} */ tools) => {
      const r = { format: "anthropic", body: { model: "m", max_tokens: 100, system: "<env>\nWorking directory: C:\\evals\n</env>", messages: [{ role: "user", content: "how do I show you a file? paste file contents?" }], tools }, headers: { ...CC_UA, "x-session-id": id }, model: "m" };
      await w.svc.prepare(w.svc.situate(r), { requestId: `t-${id}` });
      return String(r.body.system);
    };
    assert.equal(lineWith(await ask("with", [{ name: "Read", input_schema: { type: "object" } }]), "no file tools"), null);
    assert.ok(lineWith(await ask("without", [{ name: "Bash", input_schema: { type: "object" } }]), "no file tools"));
  }));
