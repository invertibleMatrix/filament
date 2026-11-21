// @ts-check
// HarnessV4_Visuals_Plan E16 step 5: pictures Claude desktop drew, in a chat imported from Claude Code (VS-D15,
// VC-72 to VC-85). Claude desktop's Code tab draws with its own MCP tool (`mcp__visualize__show_widget`); a chat made
// there keeps each call whole in its Claude Code file. The import keeps each picture on its turn as Filament keeps one
// of its own, marked as made in Claude desktop; its calls read as Filament's own two; a reader of the session reads its
// title, never its code; and its frame gives Claude desktop's own color names and classes Filament's colors (VS-D56).
// Everything is made up, in a temp folder.
// (fails before: yes — an imported picture was an MCP call of an unknown server, and nothing drew it)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { importClaudeCode } from "../src/services/memory/import/claude-code.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { callLog, desktopVisualOf, inBrief } from "../src/core/messages.js";
import { turnTranscript } from "../src/app/sessions/compaction.js";
import { VISUAL_NAMES } from "../src/core/visual-look.js";
import { desktopNames } from "../src/ui/lib/visual-look.js";
import { FRAME_SCRIPT, frameDoc, htmlFile, svgFile } from "../src/ui/harness/lib/visuals.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";

const dir = mkdtempSync(join(tmpdir(), "filament-visual-imports-"));
/** @type {Archive[]} */
const opened = [];
/** @param {Record<string, number>} [caps] */
const openArchive = (caps = {}) => {
  const a = new Archive({ file: join(dir, `a${opened.length + 1}.db`), caps });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) {
    try {
      a.close();
    } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-10-01T09:00:00Z");
const MIN = 60_000;
const SECRET = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV";
/** An SVG as Claude desktop's tool asks for one: its classes, its color names, and a key pasted into a label. */
const SVG = `<svg width="100%" viewBox="0 0 680 120" role="img"><g class="c-teal"><rect x="40" y="20" width="200" height="56" rx="8"/><text class="th" x="140" y="40">Cache</text><text class="ts" x="140" y="58">${SECRET}</text></g><line x1="240" y1="48" x2="320" y2="48" class="arr" stroke="var(--text-secondary)"/></svg>`;
const HTML = `<div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius)"><h2 class="sr-only">Settings</h2><button onclick="sendPrompt('Go with B')">B</button></div>`;
const DESKTOP = "mcp__visualize__show_widget";

/** A Claude Code chat file, a line at a time. @param {string} sid */
function chatFile(sid) {
  let n = 0;
  const line = (/** @type {number} */ i, /** @type {any} */ o) => JSON.stringify({ parentUuid: null, isSidechain: false, userType: "external", cwd: join(dir, "proj"), sessionId: sid, version: "2.1.0", uuid: `u-${++n}`, timestamp: new Date(T0 + i * MIN).toISOString(), ...o }) + "\n";
  const ask = (/** @type {number} */ i, /** @type {any} */ content) => line(i, { type: "user", message: { role: "user", content } });
  const reply = (/** @type {number} */ i, /** @type {any[]} */ content, more = {}) => line(i, { type: "assistant", requestId: `r${i}`, message: { id: `m${i}`, type: "message", role: "assistant", model: "claude-opus-4-1", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }, ...more });
  const call = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const result = (/** @type {number} */ i, /** @type {string[]} */ ids) => ask(i, ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "Widget rendered." })));
  return { line, ask, reply, call, result };
}

