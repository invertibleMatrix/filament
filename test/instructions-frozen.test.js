// @ts-check
// A chat's instruction files are told in its prompt as they were when the prompt was written, until its next
// compaction; one edited meanwhile is told on the person's next message, once, and kept with it. Before, every turn read
// the files from disk again: an AGENTS.md the agent edited, a pull, a CLAUDE.md another tool wrote — the system prompt
// moved and the provider wrote the whole chat to its cache again (the cache audit's finding, sa_c7723f15; the owner's
// of 11-07: nothing like these should break the cache).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { instructionsChanged } from "../src/app/agent/instructions.js";

describe("instruction files held until a compaction", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** Another folder the loop may work in, for a chat moved there. @type {string} */
  let other;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-instr-frozen-"));
    other = mkdtempSync(join(tmpdir(), "filament-instr-moved-"));
    writeFileSync(join(root, "AGENTS.md"), "Rule one: answer in English.\n");
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      if (!(c.body?.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      if (JSON.stringify(c.body.messages.at(-1)).includes("Fails now")) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "refused for the test" } } };
      return anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "ok" }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root, other], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root, other);
  });
  /** A new chat in `cwd`, and its send: one that must go through, or one let fail (`ok` false). @param {string} cwd */
  const chat = async (cwd) => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "agent/brain-model", preset: "plain" } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = String((await created.json()).id);
    const send = async (/** @type {string} */ content, ok = true) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content } });
      if (ok) assert.equal(r.status, 200, await r.clone().text());
      else await r.text();
      return r;
    };
    return { id, send };
  };

  /** A turn's first request, by the words of its message. @param {string} words @returns {any} */
  const first = (words) => {
    const c = up.received.find((x) => (x.body?.tools || []).length && JSON.stringify(x.body.messages.at(-1)).includes(words));
    assert.ok(c, words);
    return c.body;
  };
  /** @param {any} body */
  const sys = (body) => (Array.isArray(body.system) ? body.system.map((/** @type {any} */ b) => b.text).join("") : String(body.system || ""));
  /** @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = body.messages.at(-1);
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  const bare = (/** @type {any} */ x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "cache_control" ? undefined : v)));

  // (fails before: yes — the second turn's system prompt read the edited AGENTS.md, and the first turn's cache was gone)
  test("an AGENTS.md edited mid-chat: the prompt holds, the change rides the next message once, a compaction takes it in", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(created.status, 200, await created.clone().text());
    const path = `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
    const send = async (/** @type {string} */ content) => {
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content } });
      assert.equal(r.status, 200, await r.clone().text());
      return r;
    };
    await send(`First, hello ${"and the words around them ".repeat(400)}`);
    writeFileSync(join(root, "AGENTS.md"), "Rule two: answer in French.\n");
    const r2 = await send("Second, then");
    await send("Third, now");
    const [one, two, three] = ["First, hello", "Second, then", "Third, now"].map(first);
    assert.ok(sys(one).includes("Rule one: answer in English."));
    assert.equal(sys(two), sys(one), "the second turn's prompt is the first's, byte for byte");
    assert.equal(sys(three), sys(one));
    const note = lastTexts(two).filter((t) => t.startsWith("[Filament: AGENTS.md changed since"));
    assert.equal(note.length, 1, "the change rides the message after it");
    assert.ok(note[0].includes("It reads now:\n\nRule two: answer in French.\n]"), note[0]);
    assert.ok(!lastTexts(three).some((t) => t.includes("AGENTS.md changed since")), "told once");
    assert.deepEqual(bare(three.messages.slice(0, two.messages.length)), bare(two.messages), "and kept with that message");
    const rec = await shim.record(r2.headers.get("x-filament-request-id"));
    assert.ok(rec.changes.some((/** @type {string} */ c) => c.startsWith("agent: 1 instruction file changed since the chat's prompt was written")), rec.changes.join("\n"));
    const folded = await shim.api(`${path}/compact`, { method: "POST", body: { method: "summary" } });
    assert.equal(folded.status, 200, await folded.clone().text());
    await send("Fourth, after the summary");
    const four = first("Fourth, after the summary");
    assert.ok(sys(four).includes("Rule two: answer in French.") && !sys(four).includes("Rule one"), "a compaction writes the prompt with it");
    assert.ok(!lastTexts(four).some((t) => t.includes("AGENTS.md changed since")), "and says it no more");
  });

  // (fails before: yes — the review of 11-07: the change was marked told as the turn began, and a turn whose request
  // failed never sent it: the agent went on with the file's old text until the next compaction)
  test("a change told on a turn whose request failed is told on the next", async () => {
    const { send } = await chat(root);
    await send("One, to begin");
    writeFileSync(join(root, "AGENTS.md"), "Rule three: answer in Spanish.\n");
    await send("Fails now", false);
    await send("After the failure");
    assert.ok(lastTexts(first("After the failure")).some((t) => t.startsWith("[Filament: AGENTS.md changed since") && t.includes("Rule three")), "told on the turn that reached the model");
  });

  // (fails before: yes — the review of 11-07: the files were kept by their paths whatever folder they were read in, and a
  // chat moved to another was told each of the first folder's was gone)
  test("a chat moved to another folder reads its files there anew: nothing is told gone", async () => {
    writeFileSync(join(other, "AGENTS.md"), "Rule three: answer in Spanish.\n");
    const { id, send } = await chat(root);
    await send("Before the move");
    /** @type {any} */ (shim.app.memory).archive.mergeMeta(id, { cwd: other });
    await send("After the move");
    const after = first("After the move");
    assert.ok(!lastTexts(after).some((t) => t.includes("AGENTS.md changed since")), lastTexts(after).join("\n---\n").slice(0, 600));
    assert.ok(sys(after).includes("Rule three: answer in Spanish."));
  });
});

test("instructionsChanged: a file changed, gone or new is a note once its text; one the same, line endings aside, none", () => {
  const kept = { "/r/AGENTS.md": { file: "AGENTS.md", text: "a\n" }, "/r/CLAUDE.md": { file: "CLAUDE.md", text: null }, "/r/x.md": { file: "../x.md", text: "x" } };
  const now = { "/r/AGENTS.md": { file: "AGENTS.md", text: "a\r\n" }, "/r/CLAUDE.md": { file: "CLAUDE.md", text: "new" }, "/r/x.md": { file: "../x.md", text: null } };
  const got = instructionsChanged(kept, now, {});
  assert.deepEqual(got.map((c) => c.path), ["/r/CLAUDE.md", "/r/x.md"]);
  assert.match(got[0].text, /^\[Filament: CLAUDE\.md appeared since this chat's instructions were written; they keep no text of it until the chat's next compaction, and this is what holds now\.\n\nnew\n\]$/);
  assert.match(got[1].text, /^\[Filament: \.\.\/x\.md changed since .* It is gone: what it said no longer holds\.\]$/);
  const told = Object.fromEntries(got.map((c) => [c.path, c.hash]));
  assert.deepEqual(instructionsChanged(kept, now, told), [], "said once a text");
  // (fails before: yes — the review of 11-07: a file told of and then put back as the prompt has it was said no more,
  // and the agent's last word of it was the change)
  const putBack = { ...now, "/r/CLAUDE.md": { file: "CLAUDE.md", text: null }, "/r/x.md": { file: "../x.md", text: "x" } };
  const back = instructionsChanged(kept, putBack, told);
  assert.deepEqual(back.map((c) => c.text), [
    "[Filament: CLAUDE.md is gone again, as it was when this chat's instructions were written: what was said of it since no longer holds.]",
    "[Filament: ../x.md reads again as this chat's instructions have it: what was said of it since no longer holds.]",
  ]);
  assert.deepEqual(instructionsChanged(kept, putBack, { ...told, ...Object.fromEntries(back.map((c) => [c.path, c.hash])) }), [], "and that once");
});
