// @ts-check
// A show_visual call is said while the model writes it (VS-D11): its title once whole, its loading lines as each is
// whole. Every piece of the call's input re-read the whole of what had come with two searches — a call's code is most
// of it, so over a long drawing, the square of its length. Each piece is read where it adds (`writingReader`), and says
// what reading the whole says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { visualWriting, writingOf, writingReader } from "../src/app/agent/visuals.js";
import { visualLines, visualTitle, VISUAL_TITLE_MAX } from "../src/core/messages.js";

// The reading of the whole, as it was: the reference.
const TITLE_AT = /"title"\s*:\s*("(?:[^"\\]|\\.)*")/;
const LOADING_AT = /"loading"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)*)/;
const STRINGS = /"(?:[^"\\]|\\.)*"/g;
const unquote = (/** @type {string} */ s) => {
  try {
    const v = JSON.parse(s);
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
};
/** @param {string} json */
const whole = (json) => {
  const t = TITLE_AT.exec(json);
  const l = LOADING_AT.exec(json);
  return { title: t ? visualTitle(unquote(t[1])).slice(0, VISUAL_TITLE_MAX) : "", loading: l ? visualLines((l[1].match(STRINGS) || []).map(unquote)) : [] };
};

/** Inputs as models write them, and some as they should not: every order, a key's name as a value, escapes, spaces. */
const inputs = [
  { title: "compaction_flow", code: '<svg viewBox="0 0 10 10"><text>"title": "no"</text></svg>', loading: ["Drawing the boxes", "Joining them"] },
  { loading: ["first line", "second \"quoted\" line"], title: "spend_by_day", code: "<div>loading</div>" },
  { code: `<svg>${"<rect/>".repeat(300)}</svg>`, loading: [], title: "a\\b" },
  { title: "loading", code: "x", loading: ["title"] },
  { title: "t", code: "y" },
];
const texts = [
  ...inputs.map((o) => JSON.stringify(o)),
  ...inputs.map((o) => JSON.stringify(o, null, 2)),
  '{"title" :  "spaced_out" , "loading" : [ "one" ,  "two" ] , "code": "z"}',
  '{"title": 5, "title": "second_one", "code": "c"}',
  '{"loading": "not a list", "loading": ["the list"], "code": "c"}',
  '{"code": "\\"title\\": \\"inside\\"", "title": "outside"}',
];

// (fails before: yes — there was no reader that reads only what a piece adds)
test("read a piece at a time, a call says at every piece what reading all of it says", () => {
  for (const text of texts)
    for (const size of [1, 2, 3, 5, 8, 13, 40, text.length]) {
      const read = writingReader();
      for (let i = size; ; i += size) {
        const so = text.slice(0, Math.min(i, text.length));
        assert.deepEqual(read(so), whole(so), `${JSON.stringify(so)} in pieces of ${size}`);
        if (i >= text.length) break;
      }
      assert.deepEqual(writingOf(text), whole(text));
    }
});

// (fails before: yes — each piece searched the whole of the call so far, twice)
test("a long drawing written in many pieces is never searched whole again, and is said as before", () => {
  const code = `<svg viewBox="0 0 680 400">${'<rect x="1" y="2" width="3" height="4"/>'.repeat(2500)}</svg>`;
  const text = JSON.stringify({ title: "big_picture", code, loading: ["Laying it out", "Drawing"] });
  const real = RegExp.prototype.exec;
  let longScans = 0;
  RegExp.prototype.exec = /** @type {any} */ (function (/** @type {string} */ s) {
    if (!this.sticky && typeof s === "string" && s.length > 10_000) longScans++;
    return real.call(this, s);
  });
  /** @type {any[]} */
  const said = [];
  let t = 0;
  try {
    const w = visualWriting((news) => said.push(news), () => (t += 10));
    for (let i = 0; i < text.length; i += 50) w.piece({ id: "v1", name: "show_visual", text: text.slice(i, i + 50) });
  } finally {
    RegExp.prototype.exec = real;
  }
  assert.equal(longScans, 0, "no search of the whole call");
  const last = said.at(-1);
  assert.deepEqual([last.title, last.loading, last.chars], ["big_picture", ["Laying it out", "Drawing"], text.length]);
  assert.ok(said.some((s) => s.title === "big_picture" && s.loading.length === 0), "the title said once whole, before its lines");
});
