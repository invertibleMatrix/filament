// @ts-check
// The crafter as a chat of its own (the owner's word of 10-27: "the crafter should just open a new interactive session
// where i could see the whole transcript how crafter is working so that i could steer it if needed … nothing should run
// behind the scene"). `/craft <words>` asks Filament for a crafter chat: a new chat in the same folder with the same model,
// its first message the person's words with the crafter's brief; its agent alone has the `craft` tool, and makes the skill,
// adds its books and writes it in the open. A skill has one crafter chat: asked again, that one opens.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { craftCall, craftAtOf, CRAFT_TOOL } from "../src/app/agent/craft-tool.js";
import { crafterBrief, crafterTitle } from "../src/app/crafter-chats.js";
import { noteFromMemory } from "../src/app/skill-from-memory.js";
import { craftOf } from "../src/ui/harness/lib/craft.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The tool results of a request's newest message, by the call's id. @param {any} body */
const resultsOf = (body) => {
  const out = new Map();
  for (const b of (body?.messages || []).at(-1)?.content || []) if (b?.type === "tool_result") out.set(String(b.tool_use_id), JSON.stringify(b.content));
  return out;
};

describe("the craft tool", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-craft-tool-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("only in a crafter chat; make once, then look and write — a SKILL.md written keeps the lines from memory", async () => {
    /** @type {Record<string, { skill: string | null }>} */
    const chats = { c1: { skill: null } };
    let text = "---\nname: grids\n---\n\n## Rules\n\n- Snap to the grid.\n";
    /** @type {any} */
    const deps = {
      of: (/** @type {string} */ c) => chats[c] || null,
      make: (/** @type {string} */ c, /** @type {string} */ name) => ((chats[c].skill = name), { name, dir }),
      dirOf: () => dir,
      text: () => text,
      write: (/** @type {string} */ _n, /** @type {string} */ path, /** @type {string} */ t) => {
        if (path === "SKILL.md") text = t;
      },
      books: async () => ({ added: [], skipped: [{ name: "x.doc", why: "Filament reads PDF, Markdown and text files only" }], books: [] }),
      booksOf: () => [],
      files: () => [{ path: "SKILL.md", size: text.length, dir: false }],
    };
    assert.equal(craftAtOf(deps, "c2"), null, "a chat that crafts nothing has no craft tool");
    const at = /** @type {any} */ (craftAtOf(deps, "c1"));
    assert.ok(at);
    assert.deepEqual(await craftCall({ action: "look" }, at), { ok: false, error: 'No skill yet: make it first ({"action":"make","name":"…","description":"…"}).' });
    assert.equal((await craftCall({ action: "make", name: "bad name" }, at)).ok, false);
    const made = await craftCall({ action: "make", name: "grids", description: "Grids" }, at);
    assert.match(/** @type {any} */ (made).text, /^Made grids, in .+\. It is on nowhere until the person turns it on/);
    assert.match(/** @type {any} */ (await craftCall({ action: "make", name: "other" }, at)).error, /crafts grids already/);
    noteFromMemory(dir, { memory: "i7", section: "Rules", lines: ["- Snap to the grid."] });
    const wrote = /** @type {any} */ (await craftCall({ action: "write", path: "SKILL.md", text: "---\nname: grids\n---\n\n## Rules\n\n- Cells are square.\n" }, at));
    assert.match(wrote.text, /^Wrote SKILL\.md in grids \(\d+ lines\)\. 1 block of lines the person added from memory was not in it: Filament put it back under its section\.$/);
    assert.match(text, /- Cells are square\.\n- Snap to the grid\./);
    const look = /** @type {any} */ (await craftCall({ action: "look" }, at));
    assert.match(look.text, /Lines the person added from memory, kept in SKILL\.md whatever you write:\nRules: - Snap to the grid\./);
    assert.match(/** @type {any} */ (await craftCall({ action: "books", paths: ["x.doc"] }, at)).text, /Not added:\n- x\.doc: Filament reads PDF/);
    assert.equal((await craftCall({ action: "write", path: ".library/index.sqlite", text: "" }, at)).ok, false, "its library is Filament's");
    assert.deepEqual(CRAFT_TOOL.input_schema.properties.action.enum, ["make", "look", "books", "find", "read", "write"]);
    // The owner's tool plan of 11-08: named for the skill it crafts, so no agent takes it for a tool of its own.
    assert.equal(CRAFT_TOOL.name, "skill_craft");
  });

  test("/craft in the box, the title and the brief", () => {
    assert.deepEqual([craftOf("/craft a skill of this chat"), craftOf("/craft"), craftOf("/crafty"), craftOf("craft it")], ["a skill of this chat", "", null, null]);
    assert.equal(crafterTitle("a skill for Unity tilemaps from the docs", null), "Craft · a skill for Unity tilemaps from the docs");
    assert.equal(crafterTitle("x", "tilemaps"), "Craft · tilemaps");
    const brief = crafterBrief({ words: "a skill of what we did", from: { id: "c9", title: "Grid work" } });
    assert.match(brief, /^\[Filament: this chat crafts a skill/);
    assert.match(brief, /The person asked: a skill of what we did/);
    assert.match(brief, /not a skill-creator skill of your own nor your own skills folder/);
    assert.match(brief, /The chat this was asked in, "Grid work" \(c9\)/);
    assert.match(brief, /past about 100 pages, wait for the person's go/);
  });
});

describe("a crafter chat through Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-crafter-chat-"));
    writeFileSync(join(root, "guide.md"), "# Tilemaps\n\n## Grids\n\nA grid has cells. Snap tiles to cells.\n\n## Rule tiles\n\nA rule tile picks its sprite from its neighbours.\n");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const d of [shim.dataDir, root])
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
  });

  // (fails before: yes — there was no /api/skills/craft and no craft tool: the crafter was a job in the background)
  test("/craft opens a chat whose agent makes the skill, adds its book and writes it, with the craft tool only there; asked again for the skill, that chat opens", async () => {
    /** @type {string[][]} */
    const toolsSeen = [];
    /** @type {(v?: unknown) => void} */
    let done = () => {};
    const finished = new Promise((r) => (done = r));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const body = call.body;
      const crafting = JSON.stringify(body.messages?.[0] ?? "").includes("this chat crafts a skill");
      toolsSeen.push([crafting ? "crafter" : "plain", ...(body.tools || []).map((/** @type {any} */ t) => t.name)]);
      if (!crafting) return reply([{ type: "text", text: "Hello." }]);
      const got = resultsOf(body);
      if (got.has("k3")) {
        done();
        return reply([{ type: "text", text: "tilemaps holds the method for grids and rule tiles, with its guide as its library." }]);
      }
      if (got.has("k2")) return reply([toolUse("k3", CRAFT_TOOL.name, { action: "write", path: "SKILL.md", text: "---\nname: tilemaps\ndescription: Unity tilemaps: grids and rule tiles\n---\n\n# Tilemaps\n\n## How to work\n\n1. Snap tiles to cells.\n" })], "tool_use");
      // Its book by a path in the chat's folder, as the agent's other tools take it (fails before: yes — the drive of
      // 10-27: a short path was read from Filament's own folder, and the book was not found).
      if (got.has("k1")) return reply([toolUse("k2", CRAFT_TOOL.name, { action: "books", paths: ["guide.md"] })], "tool_use");
      return reply([toolUse("k1", CRAFT_TOOL.name, { action: "make", name: "tilemaps", description: "Unity tilemaps: grids and rule tiles" })], "tool_use");
    };
    const words = `a skill for Unity tilemaps from ${join(root, "guide.md")}`;
    const r = await shim.api("/api/skills/craft", { method: "POST", body: { words, cwd: root, model: "agent/brain-model" } });
    assert.equal(r.status, 200, await r.clone().text());
    const opened = await r.json();
    assert.equal(opened.title, crafterTitle(words, null), "titled by the person's words until the skill is named");
    // Nothing is sent: the brief comes back for the chat's box, and the person's Send sends it (the owner's word of
    // 10-27, "let me press the send so that i can change the model"; fails before: yes — the brief was sent at once).
    assert.equal(opened.draft, crafterBrief({ words, skill: null, from: null, books: [] }), "its first message, for its box");
    assert.deepEqual([toolsSeen.length, shim.app.memory.archive?.getTurns(opened.id).length], [0, 0], "no request, no turn before the Send");
    const sent = await shim.api(`/api/sessions/${encodeURIComponent(opened.id)}/turns`, { method: "POST", body: { content: opened.draft, stream: false } });
    assert.equal(sent.status, 200, await sent.clone().text());
    await sent.json();
    await Promise.race([finished, new Promise((_, no) => setTimeout(() => no(new Error("the crafter chat never wrote the skill")), 60_000))]);
    const skill = await (await shim.api("/api/skills/tilemaps")).json();
    assert.equal(skill.kind, "made");
    assert.match(skill.text, /1\. Snap tiles to cells\./, "its SKILL.md as the agent wrote it");
    assert.equal(skill.books.length, 1, "its book in its library");
    assert.match(readFileSync(join(skill.path, "references", "INDEX.md"), "utf8"), /Rule tiles/);
    const a = shim.app.memory.archive;
    assert.ok(a);
    const row = a.getChain(opened.id);
    assert.deepEqual([row?.title, row?.meta?.craft?.skill], ["Craft · tilemaps", "tilemaps"], "named by its skill once made");
    // The craft tool is the crafter chat's alone.
    const plain = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json();
    const res = await shim.api(`/api/sessions/${encodeURIComponent(plain.id)}/turns`, { method: "POST", body: { content: "hi", stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
    assert.ok(toolsSeen.filter((t) => t[0] === "crafter").every((t) => t.includes(CRAFT_TOOL.name)), "every request of the crafter chat offers skill_craft");
    assert.ok(toolsSeen.filter((t) => t[0] === "plain").every((t) => !t.includes(CRAFT_TOOL.name)), "a plain chat's offers none");
    // Asked again for the skill — its page's button —, its crafter chat opens: no second one, no new message.
    const before = toolsSeen.length;
    const again = await (await shim.api("/api/skills/craft", { method: "POST", body: { skill: "tilemaps", cwd: root, model: "agent/brain-model" } })).json();
    assert.deepEqual([again.id, again.reused, toolsSeen.length], [opened.id, true, before]);
  });

  // (fails before: yes — the sessions list carried no craft, so no line could say where a crafter chat came from)
  test("the sessions list says what a crafter chat crafts and the chat /craft was typed in, for the line over the box", async () => {
    const src = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", title: "the source chat" } })).json();
    const r = await shim.api("/api/skills/craft", { method: "POST", body: { words: "a skill for sprites", chain: src.id, cwd: root, model: "agent/brain-model" } });
    assert.equal(r.status, 200, await r.clone().text());
    const opened = await r.json();
    assert.match(opened.draft, /The chat this was asked in, "the source chat"/, "its brief names the chat it came from");
    const list = await (await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork")).json();
    const row = list.sessions.find((/** @type {any} */ s) => s.id === opened.id);
    assert.deepEqual(row?.craft, { skill: null, from: src.id });
    assert.equal(list.sessions.find((/** @type {any} */ s) => s.id === src.id)?.craft, null, "a chat that crafts nothing says none");
  });
});
