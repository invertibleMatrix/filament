// @ts-check
// Skills on demand (the owner's word of 10-27: "no context should be bloated for an agent no matter how many skills
// there are, if someone asks an agent to use the skill then agent could look for a skill and load it on demand"): the
// list in an agent's instructions costs a fixed budget however many skills are on; the skill tool, with no name, finds
// skills by words — the Library's off here named and marked —; a skill's text is read when it is loaded; and any
// skill of the Library loads by its name, on demand, turning nothing on — a $<name> in the person's message names one
// for the agent to load (the owner's of 11-07: on is the prompt's list, a tag is loaded on demand).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills, skillsSections, skillAnswer, triggeredSkills, withCalled, calledWords, calledNotes, SKILLS_LIST_BUDGET, SKILL_FIND_ON, SKILL_TOOL } from "../src/app/agent/skills.js";
import { createSkillStore } from "../src/app/skill-store.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/** @param {string} dir @param {string} name @param {string} description @param {string} [body] @param {string} [extra] */
const skillAt = (dir, name, description, body = `Do ${name}.`, extra = "") => {
  mkdirSync(join(dir, name), { recursive: true });
  const path = join(dir, name, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`);
  return path;
};

describe("the skills list and the skill tool, however many skills", () => {
  /** @type {string} */
  let dir;
  /** @type {ReturnType<typeof loadSkills>} */
  let set;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-skills-on-demand-"));
    // 120 on, named in reverse: the list goes A to Z whatever the order they are on in.
    const yours = [];
    for (let i = 119; i >= 0; i--) {
      const name = `s${String(i).padStart(3, "0")}`;
      yours.push({ name, path: skillAt(dir, name, `Does the thing numbered ${i} for you. More words that the list leaves out.`, `Body of ${name}.`, i === 0 ? "triggers: [zebra crossing]\n" : "") });
    }
    const pdf = skillAt(dir, "pdf", "Read and fill PDF forms.", "Open the form, fill each field.");
    set = loadSkills({ skills: { yours, library: [{ name: "pdf", path: pdf, description: "Read and fill PDF forms." }] } });
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  // (fails before: yes — past 64 skills the rest were not offered, and every one on was a line of the prompt in full)
  test("# Skills costs a fixed budget: A to Z, the first sentence while they fit, then names, then how many more", () => {
    assert.equal(set.skills.length, 120, "no cap of 64");
    assert.deepEqual(set.problems, []);
    const [section] = skillsSections(set.skills);
    const lines = section.split("\n").slice(2);
    assert.ok(lines.join("\n").length <= SKILLS_LIST_BUDGET, `${lines.join("\n").length} characters`);
    assert.equal(lines[0], "- s000 — Does the thing numbered 0 for you. (triggers: zebra crossing)", "A to Z, the first sentence, its triggers (the memory upgrade's a4)");
    assert.equal(section.split("(triggers:").length, 2, "only the skill that names triggers shows them");
    assert.ok(lines.some((l) => /^- And: s\d{3}, s\d{3}/.test(l)), "then names alone");
    assert.match(lines.at(-1) || "", /^- …and \d+ more: the skill tool's find, with your words and no name, searches them all\.$/);
    assert.match(skillsSections(set.skills, { tool: false })[0], /\n- …and \d+ more, not listed here\.$/);
  });

  // (fails before: yes — every SKILL.md on was read whole to list it)
  test("a long skill's text is read when it is loaded, not to list it: its front matter alone is", () => {
    const path = skillAt(dir, "long", "A long one, past the bytes read for its line.", "x".repeat(20_000));
    const [s] = loadSkills({ skills: { yours: [{ name: "long", path }] } }).skills;
    assert.equal(s.description, "A long one, past the bytes read for its line.");
    writeFileSync(path, "---\nname: long\ndescription: Changed.\n---\n\nWritten after the list was read.\n");
    assert.equal(s.body, "Written after the list was read.");
    assert.equal(s.chars, s.body.length);
  });

  // (fails before: yes — the skill tool needed a name, and knew only the skills on)
  test("with no name, find names the skills that match, best first — the Library's off here marked, at most 5", () => {
    const got = skillAnswer(set.skills, { action: "find", words: "PDF forms" }, null, set.library);
    assert.equal(got.ok, true);
    assert.match(got.text, /^No skill on here holds "pdf" or "forms"\.\n\nIn your Library, not on in this chat — load one by its name all the same:\n- pdf — Read and fill PDF forms\.$/);
    const many = skillAnswer(set.skills, { action: "find", words: "numbered" }, null, set.library);
    assert.equal(many.text.split("\n").filter((l) => l.startsWith("- s")).length, SKILL_FIND_ON);
    assert.match(skillAnswer(set.skills, { action: "find", words: "s042" }, null, set.library).text, /best first — load one by its name:\n- s042 — Does the thing numbered 42 for you\./);
    assert.deepEqual(skillAnswer(set.skills, { action: "find" }, null, set.library), { ok: false, text: "find needs words: what the skill is for." });
    const list = skillAnswer(set.skills, { action: "list" }, null, set.library);
    assert.match(list.text, /^The skills on here — load one by its name:\n- s000 — Does the thing numbered 0 for you\./);
    assert.match(list.text, /\n\nYour Library holds 1 more, off in this chat: find names them by words\.$/);
    assert.equal(skillAnswer(set.skills, {}, null, set.library).ok, false);
  });

  // (fails before: yes — the owner's of 11-07: a load of a skill off here was refused, or turned it on for the chat)
  test("a skill off here loads by its name on demand, its folder looked in, the set left as it was; an unknown name among many says how to find one", () => {
    const library = [...set.library];
    const got = skillAnswer(set.skills, { name: "PDF" }, null, library);
    assert.equal(got.ok, true);
    assert.ok("skill" in got && got.skill.name === "pdf");
    assert.match(got.text, /^Skill: pdf — Read and fill PDF forms\.\nIts folder: .+\n\nOpen the form, fill each field\.$/s, "its text, and no word of turning it on");
    assert.match(skillAnswer(set.skills, { name: "pdf", action: "list" }, null, library).text, /SKILL\.md/, "its folder, without loading it first");
    assert.deepEqual([set.skills.length, library.length], [120, 1], "nothing turned on, nothing taken from the Library's list");
    assert.deepEqual(skillAnswer(set.skills, { name: "nope" }, null, set.library), { ok: false, text: 'There is no skill or plugin "nope". Find one by your words: action find, words, and no name.' });
  });

  // (fails before: yes — the owner's of 11-07: the tool said a skill off here went on as it loaded, and nothing said
  // what a $<name> in the person's message is)
  test("the skill tool and # Skills say a $<name> names a skill to load, unless already loaded, and the skills it names in turn", () => {
    assert.match(SKILL_TOOL.description, /A \$<name> in the person's message names a skill: load it by that name unless its text is already in this conversation \(any skill of the Library loads, listed for you or not\), and load the skills it names in turn where its work needs them\./);
    assert.ok(!SKILL_TOOL.description.includes("goes on for the chat"));
    assert.match(skillsSections(set.skills)[0], /^# Skills\nYour procedures and know-how\. When a request matches one's description or triggers, load it with the skill tool before you start that work; a \$<name> in the developer's message names one to load, listed here or not\.\n/);
    assert.match(skillsSections(set.skills, { tool: false })[0], /^# Skills\nYour procedures and know-how\. One the developer's message calls as \$<name> comes whole with that message\.\n/, "a model offered no tool is sent it whole");
  });

  // (fails before: yes — a skill not on was never read for a turn)
  test("where no skill tool is offered, the person's /<name> brings a skill off here whole on the loop's message", () => {
    assert.equal(withCalled(set, "fill the pdf for me"), set, "a word is no call");
    const lit = withCalled(set, "/pdf fill the tax form");
    assert.deepEqual([lit.skills.at(-1)?.name, lit.library.length], ["pdf", 0]);
    const triggered = triggeredSkills(lit.skills, "/pdf fill the tax form");
    assert.deepEqual(triggered.map((s) => s.name), ["pdf"]);
    const pdf = lit.skills.at(-1);
    assert.ok(pdf);
    assert.deepEqual(calledNotes(set, "/pdf fill the tax form").map((c) => [c.skill.name, c.text]), [["pdf", calledWords(pdf, { off: true })]], "on the message, said off here");
    assert.ok(!skillsSections(set.skills).join("\n").includes("Open the form"), "never the prompt's");
    assert.match(calledWords(pdf, { off: true }),/^<filament-context kind="skill">\nThe person called \$pdf, a skill of their Library that is off in this chat: here it is whole, for this turn alone\. Its folder: .+\n\nOpen the form, fill each field\.\n<\/filament-context>$/);
  });

  // (fails before: yes — only /<name> called a skill; the message box lists them behind $, the owner's of 10-28)
  test("the person's $<name> calls a skill as /<name> does, on here or off; a $ in a word or a path calls none", () => {
    const lit = withCalled(set, "$pdf fill the tax form");
    assert.deepEqual([lit.skills.at(-1)?.name, lit.library.length], ["pdf", 0], "an off one, loaded for the turn");
    assert.deepEqual(triggeredSkills(lit.skills, "$pdf fill the tax form").map((s) => s.name), ["pdf"]);
    assert.deepEqual(triggeredSkills(set.skills, "use $s007, then stop.").map((s) => s.name), ["s007"], "an on one too, before a comma");
    assert.deepEqual(triggeredSkills(set.skills, "run with $s007.").map((s) => s.name), ["s007"], "at a sentence's end");
    assert.equal(withCalled(set, "echo $pdfs and $HOME/pdf"), set, "a longer word and a path call nothing");
    assert.deepEqual(triggeredSkills(set.skills, "costs $s007x or a$s007"), [], "a $ inside a word is no call");
  });

  test("the store puts the Library's skills off at a chat on its document, with what each is for", () => {
    const data = mkdtempSync(join(tmpdir(), "filament-skills-into-"));
    try {
      const store = createSkillStore({ dataDir: data });
      store.make({ name: "grids", description: "Snap tiles to grids." });
      store.make({ name: "tiles", description: "Rule tiles." });
      const on = store.into({ skills: { on: [{ name: "grids" }] } });
      assert.deepEqual(on.skills.yours.map((/** @type {any} */ y) => y.name), ["grids"]);
      assert.deepEqual(on.skills.library.map((/** @type {any} */ l) => [l.name, l.description]), [["tiles", "Rule tiles."]]);
      const none = store.into({});
      assert.deepEqual(none.skills.library.map((/** @type {any} */ l) => l.name).sort(), ["grids", "tiles"]);
      assert.deepEqual(loadSkills(none).skills, [], "none on: none listed");
    } finally {
      rmSync(data, { recursive: true, force: true });
    }
  });
});

describe("skills on demand through Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-skills-demand-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // A window known, so a chat's compaction line is.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 100000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    assert.equal((await shim.api("/api/skills", { method: "POST", body: { make: "tilemaps", description: "Unity tilemaps: grids and rule tiles." } })).status, 200);
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const d of [shim.dataDir, root])
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
  });

  // (fails before: yes — the owner's of 11-07: the agent's load turned the skill on for the chat, its next compaction
  // listed it, and a $tilemaps rode the message whole; before 11-06 the load was refused)
  test("a chat with no skill on finds one in the Library by words and loads it on demand, turning nothing on; a $<name> sends no text", async () => {
    const chat = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json();
    /** @type {{ system: string, tools: string[], results: string[], last: string }[]} */
    const seen = [];
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const b = call.body;
      const results = ((b.messages || []).at(-1)?.content || []).filter((/** @type {any} */ x) => x?.type === "tool_result").map((/** @type {any} */ x) => JSON.stringify(x.content));
      const last = JSON.stringify((b.messages || []).at(-1));
      seen.push({ system: Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x.text).join("") : String(b.system || ""), tools: (b.tools || []).map((/** @type {any} */ t) => t.name), results, last });
      const blocks = (/** @type {any[]} */ bl, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks: bl, usage: { input_tokens: 9, output_tokens: 3 } });
      if (last.includes("which skill")) return blocks([{ type: "tool_use", id: "f1", name: "skill", input: { action: "find", words: "tilemaps grids" } }], "tool_use");
      if (last.includes("f1")) return blocks([{ type: "tool_use", id: "f2", name: "skill", input: { name: "tilemaps" } }], "tool_use");
      return blocks([{ type: "text", text: "Done." }]);
    };
    const turn = async (/** @type {string} */ content, id = chat.id) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      await r.json();
    };
    await turn("which skill helps with my level's grid?");
    assert.ok(seen[0].tools.includes("skill"), "the skill tool, with no skill on");
    assert.ok(!seen[0].system.includes("# Skills"), "no list: none is on");
    assert.match(seen[1].results[0], /In your Library, not on in this chat — load one by its name all the same:.*- tilemaps — Unity tilemaps: grids and rule tiles\./);
    assert.match(seen[2].results[0], /^"Skill: tilemaps — Unity tilemaps/, "its text, and no word of turning it on");
    await turn("now lay it out");
    assert.equal(seen.at(-1)?.system, seen[0].system, "the next turn's prompt is the first's");
    assert.deepEqual(seen.at(-1)?.tools, seen[0].tools);
    const card = await (await shim.api(`/api/sessions/${encodeURIComponent(chat.id)}/compose`)).json();
    assert.deepEqual(card.current?.printChanged, [], "no card asks about a change");
    const made = await shim.api(`/api/sessions/${encodeURIComponent(chat.id)}/compact`, { method: "POST", body: { method: "fold" } });
    assert.equal(made.status, 200, await made.clone().text());
    await turn("and after the fold");
    assert.ok(!(seen.at(-1)?.system || "").includes("# Skills"), "a compaction lists none: loading it turned nothing on");
    const sent = seen.length;
    await turn("$tilemaps lay out the first level");
    assert.ok(!(seen.at(-1)?.system || "").includes("## Skill:"), "never in the system prompt");
    assert.ok(seen.slice(sent).every((x) => !x.last.includes("Unity tilemaps") && !x.last.includes("The person called")), "nothing of the skill rides the message: the tag is the agent's to load");
    assert.match(seen.at(-1)?.last || "", /\$tilemaps lay out the first level/);
  });

  // (fails before: yes — the review of 1b139de42: a compaction at the send wrote the print the chat sends from before it,
  // the loaded skill held out of it, under the new compaction: the turn after listed the skill, and the card asked the
  // person about a change they never made)
  test("a skill its agent loaded, then a compaction at the send: the print kept is the one sent, and no card asks after", async () => {
    const chat = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json();
    const path = `/api/sessions/${encodeURIComponent(chat.id)}`;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const last = JSON.stringify((call.body.messages || []).at(-1));
      const blocks = (/** @type {any[]} */ bl, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks: bl, usage: { input_tokens: 9, output_tokens: 3 } });
      // The compaction model's call, which carries no tools: a short summary.
      if (!(call.body.tools || []).length) return blocks([{ type: "text", text: "<summary>\nThe tilemaps skill was loaded.\n</summary>" }]);
      if (last.includes("load the tilemaps skill")) return blocks([{ type: "tool_use", id: "g1", name: "skill", input: { name: "tilemaps" } }], "tool_use");
      return blocks([{ type: "text", text: "Done." }]);
    };
    const turn = async (/** @type {string} */ content) => {
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      await r.json();
    };
    await turn(`load the tilemaps skill ${"and the level around it ".repeat(2500)}`);
    const set = await shim.api(`${path}/settings`, { method: "PATCH", body: { patch: { context: { compaction: { thresholdPercent: 10, mode: "auto", method: "summary" } } } } });
    assert.equal(set.status, 200, await set.clone().text());
    await turn("past the line now");
    assert.equal(/** @type {any} */ (shim.app.memory).archive.getCompactions(chat.id).length, 1, "the send compacted the chat");
    const card = await (await shim.api(`${path}/compose`)).json();
    assert.deepEqual(card.current?.printChanged, [], "the print kept is the one the turn sent");
  });
});
