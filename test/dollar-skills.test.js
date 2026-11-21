// @ts-check
// The skills behind `$` in the message box (the owner's of 10-28: "put the skill behind $ symbol so that to are easy to
// find and load"): `$` lists those on in the chat, then the Library's off here — a pick writes `$<name>`, and the
// message loads it for its turn (agent/skills.js, test/skills-on-demand.test.js) —, then the on plugins'; typing
// filters by name and words; a `$` that names none (`$PATH`) shows no panel at all.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

const settle = () => new Promise((r) => setTimeout(r, 10));

const SKILLS = {
  skills: [
    { name: "pdf", description: "Read and fill PDF forms", on: { on: false } },
    { name: "tilemaps", description: "Unity tilemaps: grids and rule tiles", on: { on: true } },
  ],
  plugins: [
    { name: "linear", title: "Linear", on: true, skills: ["linear:triage"] },
    { name: "figma", title: "Figma", on: false, skills: ["figma:inspect"] },
  ],
};

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
/** @type {string[]} */
const asked = [];
/** The server, up or down. */
const net = { down: false };
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  if (net.down) return { ok: false, status: 500, json: async () => ({ error: "down" }), text: async () => "down" };
  return { ok: true, status: 200, json: async () => (String(url).startsWith("/api/skills") ? SKILLS : {}) };
};
const { createSlashPanel, skillRows, SKILL_SECTIONS } = await import("../src/ui/harness/composer/slash.js");
const { referenceChips } = await import("../src/ui/harness/lib/labels.js");
after(() => { g.fetch = realFetch; });

// (fails before: yes — no `$` list: the box listed no skill anywhere, and only a typed /<name> called one)
test("the $ list's rows: on here first, then the Library's off here, then the on plugins'; typing keeps names and words that hold it", () => {
  const rows = skillRows(SKILLS, "");
  assert.deepEqual(rows.map((r) => [r.section, r.label, r.insert]), [
    [SKILL_SECTIONS.on, "$tilemaps", "$tilemaps "],
    [SKILL_SECTIONS.off, "$pdf", "$pdf "],
    [SKILL_SECTIONS.plugin, "$linear:triage", "$linear:triage "],
  ]);
  assert.deepEqual(skillRows(SKILLS, "forms").map((r) => r.label), ["$pdf"], "by its words too");
  assert.deepEqual(skillRows(SKILLS, "tri").map((r) => r.label), ["$linear:triage"]);
  assert.deepEqual(skillRows(null, ""), [], "no answer, no rows");
});

// (fails before: yes — the Hunter of 10-28: `$5` listed the shipped working-rules skill, whose words say "Opus 5.5", and
// `$H`, `$HO` flashed it for its "How")
test("a description holds the word typed only at a word's start, three characters on: $5 and $HO name no skill", () => {
  const shipped = { skills: [{ name: "opus-5-5-working-rules", description: "How to work on a codebase as Opus 5.5 does", on: { on: true } }, { name: "pdf", description: "Read and fill PDF forms", on: { on: false } }] };
  for (const q of ["h", "ho", "co", "as"]) assert.deepEqual(skillRows(shipped, q), [], `$${q}`);
  assert.deepEqual(skillRows(shipped, "opus").map((r) => r.label), ["$opus-5-5-working-rules"], "its name holds it");
  assert.deepEqual(skillRows(shipped, "5-working").map((r) => r.label), ["$opus-5-5-working-rules"], "a name holds any part");
  assert.deepEqual(skillRows(shipped, "5-5"), [], "a word with no letter: only a name that starts with it");
  assert.deepEqual(skillRows(shipped, "codebase").map((r) => r.label), ["$opus-5-5-working-rules"], "a word of its description");
  assert.deepEqual(skillRows(shipped, "odebase"), [], "a word's middle is no word typed");
});

// (fails before: yes — the Hunter of 10-28: `$name` stayed plain text in the sent bubble, though `/name` and `@file`
// became chips and the `$` icon was there for one)
test("a sent $<name> is a chip in the bubble; $HOME, $5 and a price are words", () => {
  const chips = (/** @type {string} */ s) => referenceChips(s).filter((p) => p.kind === "ref").map((p) => /** @type {any} */ (p).mark + /** @type {any} */ (p).name);
  assert.deepEqual(chips("$pdf fill the form, then /review"), ["$pdf", "/review"]);
  assert.deepEqual(chips("(see $linear:triage)."), ["$linear:triage"]);
  assert.deepEqual(chips("it costs $5, and $HOME is set; echo $Path"), []);
});

