// @ts-check
// HarnessV4_SpacesPlugins_Plan B3: a plugin's agents (`agents/<name>.md`, Claude's sub-agent files) are agent cards,
// tagged `<plugin>:<name>`, read from its files and never saved — Edit and Delete refused in words, Make a copy yours.
// Their tool list sets their level as near as Filament's come (only reading → reads only), and switches off what it
// leaves out; they run on the chat's model. One is asked only in a chat where its plugin is on.
// (fails before: yes — a plugin's agents were read and listed on its sheet, and reached no list of agents)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlugins, pluginAgentCard } from "../src/app/plugins.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugin-agents-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};

const REVIEWER = [
  "---",
  "name: code-reviewer",
  'description: "Use this agent after a change, to review it.\\n<example>user: review my diff\\nassistant: I will use the code-reviewer</example> It reads only."',
  "tools: Read, Grep, Glob",
  "model: inherit",
  "---",
  "You review code carefully. Name the file and line of each finding.",
].join("\n");

/** A plugin, "guard", with two agents: a reviewer that reads only, and a fixer of no tool list. @param {string} dir */
function guardAt(dir) {
  put(join(dir, ".claude-plugin", "plugin.json"), { name: "guard", version: "1.0.0", description: "Guards the code" });
  put(join(dir, "agents", "code-reviewer.md"), REVIEWER);
  put(join(dir, "agents", "fixer.md"), "---\ndescription: Fixes what the reviewer found\n---\nFix each finding, then run the tests.");
}

describe("a plugin's agent as a card", () => {
  test("its tag, name and words from its file; its tool list sets its level and what it goes without; the chat's model", () => {
    const p = { id: "guard@acme", name: "guard" };
    const c = pluginAgentCard(p, "agents/code-reviewer.md", REVIEWER);
    assert.deepEqual(
      { tag: c.tag, name: c.name, goodFor: c.goodFor, thinks: c.thinks, may: c.may, models: c.models, toolsOff: c.toolsOff, plugin: c.plugin, sees: c.sees },
      {
        tag: "guard:code-reviewer",
        name: "code-reviewer",
        goodFor: "Use this agent after a change, to review it. It reads only.",
        thinks: "You review code carefully. Name the file and line of each finding.",
        may: "read",
        models: [],
        toolsOff: ["shell", "browser", "web", "mcp", "visuals", "space"],
        plugin: "guard@acme",
        sees: { view: "none", running: false, changes: null },
      },
    );
    const level = (/** @type {string} */ tools) => {
      const x = pluginAgentCard(p, "agents/x.md", `---\nname: x\ndescription: d\ntools: ${tools}\n---\nbody`);
      return [x.may, x.toolsOff];
    };
    assert.deepEqual(level("Read, Grep, Bash"), ["copy", ["browser", "web", "mcp", "visuals", "space"]], "a command but no writes: its own copy, nothing kept");
    assert.deepEqual(level("Read, Edit, Write, WebFetch, mcp__github__get_pr"), ["edit", ["shell", "browser", "visuals", "space"]]);
    assert.deepEqual(level("[Read, Glob]"), ["read", ["shell", "browser", "web", "mcp", "visuals", "space"]], "a list as YAML writes one");
    const all = pluginAgentCard(p, "agents/Fix It.md", "---\ndescription: Fixes\n---\nFix.");
    assert.deepEqual([all.tag, all.name, all.may, all.toolsOff], ["guard:fix-it", "Fix It", "edit", []], "no list: every tool, as in Claude — its name from its file's");
    assert.equal(pluginAgentCard(p, "agents/y.md", `---\ndescription: ${"word ".repeat(60)}\n---\nb`).goodFor.length, 160);
  });

  test("the store: after yours, found by its tag; Edit and Delete refused in words; a copy is yours, kept, its words what a card holds", () => {
    const dataDir = fresh("store");
    const card = { ...pluginAgentCard({ id: "guard@acme", name: "guard" }, "agents/code-reviewer.md", REVIEWER), thinks: "t".repeat(6000) };
    let on = [card];
    const open = () => createAgentCardStore({ dataDir, plugins: () => on });
    const store = open();
    store.create({ tag: "mine", name: "Mine", goodFor: "Mine to ask" });
    const list = store.list();
    assert.deepEqual(list.slice(-2).map((c) => c.tag), ["mine", "guard:code-reviewer"]);
    assert.equal(store.find("@Guard:Code-Reviewer")?.plugin, "guard@acme");
    assert.throws(() => store.update("guard:code-reviewer", { name: "Mine now" }), { status: 403, message: "`@guard:code-reviewer` comes with the plugin guard@acme: it cannot be edited here — make a copy of it to change it, or uninstall its plugin." });
    assert.throws(() => store.remove("guard:code-reviewer"), { status: 403 });
    assert.throws(() => store.create({ tag: "guard:x", name: "X", goodFor: "x" }), { status: 400 }, "a card you save never takes a plugin's tag");
    const copy = store.create({ from: "guard:code-reviewer", tag: "my-reviewer" });
    assert.deepEqual([copy.from, copy.may, copy.thinks.length, copy.plugin], ["guard:code-reviewer", "read", 4000, undefined]);
    // Its plugin gone: its agent goes; the copy stays, read back from the file.
    on = [];
    const again = open();
    assert.deepEqual(again.list().filter((c) => !c.shipped).map((c) => [c.tag, c.name]), [["my-reviewer", "code-reviewer"], ["mine", "Mine"]], "yours by name");
  });

  test("the plugins installed: each one's agents, read once per version; a second plugin of the same name has its marketplace in its tag", async () => {
    const dataDir = fresh("data");
    const a = fresh("a");
    const b = fresh("b");
    guardAt(a);
    guardAt(b);
    const where = /** @type {Record<string, string>} */ ({ acme: a, other: b });
    const sources = {
      entry: (/** @type {string} */ id, /** @type {string} */ name) => {
        const m = id.split("/")[1];
        return { market: { id, name: m, title: m }, entry: { name, title: name, description: "", version: "", category: "", author: "", homepage: "", source: { kind: /** @type {const} */ ("path"), path: where[m] } } };
      },
    };
    const p = createPlugins({ dataDir, sources });
    assert.deepEqual(p.agents(), []);
    await p.install({ from: "claude/acme", name: "guard" });
    await p.install({ from: "claude/other", name: "guard" });
    assert.deepEqual(p.agents().map((c) => [c.tag, c.plugin, c.may]), [
      ["guard:code-reviewer", "guard@acme", "read"],
      ["guard:fixer", "guard@acme", "edit"],
      ["guard-other:code-reviewer", "guard@other", "read"],
      ["guard-other:fixer", "guard@other", "edit"],
    ]);
    p.uninstall("guard@acme");
    assert.deepEqual(p.agents().map((c) => c.tag), ["guard:code-reviewer", "guard:fixer"], "the one left takes the plain tag");
  });
});

