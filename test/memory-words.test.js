// Memory's words in any script (the memory plan's c1): a message in Urdu, Russian, German, Chinese or Japanese gives a
// query, its claims distinct keys, and an echo of one in the reply counts as its use; an ASCII text reads as it did; the
// archive's search finds a Japanese or Chinese turn from part of it, and an archive written before the trigram index
// fills it as it opens.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normWords, segmentsOf, segmentCounts, pairsOf, trigramsOf, shortUnspaced, hasUnspaced } from "../src/services/memory/words.js";
import { keywordsOf, queryOf, usedInReply, identifyingWords, termsOf } from "../src/services/memory/brain.js";
import { Archive } from "../src/archive.js";

const dir = mkdtempSync(join(tmpdir(), "filament-words-"));
/** @type {Archive[]} */
const opened = [];
let clock = 1_757_900_000_000;
const now = () => (clock += 1000);
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
const open = (/** @type {any} */ opts = {}) => {
  const a = new Archive({ file: join(dir, `a${opened.length}.db`), now, ...opts });
  opened.push(a);
  return a;
};
/** @param {Archive} a @param {string} chainId @param {string} text @param {string} answer */
function turn(a, chainId, text, answer) {
  const { turnId } = a.beginTurn(chainId, { requestId: `r${clock}`, model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text }] } });
  a.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: answer }] }, requestId: `f${clock}` });
  return turnId;
}

// What the ASCII-only readers did, kept here as the ratchet that ASCII reads as it did.
const oldNorm = (/** @type {string} */ s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const oldWords = (/** @type {string} */ s) => oldNorm(s).split(" ").filter((w) => w.length > 2);
/** Seeded ASCII texts of every printable character. */
function asciiTexts(n) {
  let x = 7;
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = "";
    for (let j = 0; j < 80; j++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      s += String.fromCharCode(32 + (x % 95));
    }
    out.push(s);
  }
  return out;
}

test("words: an ASCII text normalizes and splits as it did, letter for letter", () => {
  for (const s of [...asciiTexts(400), "Use pnpm, not npm — usage.js:227", "The API listens on port 4000; don't restart it."]) {
    const ascii = s.replace(/[^\x00-\x7f]/g, "");
    assert.equal(normWords(ascii), oldNorm(ascii), ascii);
    assert.deepEqual(segmentsOf(ascii).filter(segmentCounts), oldWords(ascii), ascii);
  }
});

test("words: any script's letters, marks and digits; an unspaced script read as pairs, searched as trigrams", () => {
  assert.equal(normWords("Das Problem ist gelöst, Café!"), "das problem ist gelöst café");
  assert.equal(normWords("Ошибка в деплое"), "ошибка в деплое");
  assert.equal(normWords("नमस्ते दुनिया"), "नमस्ते दुनिया", "a mark stays in its word");
  assert.deepEqual(pairsOf("本番へ"), ["本番", "番へ"]);
  assert.deepEqual(pairsOf("日"), ["日"]);
  assert.deepEqual(segmentsOf("v2リリース 本番"), ["v2", "リリ", "リー", "ース", "本番"]);
  assert.deepEqual(segmentsOf("پروڈکشن پر ڈیپلائے").filter(segmentCounts), ["پروڈکشن", "ڈیپلائے"], "a short word of a spaced script says too little");
  assert.deepEqual(segmentsOf("배포는 목요일").filter(segmentCounts), ["배포는", "목요일"]);
  assert.deepEqual(trigramsOf("本番へのリリース？"), ["本番へ", "番への", "へのリ", "のリリ", "リリー", "リース"]);
  assert.deepEqual(trigramsOf("deploy on Thursday"), []);
  assert.deepEqual(shortUnspaced("本番、いつ？"), ["本番", "いつ"]);
  assert.equal(hasUnspaced("Ошибка"), false);
  assert.equal(hasUnspaced("tests · typecheck、done。"), false, "punctuation that lists Han among its scripts is none of its letters");
  assert.equal(hasUnspaced("客服"), true);
});

