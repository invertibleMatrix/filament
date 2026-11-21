// @ts-check
// A skill the person tags as $<name> or /<name> is the agent's to load with the skill tool, as it needs it — nothing of
// it rides the message, and never the system prompt (the owner's of 11-07: a skill that names others, sent whole, would
// carry none of theirs; the agent loads what it needs on demand). Before, its text went in as a `## Skill:` section of
// the system prompt for that turn alone, so the provider wrote the whole chat to its cache twice; then it rode the
// message whole.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

describe("a tagged skill is the agent's to load: nothing rides the message, and the system prompt holds", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The newest user message's text blocks. @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = [...(body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user");
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  /** What a request holds, its cache's marks aside. @param {any} x */
  const bare = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "cache_control" ? undefined : v)));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-skill-message-"));
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      if (!(c.body?.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      // The agent loads the skill its message tags, once, then answers.
      const last = JSON.stringify(c.body.messages.at(-1));
      if (last.includes("the staging build") && !last.includes("tool_result")) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "k1", name: "skill", input: { name: "deploy" } }] });
      return anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "ok" }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    for (const [make, description] of [["deploy", "Ship a release."], ["tilemaps", "Unity tilemaps: grids and rule tiles."]])
      assert.equal((await shim.api("/api/skills", { method: "POST", body: { make, description } })).status, 200);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });

  /** A turn's first request: the one whose newest message is the person's, saying the words. @param {string} words @returns {any} */
  const first = (words) => {
    const c = up.received.find((x) => (x.body?.tools || []).length && JSON.stringify(x.body.messages.at(-1)).includes(words));
    assert.ok(c, words);
    return c.body;
  };

  // (fails before: yes — the owner's of 11-07: /deploy and $tilemaps rode their messages whole; before that, in the
  // system prompt for their turn alone)
  test("$name and /name, on in the chat or off: the system prompt and the tools are the same bytes every turn, and nothing of the skill rides its message", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { skills: { on: [{ name: "deploy" }] } } } });
    assert.equal(created.status, 200, await created.clone().text());
    const path = `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
    for (const content of ["First, hello", "/deploy ship it now", "$tilemaps lay out the level", "Fourth, then"]) {
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    const [one, two, three, four] = ["First, hello", "/deploy ship it now", "$tilemaps lay out the level", "Fourth, then"].map(first);
    assert.match(JSON.stringify(one.system), /# Skills[\s\S]*- deploy — Ship a release\./, "deploy is on, listed");
    for (const [n, b] of /** @type {const} */ ([["second", two], ["third", three], ["fourth", four]])) {
      assert.deepEqual(bare(b.system), bare(one.system), `the ${n} turn's system prompt is the first's`);
      assert.deepEqual(bare(b.tools), bare(one.tools), `the ${n} turn's tools are the first's`);
    }
    assert.ok(!JSON.stringify(two.system).includes("## Skill:"), "no skill whole in the system prompt");
    for (const b of [two, three]) assert.ok(!lastTexts(b).some((t) => t.includes('kind="skill"') || t.includes("Ship a release") || t.includes("Unity tilemaps")), "the tag is the person's words alone");
    assert.ok(lastTexts(two).some((t) => t.includes("/deploy ship it now")) && lastTexts(three).some((t) => t.includes("$tilemaps lay out the level")));
    assert.match(JSON.stringify(one.tools), /A \$<name> in the person's message names a skill: load it by that name/, "the skill tool says what a tag is");
    assert.deepEqual(bare(three.messages.slice(0, two.messages.length)), bare(two.messages), "the third turn repeats the second's messages byte for byte");
    assert.deepEqual(bare(four.messages.slice(0, three.messages.length)), bare(three.messages), "the fourth turn repeats the third's");
  });

  // (fails before: yes — the owner's of 11-07: a summary took the skill the agent loaded, and nothing after it said it
  // had been — the list named only skills sent whole on a message)
  test("a summary of the turns the agent loaded a skill in names it after the summary, to load again, with the last reply", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { skills: { on: [{ name: "deploy" }] } } } });
    const path = `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
    for (const content of [`Begin ${"and the words around them ".repeat(400)}`, "/deploy the staging build"]) {
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    const made = await shim.api(`${path}/compact`, { method: "POST", body: { method: "summary" } });
    assert.equal(made.status, 200, await made.clone().text());
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content: "After the summary" } });
    assert.equal(r.status, 200, await r.clone().text());
    const after = first("After the summary");
    const head = JSON.stringify(after.messages[0]);
    assert.ok(head.includes("<skills>\\n- deploy (turn 2)\\n</skills>"), head.slice(0, 1500));
    assert.ok(head.includes("A skill named was loaded in the turns the summary stands for, and its text went with them: load it again with Filament's `skill` tool before you follow it."));
    assert.ok(/<last-reply turn=\\"2\\">\\nok\\n<\/last-reply>/.test(head), "the reply the next message answers");
    assert.ok(head.includes("Any of turns 1–2 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended."));
  });
});