describe("through the app", () => {
  test("Library › Agents lists them apart, read from the plugin; the agent tool asks one only in a chat where its plugin is on", async (t) => {
    const home = fresh("home");
    const market = join(home, ".claude", "plugins", "marketplaces", "acme");
    put(join(home, ".claude", "plugins", "known_marketplaces.json"), { acme: { source: { source: "github", repo: "acme/plugins" }, installLocation: market } });
    put(join(market, ".claude-plugin", "marketplace.json"), { name: "acme", plugins: [{ name: "guard", source: "./plugins/guard" }] });
    guardAt(join(market, "plugins", "guard"));
    const folder = fresh("work");
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    /** Who a request answers as: a saved agent's name; null for the main agent's. @param {any} c */
    const asWhom = (c) => (/You answer as ([^.]+)\./.exec(JSON.stringify(c.body?.system ?? "")) || [])[1] || null;
    const up = await fakeUpstream(async (/** @type {any} */ call) => {
      const model = String(call.body?.model || "");
      const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 50, output_tokens: 7 } });
      if (!(call.body?.tools || []).length) return anthropicReply("A title", { model });
      const who = asWhom(call);
      if (who) return blocks([{ type: "text", text: `${who} FOUND nothing wrong.` }]);
      const said = JSON.stringify(call.body?.messages?.at(-1)?.content ?? "");
      if (said.includes("tool_result")) return blocks([{ type: "text", text: "MAIN DONE" }]);
      return blocks([{ type: "tool_use", id: "toolu_rv", name: "agent", input: { run_in_background: false, saved_agent: "code-reviewer", description: "review the change", prompt: "Review the change in notes.txt." } }], "tool_use");
    });
    t.after(() => up.close());
    const shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
    t.after(() => shim.stop());
    assert.equal((await shim.api("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "guard" } })).status, 200);
    // Library › Agents and teams: apart from yours, each with its plugin.
    const page = await (await shim.api("/api/agents")).json();
    assert.deepEqual(page.plugins.map((/** @type {any} */ c) => [c.tag, c.name, c.may, c.plugin]), [["guard:code-reviewer", "code-reviewer", "read", "guard@acme"], ["guard:fixer", "fixer", "edit", "guard@acme"]]);
    assert.equal(page.saved.length, 0);
    const edit = await shim.api(`/api/agents/${encodeURIComponent("guard:code-reviewer")}`, { method: "PUT", body: { name: "x" } });
    assert.equal(edit.status, 403, await edit.clone().text());
    /** A chat, its plugins on as given; one turn that names the reviewer in words. @param {any[]} on */
    const ask = async (on) => {
      const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings: { plugins: { on } } } })).json();
      const mark = up.received.length;
      const r = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/turns`, { method: "POST", body: { content: "Ask the code-reviewer to look at notes.txt.", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const calls = up.received.slice(mark);
      const back = calls.find((/** @type {any} */ c) => JSON.stringify(c.body?.messages?.at(-1)?.content ?? "").includes("toolu_rv"));
      const result = (back?.body?.messages?.at(-1)?.content || []).find((/** @type {any} */ x) => x.tool_use_id === "toolu_rv");
      const text = typeof result?.content === "string" ? result.content : (result?.content || []).map((/** @type {any} */ x) => x.text || "").join("");
      return { asked: calls.filter((/** @type {any} */ c) => asWhom(c) === "code-reviewer"), text };
    };
    // Its plugin off in this chat: refused in words, nobody asked.
    const off = await ask([]);
    assert.equal(off.asked.length, 0);
    assert.match(off.text, /code-reviewer comes with the plugin guard@acme, which is not on in this chat/);
    // On: asked, thinking its file's words.
    const on = await ask([{ id: "guard@acme" }]);
    assert.equal(on.asked.length, 1, on.text);
    assert.match(JSON.stringify(on.asked[0].body.system), /You review code carefully\. Name the file and line of each finding\./);
    assert.match(on.text, /code-reviewer FOUND nothing wrong\./);
  });
});