describe("the $ panel", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  test("lists the skills where the chat stands, and a pick writes $<name>", async () => {
    asked.length = 0;
    /** @type {string[]} */
    const inserted = [];
    const panel = createSlashPanel({ onInsert: (text) => inserted.push(text), getChain: () => "c1" });
    await panel.open("$", "");
    await settle();
    assert.equal(asked[0], "/api/skills?place=chat%3Ac1", "at the chat's place: on and off as it has them");
    assert.equal(panel.isOpen(), true);
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "Skills");
    const rows = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"));
    assert.deepEqual(rows.map((r) => r.querySelector(".slash-label")?.textContent), ["$tilemaps", "$pdf", "$linear:triage"]);
    rows[1].dispatch("click");
    assert.deepEqual(inserted, ["$pdf "]);
    assert.equal(panel.isOpen(), false);
  });

  // (fails before: yes, the Hunter of 10-28 — `$5` listed the shipped working-rules skill, whose name and words hold a
  // 5, and each `$HOME` asked the server for the skills)
  test("a $ that names no skill — $HOME, $5 — shows no panel and asks nothing; a lower-case word naming none shows none either", async () => {
    asked.length = 0;
    const panel = createSlashPanel({ onInsert: () => {}, getChain: () => "" });
    for (const typed of ["H", "HO", "HOM", "HOME", "5", "5.50"]) {
      await panel.open("$", typed);
      await settle();
      assert.equal(panel.isOpen(), false, `$${typed}`);
      assert.ok(panel.el.classList.contains("hidden"), "never shown, not even as Searching…");
    }
    assert.deepEqual(asked, [], "a variable and a price: a skill's name is lower case, so nothing is asked");
    for (const typed of ["zz", "zzz"]) {
      await panel.open("$", typed);
      await settle();
      assert.equal(panel.isOpen(), false, `$${typed}`);
    }
    assert.deepEqual(asked, ["/api/skills?place=all"], "a chat not started: everywhere's; read once for the word");
    await panel.open("$", "pd");
    await settle();
    assert.equal(panel.isOpen(), true, "a name that holds it opens it");
  });

  // (fails before: yes — the Hunter of 10-28: the one box kept the first chat's skills for ten seconds, so the next chat's
  // `$` listed its on and off as the last one had them)
  test("another chat, or this one once it started, reads its own skills: never the last chat's, kept for a while", async () => {
    asked.length = 0;
    let chain = "";
    const panel = createSlashPanel({ onInsert: () => {}, getChain: () => chain });
    for (const now of ["", "c1", "c1", "c2"]) {
      chain = now;
      await panel.open("$", "");
      await settle();
      panel.close();
    }
    assert.deepEqual(asked, ["/api/skills?place=all", "/api/skills?place=chat%3Ac1", "/api/skills?place=chat%3Ac2"], "read again where the chat changed, once where it stayed");
  });

  // (fails before: yes — the Hunter of 10-28: a chat's skills that could not be read fell back to everywhere's, kept as
  // the chat's for ten seconds, its on and off wrong)
  test("a chat's skills that could not be read show no panel, are never everywhere's, and are read again at the next $", async () => {
    asked.length = 0;
    net.down = true;
    try {
      const panel = createSlashPanel({ onInsert: () => {}, getChain: () => "c9" });
      await panel.open("$", "");
      await settle();
      assert.equal(panel.isOpen(), false);
      await panel.open("$", "p");
      await settle();
      assert.deepEqual(asked.filter((u) => u.startsWith("/api/skills")), ["/api/skills?place=chat%3Ac9", "/api/skills?place=chat%3Ac9"]);
    } finally {
      net.down = false;
    }
  });

  // (fails before: yes — the Hunter of 10-28: the panel stayed open after a send, or another chat's draft, and the next
  // Enter put a skill in the box in place of sending)
  test("the box's panel closes once its words are sent or set by the page: the next Enter sends", async () => {
    const kept = new Map();
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v), removeItem: (/** @type {string} */ k) => kept.delete(k) };
    try {
      const { createComposer } = await import("../src/ui/harness/composer/composer.js");
      const host = /** @type {any} */ (doc.document.createElement("div"));
      /** @type {string[]} */
      const sent = [];
      const c = createComposer(host, { onSend: (/** @type {string} */ text) => (sent.push(text), true), onStop: () => {}, getChat: () => /** @type {any} */ ({ chainId: "c1", turns: [] }) });
      // The message box (rich-box.js): its words set as a textarea's, the caret at their end, and the browser's input heard.
      const box = host.querySelector(".composer-input");
      const panel = host.querySelector(".slash-panel");
      const type = async (/** @type {string} */ text) => {
        box.value = text;
        box.dispatch("input");
        await settle();
      };
      const enter = () => box.dispatch("keydown", { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, preventDefault: () => {} });
      await type("fix it $");
      assert.equal(panel.classList.contains("hidden"), false, "the $ list is open");
      host.querySelector(".send").onclick();
      assert.deepEqual(sent, ["fix it $"]);
      assert.equal(panel.classList.contains("hidden"), true, "sent: closed");
      box.value = "and the next";
      enter();
      assert.deepEqual(sent, ["fix it $", "and the next"], "Enter sends");

      await type("$");
      assert.equal(panel.classList.contains("hidden"), false);
      c.setDraft("another chat's draft");
      assert.equal(panel.classList.contains("hidden"), true, "another chat's words: closed");
      enter();
      assert.deepEqual(sent.at(-1), "another chat's draft");
    } finally {
      delete g.localStorage;
    }
  });
});