describe("a chat imported from Claude Code keeps Claude desktop's pictures on their turns (VC-72, VC-75 to VC-78, VC-82)", () => {
  const SID = "dddddddd-0000-4000-8000-000000000001";
  const root = join(dir, "cc");
  const slug = join(root, "H--proj");
  mkdirSync(slug, { recursive: true });
  const file = join(slug, `${SID}.jsonl`);
  const f = chatFile(SID);
  const a = openArchive();
  const chainOf = () => a.chainsWithKeyPrefix(`cc:${SID}`).find((c) => c.key === `cc:${SID}`);
  const turnsOf = () => a.getTurns(/** @type {any} */ (chainOf()).id);

  test("each picture on its turn, by its call's id, marked as made in Claude desktop; its code whole, scrubbed as its call is", async () => {
    writeFileSync(
      file,
      f.ask(1, "draw how the cache works") +
        f.reply(2, [f.call("rm1", "mcp__visualize__read_me", { modules: ["diagram"], platform: "desktop" })]) +
        f.result(3, ["rm1"]) +
        f.reply(4, [{ type: "text", text: "Here it is." }, f.call("w1", DESKTOP, { title: "Cache Flow", loading_messages: ["Laying out", " ", "Drawing"], widget_code: SVG })]) +
        f.result(5, ["w1"]) +
        // A sub-agent's picture stands in its own transcript: its lines are not the chat's (VC-77).
        f.reply(5, [f.call("s1", DESKTOP, { title: "sub", widget_code: "<svg></svg>" })], { isSidechain: true }) +
        f.reply(6, [{ type: "text", text: "The cache sits in front." }]) +
        f.ask(7, "now a settings screen") +
        // Claude desktop's server under another name; and another server's tool of the same name, with no code (VC-78).
        f.reply(8, [f.call("w2", "mcp__6f616b42-0ed8-571e-823f-ee4aca6b7ce9__show_widget", { title: "settings_mock", widget_code: HTML }), f.call("x1", "mcp__other__show_widget", { html: "<b>no</b>" })]) +
        f.result(9, ["w2", "x1"]) +
        // The person stopped that turn: its picture is kept all the same (VC-82).
        f.ask(10, [{ type: "text", text: "[Request interrupted by user]" }]),
    );
    const r = await importClaudeCode({ archive: a, root });
    assert.deepEqual(r.errors, []);
    const [one, two] = turnsOf();
    const listed = (/** @type {any} */ t) => (t.meta.visuals || []).map((/** @type {any} */ v) => [v.id, v.title, v.madeIn]);
    assert.deepEqual(listed(one), [["w1", "cache_flow", "claude-desktop"]]);
    assert.deepEqual(listed(two), [["w2", "settings_mock", "claude-desktop"]]);
    assert.ok(two.meta.stopped, "the stopped turn");
    const kept = /** @type {any} */ (a.turnVisual(one.id, "w1"));
    assert.deepEqual(kept.loading, ["Laying out", "Drawing"]);
    assert.ok(!kept.code.includes(SECRET) && kept.code.includes("sk-ant-…"), `the key is scrubbed (VC-76): ${kept.code}`);
    const work = a.getTurn(one.id).work.map((/** @type {string} */ hash) => a.getMessage(hash)?.message).flatMap((/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content : []));
    assert.equal(kept.code, work.find((/** @type {any} */ b) => b.id === "w1").input.widget_code, "the picture holds what its call holds");
    assert.equal(/** @type {any} */ (a.turnVisual(two.id, "w2")).code, HTML);
  });

  test("Sync after the chat grew: a picture kept already is not kept twice; the new turn's is kept (VC-75)", async () => {
    const before = turnsOf()[0].meta.visuals;
    appendFileSync(file, f.ask(11, "and the miss path") + f.reply(12, [f.call("w3", DESKTOP, { title: "miss_path", widget_code: SVG })]) + f.result(13, ["w3"]) + f.reply(14, [{ type: "text", text: "Done." }]));
    await importClaudeCode({ archive: a, root });
    const turns = turnsOf();
    assert.deepEqual(turns[0].meta.visuals, before, "unchanged, its time too");
    assert.deepEqual(turns.at(-1).meta.visuals.map((/** @type {any} */ v) => v.id), ["w3"]);
  });

  test("a dry run keeps nothing; a picture over what the archive keeps of one message is not kept, and its call stays (VC-83)", async () => {
    const dry = openArchive();
    await importClaudeCode({ archive: dry, root, dryRun: true });
    assert.deepEqual(dry.chainsWithKeyPrefix("cc:"), []);
    const small = openArchive({ messageBytes: 400 });
    const r = await importClaudeCode({ archive: small, root });
    assert.deepEqual(r.errors, []);
    const [one] = small.getTurns(/** @type {any} */ (small.chainsWithKeyPrefix(`cc:${SID}`)[0]).id);
    assert.equal(one.meta.visuals, undefined);
    assert.equal(small.getTurn(one.id).work.length, 4, "its calls and their results");
  });
});

