// The golden recall eval: one corpus of memory (test/fixtures/recall-golden/corpus.json — a web shop's months of it, a
// second project's, the claims that hold in every project; some corrected, some retired, some said twice in other
// words, some in other languages) and 40-80 asks of it (cases.json), each with the claims that answer it, the ones that
// must never be served for it and the ones of which one is enough. Each ask is put to every surface memory serves on:
//   briefing  a session's first message: the briefing block in its system prompt;
//   turn      the next message of a session opened with a greeting: the turn block on it. What the session has in
//             view — its briefing and that block — counts for recall; the block's own lines for the rest;
//   search    filament_memory_search with the ask as its query, as the model's tool answers it - and, once the cases
//             are scored, a multi-document ask answered by a topic page (the memory plan's f7);
//   brief     what a sub-agent given the ask as its task is handed.
// and each surface is scored: precision (the answers among the corpus's lines it served; the briefing and the brief
// open with the user's rules, preferences and conventions by design, so those count there only where an ask wants
// them), recall (the wanted claims served), must-not (lines served that must never be), repeats (more than one line
// of one thing said twice) and tokens (what the surface added, its characters / 4).
//
// Two ratchets. A case today's memory fails is listed in KNOWN with the gap it fails on and the surfaces it fails on,
// and the test asserts it fails on exactly those — so a fix that makes one pass fails this file until its entry is
// trimmed, and a case that starts failing elsewhere fails at once. The totals per surface are in
// test/fixtures/memory-recall.json: precision, recall, must-not, repeats and the cases passed must match it either way
// (a gain is written down: FILAMENT_RECALL_WRITE=1 writes the measured numbers), tokens per ask may rise 10%.
//
// The cases share one world per engine, seeded once; each case's sessions are deleted after it (as the person deletes
// a chat), so what one case was shown, said or let fade never reaches the next — the last test asks the first case
// again and expects the same scores. The fake engine (word overlap) runs everywhere; the real one, Mnemosyne with
// embeddings as installed, only where it is installed, with its own KNOWN and its own totals.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { world } from "./fixtures/memory-world.mjs";
import { executeMemoryTool } from "../src/memory-tools.js";
import { groundDossier, capPage, PAGE_SECTIONS } from "../src/services/memory/curator.js";
import { pageSource } from "../src/services/memory/brain.js";
import { engineState, EMBEDDING_MODEL } from "../src/memory-install.js";

const read = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8"));
const CORPUS = read("recall-golden/corpus.json");
/** @type {Case[]} */
const CASES = read("recall-golden/cases.json").cases;
const BASELINE_FILE = fileURLToPath(new URL("./fixtures/memory-recall.json", import.meta.url));
const BASELINE = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {};
const WRITE = !!process.env.FILAMENT_RECALL_WRITE;
const SURFACES = /** @type {const} */ (["briefing", "turn", "search", "brief"]);
/** The kinds the briefing and the brief open with whatever is asked. */
const STANDING = new Set(["rule", "preference", "convention"]);
const KIND = new Map(CORPUS.claims.map((/** @type {any} */ c) => [c.key, c.kind]));

/**
 * @typedef {{ id: string, category: string, ask: string, project?: string, want?: (string | string[])[], not?: string[], once?: string[][] }} Case
 * @typedef {typeof SURFACES[number]} Surface
 * @typedef {{ known: string, fails: Surface[] }} Gap
 */

