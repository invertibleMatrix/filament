// @ts-check
// About the user, everywhere (the memory plan's f5): each project keeps its own memories, so what a project learned about
// the user was known in none of the others. A fact about the user (a slot whose subject is "user") learned in two
// projects or more is put to the model once, which picks the one true of the user in every project; accepted, its words
// are the user's in every project, shown in every briefing in place of each project's copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_PROMPT, MERGE_PROMPT, EVERYWHERE_PROMPT } from "../src/services/memory/curator.js";
import { slotOf } from "../src/services/memory/slots.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { questionWords } from "../src/ui/lib/claims.js";
import { world } from "./fixtures/memory-world.mjs";

/** @param {any} w @param {any} sit @param {string} text */
const mem = async (w, sit, text) => (await memoryCommand(w.svc, text, sit))?.text || "";

/**
 * Memory's model where the everywhere step asks: `pick` answers from what it was shown; every other step finds nothing.
 * @param {(user: string) => any} pick
 */
const picker = (pick) => {
  /** @type {string[]} */
  const asked = [];
  const fn = async (/** @type {any} */ a) => {
    if (a.system === EVERYWHERE_PROMPT) {
      asked.push(a.user);
      return JSON.stringify(pick(a.user));
    }
    return JSON.stringify(a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return Object.assign(fn, { asked });
};
/** The number of the shown line that holds `words`. @param {string} user @param {string} words */
const lineOf = (user, words) => {
  const m = user.split("\n").find((l) => l.includes(words))?.match(/^(\d+)\. /);
  return m ? Number(m[1]) : null;
};

/**
 * A fact about the user a session of the project in `cwd` learned, in its slot about them.
 * @param {any} w @param {string} id @param {string} cwd @param {string} text @param {string} value @param {string} [attribute] @param {boolean} [multi]
 */
const learned = async (w, id, cwd, text, value, attribute = "background", multi = false) => {
  const s = await w.session(id, { cwd }).send("hello");
  const r = await w.svc.brain.fileLearned({ projectId: s.prep.project, chainId: s.prep.chain, turnId: s.prep.turn, kind: "fact", text, importance: 0.7, slot: slotOf({ subject: "user", attribute, value, multi }) });
  await w.settle();
  return { ...s, id: Number(r.id), filed: r.filed };
};
/** What holds in every project, as a briefing heads it, in a pattern. */
const EVERYWHERE = "What holds in every project \\(the user's own word\\):";
/** Words in a pattern. @param {string} s */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GAME = "The user is a game developer learning web tooling.";
const UNITY = "The user is a game developer with a Unity background.";

// (fails before: yes — a project's facts about the user were its own: nothing put them to the user for every project)
test("a fact about the user learned in two projects is asked once; accepted, it is theirs in every project, and each project's copy is replaced", () => {
  const model = picker((user) => ({ keep: lineOf(user, "Unity"), same: [lineOf(user, "web tooling")], why: "both say the user is a game developer; the Unity one says more" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    const b = await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    const r = await w.svc.curator.run(a.prep.project);
    assert.equal(r.everywhereAsked, 1, JSON.stringify(r));
    assert.equal(model.asked[0], `About the user · background, from 2 projects:\n1. (project site) ${UNITY}\n2. (project game) ${GAME}`);
    const [q] = w.svc.brain.questions(b.prep.project);
    assert.deepEqual([q.kind, q.project, q.proposal.text, q.proposal.slot, q.proposal.pick, q.proposal.from], ["everywhere", null, UNITY, "user · background", b.id, [b.id, a.id]]);
    assert.equal(questionWords(q), `Keep about you in every project: “${UNITY}”`);
    assert.match(await mem(w, a.sit, "@mem inbox"), new RegExp(`keep about you, in every project: "${UNITY.replace(/\./g, "\\.")}" — learned in 2 projects: both say the user is a game developer`));
    assert.match((await mem(w, a.sit, "@mem curate")) || "", /^- nothing needed changing$/m, "asked once");
    assert.equal((await w.svc.curator.run(b.prep.project)).everywhereAsked, undefined, "and once for every project");
    assert.equal(model.asked.length, 1);
    await mem(w, a.sit, `@mem accept ${q.id}`);
    const all = w.svc.archive.items.list({});
    const kept = all.find((/** @type {any} */ it) => it.text === UNITY && it.project_id == null);
    assert.deepEqual([kept?.kind, kept?.origin, kept?.status, kept?.slot], ["fact", "person", "confirmed", "user · background"]);
    for (const id of [a.id, b.id]) assert.deepEqual([w.svc.archive.items.get(id).status, w.svc.archive.items.get(id).superseded_by], ["superseded", kept.id]);
    // A third project's first session knows it, as the user's word.
    const c = await w.session("c", { cwd: "C:\\work\\tools" }).send("hello");
    assert.match(c.seen, new RegExp(`${EVERYWHERE}\\n- \\[i${kept.id} fact · user said[^\\]]*\\] ${esc(UNITY)}`), c.seen);
    // Held everywhere now: a project that learns the slot again is not asked about it.
    await learned(w, "d", "C:\\work\\api", "The user is a game developer.", "game developer");
    await w.svc.curator.run(a.prep.project);
    assert.equal(model.asked.length, 1, "a slot held everywhere is not put");
  });
});

// (fails before: yes — the same)
test("none picked is not put again until a further project learns the slot; a value rejected is never asked again", () => {
  /** @type {(user: string) => any} */
  let pick = () => ({ keep: null, why: "each is about one project" });
  const model = picker((user) => pick(user));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    await w.svc.curator.run(a.prep.project);
    await w.svc.curator.run(a.prep.project);
    assert.equal(model.asked.length, 1, "none: not put again for the same projects");
    assert.deepEqual(w.svc.brain.questions(a.prep.project), []);
    pick = (user) => ({ keep: lineOf(user, UNITY), why: "it holds of the user everywhere" });
    const c = await learned(w, "c", "C:\\work\\tools", "The user builds games in Unity.", "game developer in Unity");
    assert.equal((await w.svc.curator.run(c.prep.project)).everywhereAsked, 1, "a further project's fact puts it again");
    const [q] = w.svc.brain.questions(a.prep.project);
    await mem(w, a.sit, `@mem reject ${q.id}`);
    await learned(w, "d", "C:\\work\\api", "The user once shipped a Unity game.", "Unity game developer");
    assert.equal((await w.svc.curator.run(a.prep.project)).everywhereAsked, undefined);
    assert.equal(model.asked.length, 3, "put again for the further project, and the value rejected not asked");
    // (fails before: yes — the review of f5: a value asked before raised nothing and recorded nothing, so every pass of
    // every project paid the call again)
    for (const p of [a, c]) await w.svc.curator.run(p.prep.project);
    assert.equal(model.asked.length, 3, "judged with a value asked before: not put again until a project more holds it");
    assert.equal(w.svc.archive.items.list({}).some((/** @type {any} */ it) => it.project_id == null), false, "nothing is kept everywhere the user did not accept");
  });
});

// (fails before: yes — the briefing read the engine's canonical facts; the user's word of no project had no place in it)
test("a fact about the user set on the Memory page joins every briefing; setting its name again corrects it, and deleting it retires it", () =>
  world({ models: { summarizer: "judge" } }, async (w) => {
    const set = await w.svc.identitySet({ name: "editor", body: "The user edits in Neovim." });
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.deepEqual(w.svc.identity().map((/** @type {any} */ f) => [f.name, f.body, f.trust]), [["editor", "The user edits in Neovim.", "user said"]]);
    const first = await w.session("a", { cwd: "C:\\work\\game" }).send("hello");
    assert.match(first.seen, new RegExp(`${EVERYWHERE}\\n- \\[i\\d+ fact · user said[^\\]]*\\] The user edits in Neovim\\.`), first.seen);
    await w.svc.identitySet({ name: "Editor", body: "The user edits in Helix now." });
    assert.deepEqual(w.svc.identity().map((/** @type {any} */ f) => f.body), ["The user edits in Helix now."], "the same name: its memory corrected");
    const gone = await w.svc.identityForget({ name: "editor" });
    assert.equal(gone.ok, true, JSON.stringify(gone));
    assert.deepEqual(w.svc.identity(), []);
    const later = await w.session("b", { cwd: "C:\\work\\site" }).send("hello");
    assert.doesNotMatch(later.seen, /What holds in every project/);
  }));

// (fails before: yes — the review of f5: the question named its pick nowhere archive `inbox.about` reads, so a pick
// corrected meanwhile left it open, and accepting it kept the words the user had corrected in every project)
test("a pick corrected before the question is answered withdraws it", () => {
  const model = picker((user) => ({ keep: lineOf(user, "Unity"), same: [lineOf(user, "web tooling")], why: "the Unity one says more" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    const b = await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    await w.svc.curator.run(a.prep.project);
    const [q] = w.svc.brain.questions(a.prep.project);
    assert.equal(q?.kind, "everywhere");
    const fixed = await w.svc.scope({ role: "person", project: b.prep.project }).correct(`i${b.id}`, { text: "The user is a game developer who moved to Godot.", reason: "they moved" });
    assert.equal(fixed.ok, true, JSON.stringify(fixed));
    assert.deepEqual(w.svc.brain.questions(a.prep.project), [], "withdrawn");
    assert.equal(w.svc.archive.inbox.get(Number(q.id.slice(1))).status, "withdrawn");
    assert.match((await mem(w, a.sit, `@mem accept ${q.id}`)) || "", /withdrawn/);
    assert.equal(w.svc.archive.items.list({}).some((/** @type {any} */ it) => it.project_id == null), false, "nothing kept everywhere");
    assert.equal(w.svc.archive.items.get(a.id).status, "inferred", "the other project's claim stands");
  });
});

// (fails before: yes — the review of f5: a slot was one thing whatever its values, and accepting superseded every claim
// in it — a multi-valued slot's other values and claims the model never saw or said otherwise)
test("accepted, a question replaces only what the model said says the same; a multi-valued slot's values are each their own", () => {
  const model = picker((user) =>
    user.includes("· languages")
      ? { keep: lineOf(user, "writes Rust."), same: [lineOf(user, "Rust daily")], why: "both say the user writes Rust" }
      : { keep: lineOf(user, "Neovim for everything"), same: [lineOf(user, "edits in Neovim")], why: "the user edits in Neovim" },
  );
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const rust = await learned(w, "a1", "C:\\work\\game", "The user writes Rust.", "Rust", "languages", true);
    const python = await learned(w, "a2", "C:\\work\\game", "The user writes Python.", "Python", "languages", true);
    const daily = await learned(w, "b1", "C:\\work\\site", "The user writes Rust daily.", "Rust", "languages", true);
    const ts = await learned(w, "b2", "C:\\work\\site", "The user writes TypeScript.", "TypeScript", "languages", true);
    const nvim = await learned(w, "a3", "C:\\work\\game", "The user edits in Neovim.", "Neovim", "editor");
    const all = await learned(w, "b3", "C:\\work\\site", "The user uses Neovim for everything.", "Neovim", "editor");
    const work = await learned(w, "c1", "C:\\work\\tools", "The user edits in VS Code for this project's notebooks.", "VS Code", "editor");
    const r = await w.svc.curator.run(rust.prep.project);
    assert.equal(r.everywhereAsked, 2, JSON.stringify(r));
    assert.equal(model.asked.filter((u) => u.includes("· languages")).length, 1, "Rust alone: Python and TypeScript are each of one project");
    assert.ok(!model.asked.join("\n").includes("Python") && !model.asked.join("\n").includes("TypeScript"));
    for (const q of w.svc.brain.questions(rust.prep.project)) await mem(w, rust.sit, `@mem accept ${q.id}`);
    const st = (/** @type {{ id: number }} */ c) => w.svc.archive.items.get(c.id).status;
    assert.deepEqual([rust, daily, python, ts].map(st), ["superseded", "superseded", "inferred", "inferred"], "the value kept everywhere replaces its own, never another");
    assert.deepEqual([nvim, all, work].map(st), ["superseded", "superseded", "inferred"], "the claim the model left out stands");
    // The other values are no longer kept from being asked about: the language held everywhere is Rust alone.
    await learned(w, "c2", "C:\\work\\tools", "The user writes Python for scripts.", "Python", "languages", true);
    await w.svc.curator.run(python.prep.project);
    assert.equal(model.asked.filter((u) => u.includes("· languages")).length, 2, "Python, now of two projects, is put");
    // (fails before: yes — the second look of f5's review: a value set on the Memory page has no value of its own, and
    // was held by its whole words, so the same language learned in two projects was asked about all the same)
    await learned(w, "a4", "C:\\work\\game", "The user writes Zig.", "Zig", "languages", true);
    await learned(w, "b4", "C:\\work\\site", "The user writes Zig for tools.", "Zig", "languages", true);
    // The Memory page: a second language, and deleting it by its id leaves the first.
    await w.svc.identitySet({ name: "languages", body: "The user writes Zig on weekends." });
    await w.svc.curator.run(python.prep.project);
    assert.equal(model.asked.filter((u) => u.includes("· languages")).length, 2, "Zig, kept everywhere on the Memory page, is not put");
    const langs = w.svc.identity().filter((/** @type {any} */ f) => f.name === "languages");
    assert.deepEqual(langs.map((/** @type {any} */ f) => f.body), ["The user writes Rust.", "The user writes Zig on weekends."], "beside the other value, not in its place");
    assert.equal((await w.svc.identityForget({ id: langs[1].id })).ok, true);
    assert.deepEqual(w.svc.identity().filter((/** @type {any} */ f) => f.name === "languages").map((/** @type {any} */ f) => f.body), ["The user writes Rust."], "the one asked, by its id");
  });
});