describe("its calls read as Filament's own; a reader of the session reads its title (VC-74, VC-79)", () => {
  test("Drew and the guide's line, by the call and its input; another server's same names stay MCP calls", () => {
    assert.deepEqual(cardOf(DESKTOP, { title: "cache_flow", widget_code: SVG }), { kind: "visual", title: "Draw", subject: "cache_flow" });
    assert.deepEqual(cardOf("mcp__visualize__read_me", { modules: ["diagram", "chart"], platform: "desktop" }), { kind: "visual-guide", title: "Read the visual guide", subject: "diagram, chart" });
    assert.equal(cardOf("mcp__other__show_widget", { html: "x" }).kind, "mcp");
    assert.equal(cardOf("mcp__notes__read_me", { path: "a.md" }).kind, "mcp");
    assert.equal(desktopVisualOf({ type: "tool_use", id: "x", name: "mcp__other__show_widget", input: { html: "x" } }), null);
    assert.equal(desktopVisualOf({ type: "tool_use", id: "x", name: DESKTOP, input: { title: "t", widget_code: "  " } }), null, "no code, no picture");
  });

  test("memory's call log and a summary's transcript read the title and what it is, never the code", () => {
    const call = { role: "assistant", content: [{ type: "tool_use", id: "w1", name: DESKTOP, input: { title: "cache_flow", loading_messages: [], widget_code: SVG } }] };
    const shown = { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "Widget rendered." }] };
    assert.deepEqual(inBrief(DESKTOP, call.content[0].input), { title: "cache_flow", drew: `an SVG drawing of ${SVG.length} characters, shown to the developer` });
    const [logged] = callLog([{ role: "user", content: "draw" }, call, shown]);
    assert.ok(logged.input.includes('"title":"cache_flow"') && !logged.input.includes("Cache"), logged.input);
    const summary = turnTranscript({ n: 1, user: { role: "user", content: "draw" }, work: [call, shown], final: { role: "assistant", content: [{ type: "text", text: "Done." }] } });
    assert.ok(summary.includes('"title":"cache_flow"') && !summary.includes(SECRET), summary);
    const other = { html: "<b>x</b>" };
    assert.equal(inBrief("mcp__other__show_widget", other), other, "another server's call is itself");
  });

  test("the work's line: Drew and the title, as Filament's own picture", () => {
    const doc = stubDocument();
    try {
      const input = { title: "cache_flow", widget_code: SVG };
      const cell = alignEvents([{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, id: "w1", name: DESKTOP, args: "", card: cardOf(DESKTOP, input) }, { type: "tool-end", round: 1, id: "w1", ok: true }]).byRound.get(1);
      const [row] = roundRows(cell);
      assert.deepEqual(["tool-kind", "tool-primary"].map((c) => row.querySelector(`.${c}`)?.textContent), ["Drew", "cache_flow"]);
    } finally {
      doc.restore();
    }
  });
});