// What today's memory gets wrong, by case: the gap and the surfaces it fails on. Trim an entry when its fix lands. A
// surface missing from an entry may pass by the dossier's grace: the briefing and the brief list the project's newest
// facts whatever is asked, and the turn block counts what the session's opening briefing showed.
const ALL = [...SURFACES];
const CROSS = "cross-project: another project's value for the same thing is served beside this one's, unlabelled";
const OTHER_TONGUE = "multilingual: the ask and the claim are in two languages, and recall goes by shared words";
const PARAPHRASE = "paraphrase: the ask shares no word with the claim, and recall goes by shared words";
const REPEAT = "repeat: one thing said twice in other words is served twice; nothing merges them without the curator's model";
/** @type {Record<string, Gap>} */
const KNOWN = {
  "cross-port": { known: CROSS, fails: ALL },
  "cross-deploy": { known: CROSS, fails: ALL },
  "cross-blog-pm": { known: CROSS, fails: ALL },
  "ml-de-en": { known: OTHER_TONGUE, fails: ALL },
  // Its briefing passed while a Japanese ask had no keywords (before c1): the briefing then searched by the project's name.
  "ml-ja-en": { known: OTHER_TONGUE, fails: ALL },
  "ml-en-es": { known: OTHER_TONGUE, fails: ["briefing", "turn", "search"] },
  "ml-en-ja": { known: OTHER_TONGUE, fails: ALL },
  // pa-socket's turn and pa-logged-in's briefing and turn passed by the dossier's grace until the briefing's header and
  // tools' line counted in its budget (the memory plan's d2): the dossier's room shrank, and its newest facts with it;
  // pa-logged-in's turn passed again since the briefing's blocks of git and sessions are small (e1), and fails since the
  // user's fact of no project, in no dossier, is told in every briefing (f5): its line takes the dossier's room, and
  // d-redis with it.
  "pa-socket": { known: PARAPHRASE, fails: ["briefing", "turn", "search"] },
  "pa-card-company": { known: PARAPHRASE, fails: ALL },
  "pa-bills": { known: PARAPHRASE, fails: ALL },
  "pa-logged-in": { known: PARAPHRASE, fails: ["briefing", "turn", "search"] },
  "pa-pictures": { known: PARAPHRASE, fails: ALL },
  "pa-languages": { known: PARAPHRASE, fails: ALL },
  "pa-weekend-copy": { known: PARAPHRASE, fails: ALL },
  "pa-erase": { known: PARAPHRASE, fails: ALL },
  "repeat-cart": { known: REPEAT, fails: ALL },
  "repeat-node": { known: REPEAT, fails: ["briefing", "turn", "brief"] },
  "repeat-unit": { known: REPEAT, fails: ALL },
};
// The same for the real engine. By meaning (c2: its multilingual model, and its rows nearest the person's sentence
// beside those sharing the ask's words), an ask in another language or in other words finds its claim; what is left
// ranks below the floor or below rows the words found.
const ENGINE_PARAPHRASE = "paraphrase: the claim, worded otherwise, is not near enough the ask by meaning to pass the floor, nor shares its words";
/** @type {Record<string, Gap>} */
const KNOWN_REAL = {
  "cross-port": { known: CROSS, fails: ALL },
  "cross-deploy": { known: CROSS, fails: ALL },
  "cross-blog-pm": { known: CROSS, fails: ALL },
  "ml-en-ja": { known: "multilingual: found by meaning on every other surface, it is not among the turn block's three", fails: ["turn"] },
  // pa-socket's turn and pa-logged-in's briefing and turn passed by the dossier's grace (its newest facts) until the
  // briefing's header and tools' line counted in its budget (d2) and the user's fact of no project took a line of it
  // (f5), as on the fake engine; measured again with g1, when zendesk's turn passed (its entry gone).
  "pa-socket": { known: ENGINE_PARAPHRASE, fails: ["briefing", "turn", "search"] },
  "pa-card-company": { known: ENGINE_PARAPHRASE, fails: ALL },
  "pa-bills": { known: ENGINE_PARAPHRASE, fails: ALL },
  "pa-logged-in": { known: ENGINE_PARAPHRASE, fails: ["briefing", "turn", "search"] },
  "repeat-cart": { known: REPEAT, fails: ALL },
  "repeat-node": { known: REPEAT, fails: ALL },
  "repeat-unit": { known: REPEAT, fails: ["briefing", "search", "brief"] },
};