// (fails before: yes — the Hunter of 10-28: `$HOME` and `$PATH` loaded a skill named home or path, with no chip to say so)
test("a $ call is the skill's name as written: $HOME loads no skill named home; /HOME still calls it in any case", async () => {
  const { triggeredSkills } = await import("../src/app/agent/skills.js");
  const skills = /** @type {any[]} */ ([{ name: "home", triggers: [] }, { name: "Deploy", triggers: [] }]);
  const names = (/** @type {string} */ m) => triggeredSkills(skills, m).map((s) => s.name);
  assert.deepEqual(names("set $HOME first"), []);
  assert.deepEqual(names("use $home now"), ["home"]);
  assert.deepEqual(names("run $Deploy."), ["Deploy"]);
  assert.deepEqual(names("run $deploy"), [], "not as it is named");
  assert.deepEqual(names("/HOME please"), ["home"], "a / call in any case, as before");
});

// (fails before: yes — the Hunter of 10-28: a plugin's skill was listed by its folder, and a pick called no skill)
test("a plugin's skill is listed by the name its front matter gives it", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pluginSkillName } = await import("../src/app/agent/skills.js");
  const root = mkdtempSync(join(tmpdir(), "filament-plugskill-"));
  try {
    mkdirSync(join(root, "skills", "pdf-tools"), { recursive: true });
    writeFileSync(join(root, "skills", "pdf-tools", "SKILL.md"), "---\nname: pdf\ndescription: Fill PDF forms\n---\nBody\n");
    mkdirSync(join(root, "skills", "bare"), { recursive: true });
    writeFileSync(join(root, "skills", "bare", "SKILL.md"), "No front matter\n");
    assert.equal(pluginSkillName(join(root, "skills", "pdf-tools", "SKILL.md"), "docs"), "docs:pdf");
    assert.equal(pluginSkillName(join(root, "skills", "bare", "SKILL.md"), "docs"), "docs:bare", "its folder's, where it names none");
    assert.equal(pluginSkillName(join(root, "skills", "gone", "SKILL.md"), "docs"), "docs:gone", "unreadable: its folder's");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: yes — the Hunter of 10-28: a skill's name may start with a capital or a digit, and `$D` or `$3` closed
// the panel on it)
test("a word with no lower-case letter keeps the names that start with it as written: $HOME and $5 name none, $D and $3 do", () => {
  const got = { skills: [{ name: "Deploy", description: "Ship it", on: { on: true } }, { name: "3d-print", description: "Slice a model", on: { on: false } }, { name: "home-notes", description: "", on: { on: false } }] };
  assert.deepEqual(skillRows(got, "d", "D").map((r) => r.label), ["$Deploy"]);
  assert.deepEqual(skillRows(got, "3", "3").map((r) => r.label), ["$3d-print"]);
  assert.deepEqual(skillRows(got, "home", "HOME"), [], "a variable: home-notes is not HOME");
  assert.deepEqual(skillRows(got, "5", "5"), []);
  assert.deepEqual(skillRows(got, "dep", "dep").map((r) => r.label), ["$Deploy"], "lower case finds any case, as before");
});

// (fails before: yes — the Hunter of 10-28: a chip needed a lower-case first letter and no dot, so $Deploy, $3d-print
// and $v1.2-notes stayed words though they loaded)
test("once the page has read the skills, a sent $<name> is a chip where it names one, as written", async () => {
  const { noteSkillNames } = await import("../src/ui/harness/lib/labels.js");
  noteSkillNames(["Deploy", "3d-print", "v1.2-notes", "pdf", "linear:triage"]);
  const chips = (/** @type {string} */ s) => referenceChips(s).filter((p) => p.kind === "ref").map((p) => /** @type {any} */ (p).mark + /** @type {any} */ (p).name);
  assert.deepEqual(chips("$Deploy then $3d-print, and $v1.2-notes."), ["$Deploy", "$3d-print", "$v1.2-notes"]);
  assert.deepEqual(chips("$deploy, $HOME, $Path, $5 and $env:Path"), [], "names it has not read are words, whatever their case");
  assert.deepEqual(chips("(see $linear:triage). $pdf"), ["$linear:triage", "$pdf"]);
});

test("the message box opens the $ list as it opens / @ and #, and its placeholder says so", () => {
  const src = readFileSync(new URL("../src/ui/harness/composer/composer.js", import.meta.url), "utf8");
  assert.match(src, /const token = \/\(\?:\^\|\\s\)\(\[\/@#\$\]\)\(\[\^\\s\]\*\)\$\/\.exec\(upTo\);/);
  assert.match(src, /"Ask Filament anything, @ to ask an agent or add context, \/ for commands, \$ for skills"/);
});
