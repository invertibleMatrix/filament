// @ts-check
// HarnessV4_Skills_Plan S1-6, the page half (the Designer's of 10-27): Library › Skills on the fake DOM — the words a row,
// a toast and a confirm say; one place's list with a switch per skill, ↺ back to what it inherits, a plugin's skills
// with no switch of their own; the empty list naming what the agents keep; Add skills… with nothing ticked and its
// button naming the place; a skill's own page. The server half is in skills-api.test.js.
// (fails before: Library › Abilities stood here; skills were a switch and a folder list in Settings › Instructions)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bookLine, emptyWords, filesShown, fromChip, fromLine, noTextLine, noteWords, overWords, pageSpans, partsWords, removeWords, renderSkillPage, renderSkills, skillsPlace, toastWords, updatedWords, whereWords } from "../src/ui/harness/library/skills.js";
import { LIBRARY_PAGES, parseRoute, routeFor } from "../src/ui/harness/lib/router.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const button = (/** @type {any} */ el, /** @type {string} */ words) => {
  const b = buttonsOf(el).find((x) => textOf(x) === words);
  assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
  return b;
};
/** Every node under `el` named `label` for a screen reader. @param {any} el @param {string} label */
const labelled = (el, label) => {
  /** @type {any[]} */
  const out = [];
  const walk = (/** @type {any} */ n) => {
    if (!n || typeof n !== "object") return;
    if (n.attrs?.["aria-label"] === label) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};

/** A skill as the list answers it. @param {Record<string, any>} [o] */
const skill = (o = {}) => ({ name: "unity-cli", kind: "linked", from: "codex", fromWords: "Codex", path: "C:/u/.agents/skills/unity-cli", description: "Run Unity from the command line", there: true, at: 1, on: { place: "all", label: "all chats", on: true, here: true, from: null }, places: [{ place: "all", label: "all chats", on: true }], ...o });
const listOf = (/** @type {Record<string, any>} */ o = {}) => ({ place: { place: "all", label: "all chats", projectId: null, chainId: null }, skills: [skill()], plugins: [], count: 1, most: 64, ...o });

/** The page on the fake DOM with a recording server, menu, dialog and confirm. @param {{ reply?: (path: string, method: string, body: any) => any, start?: string | null, confirm?: boolean }} [o] */
function pageWith(o = {}) {
  /** @type {{ path: string, method: string, body: any }[]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const menus = [];
  /** @type {any[]} */
  const dialogs = [];
  /** @type {any[]} */
  const asks = [];
  /** @type {string[]} */
  const went = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ path, method, body: opts.body });
    const r = o.reply ? await o.reply(path, method, opts.body) : undefined;
    if (r instanceof Error) throw r;
    if (r !== undefined) return r;
    if (path.startsWith("/memory/projects")) return { projects: [{ id: "p1", name: "Unity Game" }] };
    if (path.startsWith("/spaces/own")) return { spaces: [] };
    if (path.startsWith("/skills?")) return listOf();
    if (path.startsWith("/skills/found")) return { agents: [] };
    return { ok: true };
  };
  const body = fakeH("div");
  const acts = fakeH("span");
  const io = /** @type {any} */ ({
    h: fakeH, api,
    menu: (/** @type {any[]} */ items, /** @type {any} */ mo) => menus.push({ items, o: mo }),
    dialog: (/** @type {any} */ d) => { const rec = { ...d, closed: false, close() { if (rec.closed) return; rec.closed = true; d.onClose?.(); } }; dialogs.push(rec); return rec; },
    confirm: async (/** @type {any} */ q) => { asks.push(q); return o.confirm ?? true; },
    go: (/** @type {string} */ hash) => went.push(hash),
  });
  return { body, acts, io, calls, toasts, menus, dialogs, asks, went, onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => toasts.push([msg, kind]) };
}