describe("its frame gives Claude desktop's names and classes Filament's colors (VC-73, VC-80, VC-81; VS-D56)", () => {
  const look = (/** @type {"light" | "dark"} */ theme) => ({ theme, motion: /** @type {const} */ ("full"), background: "rgb(9, 9, 9)", names: Object.fromEntries(Object.keys(VISUAL_NAMES).map((k, i) => [k, `rgb(${i}, 1, 2)`])) });
  const dark = look("dark");
  const MADE = { madeIn: "claude-desktop" };
  /** Every name Claude desktop's pictures in the owner's chats use (a count of names, 10-16). */
  const USED = ["--text-muted", "--text-secondary", "--border", "--surface-2", "--text-tint-aqua", "--radius", "--bg-tint-aqua", "--text-tint-orange", "--surface-1", "--bg-tint-orange", "--fill-ghost-selected", "--border-strong", "--text-primary", "--text-warning"];
  const rootOf = (/** @type {string} */ doc) => /** @type {string} */ (/:root\{([^}]*)\}/.exec(doc)?.[1]);

  test("each name it leans on has Filament's value; its quieter text and its control's corner take its meaning", () => {
    const names = desktopNames(dark);
    for (const n of USED) assert.ok(names[n] && !names[n].includes("undefined"), `${n}: ${names[n]}`);
    for (const [n, v] of Object.entries(names)) assert.ok(v && v !== "undefined", `${n} has a value`);
    assert.deepEqual([names["--text-primary"], names["--text-secondary"], names["--text-muted"], names["--radius"]], [dark.names["--text"], dark.names["--text-muted"], dark.names["--text-faint"], dark.names["--radius-sm"]]);
    assert.equal(names["--bg-tint-aqua"], dark.names["--teal-fill"]);
    const root = rootOf(frameDoc(SVG, dark, MADE));
    assert.ok(root.includes(`--text-muted:${dark.names["--text-faint"]}`) && !root.includes(`--text-muted:${dark.names["--text-muted"]}`), "one --text-muted: its own");
  });

  test("an imported picture's frame: its names, its classes, its theme by its own mark; Filament's own frames are as they were", () => {
    const doc = frameDoc(SVG, dark, MADE);
    assert.match(doc, /<html data-theme="dark" data-motion="full" data-mode="dark">/);
    for (const rule of [".th{", ".ts{", ".t{", ".box{", ".arr{", ".leader{", ".c-teal>rect", "rect.c-coral", ".c-gray>.ts{", ".sr-only{", "button{"]) assert.ok(doc.includes(rule), rule);
    const own = frameDoc(SVG, dark);
    for (const not of ["data-mode", "--text-primary", ".c-teal", ".sr-only"]) assert.ok(!own.includes(not), not);
    assert.equal(frameDoc(SVG, dark, { madeIn: null }), own);
  });

  test("its icon font's marks take no room: Filament has no such font, and an empty mark left a gap (VC-84)", () => {
    // (fails before: yes — the drive's cards showed a gap where `<i class="ti ti-clock">` drew nothing)
    assert.ok(frameDoc(HTML, dark, MADE).includes("i.ti{display:none}"));
    assert.ok(!frameDoc(HTML, dark).includes("i.ti{"), "Filament's own pictures keep their marks");
  });

  test("Save: the HTML file carries the same; the SVG file has its names and classes written in as values (VC-80)", () => {
    const html = htmlFile(HTML, dark, "settings_mock", MADE);
    assert.ok(html.includes("--surface-2:") && html.includes(".c-teal>rect") && html.includes('data-mode="dark"'));
    assert.match(html, /window\.openLink=function\(u\)\{window\.open\(String\(u\),"_blank","noopener"\)\};/);
    const svg = /** @type {string} */ (svgFile(SVG, dark, MADE));
    assert.ok(!svg.includes("var(--"), "no name left for a drawing program to guess");
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100%" viewBox="0 0 680 120" role="img"><style>[^<]*\.c-teal>rect[^<]*\{fill:rgb\(/);
    assert.ok(svg.includes(`stroke="${dark.names["--text-muted"]}"`), "its --text-secondary, as Filament's --text-muted");
    assert.ok(!(/** @type {string} */ (svgFile(SVG, dark)).includes("<style>")), "Filament's own SVG has no classes to take");
  });

  test("its sendPrompt and openLink are Filament's: words into the box, an address shown first (VC-81)", () => {
    assert.match(FRAME_SCRIPT, /window\.sendPrompt=ask;window\.openLink=function\(u\)\{say\(\{kind:"link",href:String\(u==null\?"":u\)\}\)\};/);
  });

  test("the card says where it was made, under the picture (pinned in the page's source)", async () => {
    const card = (await import("node:fs")).readFileSync(new URL("../src/ui/harness/conversation/visual.js", import.meta.url), "utf8");
    assert.match(card, /const origin = made\.madeIn === "claude-desktop" \? h\("div", \{ class: "visual-origin" \}, DESKTOP_LINE\) : null;/);
    assert.match(card, /frameDoc\(kept\.code, pageLook\(\), made\)/);
    const tl = (await import("node:fs")).readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(tl, /const pic = pictureOf\(v, k\.id, k\.title, k\.madeIn \|\| null\);/, "a turn's listed picture says where it was made");
  });
});
