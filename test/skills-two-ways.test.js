// @ts-check
// Library › Skills as Product's mock A of 11-07 has it, the smallest version: the list in two sections — the skills
// always on at the place picked, with what their lines cost every message, and those you tag when you need them —, each
// named by its tag ($name) with Copy beside it, the search always shown, How skills work open on the first visit, and
// Add skills… turning nothing on: what it adds a tag loads, and its switch turns it on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSkills, HOW_CARDS, NONE_ON } from "../src/ui/harness/library/skills.js";
import { SKILL_SECTIONS } from "../src/ui/harness/composer/slash.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
/** A skill as the list answers it, on at all chats or not. @param {string} name @param {boolean} on @param {number} tokens */
const skill = (name, on, tokens) => ({
  name, kind: "linked", from: "codex", fromWords: "Codex", path: `C:/u/${name}`, description: `What ${name} does, and when to use it`, there: true, at: 1, lineTokens: tokens,
  on: { place: "all", label: "all chats", on, here: on, from: null }, places: on ? [{ place: "all", label: "all chats", on: true }] : [],
});
/** Every node under `el` that wears the class. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(String(el?.attrs?.class || "").split(" ").includes(cls) ? [el] : []), ...(el?.kids || []).flatMap((/** @type {any} */ k) => all(k, cls))];

/** The first node under `el` named `label` for a screen reader. @param {any} el @param {string} label @returns {any} */
const labelled = (el, label) => (el?.attrs?.["aria-label"] === label ? el : (el?.kids || []).map((/** @type {any} */ k) => labelled(k, label)).find(Boolean) || null);

/** The page on the fake DOM, with a recording server, clipboard and store. @param {any[]} skills @param {{ seen?: boolean }} [o] */
function page(skills, o = {}) {
  /** @type {{ path: string, method: string, body: any }[]} */
  const calls = [];
  /** @type {string[]} */
  const toasts = [];
  /** @type {string[]} */
  const copied = [];
  /** @type {any[]} */
  const dialogs = [];
  /** @type {Record<string, string>} */
  const kept = o.seen ? { "filament.skills.howSeen": "1" } : {};
  const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ path, method, body: opts.body });
    if (path.startsWith("/memory/projects")) return { projects: [] };
    if (path.startsWith("/spaces/own")) return { spaces: [] };
    if (path.startsWith("/skills?")) return { place: { place: "all", label: "all chats" }, skills, plugins: [], count: skills.filter((s) => s.on.on).length, most: 64 };
    if (path.startsWith("/skills/found")) return { agents: [{ agent: "codex", label: "Codex", folders: ["C:/x"], where: ["~/.agents/skills"], skills: [{ name: "pdf", description: "", path: "C:/x/pdf", added: false, clash: null }] }] };
    if (path === "/skills" && method === "POST") return { ok: true, added: [{ name: "pdf" }], skipped: [] };
    return { ok: true };
  };
  const body = fakeH("div");
  const acts = fakeH("span");
  const io = /** @type {any} */ ({
    h: fakeH, api, menu: () => {}, confirm: async () => true, go: () => {},
    dialog: (/** @type {any} */ d) => { const rec = { ...d, closed: false, close() { rec.closed = true; } }; dialogs.push(rec); return rec; },
    copy: async (/** @type {string} */ t) => { copied.push(t); },
    store: { getItem: (/** @type {string} */ k) => kept[k] ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { kept[k] = v; } },
  });
  renderSkills(body, { onToast: (msg) => toasts.push(msg), acts }, io);
  return { body, acts, calls, toasts, copied, dialogs, kept };
}