describe("the words (pure)", () => {
  test("a chip, where it is on, the note beside Applies to, a toast, Remove's warning by source, the page's line, over the most, the empty list", () => {
    // the agents' names are the server's (fromWords): the page holds no table of them (FB 6)
    const came = [["linked", "claude-code", "Claude Code"], ["linked", "codex", "Codex"], ["linked", "cursor", "Cursor"], ["linked", "folder", "a folder"], ["git", "git", "git"], ["made", "made", "made in Filament"], ["shipped", "filament", "filament"]];
    assert.deepEqual(came.map(([kind, from, fromWords]) => fromChip({ kind, from, fromWords })), ["Claude Code's", "Codex's", "Cursor's", "imported", "from git", "made here", "Filament's"]);
    assert.equal(whereWords([{ label: "all chats", on: true }, { label: "Unity Game", on: true }, { label: "Work", on: false }]), "on for all chats, Unity Game · off for Work");
    assert.equal(whereWords([{ label: "all chats", on: true }]), "on for all chats");
    // On nowhere is no fault: a tag loads it all the same (Product's mock A of 11-07).
    assert.equal(whereWords([]), "");
    assert.equal(whereWords([{ label: "Work", on: false }]), "", "off where nothing beneath turns it on says nothing more");
    assert.equal(noteWords("all", null), "Every chat gets these, unless its project or the chat turns one off.");
    assert.equal(noteWords("project:w", { space: true, shows: 2 }), "Chats in this Space and in the 2 projects it shows get what's on for all chats, with the changes you make here.");
    assert.equal(noteWords("project:p", { name: "webshop" }), "Chats in webshop get what's on for all chats, with the changes you make here.");
    assert.equal(toastWords("unity-cli", true, "Unity Game", 52), "unity-cli is always on in Unity Game: about 52 tokens in every message, starting with each chat's next message.");
    assert.equal(toastWords("unity-cli", false, "Unity Game"), "unity-cli is off for Unity Game. Tag it as $unity-cli when you need it.");
    assert.equal(updatedWords("alpha", { changed: true, before: "aaa", now: "bbb", added: [{ name: "gamma" }, { name: "delta" }] }), "alpha is up to date: aaa → bbb. New in it: gamma, delta.");
    assert.equal(updatedWords("alpha", { changed: false, before: "aaa", now: "aaa" }), "alpha was up to date already.");
    assert.equal(removeWords({ kind: "linked", from: "codex", fromWords: "Codex" }), "The files stay in Codex's folder; Codex keeps loading it.");
    assert.equal(removeWords({ kind: "linked", from: "folder" }), "The folder stays; Filament stops reading it.");
    assert.equal(removeWords({ kind: "git", from: "git" }), "Filament's copy goes.");
    assert.equal(fromLine({ kind: "linked", from: "codex", fromWords: "Codex", path: "x" }), "From Codex's folder — Codex loads it itself; Filament gives it to the other agents.");
    assert.equal(overWords("Unity Game", 70, 64), "Unity Game has 70 skills on: its chats get the first 64, and 6 are left out.");
    assert.equal(emptyWords([{ label: "Claude Code", skills: [1, 2] }, { label: "Codex", skills: [1, 2, 3] }, { label: "Cursor", skills: [] }]), "No skills yet. Your agents keep 5 on this computer, each for itself — Claude Code 2 · Codex 3.");
    assert.equal(emptyWords([]), "No skills yet. A skill is a folder with a SKILL.md: add one from this computer or a git address, or make one here.");
  });

  test("Skills takes Abilities' place in the Library, and a skill has an address of its own", () => {
    // Connectors is a part of Plugins & Connectors since the owner's of 11-09 (test/library-plugins-connectors.test.js).
    assert.deepEqual(LIBRARY_PAGES, ["agents", "skills", "memory", "plugins"]);
    assert.equal(routeFor("library", { page: "skills", scope: "unity-cli" }), "#/library/skills/unity-cli");
    assert.deepEqual(parseRoute("#/library/skills/unity-cli"), { kind: "library", page: "skills", scope: "unity-cli" });
    // (fails before: yes — Hunter's find: an old bookmark of Abilities opened Agents and teams)
    assert.deepEqual(parseRoute("#/library/abilities"), { kind: "library", page: "skills", scope: "" }, "the old page's address opens what took its place");
    assert.deepEqual(parseRoute("#/library/nope"), { kind: "library", page: "agents", scope: "" }, "an unknown page, the first");
  });
});