test("keywords: a message in any language searches for its words; English's as before", () => {
  assert.deepEqual(keywordsOf("Ошибка при деплое на сервере production"), ["ошибка", "при", "деплое", "сервере", "production"]);
  assert.deepEqual(keywordsOf("پروڈکشن پر ڈیپلائے جمعرات کو ہوتا ہے"), ["پروڈکشن", "ڈیپلائے", "جمعرات", "ہوتا"]);
  assert.deepEqual(keywordsOf("Ist das Problem mit dem Lager gelöst?"), ["ist", "das", "problem", "mit", "dem", "lager", "gelöst"]);
  assert.deepEqual(keywordsOf("本番へのリリースは何曜日？"), ["本番へのリリースは何曜日"]);
  assert.deepEqual(keywordsOf("客服工单要在多长时间内回复？"), ["客服工单要在多长时间内回复"]);
  assert.notEqual(queryOf("本番へのリリースは何曜日？"), "");
  // English, as before: stop words out, code first.
  assert.deepEqual(keywordsOf("The tray keeps restarting; see usage.js:227 — what did we decide?"), ["usage.js:227", "tray", "keeps", "restarting", "decide"]);
  assert.equal(queryOf("hi"), "");
});

test("claims in another script have identifying words of their own, and an echo of one in the reply is its use", () => {
  const a = identifyingWords("Деплой в продакшен идёт по четвергам");
  const b = identifyingWords("Счета отправляются в бухгалтерию в пятницу");
  assert.ok(a.length >= 3 && b.length >= 3, `${a} / ${b}`);
  assert.equal(a.filter((w) => b.includes(w)).length, 0);
  assert.equal(usedInReply("Деплой в продакшен идёт по четвергам после обеда", "Как вы просили: деплой в продакшен идёт по четвергам после обеда, так что я подожду."), true);
  assert.equal(usedInReply("Деплой в продакшен идёт по четвергам", "Вот рецепт хлеба на закваске."), false);
  assert.equal(usedInReply("客服工单必须在四小时内回复，周末除外。", "按照规定，客服工单必须在四小时内回复，所以我先处理这个。"), true);
  assert.equal(usedInReply("客服工单必须在四小时内回复。", "今天天气很好。"), false);
  assert.deepEqual(termsOf("नमस्ते दुनिया pnpm"), ["नमस्ते", "दुनिया", "pnpm"], "a mark keeps its word whole in the work's words too");
});

test("archive search: a Japanese or Chinese turn found from part of it, ranked by how much it shares; a short word by its letters", () => {
  const a = open();
  const c = a.chainForKey("k", { cwd: "/p" });
  const ja = turn(a, c.id, "本番へのリリースは毎週木曜日です。", "了解しました。");
  const zh = turn(a, c.id, "客服工单必须在四小时内回复，周末除外。", "好的。");
  turn(a, c.id, "deploys go out on Thursday", "ok");
  const j = a.searchInputs("本番へのリリースは何曜日？");
  assert.equal(j[0]?.turnId, ja, JSON.stringify(j));
  assert.match(j[0].snippet, /\[本番へ/);
  assert.equal(a.searchInputs("客服工单要在多长时间内回复")[0]?.turnId, zh);
  assert.equal(a.searchInputs("本番")[0]?.turnId, ja, "two characters, which no trigram holds, by their letters");
  assert.equal(a.searchInputs("Thursday").length, 1, "the rest as before");
  // Only text in such a script is in the trigram index: the two turns' asks and answers, none of the English turn's.
  assert.equal(Number(a.db.prepare("SELECT COUNT(*) AS n FROM fts_tri").get()?.n), 4);
  a.setChainIndexed(c.id, false);
  assert.deepEqual(a.searchInputs("本番へのリリース"), [], "a chain taken out of the index is out of both");
  a.setChainIndexed(c.id, true);
  assert.equal(a.searchInputs("本番へのリリース")[0]?.turnId, ja);
});

test("an archive written before the trigram index fills it as it opens, once", () => {
  const file = join(dir, "before.db");
  const a = new Archive({ file, now });
  const c = a.chainForKey("k", { cwd: "/p" });
  const ja = turn(a, c.id, "本番へのリリースは毎週木曜日です。", "了解。");
  turn(a, c.id, "english only", "ok");
  // As a build before c1 left it: no trigram rows, and no mark that they were filled.
  a.db.exec("DELETE FROM fts_tri");
  a.db.prepare("DELETE FROM schema_meta WHERE key = 'trigramFilled'").run();
  assert.deepEqual(a.searchInputs("本番へのリリース"), []);
  a.close();
  const b = open({ file });
  assert.equal(b.searchInputs("本番へのリリース")[0]?.turnId, ja);
  assert.equal(Number(b.db.prepare("SELECT COUNT(*) AS n FROM fts_tri").get()?.n), 2, "the Japanese turn's ask and answer");
  assert.equal(b.schemaMetaGet("trigramFilled"), 1);
});
