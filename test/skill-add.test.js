// @ts-check
// Add to skill… (src/ui/harness/library/skill-add.js, HarnessV4_Skills_Plan step 4): where a memory's words go in a
// SKILL.md, and the dialog from the skill picked to the words written — on the fake DOM, with a recording api and dialog.
// (fails before: yes — no memory could go into a skill)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { addedWords, addsToSkill, linesFor, openAddToSkill, sectionFor, sectionsOf, withLines } from "../src/ui/harness/library/skill-add.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const GUIDE = "---\nname: release-checks\ndescription: Before a release\n---\n\n# Release checks\n\n## When to use it\nBefore a tag.\n\n## Rules\n- Run the full suite.\n- Never push on Friday.\n\n## Where to look\n- docs/RELEASE.md\n";

describe("where the words go (pure)", () => {
  test("a kind's section; threads and a past session's words go nowhere; a how-to its own heading and steps", () => {
    assert.deepEqual(["rule", "convention", "preference", "decision", "procedure", "fact", "other"].map(sectionFor), ["Rules", "Rules", "Rules", "Rules", "How to work", "Facts", "Rules"]);
    assert.deepEqual(["rule", "procedure", "fact", "thread", "words"].map(addsToSkill), [true, true, true, false, false]);
    assert.deepEqual(linesFor("rule", "  Tag only from main.\n Always. "), ["- Tag only from main. Always."]);
    assert.deepEqual(linesFor("procedure", "How to cut a release: 1. `npm version patch` 2. `npm publish` 3. tag it"), ["### How to cut a release", "1. `npm version patch`", "2. `npm publish`", "3. tag it"]);
    assert.deepEqual(linesFor("procedure", "Bump the version before publishing."), ["- Bump the version before publishing."], "a how-to not in steps: a line");
  });

  test("the sections: past the front matter, outside code fences", () => {
    assert.deepEqual(sectionsOf(GUIDE), ["When to use it", "Rules", "Where to look"]);
    assert.deepEqual(sectionsOf("---\nname: x\n## not a heading: front matter\n---\n## A\n```\n## not one either\n```\n### B\n## C ##\n"), ["A", "C"]);
  });

  test("at the end of its section, before the next; a missing one made at the end; said already; its line ends kept", () => {
    const rules = withLines(GUIDE, "rules", ["- Tag only from main."]);
    assert.equal(rules.text, GUIDE.replace("- Never push on Friday.\n", "- Never push on Friday.\n- Tag only from main.\n"));
    assert.deepEqual([rules.before, rules.made, rules.already], [["- Run the full suite.", "- Never push on Friday."], false, false]);
    const facts = withLines(GUIDE, "Facts", ["- The registry is npmjs.org."]);
    assert.ok(facts.text.endsWith("## Where to look\n- docs/RELEASE.md\n\n## Facts\n\n- The registry is npmjs.org.\n"), facts.text);
    assert.equal(facts.made, true);
    const how = withLines(GUIDE, "Rules", ["### How to tag", "1. git tag", "2. git push --tags"]);
    assert.match(how.text, /- Never push on Friday\.\n\n### How to tag\n1\. git tag\n2\. git push --tags\n\n## Where to look/, "a heading of its own stands apart");
    assert.equal(withLines(GUIDE, "Rules", ["- Run the full suite."]).already, true);
    const empty = withLines("# T\n## Rules\n## Next\n", "Rules", ["- x"]);
    assert.equal(empty.text, "# T\n## Rules\n\n- x\n## Next\n");
    const crlf = withLines(GUIDE.replace(/\n/g, "\r\n"), "Rules", ["- Tag only from main."]);
    assert.ok(crlf.text.includes("- Never push on Friday.\r\n- Tag only from main.\r\n"), "CRLF kept");
    assert.ok(!/[^\r]\n/.test(crlf.text), "no bare LF");
  });

  test("the toast: where it went, and who gets it", () => {
    assert.equal(addedWords("i12", "release-checks", "Rules", true), "Added i12 to release-checks, under Rules. Chats where it is on get it from their next message.");
    assert.equal(addedWords("i12", "release-checks", "Rules", false), "Added i12 to release-checks, under Rules. It is on nowhere: a message that tags it as $release-checks has the agent load it.");
  });
});

/** @param {{ reply?: (path: string, method: string, body: any) => any }} [o] */
function rig(o = {}) {
  /** @type {{ path: string, method: string, body: any }[]} */
  const calls = [];
  /** @type {any[]} */
  const dialogs = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ path, method, body: opts.body });
    const r = o.reply ? await o.reply(path, method, opts.body) : undefined;
    if (r instanceof Error) throw r;
    if (r !== undefined) return r;
    if (path === "/skills?place=all") return { skills: [{ name: "pdf", kind: "linked", places: [] }, { name: "release-checks", kind: "made", places: [{ place: "all", label: "all chats", on: true }] }, { name: "notes", kind: "made", places: [] }] };
    if (path === "/skills/release-checks") return { name: "release-checks", text: GUIDE, cut: false };
    if (path === "/skills/notes") return { name: "notes", text: "---\nname: notes\n---\n\n# notes\n", cut: false };
    return { ok: true };
  };
  const io = /** @type {any} */ ({
    h: fakeH, api,
    dialog: (/** @type {any} */ d) => { const rec = { ...d, closed: false, close() { if (rec.closed) return; rec.closed = true; d.onClose?.(); } }; dialogs.push(rec); return rec; },
  });
  return { io, calls, dialogs, toasts, toast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => { toasts.push([msg, kind]); } };
}
const RULE = { id: "i12", kind: "rule", text: "Tag only from main." };
/** The button under a node whose label is this. @param {any} el @param {string} label */
const button = (el, label) => buttonsOf(el).find((b) => textOf(b) === label);
/** The first node under el with this tag and, if given, this aria-label. @param {any} el @param {string} tag @param {string} [label] @returns {any} */
const byTag = (el, tag, label) => {
  for (const k of el?.kids || []) {
    if (!k || typeof k !== "object") continue;
    if (k.tag === tag && (!label || k.attrs?.["aria-label"] === label)) return k;
    const r = byTag(k, tag, label);
    if (r) return r;
  }
  return null;
};