// ---------------------------------------------------------------------------------------------------
// Reading what a surface served
// ---------------------------------------------------------------------------------------------------
const block = (/** @type {string} */ kind, /** @type {unknown} */ text) => new RegExp(`<filament-memory kind="${kind}">\\n([\\s\\S]*?)\\n</filament-memory>`).exec(String(text ?? ""))?.[1] || "";
const textOf = (/** @type {any} */ content) => (typeof content === "string" ? content : (content || []).map((/** @type {any} */ b) => b?.text || "").join("\n"));
const tokens = (/** @type {string} */ s) => Math.ceil(s.length / 4);
/**
 * The claims a block's lines name: a claim's line opens with its id (`- [i12 fact · …]`), a curator's dossier line ends
 * with the ones it rests on (`… [i12, i14]`), and the topic page it links to after them (`… [i12] → page:checkout`).
 * @param {string} text @returns {Set<string>}
 */
function idsIn(text) {
  const ids = new Set();
  for (const l of text.split("\n")) {
    if (!l.startsWith("- ")) continue;
    const head = /^- \[(i\d+)[ \]]/.exec(l);
    if (head) ids.add(head[1]);
    const cites = /\[((?:i\d+, )*i\d+)\](?: → page:\S+)?$/.exec(l);
    if (cites) for (const id of cites[1].split(", ")) ids.add(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------
// The world: the corpus filed, then each case asked
// ---------------------------------------------------------------------------------------------------
/**
 * Files the corpus as it would have been filed: the user's own word through the owner's handle, an assistant's note
 * through the model's, a learned claim as the learner files it, a correction by correcting what it replaces.
 * @param {any} w
 */
async function seed(w) {
  /** @type {Record<string, string>} */
  const projects = {};
  /** @type {Record<string, string>} */
  const sessions = {};
  for (const [name, cwd] of Object.entries(CORPUS.projects)) {
    const { sit, prep } = await w.session(`seed-${name}`, { cwd }).send("hello");
    projects[name] = sit.project.id;
    sessions[name] = prep.chain;
  }
  /** @type {Map<string, string>} */
  const ids = new Map();
  for (const c of CORPUS.claims) {
    const project = c.project ? projects[c.project] : null;
    const owner = w.svc.scope({ role: "owner", project });
    let r;
    if (c.replaces) r = await owner.correct(ids.get(c.replaces), { text: c.text, reason: "it changed" });
    else if (c.by === "learner") r = await w.svc.brain.fileLearned({ projectId: project, chainId: sessions[c.project], kind: c.kind, text: c.text, importance: 0.7 });
    else r = await w.svc.scope({ role: c.by || "owner", project }).remember(c.text, { kind: c.kind });
    const id = typeof r?.id === "number" ? `i${r.id}` : r?.id;
    assert.ok(/^i\d+$/.test(String(id)) && ![...ids.values()].includes(id), `${c.key} was filed as a claim of its own: ${JSON.stringify(r)}`);
    ids.set(c.key, id);
    if (c.forget) assert.ok((await owner.forget(id, { reason: "it was never true" })).ok, `${c.key} retired`);
  }
  await w.settle();
  return { projects, keyOf: new Map([...ids].map(([k, id]) => [id, k])) };
}

/**
 * One case put to each surface; what each served (`shown`), what the model has in view with it (`view`) and its
 * tokens. Each session is deleted once read, so the next surface and the next case see none of it.
 * @param {any} w @param {Awaited<ReturnType<typeof seed>>} g @param {Case} c
 */
async function ask(w, g, c) {
  const where = c.project || "shop";
  const project = g.projects[where];
  const cwd = CORPUS.projects[where];
  /** @type {Record<string, { shown: Set<string>, view: Set<string>, tokens: number }>} */
  const out = {};
  const first = await w.session(`briefing-${c.id}`, { cwd }).send(c.ask);
  const briefing = block("briefing", textOf(first.r.body.system));
  await w.svc.deleteSession(first.prep.chain);
  out.briefing = { shown: idsIn(briefing), view: idsIn(briefing), tokens: tokens(briefing) };

  const s = w.session(`turn-${c.id}`, { cwd });
  const opened = block("briefing", textOf((await s.send("hello")).r.body.system));
  const next = await s.send(c.ask);
  const turn = block("turn", textOf(next.r.body.messages.at(-1).content));
  await w.svc.deleteSession(next.prep.chain);
  out.turn = { shown: idsIn(turn), view: new Set([...idsIn(opened), ...idsIn(turn)]), tokens: tokens(turn) };

  const found = await executeMemoryTool(w.svc.scope({ role: "model", project, client: "claude-code" }), "filament_memory_search", { query: c.ask });
  const parsed = JSON.parse(found);
  assert.ok(Array.isArray(parsed.results), `the search answered: ${found.slice(0, 300)}`);
  const hits = new Set(parsed.results.map((/** @type {any} */ r) => String(r.id)).filter((/** @type {string} */ id) => /^i\d+$/.test(id)));
  out.search = { shown: hits, view: hits, tokens: tokens(found) };

  const brief = (await w.svc.scope({ role: "agent", project }).brief({ purpose: "subagent", task: c.ask })).text;
  out.brief = { shown: idsIn(brief), view: idsIn(brief), tokens: tokens(brief) };
  return out;
}

/**
 * A surface's score for a case. `useful`: the wanted claims among its own lines, each once; `counted`: its corpus lines
 * that precision weighs (a standing claim on the briefing or the brief only where wanted).
 * @param {Case} c @param {Surface} surface @param {{ shown: Set<string>, view: Set<string>, tokens: number }} r @param {Map<string, string>} keyOf
 */
function score(c, surface, r, keyOf) {
  const keys = (/** @type {Set<string>} */ ids) => new Set([...ids].map((id) => keyOf.get(id)).filter((k) => k !== undefined));
  const shown = keys(r.shown);
  const view = keys(r.view);
  const want = (c.want || []).map((k) => [k].flat());
  const wanted = new Set(want.flat());
  const missing = want.filter((alts) => !alts.some((k) => view.has(k))).map((alts) => alts.join(" or "));
  const served = (c.not || []).filter((k) => shown.has(k));
  const repeats = (c.once || []).reduce((n, group) => n + Math.max(0, group.filter((k) => shown.has(k)).length - 1), 0);
  const opensWith = surface === "briefing" || surface === "brief";
  const counted = [...shown].filter((k) => wanted.has(k) || !(opensWith && STANDING.has(KIND.get(k)))).length;
  return {
    want: want.length,
    met: want.length - missing.length,
    useful: want.filter((alts) => alts.some((k) => shown.has(k))).length,
    counted,
    mustNot: served.length,
    repeats,
    tokens: r.tokens,
    missing,
    served,
    pass: !missing.length && !served.length && !repeats,
  };
}
/** @typedef {ReturnType<typeof score>} Score */

/** Why a surface fails, in words. @param {Score} s */
const why = (s) => [s.missing.length ? `missing ${s.missing.join(", ")}` : "", s.served.length ? `served ${s.served.join(", ")}, which must not be` : "", s.repeats ? `${s.repeats} line(s) said twice` : ""].filter(Boolean).join("; ");

/** The totals of one surface over every case. @param {Map<string, Record<Surface, Score>>} measured @param {Surface} surface */
function totals(measured, surface) {
  const all = [...measured.values()].map((m) => m[surface]);
  const sum = (/** @type {(s: Score) => number} */ f) => all.reduce((n, s) => n + f(s), 0);
  const round = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  return {
    precision: round(sum((s) => s.useful) / Math.max(1, sum((s) => s.counted))),
    recall: round(sum((s) => s.met) / Math.max(1, sum((s) => s.want))),
    mustNot: sum((s) => s.mustNot),
    repeats: sum((s) => s.repeats),
    passed: all.filter((s) => s.pass).length,
    tokens: Math.round(sum((s) => s.tokens) / Math.max(1, all.length)),
  };
}
/**
 * A multi-document ask (the memory plan's f7): several claims of one topic answer it, more than a search of claims serves
 * at once; the topic's page, its lines folded from those claims, answers it whole.
 */
const MULTI = {
  ask: "How does checkout handle payments, sales tax, discount codes and invoices?",
  want: ["f-payments", "f-stripe-test", "f-tax", "f-coupons", "f-pdf"],
  lines: /** @type {[string, string[]][]} */ ([
    ["Payments go through Stripe (webhook src/payments/stripe-webhook.ts); in test mode the card 4242 4242 4242 4242 makes a successful charge.", ["f-payments", "f-stripe-test"]],
    ["Sales tax is calculated by TaxJar at checkout, for US addresses only.", ["f-tax"]],
    ["Discount codes are stored in the coupons table; a code can be limited to first orders.", ["f-coupons"]],
    ["Invoices are rendered to PDF by Puppeteer in src/billing/invoice-pdf.ts.", ["f-pdf"]],
  ]),
};

/** What may only go one way, and which way is better. */
const BETTER = /** @type {const} */ ({ precision: 1, recall: 1, mustNot: -1, repeats: -1, passed: 1 });

/** @type {Record<string, any>} */
const written = {};

// ---------------------------------------------------------------------------------------------------
// The eval, once per engine
// ---------------------------------------------------------------------------------------------------
/**
 * @param {string} name  the baseline's key
 * @param {Record<string, Gap>} known
 * @param {{ engine?: any, skip?: string | false, engineLine?: (w: any) => any }} o
 */
function golden(name, known, { engine = null, skip = false, engineLine = () => null }) {
  describe(`golden recall (${name} engine)`, { skip }, () => {
    /** @type {any} */
    let w = null;
    /** @type {Awaited<ReturnType<typeof seed>>} */
    let g;
    /** @type {() => void} */
    let release = () => {};
    /** @type {Promise<any>} */
    let done = Promise.resolve();
    /** @type {Map<string, Record<Surface, Score>>} */
    const measured = new Map();

    before(async () => {
      await new Promise((ready, failed) => {
        done = world({ cwd: CORPUS.projects.shop, engine }, async (x) => {
          w = x;
          ready(undefined);
          await new Promise((r) => (release = () => r(undefined)));
        }).catch(failed);
      });
      g = await seed(w);
    }, { timeout: 300_000 });
    after(async () => {
      release();
      await done;
    });

    /** @param {Case} c */
    const run = async (c) => {
      const r = await ask(w, g, c);
      return /** @type {Record<Surface, Score>} */ (Object.fromEntries(SURFACES.map((s) => [s, score(c, s, r[s], g.keyOf)])));
    };

    for (const c of CASES)
      test(`${c.id} (${c.category}): ${c.ask}`, async (t) => {
        const scores = await run(c);
        measured.set(c.id, scores);
        const failing = SURFACES.filter((s) => !scores[s].pass);
        for (const s of failing) t.diagnostic(`${s}: ${why(scores[s])}`);
        if (WRITE) return;
        const gap = known[c.id];
        const expected = gap?.fails || [];
        const news = failing.filter((s) => !expected.includes(s));
        const fixed = expected.filter((s) => !failing.includes(s));
        assert.ok(!news.length, news.map((s) => `fails on ${s}: ${why(scores[s])}`).join(" | "));
        assert.ok(!fixed.length, `passes on ${fixed.join(", ")} now: take ${fixed.length > 1 ? "them" : "it"} out of its KNOWN entry (${gap?.known})`);
      });

    test("a case asked again scores as it did: no case leaks into the next", async () => {
      const again = await run(CASES[0]);
      assert.deepEqual(again, measured.get(CASES[0].id));
    });

    test("the totals per surface hold against the baseline", (t) => {
      assert.equal(measured.size, CASES.length, "every case was measured");
      const now = Object.fromEntries(SURFACES.map((s) => [s, totals(measured, s)]));
      const line = engineLine(w);
      for (const s of SURFACES) t.diagnostic(`${s}: ${JSON.stringify(now[s])}`);
      if (WRITE) {
        written[name] = { ...(line ? { engine: line } : {}), ...now };
        return;
      }
      const base = BASELINE[name];
      assert.ok(base, `no baseline for the ${name} engine: run with FILAMENT_RECALL_WRITE=1`);
      if (line) assert.deepEqual(line, base.engine, `the baseline was measured on another engine: measure this one with FILAMENT_RECALL_WRITE=1`);
      for (const s of SURFACES)
        for (const [k, better] of Object.entries(BETTER)) {
          const was = base[s][k],
            is = now[s][k];
          assert.ok(is * better >= was * better, `${s} ${k} got worse: ${was} → ${is}`);
          assert.ok(is === was, `${s} ${k} got better: ${was} → ${is}; write the baseline again (FILAMENT_RECALL_WRITE=1)`);
        }
      for (const s of SURFACES) assert.ok(now[s].tokens <= Math.ceil(base[s].tokens * 1.1) + 2, `${s} tokens per ask rose from ${base[s].tokens} to ${now[s].tokens}`);
    });

    // After the totals, so no case is served the page. Its lines are grounded and capped as the curator keeps a page's.
    test("a multi-document ask (f7): a search of claims answers it in part, the topic's page whole, its own result in fewer tokens than its claims served as results", async (t) => {
      const project = g.projects.shop;
      const idOf = new Map([...g.keyOf].map(([id, k]) => [k, id]));
      const scope = w.svc.scope({ role: "model", project, client: "claude-code" });
      /** The corpus's claims a search's results put in view: a claim's own result, a page's lines. @param {string} raw */
      const inView = (raw) =>
        new Set(
          JSON.parse(raw)
            .results.flatMap((/** @type {any} */ r) => (r.kind === "page" ? [...idsIn(r.text)] : [String(r.id)]))
            .map((/** @type {string} */ id) => g.keyOf.get(id))
            .filter(Boolean),
        );
      const before = await executeMemoryTool(scope, "filament_memory_search", { query: MULTI.ask });
      const sources = new Map(MULTI.want.map((k) => [String(idOf.get(k)), String(CORPUS.claims.find((/** @type {any} */ c) => c.key === k).text)]));
      // The same claims served as results, each as a search of its own words serves it, before the page is written: what
      // the page saves.
      const one = [];
      for (const k of MULTI.want) {
        const got = JSON.parse(await executeMemoryTool(scope, "filament_memory_search", { query: sources.get(String(idOf.get(k))) })).results;
        one.push(got.find((/** @type {any} */ r) => r.id === idOf.get(k)));
      }
      assert.ok(one.every(Boolean), "each claim found by its own words");
      const asClaims = JSON.stringify({ results: one });
      const grounded = groundDossier([{ title: "Facts", lines: MULTI.lines.map(([text, keys]) => ({ text, cites: keys.map((k) => idOf.get(k)) })) }], sources, PAGE_SECTIONS);
      const page = capPage(grounded.sections, new Map([...sources].map(([id, text]) => [Number(id.slice(1)), text])));
      assert.ok(page && grounded.dropped === 0 && page.dropped === 0, "every line grounded in its claims, within the caps");
      const written = page.cites.map((id) => pageSource(w.svc.archive.items.get(id)));
      const row = w.svc.archive.pages.add({ projectId: project, topic: "about:checkout", slug: "checkout", title: "checkout", sections: page.sections, cites: page.cites, sources: written, basis: "golden" });
      try {
        const after = await executeMemoryTool(scope, "filament_memory_search", { query: MULTI.ask });
        const served = JSON.parse(after).results.find((/** @type {any} */ r) => r.id === "page:checkout");
        assert.ok(served, after);
        const was = inView(before);
        const now = inView(after);
        for (const k of MULTI.want) assert.ok(now.has(k), `${k} is in view with the page (the claims alone served ${MULTI.want.filter((x) => was.has(x)).join(", ") || "none"})`);
        assert.ok(MULTI.want.filter((k) => was.has(k)).length < MULTI.want.length, "a search of claims answers it in part: a multi-document ask");
        // The page's own result against the five claims' own: what it says, and what they would.
        const asPage = JSON.stringify({ results: [served] });
        t.diagnostic(`a search of claims: ${tokens(before)} tokens, ${MULTI.want.filter((k) => was.has(k)).length} of ${MULTI.want.length} in view; with the page: ${tokens(after)}, all in view, the page's own result ${tokens(asPage)}; the five claims as results: ${tokens(asClaims)}`);
        assert.ok(tokens(asPage) < tokens(asClaims), `the page, ${tokens(asPage)} tokens, under its claims served as results, ${tokens(asClaims)}`);
      } finally {
        w.svc.archive.pages.undone(row.id);
      }
    });
  });
}

test("the golden set: 40-80 cases, every claim they name in the corpus, every gap a case's", () => {
  assert.ok(CASES.length >= 40 && CASES.length <= 80, `${CASES.length} cases`);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, "case ids are unique");
  assert.equal(KIND.size, CORPUS.claims.length, "claim keys are unique");
  for (const c of CASES) {
    assert.ok(c.ask && (c.want?.length || c.not?.length), `${c.id} asks something and expects something`);
    for (const k of [...(c.want || []).flat(), ...(c.not || []), ...(c.once || []).flat()]) assert.ok(KIND.has(k), `${c.id} names ${k}, which the corpus has not`);
    assert.ok(!c.project || c.project in CORPUS.projects, `${c.id}'s project`);
  }
  for (const cat of ["multilingual", "paraphrase", "repeat"]) assert.ok(CASES.some((c) => c.category === cat), `a ${cat} case`);
  for (const [id, gap] of [...Object.entries(KNOWN), ...Object.entries(KNOWN_REAL)]) {
    assert.ok(CASES.some((c) => c.id === id), `KNOWN names ${id}, which is no case`);
    assert.ok(gap.known && gap.fails.length && gap.fails.every((s) => SURFACES.includes(s)), `${id}'s gap names what and where`);
  }
});

golden("fake", KNOWN, {});

// Where Mnemosyne is installed (the managed engine, or FILAMENT_MEMORY_PYTHON's), as test/memory-engine.test.js finds it;
// its embedding model from the managed engine's cache (or MNEMOSYNE_FASTEMBED_CACHE_DIR's), so nothing is downloaded. It
// measures this build's model (c2): the one the engine's install warmed, or MNEMOSYNE_EMBEDDING_MODEL's where it names
// one; an engine warmed with another waits for this build's bundle. It runs with its clocks held still
// (fixtures/steady-sidecar.py): its memories named by their words, not the moment they were filed, and each as recent
// as one filed when it is asked — else memories that score alike tie the other way each run, and a brief's line with them.
const managed = engineState(join(process.env.APPDATA || tmpdir(), "filament"));
const realPython = process.env.FILAMENT_MEMORY_PYTHON || (managed.installed ? managed.venvPython : null);
const modelCache = process.env.MNEMOSYNE_FASTEMBED_CACHE_DIR || [join(managed.dir, "cache", "fastembed")].find((d) => existsSync(d));
const realModel = process.env.MNEMOSYNE_EMBEDDING_MODEL || managed.embeddingModel;
golden("real", KNOWN_REAL, {
  skip: !realPython || !existsSync(realPython) ? "no Python with mnemosyne" : realModel !== EMBEDDING_MODEL ? `the engine here was not warmed with this build's model (${EMBEDDING_MODEL})` : false,
  engine: { command: realPython, args: [fileURLToPath(new URL("./fixtures/steady-sidecar.py", import.meta.url)), fileURLToPath(new URL("../sidecar/mnemosyne_sidecar.py", import.meta.url))], env: { ...(modelCache ? { MNEMOSYNE_FASTEMBED_CACHE_DIR: modelCache } : {}), MNEMOSYNE_EMBEDDING_MODEL: EMBEDDING_MODEL } },
  engineLine: (w) => {
    const hello = w?.svc.store?.status?.().hello || {};
    return { version: hello.version || null, embeddings: !!hello.embeddings, model: hello.embeddingModel || null };
  },
});

after(() => {
  if (!WRITE || !Object.keys(written).length) return;
  writeFileSync(BASELINE_FILE, JSON.stringify({ ...BASELINE, ...written }, null, 2) + "\n");
});