// (fails before: yes — one list headed "Yours", names without their tag, no Copy, the filter only past 12 skills, no
// How skills work; and Add skills… turned what it added on for the place)
test("two sections: always on, with what their lines cost every message, and those a tag loads; each named by its tag", async () => {
  const p = page([skill("ship-a-release", true, 68), skill("unity-cli", true, 52), skill("pdf", false, 40)]);
  await flush();
  const text = textOf(p.body);
  assert.match(text, /Always on in\|All chats/, "the place picker says what it sets");
  const [on, tag] = ["on", "tag"].map((k) => all(p.body, "skl-sec").find((s) => s.attrs["data-sec"] === k));
  assert.match(textOf(on), /^Always on in all chats\|2 skills · about 120 tokens in every message\|\$ship-a-release\|/);
  assert.match(textOf(on), /\$unity-cli/);
  assert.doesNotMatch(textOf(on), /\$pdf/);
  assert.match(textOf(tag), /^Tag when you need them\|They cost nothing until you tag one, like \|\$pdf\|\$pdf\|Codex's\|What pdf does/);
  assert.doesNotMatch(textOf(tag), /on nowhere/, "a skill off here is no fault: a tag loads it");
  assert.ok(all(p.body, "skl-filter").length === 1, "the search, with three skills");
  // Copy $name: the tag to paste.
  buttonsOf(p.body).find((b) => textOf(b) === "Copy $pdf")?.dispatch("click");
  await flush();
  assert.deepEqual(p.copied, ["$pdf"]);
  assert.equal(p.toasts.at(-1), "Copied $pdf. Paste it in a message and the agent loads the skill for that message.");
  // Its switch: on, what it costs; off, how it still loads.
  buttonsOf(p.body).find((b) => b.attrs["aria-label"] === "pdf for All chats")?.dispatch("click");
  await flush();
  assert.equal(p.toasts.at(-1), "pdf is always on in all chats: about 40 tokens in every message, starting with each chat's next message.");
  buttonsOf(p.body).find((b) => b.attrs["aria-label"] === "unity-cli for All chats")?.dispatch("click");
  await flush();
  assert.equal(p.toasts.at(-1), "unity-cli is off for all chats. Tag it as $unity-cli when you need it.");
});

test("none always on: the section says a tag still loads each; How skills work opens on the first visit only", async () => {
  const p = page([skill("pdf", false, 40)]);
  await flush();
  const on = all(p.body, "skl-sec").find((s) => s.attrs["data-sec"] === "on");
  assert.equal(textOf(on), `Always on in all chats|${NONE_ON}`);
  const how = all(p.body, "skl-how")[0];
  assert.ok(how, "open on the first visit");
  for (const c of HOW_CARDS) assert.ok(textOf(how).includes(c.title) && textOf(how).includes(c.words), c.title);
  assert.match(textOf(how), /Why does no model answer\? \|\$filament-setup/);
  assert.equal(p.kept["filament.skills.howSeen"], "1");
  const again = page([skill("pdf", false, 40)], { seen: true });
  await flush();
  assert.equal(all(again.body, "skl-how").length, 0, "seen: closed");
  buttonsOf(again.body).find((b) => textOf(b) === "How skills work")?.dispatch("click");
  assert.equal(all(again.body, "skl-how").length, 1, "and there to open");
});

test("Add skills… turns nothing on: the place says only whose a folder is, and the toast says how a tag loads it", async () => {
  const p = page([skill("unity-cli", true, 52)]);
  await flush();
  buttonsOf(p.acts).find((b) => textOf(b) === "Add skills…")?.dispatch("click");
  await flush();
  const d = p.dialogs[0];
  assert.equal(d.description, "Into your skills: a tag loads one when you need it, and its switch turns it on for chats that should always have it.");
  labelled(d.body, "Add pdf").dispatch("change", { target: { checked: true } });
  buttonsOf(d.body).find((b) => textOf(b) === "Add")?.dispatch("click");
  await flush();
  assert.deepEqual(p.calls.filter((c) => c.method === "POST" && c.path === "/skills").map((c) => c.body), [{ paths: ["C:/x/pdf"], place: "all", on: false }]);
  assert.equal(p.toasts.at(-1), "pdf is added: tag it as $pdf when you need it.");
});

// (fails before: yes — the review: a name searched as its row shows it found nothing, and Copy where the page has no
// clipboard said the browser's own words)
test("a tag searched finds its skill; Copy with no clipboard says it failed", async () => {
  const p = page([skill("pdf", false, 40), skill("unity-cli", true, 52)]);
  await flush();
  const field = all(p.body, "skl-filter")[0];
  field.dispatch("input", { target: { value: "$pdf" } });
  assert.deepEqual(buttonsOf(p.body).filter((b) => b.attrs.class === "skl-name").map((b) => textOf(b)), ["$pdf"]);
  const g = /** @type {any} */ (globalThis);
  const had = Object.getOwnPropertyDescriptor(g, "navigator");
  Object.defineProperty(g, "navigator", { value: {}, configurable: true });
  try {
    // The page's own copy, with no clipboard to reach: its default, not a stand-in.
    const body = fakeH("div");
    /** @type {string[]} */
    const said = [];
    renderSkills(body, { onToast: (msg, kind) => said.push(`${kind || "ok"}: ${msg}`) }, /** @type {any} */ ({ h: fakeH, api: async (/** @type {string} */ path) => (path.startsWith("/skills?") ? { place: { place: "all" }, skills: [skill("pdf", false, 40)], plugins: [], count: 0, most: 64 } : { projects: [], spaces: [] }), menu: () => {}, store: null }));
    await flush();
    buttonsOf(body).find((b) => textOf(b) === "Copy $pdf")?.dispatch("click");
    await flush();
    assert.deepEqual(said, ["err: Copy failed"]);
  } finally {
    if (had) Object.defineProperty(g, "navigator", had);
    else delete g.navigator;
  }
});

test("the $ list in the message box says the same two ways", () => {
  assert.deepEqual(SKILL_SECTIONS, { on: "Always on in this chat", off: "Tag to load it for this message", plugin: "From your plugins" });
});