describe("the dialog", () => {
  test("made skills only, the first picked; the section by its kind, shown in place; Add reads it again, then writes it; the memory stays", async () => {
    const r = rig();
    openAddToSkill(RULE, { toast: r.toast }, r.io);
    await flush();
    const d = r.dialogs[0];
    assert.equal(d.title, "Add i12 to a skill");
    const pick = byTag(d.body, "select", "Skill");
    assert.deepEqual(pick.kids.map((/** @type {any} */ k) => textOf(k)), ["release-checks", "notes"], "made skills only");
    assert.match(textOf(d.body), /It is on for all chats\./);
    assert.equal(byTag(d.body, "select", "Section").kids.map((/** @type {any} */ k) => textOf(k)).join("|"), "Rules|When to use it|Where to look");
    assert.equal(textOf(byTag(d.body, "pre")), "## Rules|…|- Run the full suite.|- Never push on Friday.|- Tag only from main.");
    button(d.body, "Add to release-checks").attrs.onclick();
    await flush();
    const put = r.calls.at(-1);
    assert.deepEqual([put?.path, put?.method, put?.body.path], ["/skills/release-checks/file", "PUT", "SKILL.md"]);
    assert.equal(put?.body.text, GUIDE.replace("- Never push on Friday.\n", "- Never push on Friday.\n- Tag only from main.\n"));
    assert.equal(r.calls.filter((c) => c.path === "/skills/release-checks").length, 2, "read again just before the write");
    assert.ok(d.closed);
    assert.deepEqual(r.toasts, [["Added i12 to release-checks, under Rules. Chats where it is on get it from their next message.", undefined]]);
    assert.ok(!r.calls.some((c) => c.path.startsWith("/memory")), "the memory is not touched");
    // (fails before: yes — the write said nothing of the memory: its History never said where its words went, and the
    // crafter could not tell them from its own)
    assert.deepEqual(put?.body.from, { memory: "i12", section: "Rules", lines: ["- Tag only from main."] }, "the write says whose words they are, where");
  });

  test("the words changed, another section, another skill: the preview follows; the skill picked last is picked first next time", async () => {
    const r = rig();
    openAddToSkill({ id: "i3", kind: "fact", text: "The registry is npmjs.org." }, { toast: r.toast }, r.io);
    await flush();
    const d = r.dialogs[0];
    assert.match(textOf(byTag(d.body, "pre")), /^## Facts — new, at the end\|- The registry is npmjs\.org\.$/);
    const words = byTag(d.body, "textarea", "Its words");
    words.value = "Packages publish to npmjs.org.";
    words.dispatch("input");
    assert.match(textOf(byTag(d.body, "pre")), /- Packages publish to npmjs\.org\.$/);
    const section = byTag(d.body, "select", "Section");
    section.value = "Where to look";
    section.dispatch("change");
    assert.equal(textOf(byTag(d.body, "pre")), "## Where to look|…|- docs/RELEASE.md|- Packages publish to npmjs.org.");
    const pick = byTag(d.body, "select", "Skill");
    pick.value = "notes";
    pick.dispatch("change");
    await flush();
    assert.match(textOf(d.body), /On nowhere: a message that tags it as \$[\w.-]+ has the agent load it\./);
    button(d.body, "Add to notes").attrs.onclick();
    await flush();
    assert.equal(r.calls.at(-1)?.body.text, "---\nname: notes\n---\n\n# notes\n\n## Where to look\n\n- Packages publish to npmjs.org.\n");
    assert.deepEqual(r.toasts.at(-1), ["Added i3 to notes, under Where to look. It is on nowhere: a message that tags it as $notes has the agent load it.", undefined]);
    const again = rig();
    openAddToSkill(RULE, { toast: again.toast }, again.io);
    await flush();
    assert.ok(button(again.dialogs[0].body, "Add to notes"), "notes, picked last");
  });

  test("changed while it was open: shown again, not written; said already, or longer than the page reads: no Add", async () => {
    let text = GUIDE;
    const r = rig({ reply: (path) => (path === "/skills/release-checks" ? { text, cut: false } : path === "/skills?place=all" ? { skills: [{ name: "release-checks", kind: "made", places: [] }] } : undefined) });
    openAddToSkill(RULE, { toast: r.toast }, r.io);
    await flush();
    const d = r.dialogs[0];
    text = GUIDE.replace("- Run the full suite.\n", "- Run the full suite.\n- Lint first.\n");
    button(d.body, "Add to release-checks").attrs.onclick();
    await flush();
    assert.ok(!r.calls.some((c) => c.method === "PUT"), "not written over");
    assert.match(textOf(d.body), /Its SKILL\.md changed while this was open: this is where the words land now\./);
    assert.match(textOf(byTag(d.body, "pre")), /- Lint first\.\|- Never push on Friday\.\|- Tag only from main\.$/);
    button(d.body, "Add to release-checks").attrs.onclick();
    await flush();
    assert.ok(r.calls.at(-1)?.body.text.includes("- Lint first.\n- Never push on Friday.\n- Tag only from main.\n"));

    const said = rig();
    openAddToSkill({ id: "i4", kind: "rule", text: "Run the full suite." }, { toast: said.toast }, said.io);
    await flush();
    assert.ok("disabled" in button(said.dialogs[0].body, "Add to release-checks").attrs);
    assert.match(textOf(said.dialogs[0].body), /release-checks says it already, under Rules\./);

    const long = rig({ reply: (path) => (path === "/skills/release-checks" ? { text: GUIDE, cut: true } : undefined) });
    openAddToSkill(RULE, { toast: long.toast }, long.io);
    await flush();
    assert.ok("disabled" in button(long.dialogs[0].body, "Add to release-checks").attrs);
    assert.match(textOf(long.dialogs[0].body), /Its SKILL\.md is longer than the page reads: it is edited in its folder\./);
  });

  test("no skill made here yet: said, and New skill… makes one, picked here once it is", async () => {
    /** @type {any[]} */
    let skills = [{ name: "pdf", kind: "linked", places: [] }];
    const r = rig({
      reply: (path, method, body) => {
        if (path === "/skills?place=all") return { skills };
        if (path === "/skills" && method === "POST") {
          skills = [...skills, { name: body.make, kind: "made", places: [] }];
          return { ok: true, added: [{ name: body.make }] };
        }
        if (path === "/skills/tagging") return { text: "---\nname: tagging\n---\n", cut: false };
        return undefined;
      },
    });
    openAddToSkill(RULE, { toast: r.toast }, r.io);
    await flush();
    const d = r.dialogs[0];
    assert.match(textOf(d.body), /No skill made in Filament yet: only those are written here\./);
    button(d.body, "New skill…").attrs.onclick();
    const made = r.dialogs[1];
    assert.equal(made.title, "New skill");
    const name = byTag(made.body, "input", "Name");
    name.value = "tagging";
    name.dispatch("input");
    button(made.body, "Make skill").attrs.onclick();
    await flush();
    assert.ok(made.closed);
    assert.ok(!d.closed, "back here");
    assert.ok(button(d.body, "Add to tagging"), "the new one, picked");
    assert.deepEqual(r.toasts[0], ["tagging is made. It is on nowhere: a message that tags it as $tagging has the agent load it.", undefined]);
  });
});