describe("the list", () => {
  test("a row: its name opens it, where it came from and is on, its words; the switch for the place picked; Add skills… in the title row", async () => {
    const p = pageWith();
    renderSkills(p.body, { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    assert.match(textOf(p.body), /Always on in\|All chats/);
    assert.match(textOf(p.body), /\$unity-cli\|Codex's · on for all chats\|Run Unity from the command line/);
    assert.equal(textOf(p.acts), "New skill…|Add skills…");
    button(p.body, "$unity-cli").dispatch("click");
    assert.deepEqual(p.went, ["#/library/skills/unity-cli"]);
    const sw = labelled(p.body, "unity-cli for All chats")[0];
    assert.equal(sw.attrs["aria-checked"], "true");
    sw.dispatch("click");
    await flush();
    assert.deepEqual(p.calls.find((c) => c.method === "POST"), { path: "/skills/unity-cli/on", method: "POST", body: { place: "all", on: false } });
    assert.deepEqual(p.toasts.at(-1), ["unity-cli is off for all chats. Tag it as $unity-cli when you need it.", undefined]);
    assert.equal(labelled(p.body, "unity-cli: back to what it inherits").length, 0, "All chats inherits nothing");
  });

  test("a project picked: its own word on a skill can go back to what it inherits; a plugin's skills have no switch; over the most, said", async () => {
    const p = pageWith({
      reply: (path) =>
        path.startsWith("/skills?place=project")
          ? listOf({
              place: { place: "project:p1", label: "Unity Game" },
              skills: [skill({ on: { place: "project:p1", label: "Unity Game", on: false, here: true, from: null } })],
              plugins: [{ id: "linear@m", name: "linear", title: "Linear", skills: ["linear:triage"], commands: ["linear:standup"], on: true, places: ["Work"] }],
              count: 70,
            })
          : undefined,
    });
    renderSkills(p.body, { onToast: p.onToast, start: "project:p1" }, p.io);
    await flush();
    assert.match(textOf(p.body), /Unity Game has 70 skills on: its chats get the first 64, and 6 are left out\./);
    assert.match(textOf(p.body), /Linear plugin\|on where Linear is on: Work\|Open Linear ›\|linear:triage\|\/linear:standup\|a command you can also type/);
    assert.equal(labelled(p.body, "linear:triage for Unity Game").length, 0);
    labelled(p.body, "unity-cli: back to what it inherits")[0].dispatch("click");
    await flush();
    assert.deepEqual(p.calls.filter((c) => c.method === "POST").at(-1)?.body, { place: "project:p1", on: null });
    button(p.body, "Open Linear ›").dispatch("click");
    assert.deepEqual(p.went, ["#/library/plugins/linear%40m"]);
  });

  test("⋯: Open, Update for a git one, Remove from Filament… with its source's words", async () => {
    const p = pageWith({ reply: (path) => (path.startsWith("/skills?") ? listOf({ skills: [skill({ kind: "git", from: "git", name: "pack" })] }) : undefined) });
    renderSkills(p.body, { onToast: p.onToast }, p.io);
    await flush();
    labelled(p.body, "More for pack")[0].dispatch("click");
    assert.deepEqual(p.menus[0].items.map((/** @type {any} */ i) => i.label || i.type), ["Open", "Update", "separator", "Remove from Filament…"]);
    p.menus[0].items[3].onClick();
    await flush();
    assert.deepEqual(p.asks[0], { title: "Remove pack from Filament?", description: "It goes off every chat. Filament's copy goes.", confirmLabel: "Remove", destructive: true });
    assert.ok(p.calls.some((c) => c.method === "DELETE" && c.path === "/skills/pack"));
  });

  // (fails before: yes — Hunter's finds: a place whose list could not be read kept the last place's switches, which
  // then wrote to the new place from the old place's state; and Back to Skills had no place to come back to)
  test("a place that can't be read says why, with no switches of another place's; the place picked is kept for Back to Skills", async () => {
    const p = pageWith({ reply: (path) => (path.startsWith("/skills?place=project") ? new Error("the project's settings can't be read") : undefined) });
    renderSkills(p.body, { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    assert.equal(labelled(p.body, "unity-cli for All chats").length, 1);
    button(p.body, "A project ▾").dispatch("click");
    await flush();
    p.menus.at(-1).items[0].onClick();
    await flush();
    assert.match(textOf(p.body), /the project's settings can't be read/);
    assert.equal(buttonsOf(p.body).filter((b) => /^unity-cli for /.test(String(b.attrs["aria-label"] || ""))).length, 0, "no switch from another place");
    assert.equal(skillsPlace(), "project:p1");
    button(p.body, "All chats").dispatch("click");
    await flush();
    assert.equal(skillsPlace(), "all");
  });

  // (fails before: yes — Hunter's find: each letter painted the list again, field and all, so the field lost the focus)
  test("the filter: typing filters the rows alone, the field stays the one typed in", async () => {
    const many = Array.from({ length: 13 }, (_, i) => skill({ name: `skill-${i}`, description: i === 3 ? "Ship a build" : "Other work" }));
    const p = pageWith({ reply: (path) => (path.startsWith("/skills?") ? listOf({ skills: many, count: many.length }) : undefined) });
    renderSkills(p.body, { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    const field = p.body.querySelector("skl-filter");
    assert.ok(field);
    field.dispatch("input", { target: { value: "ship" } });
    assert.equal(p.body.querySelector("skl-filter"), field, "the same field, still in the page");
    assert.deepEqual(buttonsOf(p.body).filter((b) => b.attrs.class === "skl-name").map((b) => textOf(b)), ["$skill-3"]);
    field.dispatch("input", { target: { value: "nothing like it" } });
    assert.match(textOf(p.body), /None of your skills holds those words\./);
    assert.equal(p.body.querySelector("skl-filter"), field);
  });

  test("empty: what the agents keep on this computer, and Add skills…", async () => {
    const p = pageWith({ reply: (path) => (path.startsWith("/skills?") ? listOf({ skills: [] }) : path.startsWith("/skills/found") ? { agents: [{ agent: "codex", label: "Codex", folders: ["C:/h/.agents/skills"], skills: [{ name: "ui" }, { name: "unity-cli" }] }] } : undefined) });
    renderSkills(p.body, { onToast: p.onToast }, p.io);
    await flush();
    assert.match(textOf(p.body), /No skills yet\. Your agents keep 2 on this computer, each for itself — Codex 2\.\|Add skills…/);
  });
});

describe("Add skills…", () => {
  test("nothing ticked; one yours or clashing has no tick; ticked ones and a typed address go to the place the button names", async () => {
    const found = { agents: [
      { agent: "claude-code", label: "Claude Code", folders: ["C:/Users/a/.claude/skills"], where: ["~/.claude/skills"], skills: [{ name: "docs", description: "Editable docs", path: "C:/c/docs", added: false, clash: null }, { name: "pdf", description: "", path: "C:/c/pdf", added: true, clash: null }] },
      { agent: "codex", label: "Codex", folders: ["C:/Users/a/.codex/skills"], where: ["~/.agents/skills"], skills: [{ name: "ui", description: "Unity UI", path: "C:/x/ui", added: false, clash: null }, { name: "docs", description: "", path: "C:/x/docs", added: false, clash: "docs" }] },
    ] };
    const p = pageWith({ reply: (path, method) => (path.startsWith("/skills/found") ? found : path === "/skills" && method === "POST" ? { ok: true, added: [{ name: "ui" }], skipped: [] } : undefined) });
    renderSkills(p.body, { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    button(p.acts, "Add skills…").dispatch("click");
    await flush();
    const d = p.dialogs[0];
    assert.deepEqual([d.title, d.description, d.wide], ["Add skills", "Into your skills: a tag loads one when you need it, and its switch turns it on for chats that should always have it.", true]);
    const text = textOf(d.body);
    assert.match(text, /Found on this computer\|Your agents keep these for themselves\./);
    assert.match(text, /Claude Code\|2 · ~\/\.claude\/skills/);
    assert.match(text, /Codex\|2 · ~\/\.agents\/skills/, "the folder that holds them, not the agent's first");
    assert.match(text, /In your skills already\./);
    assert.match(text, /Another skill is named docs: this one would be left out\./);
    const ticks = labelled(d.body, "Add ui");
    assert.equal(ticks.length, 1);
    assert.equal(labelled(d.body, "Add pdf").length, 0);
    assert.ok(!ticks[0].attrs.checked, "nothing ticked by default");
    const add = button(d.body, "Add");
    assert.ok("disabled" in add.attrs);
    ticks[0].dispatch("change", { target: { checked: true } });
    assert.ok(!("disabled" in add.attrs));
    const typed = labelled(d.body, "A folder or a git address")[0];
    typed.value = "owner/skills";
    add.dispatch("click");
    await flush();
    const posts = p.calls.filter((c) => c.method === "POST" && c.path === "/skills").map((c) => c.body);
    assert.deepEqual(posts, [{ paths: ["C:/x/ui"], place: "all", on: false }, { git: "owner/skills" }], "turned on nowhere: what it adds is tagged when needed");
    assert.equal(d.closed, true);
    assert.deepEqual(p.toasts[0], ["2 skills are added: tag one with $ and its name when you need it.", undefined]);
  });
});

describe("a skill's page", () => {
  test("where it came from, where it is on, what it costs; its files beside SKILL.md drawn; another file read; a made one is edited and saved", async () => {
    const page = { ...skill({ name: "game-rules", kind: "made", from: "made" }), text: "---\nname: game-rules\n---\n# Rules\nPlay fair.", files: [{ path: "references", dir: true, size: 0 }, { path: "references/01.md", dir: false, size: 9 }, { path: "SKILL.md", dir: false, size: 40 }], more: false, places: [{ place: "all", label: "all chats", on: true }], lineTokens: 12 };
    const p = pageWith({ reply: (path, method) => (path === "/skills/game-rules" ? page : path.startsWith("/skills/game-rules/file?") ? { path: "references/01.md", text: "# One\nThe board.", size: 16 } : method === "PUT" ? { ok: true } : undefined) });
    /** @type {string[]} */
    const head = [];
    renderSkillPage(p.body, "game-rules", { onToast: p.onToast, acts: p.acts, head: (t, l) => head.push(t, l) }, p.io);
    await flush();
    assert.deepEqual(head, ["game-rules", "Run Unity from the command line"]);
    const text = textOf(p.body);
    assert.match(text, /Made in Filament: written here\./);
    assert.match(text, /Always on in\|All chats\|Change…/);
    assert.match(text, /Every request where it is on: about 12 tokens; the rest loads only when it is used\./);
    assert.match(text, /Files\|references\/\|01\.md\|SKILL\.md/);
    assert.match(text, /SKILL\.md · 40 B/, "its size on disk, as its folder lists it");
    assert.equal(textOf(p.acts), "Remove…");
    button(p.body, "01.md").dispatch("click");
    await flush();
    assert.ok(p.calls.some((c) => c.path === "/skills/game-rules/file?path=references%2F01.md"));
    assert.match(textOf(p.body), /references\/01\.md · 16 B/);
    button(p.body, "SKILL.md").dispatch("click");
    await flush();
    button(p.body, "Edit").dispatch("click");
    const area = labelled(p.body, "game-rules's SKILL.md")[0];
    area.value = "---\nname: game-rules\n---\nPlay fairer.";
    button(p.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual(p.calls.find((c) => c.method === "PUT"), { path: "/skills/game-rules/file", method: "PUT", body: { path: "SKILL.md", text: "---\nname: game-rules\n---\nPlay fairer." } });
  });

  // (fails before: yes — Hunter's finds: a slow file read landed over the one picked after it; a SKILL.md past what the
  // page reads was edited from its start and saved as the whole)
  test("a file read late does not cover the one picked after it; a SKILL.md longer than the page reads is not edited here", async () => {
    /** @type {(v: any) => void} */
    let release = () => {};
    const slow = new Promise((r) => { release = r; });
    const page = { ...skill({ name: "game-rules", kind: "made", from: "made" }), text: "---\nname: game-rules\n---\nRules.", files: [{ path: "a.md", dir: false, size: 5 }, { path: "b.md", dir: false, size: 5 }, { path: "SKILL.md", dir: false, size: 30 }], places: [], lineTokens: 9 };
    const p = pageWith({ reply: (path) => (path === "/skills/game-rules" ? page : path.endsWith("path=a.md") ? slow : path.endsWith("path=b.md") ? { path: "b.md", text: "Bee.", size: 4 } : undefined) });
    renderSkillPage(p.body, "game-rules", { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    button(p.body, "a.md").dispatch("click");
    button(p.body, "b.md").dispatch("click");
    await flush();
    release({ path: "a.md", text: "Ay.", size: 3 });
    await flush();
    const view = p.body.querySelector("skl-view");
    assert.match(textOf(view), /b\.md · 4 B/);
    assert.doesNotMatch(textOf(view), /a\.md/, "the late one is not shown");

    const long = { ...page, cut: true, files: [{ path: "SKILL.md", dir: false, size: 1_400_000 }] };
    const q = pageWith({ reply: (path) => (path === "/skills/game-rules" ? long : undefined) });
    renderSkillPage(q.body, "game-rules", { onToast: q.onToast, acts: q.acts }, q.io);
    await flush();
    assert.match(textOf(q.body), /SKILL\.md · 1\.3 MB\|It is longer than the page reads: its start is shown, and it is edited in its folder/);
    assert.equal(buttonsOf(q.body).filter((b) => textOf(b) === "Edit").length, 0, "no Edit");
  });

  test("on nowhere: Turn on for… opens the places, a switch each", async () => {
    const page = { ...skill({ name: "books", kind: "linked", from: "folder" }), text: "x", files: [], places: [], lineTokens: 8 };
    const p = pageWith({ reply: (path) => (path === "/skills/books" ? page : path.startsWith("/skills/books/on?") ? { on: false, here: false, from: null } : undefined) });
    renderSkillPage(p.body, "books", { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    assert.match(textOf(p.body), /Always on nowhere: tag it as \$books in a message when you need it\./);
    assert.match(textOf(p.body), /Read-only here: change it in its folder\./);
    button(p.body, "Turn on for…").dispatch("click");
    await flush();
    const d = p.dialogs[0];
    assert.equal(d.title, "Where books is on");
    labelled(d.body, "books for Unity Game")[0].dispatch("click");
    await flush();
    assert.deepEqual(p.calls.filter((c) => c.method === "POST").at(-1), { path: "/skills/books/on", method: "POST", body: { place: "project:p1", on: true } });
    assert.deepEqual(p.toasts.at(-1), ["books is always on in Unity Game: about 8 tokens in every message, starting with each chat's next message.", undefined]);
  });
});

// (fails before: yes — HarnessV4_Skills_Plan step 2, the Designer's of 10-27: a made skill carried no books, and nothing
// on the page made a skill)
describe("a made skill's Books, and New skill…", () => {
  const part = (/** @type {[number, number] | null} */ pages) => ({ file: "references/x/01.md", title: "x", pages, chars: 10 });
  const book = (/** @type {Record<string, any>} */ o = {}) => ({ id: "release-it", title: "release-it", name: "release-it.pdf", source: "sources/release-it.pdf", kind: "pdf", pages: 312, files: 1, split: "chapters", parts: Array.from({ length: 24 }, () => part([1, 2])), noText: [], at: 1, ...o });

  test("the words: how a book was split, its pages with no text, the files folded, Remove naming the books", () => {
    assert.equal(bookLine(book()), "312 pages · 24 parts, one per chapter");
    assert.equal(bookLine(book({ split: "pages", pages: 96, parts: Array.from({ length: 5 }, () => part([1, 20])) })), "96 pages · 5 parts of 20 pages — it has no chapters to split by");
    assert.equal(bookLine(book({ kind: "md", pages: null, split: "headings", parts: [part(null), part(null)] })), "2 parts, one per heading");
    assert.equal(bookLine(book({ kind: "txt", pages: null, split: "whole", parts: [part(null)] })), "1 part — it has no headings to split by");
    assert.equal(bookLine(book({ kind: "folder", pages: null, files: 37, split: "files", parts: Array.from({ length: 52 }, () => part(null)) })), "37 files · 52 parts, one per file and heading");
    assert.equal(partsWords(book({ pages: 1, parts: [part([1, 1])] })), "1 part, one per chapter");
    assert.equal(pageSpans([180, 140, 141, 142, 7]), "7, 140–142, 180");
    assert.equal(noTextLine(book({ noText: [140, 141, 142] })), "No text on pages 140–142 — blank, or scans: agents can't look up what is on them.");
    assert.equal(noTextLine(book()), "");
    const files = [
      { path: "references", dir: true, size: 0 }, { path: "references/INDEX.md", dir: false, size: 9 },
      { path: "references/release-it", dir: true, size: 0 }, ...Array.from({ length: 9 }, (_, i) => ({ path: `references/release-it/0${i}.md`, dir: false, size: 1 })),
      { path: "SKILL.md", dir: false, size: 40 },
    ];
    assert.deepEqual(filesShown(files, new Set()).map((f) => `${f.path}${f.folded ? ` · ${f.folded}` : ""}`), ["references", "references/INDEX.md", "references/release-it · 9", "SKILL.md"]);
    assert.equal(filesShown(files, new Set(["references/release-it"])).length, files.length, "opened: every file");
    assert.equal(removeWords({ kind: "made", from: "made", books: [book(), book()] }), "Its folder in Filament goes with everything in it: its SKILL.md and its 2 books.");
  });

  test("Books on its page: a row a book, its split and its pages with no text; one taken out after a confirm; a book's name shows its parts", async () => {
    const page = { ...skill({ name: "release", kind: "made", from: "made" }), text: "---\nname: release\n---\nShip.", files: [{ path: "references", dir: true, size: 0 }, { path: "references/INDEX.md", dir: false, size: 9 }, { path: "SKILL.md", dir: false, size: 30 }], places: [], lineTokens: 9, books: [book({ noText: [140, 141] })], readsPdf: true, pagesPerPart: 20 };
    const p = pageWith({ reply: (path, method) => (path === "/skills/release" ? page : path.startsWith("/skills/release/file?") ? { text: "# release's library\n\n## release-it\n", size: 30 } : method === "DELETE" ? { ok: true, removed: "release-it.pdf", books: [] } : undefined) });
    /** @type {string[]} */
    const crafted = [];
    renderSkillPage(p.body, "release", { onToast: p.onToast, acts: p.acts, onCraft: (/** @type {string} */ name) => void crafted.push(name) }, p.io);
    await flush();
    const text = textOf(p.body);
    assert.match(text, /Books\|1 book · 24 parts\|Craft it in a chat…\|Add books…\|release-it\.pdf\|312 pages · 24 parts, one per chapter\|No text on pages 140–141/);
    assert.match(text, /Agents search the parts by words and read only the passage they need/);
    assert.equal(p.body.querySelector("is-warn"), null, "two blank pages of 312 are any book's: said, not in the warning's colour");
    assert.doesNotMatch(text, /Made here: Edit writes its SKILL\.md/, "a made skill's foot would repeat its From line");
    button(p.body, "release-it.pdf").dispatch("click");
    await flush();
    assert.ok(p.calls.some((c) => c.path === "/skills/release/file?path=references%2FINDEX.md"), "its name shows the table of contents");
    // (fails before: yes — the button opened a dialog whose model wrote the skill in the background)
    button(p.body, "Craft it in a chat…").dispatch("click");
    await flush();
    assert.deepEqual([crafted, p.dialogs.length], [["release"], 0], "its crafter chat opens, no dialog");
    labelled(p.body, "Remove release-it.pdf…")[0].dispatch("click");
    await flush();
    assert.deepEqual(p.asks[0], { title: "Remove release-it.pdf?", description: "Its 24 parts and Filament's copy of it go; agents can no longer look anything up in it. Your own file stays where it is.", confirmLabel: "Remove", destructive: true });
    assert.ok(p.calls.some((c) => c.method === "DELETE" && c.path === "/skills/release/books/release-it"));
    assert.deepEqual(p.toasts.at(-1), ["release-it.pdf is removed from release's books.", undefined]);
  });

  test("Add books…: files dropped on Books are picked, one of another kind said; each sent on its own; all added, a toast; some not, the dialog says which", async () => {
    const page = { ...skill({ name: "release", kind: "made", from: "made" }), text: "x", files: [], places: [], lineTokens: 9, books: [], readsPdf: false, pagesPerPart: 20 };
    /** @type {any[]} */
    let answers = [];
    const p = pageWith({ reply: (path, method) => (path === "/skills/release" ? page : method === "POST" && path === "/skills/release/books" ? answers.shift() : undefined) });
    p.io.base64 = async (/** @type {any} */ f) => `b64:${f.name}`;
    renderSkillPage(p.body, "release", { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    assert.match(textOf(p.body), /No books yet\. Add a PDF, a Markdown or text file, or a folder of them/);
    assert.doesNotMatch(textOf(p.body), /Craft it in a chat…/, "no crafter where the page was given none");
    const books = p.body.querySelector("skl-books");
    books.dispatch("drop", { dataTransfer: { files: [{ name: "guide.md", size: 2048 }, { name: "notes.txt", size: 10 }, { name: "photo.png", size: 5 }] } });
    const d = p.dialogs[0];
    assert.deepEqual([d.title, d.description], ["Add books", "Into release · agents look things up in them"]);
    const sheet = textOf(d.body);
    assert.match(sheet, /This computer has no pdftotext, so PDFs can't be added/);
    assert.match(sheet, /guide\.md\|Markdown · 2\.0 KB\|notes\.txt\|Text · 10 B\|photo\.png\|Filament reads PDF, Markdown and text files only\./);
    assert.match(sheet, /2 books to add/);
    assert.match(sheet, /a PDF without them, every 20 pages/);
    answers = [{ added: [book({ name: "guide.md", id: "guide", kind: "md", pages: null, split: "headings", parts: [part(null), part(null)] })], skipped: [] }, { added: [book({ name: "notes.txt", id: "notes", kind: "txt", pages: null, split: "whole", parts: [part(null)] })], skipped: [] }];
    button(d.body, "Add").dispatch("click");
    await flush();
    const posts = p.calls.filter((c) => c.method === "POST").map((c) => c.body);
    assert.deepEqual(posts, [{ files: [{ name: "guide.md", data: "b64:guide.md" }] }, { files: [{ name: "notes.txt", data: "b64:notes.txt" }] }], "one file a request: the count is true");
    assert.equal(d.closed, true);
    assert.deepEqual(p.toasts.at(-1), ["Added 2 books to release: 3 parts.", undefined]);

    // Some not added: the dialog stays and says which.
    renderSkillPage(p.body, "release", { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    button(p.body.querySelector("skl-books"), "Add books…").dispatch("click");
    const d2 = p.dialogs.at(-1);
    const path = labelled(d2.body, "A file or folder on this computer")[0];
    path.value = "C:\\Books";
    path.dispatch("input");
    answers = [{ added: [book({ name: "a.pdf", id: "a" })], skipped: [{ name: "scan.pdf", why: "no text: a scanned PDF needs OCR, which Filament does not do" }] }];
    button(d2.body, "Add").dispatch("click");
    await flush();
    assert.deepEqual(p.calls.filter((c) => c.method === "POST").at(-1)?.body, { paths: ["C:\\Books"] });
    assert.equal(d2.closed, false);
    assert.match(textOf(d2.body), /Added 1 of 2\|a\.pdf\|312 pages · 24 parts, one per chapter\|scan\.pdf\|Not added: no text: a scanned PDF needs OCR, which Filament does not do\|+Done/);
  });

  test("New skill…: a name and what it is for; made on nowhere, its page opened", async () => {
    const p = pageWith({ reply: (path, method) => (method === "POST" && path === "/skills" ? { ok: true, added: [{ name: "release-checks" }], skipped: [], place: null } : undefined) });
    renderSkills(p.body, { onToast: p.onToast, acts: p.acts }, p.io);
    await flush();
    button(p.acts, "New skill…").dispatch("click");
    const d = p.dialogs[0];
    assert.deepEqual([d.title, d.description], ["New skill", "Made in Filament: you write it here and give it books to look things up in."]);
    const make = buttonsOf(d.body).find((b) => textOf(b) === "Make skill");
    assert.ok("disabled" in make.attrs, "no name, nothing to make");
    const name = labelled(d.body, "Name")[0];
    name.value = "release-checks";
    name.dispatch("input");
    labelled(d.body, "What it is for")[0].value = "How a release is checked, from the release book";
    make.dispatch("click");
    await flush();
    assert.deepEqual(p.calls.filter((c) => c.method === "POST").at(-1)?.body, { make: "release-checks", description: "How a release is checked, from the release book" }, "no place: it starts on nowhere");
    assert.deepEqual([d.closed, p.went.at(-1), p.toasts.at(-1)], [true, "#/library/skills/release-checks", ["release-checks is made. It is on nowhere: a message that tags it as $release-checks has the agent load it.", undefined]]);
  });
});