// (fails before: yes — the review of f5: a slot asked about was put again for a third project's value, and two
// questions accepted kept two values of one single-valued slot everywhere)
test("a slot an open question asks about is not put again, and accepted where the user keeps a value already, that value is corrected", () => {
  const model = picker((user) => ({ keep: lineOf(user, "Unity") ?? 1, same: [], why: "it holds everywhere" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    await w.svc.curator.run(a.prep.project);
    const c = await learned(w, "c", "C:\\work\\tools", "The user makes mobile games.", "mobile game developer");
    await w.svc.curator.run(c.prep.project);
    assert.equal(model.asked.length, 1, "asked about already: not put again");
    assert.equal(w.svc.brain.questions(a.prep.project).length, 1);
    // Set on the Memory page meanwhile, then the question accepted: one value everywhere, in the question's words.
    await w.svc.identitySet({ name: "background", body: "The user is a game developer." });
    const [q] = w.svc.brain.questions(a.prep.project);
    assert.equal((await w.svc.brain.decide(q.id, "accept", { by: "person" })).ok, true);
    assert.deepEqual(w.svc.identity().map((/** @type {any} */ f) => [f.name, f.body]), [["background", UNITY]]);
  });
});

// (fails before: yes — the review of f5: the learner looked for a slot's value in its project alone, so a project
// learned the user otherwise after they kept a value everywhere, and both stood)
test("once the user keeps a value of a slot about them everywhere, a project's learner hears it: the same value is evidence, another is the user's word against it", () => {
  const model = picker((user) => ({ keep: lineOf(user, "Unity"), same: [lineOf(user, "web tooling")], why: "the Unity one says more" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    await w.svc.curator.run(a.prep.project);
    await mem(w, a.sit, `@mem accept ${w.svc.brain.questions(a.prep.project)[0].id}`);
    const kept = w.svc.archive.items.list({}).find((/** @type {any} */ it) => it.project_id == null);
    const again = await learned(w, "c", "C:\\work\\tools", "The user is a game dev with a Unity background.", "game dev with Unity background");
    assert.deepEqual([again.id, again.filed], [kept.id, "evidence"], "said again in a third project: evidence for the user's");
    const other = await learned(w, "d", "C:\\work\\api", "The user is a web developer.", "web developer");
    assert.equal(other.filed, "dismissed");
    assert.match(w.svc.archive.items.events(other.id).map((/** @type {any} */ e) => e.reason || "").join(" "), new RegExp(`the user's word holds its slot \\(user · background\\): i${kept.id}`));
  });
});

// (fails before: yes — the review of f5: a question of no project quotes other projects' claims, and a handle kept to
// one project listed and answered it)
test("a handle kept to its project neither sees nor answers a question that would keep a claim in every project", () => {
  const model = picker((user) => ({ keep: lineOf(user, "Unity"), same: [], why: "the Unity one says more" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    await w.svc.curator.run(a.prep.project);
    const [q] = w.svc.scope({ role: "person", project: a.prep.project }).questions();
    assert.equal(q?.kind, "everywhere");
    const confined = w.svc.scope({ role: "person", project: a.prep.project, confined: true });
    assert.deepEqual(confined.questions(), []);
    const r = await confined.decide(q.id, "accept");
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(w.svc.archive.inbox.get(Number(q.id.slice(1))).status, "open");
  });
});

// (fails before: yes — the second look of f5's review: the learner took the user's value said again for evidence and
// stopped there, so the project's older learned value stood beside it for good, the slot held and never asked about)
test("the user's value in every project said again in a project retires the project's older learned value", () =>
  world({ models: { summarizer: "judge" } }, async (w) => {
    const old = await learned(w, "a", "C:\\work\\api", "The user edits in VS Code.", "VS Code", "editor");
    await w.svc.identitySet({ name: "editor", body: "The user edits in Neovim." });
    const kept = w.svc.archive.items.list({}).find((/** @type {any} */ it) => it.project_id == null);
    const again = await learned(w, "b", "C:\\work\\api", "The user edits in Neovim now.", "Neovim", "editor");
    assert.deepEqual([again.id, again.filed], [kept.id, "evidence"]);
    assert.deepEqual([w.svc.archive.items.get(old.id).status, w.svc.archive.items.get(old.id).superseded_by], ["superseded", kept.id]);
  }));

// (fails before: yes — the second look of f5's review: the legend explained the flagged lines of every block but this
// one, so "said otherwise later" stood on the user's line with nothing saying what it means)
test("a line of what holds in every project a later session said otherwise is flagged, and the legend says what that means", () =>
  world({ models: { summarizer: "judge" } }, async (w) => {
    await w.svc.identitySet({ name: "background", body: "The user is a game developer." });
    const kept = w.svc.archive.items.list({}).find((/** @type {any} */ it) => it.project_id == null);
    w.svc.archive.db.prepare("UPDATE items SET created_at = created_at - 60000 WHERE id = ?").run(kept.id);
    const other = await learned(w, "a", "C:\\work\\api", "The user is a web developer.", "web developer");
    assert.equal(other.filed, "dismissed");
    const next = await w.session("b", { cwd: "C:\\work\\site" }).send("hello");
    assert.match(next.seen, new RegExp(`- \\[i${kept.id} fact · user said[^\\]]*said otherwise later: web developer\\] The user is a game developer\\.`), next.seen);
    assert.ok(next.seen.includes('A line marked "said otherwise later" is the user\'s word that a later session contradicted'), next.seen);
  }));

// (fails before: yes — the second look of f5's review: the briefing's note counted every open question, the ones a
// handle kept to its project neither lists nor answers too)
test("a confined session's note counts the questions it may answer", () => {
  const model = picker((user) => ({ keep: lineOf(user, "Unity"), same: [], why: "the Unity one says more" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await learned(w, "a", "C:\\work\\game", GAME, "game developer");
    await learned(w, "b", "C:\\work\\site", UNITY, "game dev with Unity background");
    await w.svc.curator.run(a.prep.project);
    assert.equal((await w.session("c", { cwd: "C:\\work\\game" }).send("hello")).prep.cue?.questions, 1);
    const kept = await w.session("d", { cwd: "C:\\work\\game" }).send("hello", { confined: true });
    assert.equal(kept.prep.cue?.questions, undefined, JSON.stringify(kept.prep.cue));
  });
});
