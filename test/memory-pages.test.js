// @ts-check
// Topic pages (the memory plan's f7): a pass writes one topic's page - its claims folded into fewer lines, each citing
// them, grounded and kept to its caps; a retired claim's line leaves it at once; a search serves the page in the place
// of the claims it rests on, and the dossier's lines link to it; undoing the pass, or deleting the project, takes it.
// The model is scripted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE_PROMPT, DOSSIER_PROMPT, capPage, slugOf } from "../src/services/memory/curator.js";
import { idsInView } from "../src/services/memory/brain.js";
import { executeMemoryTool } from "../src/memory-tools.js";
import { memoryMcpCall } from "../src/app/memory-mcp.js";
import { world } from "./fixtures/memory-world.mjs";

const CHECKOUT = {
  pay: "Checkout payments go through Stripe; the webhook handler is src/payments/stripe-webhook.ts.",
  tax: "At checkout, sales tax is calculated by TaxJar for US addresses only.",
  card: "In Stripe test mode at checkout, the card 4242 4242 4242 4242 makes a successful charge.",
  coupons: "Checkout discount codes are stored in the coupons table.",
};
const SEARCH = {
  engine: "Product search is served by Meilisearch.",
  reindex: "The search index is rebuilt every night by jobs/reindex.ts.",
  typos: "Search typo tolerance is set to two typos for words over eight letters.",
};
const CART = "Checkout keeps a guest's cart for 30 days.";
/** The folded line of the checkout page: the payments and the test card, in their own words. */
const FOLDED = "Checkout payments go through Stripe (webhook src/payments/stripe-webhook.ts); in test mode the card 4242 4242 4242 4242 makes a successful charge.";

/** The claims a page or dossier prompt shows: id and words. @param {string} u */
const claimsOf = (u) => [...u.matchAll(/^(i\d+) \[[^\]]*\] (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
/**
 * A page as the model would write it: the checkout topic's payments and test card folded into one line, a line the
 * claims do not hold and one citing no claim given (both dropped); any other topic, a line a claim, word for word.
 * @param {string} u
 */
const foldingPage = (u) => {
  const cs = claimsOf(u);
  const id = (/** @type {string} */ text) => cs.find((c) => c.text === text)?.id;
  if (/^Topic: checkout$/m.test(u)) {
    const rest = cs.filter((c) => c.text !== CHECKOUT.pay && c.text !== CHECKOUT.card);
    return {
      sections: [
        { title: "Facts", lines: [{ text: "Checkout runs on Kubernetes with horizontal autoscaling.", cites: [id(CHECKOUT.tax)] }, { text: CHECKOUT.tax, cites: ["i99999"] }] },
        { title: "Facts", lines: [{ text: FOLDED, cites: [id(CHECKOUT.pay), id(CHECKOUT.card)] }, ...rest.map((c) => ({ text: c.text, cites: [c.id] }))] },
      ],
    };
  }
  const lines = cs.map((c) => ({ text: c.text, cites: [c.id] }));
  // Six lines a section, as the dossier's: a longer page takes two.
  return { sections: [{ title: "Facts", lines: lines.slice(0, 5) }, ...(lines.length > 5 ? [{ title: "Conventions and rules", lines: lines.slice(5) }] : [])] };
};
/** A dossier of a line a claim, word for word, as the routes' judge writes it. @param {string} u */
const verbatimDossier = (u) => ({ sections: [{ title: "Facts", lines: claimsOf(u).map((c) => ({ text: c.text, cites: [c.id] })) }] });

/**
 * A scripted model: the page and the dossier by their handlers, every other prompt nothing; each call kept.
 * @param {{ page?: (u: string) => any, dossier?: (u: string) => any }} h
 */
function scripted(h) {
  /** @type {{ system: string, user: string }[]} */
  const calls = [];
  const fn = async (/** @type {any} */ a) => {
    calls.push({ system: a.system, user: a.user });
    if (a.system === PAGE_PROMPT) return JSON.stringify(h.page ? h.page(a.user) : { sections: [] });
    if (a.system === DOSSIER_PROMPT) return JSON.stringify(h.dossier ? h.dossier(a.user) : { sections: [] });
    return JSON.stringify({ slots: [], pairs: [], notes: [], rule: null, keep: null });
  };
  return Object.assign(fn, { calls, of: (/** @type {string} */ p) => calls.filter((c) => c.system === p) });
}

/** A project and a filer of learned claims in it, each in a slot of its topic. @param {any} w @param {string} [cwd] */
async function project(w, cwd) {
  const { sit } = await w.session("open", cwd ? { cwd } : {}).send("hello");
  const projectId = sit.project.id;
  let n = 0;
  /** @param {string} text @param {string | null} [subject] @param {string} [kind] */
  const learned = async (text, subject = null, kind = "fact") => {
    const k = ++n;
    const slot = subject ? { slot: `${subject} · thing ${k}`, value: `value ${k}`, multi: false } : null;
    const r = await w.svc.brain.fileLearned({ projectId, chainId: `c${k}`, kind, text, importance: 0.7, slot });
    await w.settle();
    return w.svc.archive.items.get(r.id);
  };
  return { sit, projectId, learned };
}
/** @param {any} w @param {string} projectId @param {string} query */
const search = async (w, projectId, query) => {
  const raw = await executeMemoryTool(w.svc.scope({ role: "model", project: projectId, client: "claude-code" }), "filament_memory_search", { query });
  return { raw, results: /** @type {any[]} */ (JSON.parse(raw).results) };
};
/** The claim ids a page's lines end with. @param {string} text */
const citesIn = (text) => new Set([...text.matchAll(/\[((?:i\d+, )*i\d+)[\] ·]/g)].flatMap((m) => m[1].split(", ")));

// (fails before: yes - there were no topic pages)
test("a pass writes one topic's page - a topic with no page first, then the one that moved most, once a third of it moved: folded, grounded line by line, every line citing its claims", async () => {
  const model = scripted({ page: foldingPage });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const c = { pay: await learned(CHECKOUT.pay, "checkout"), tax: await learned(CHECKOUT.tax, "checkout"), card: await learned(CHECKOUT.card, "checkout"), coupons: await learned(CHECKOUT.coupons, "checkout") };
    const cart = await learned(CART, "checkout");
    for (const t of Object.values(SEARCH)) await learned(t, "search");
    await learned("The storefront is a single-page app.");
    const first = await w.svc.curator.run(projectId);
    assert.equal(first.page, "page:checkout v1", JSON.stringify(first));
    assert.equal(first.pageDropped, 2, "the line its claims do not hold, and the one citing no claim given");
    const asked = model.of(PAGE_PROMPT);
    assert.equal(asked.length, 1, "one page a pass");
    assert.match(asked[0].user, /^Topic: checkout$/m);
    assert.deepEqual(claimsOf(asked[0].user).map((x) => x.text).sort(), [...Object.values(CHECKOUT), CART].sort(), "the topic's claims alone");
    const p = w.svc.archive.pages.latest(projectId, "about:checkout");
    assert.deepEqual([p.slug, p.title, p.version], ["checkout", "checkout", 1]);
    assert.deepEqual(
      p.sections.flatMap((/** @type {any} */ s) => s.lines.map((/** @type {any} */ l) => [l.text, l.cites])),
      [
        [FOLDED, [`i${c.pay.id}`, `i${c.card.id}`]],
        [CHECKOUT.tax, [`i${c.tax.id}`]],
        [CHECKOUT.coupons, [`i${c.coupons.id}`]],
        [CART, [`i${cart.id}`]],
      ],
    );
    assert.deepEqual([...p.cites].sort((a, b) => a - b), [c.pay.id, c.tax.id, c.card.id, c.coupons.id, cart.id].sort((a, b) => a - b));
    // The next pass writes the other topic; a third has nothing to write, and asks nothing.
    assert.equal((await w.svc.curator.run(projectId)).page, "page:search v1");
    const third = await w.svc.curator.run(projectId);
    assert.equal(third.page, "every topic's page stands");
    assert.equal(model.of(PAGE_PROMPT).length, 2);
    // Two claims more of checkout, three of search: search moved more, though checkout is the larger, and is written again.
    await learned("Checkout sends the order confirmation email through Postmark.", "checkout");
    await learned("Checkout shows the delivery estimate from Shippo.", "checkout");
    await learned("Search results are cached for five minutes.", "search");
    await learned("Search synonyms are kept in config/synonyms.json.", "search");
    await learned("Search facets are built from the product attributes table.", "search");
    assert.equal((await w.svc.curator.run(projectId)).page, "page:search v2");
    assert.equal((await w.svc.curator.run(projectId)).page, "page:checkout v2", "then the other");
    assert.equal(w.svc.archive.pages.latest(projectId, "about:checkout").slug, "checkout", "a topic keeps its name");
    // A claim more of checkout's seven is under a third: its page stands.
    await learned("Checkout totals are rounded to whole cents.", "checkout");
    assert.equal((await w.svc.curator.run(projectId)).page, "every topic's page stands");
    // Three more of checkout, and a topic of three with no page: the topic with no page first.
    for (const t of ["Checkout retries a declined card once.", "Checkout logs each payment attempt.", "Checkout caps an order at 50 items."]) await learned(t, "checkout");
    for (const t of ["Orders are numbered from 1000.", "Orders ship from the Leipzig warehouse.", "Orders are archived after a year."]) await learned(t, "orders");
    assert.equal((await w.svc.curator.run(projectId)).page, "page:orders v1");
    assert.equal((await w.svc.curator.run(projectId)).page, "page:checkout v3");
  });
});

// (fails before: yes - there were no caps)
test("a page is kept to its caps: no longer than the claims it cites, ten lines at most, three claims cited or none; a topic whose page came to nothing waits until it moves", async () => {
  // capPage on its own: the lines past a cap dropped from the end.
  const claims = new Map([[1, "a".repeat(50)], [2, "b".repeat(50)], [3, "c".repeat(50)], [4, "d".repeat(50)]]);
  const line = (/** @type {number} */ id, /** @type {number} */ n = 50) => ({ text: "x".repeat(n), cites: [`i${id}`] });
  assert.deepEqual(capPage([{ title: "Facts", lines: [line(1), line(2), line(3), line(4, 120)] }], claims)?.cites, [1, 2, 3], "longer than its claims: the last line dropped");
  assert.equal(capPage([{ title: "Facts", lines: [line(1), line(2)] }], claims), null, "two claims cited: no page");
  const many = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, "y".repeat(40)]));
  const capped = capPage([{ title: "Facts", lines: Array.from({ length: 12 }, (_, i) => line(i + 1, 30)) }], many);
  assert.deepEqual([capped?.sections[0].lines.length, capped?.dropped], [10, 2]);
  assert.equal(slugOf("src/app/agent"), "src-app-agent");
  // In a pass: a page that says each claim twice over is no page, and is not asked again until its topic moves.
  const model = scripted({ page: (u) => ({ sections: [{ title: "Facts", lines: claimsOf(u).map((x) => ({ text: `${x.text} ${x.text}`, cites: [x.id] })) }] }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    for (const t of Object.values(SEARCH)) await learned(t, "search");
    const run = await w.svc.curator.run(projectId);
    assert.match(run.page, /^"search": no page of 3 claims or more/);
    assert.equal(w.svc.archive.pages.latest(projectId, "about:search"), null);
    await w.svc.curator.run(projectId);
    assert.equal(model.of(PAGE_PROMPT).length, 1, "not asked again while its claims stand as they were");
    await learned("Search results are cached for five minutes.", "search");
    await w.svc.curator.run(projectId);
    assert.equal(model.of(PAGE_PROMPT).length, 2, "asked again once a claim joined it");
    // Another project's topic of the same name that comes to nothing is its own: this one's is not asked again for it.
    const other = await project(w, "C:\\evals-b");
    for (const t of Object.values(SEARCH)) await other.learned(t, "search");
    await w.svc.curator.run(other.projectId);
    assert.equal(model.of(PAGE_PROMPT).length, 3);
    await w.svc.curator.run(projectId);
    await w.svc.curator.run(other.projectId);
    assert.equal(model.of(PAGE_PROMPT).length, 3, "neither asked again: each project's none-list holds its own basis");
  });
  // An answer with no JSON (cut, or broken) is no verdict: the topic is asked again next pass.
  let asked = 0;
  const broken = async (/** @type {any} */ a) => {
    if (a.system !== PAGE_PROMPT) return JSON.stringify({ slots: [], pairs: [], notes: [], rule: null, keep: null, sections: [] });
    asked++;
    return '{ "sections": [';
  };
  await world({ models: { summarizer: "judge" }, callModel: broken }, async (w) => {
    const { projectId, learned } = await project(w);
    for (const t of Object.values(SEARCH)) await learned(t, "search");
    assert.equal((await w.svc.curator.run(projectId)).errors?.page, "the model answered no JSON");
    await w.svc.curator.run(projectId);
    assert.equal(asked, 2);
  });
});

// (fails before: yes)
test("topics by folder: claims naming files of one folder of the project are one topic; the project's top folder is none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-pages-"));
  try {
    mkdirSync(join(dir, "src", "payments"), { recursive: true });
    for (const f of ["stripe-webhook.ts", "refunds.ts", "charges.ts"]) writeFileSync(join(dir, "src", "payments", f), "export {};\n");
    writeFileSync(join(dir, "README.md"), "# shop\n");
    writeFileSync(join(dir, "package.json"), "{}\n");
    writeFileSync(join(dir, "tsconfig.json"), "{}\n");
    const model = scripted({ page: foldingPage });
    await world({ cwd: dir, models: { summarizer: "judge" }, callModel: model }, async (w) => {
      const { projectId, learned } = await project(w, dir);
      await learned("Stripe webhooks are verified in src/payments/stripe-webhook.ts before any order changes.");
      await learned("Refunds are issued from src/payments/refunds.ts, never by hand in the dashboard.");
      await learned("Charges are captured in src/payments/charges.ts once the order ships.");
      await learned("The README.md says how to start the shop.");
      await learned("Scripts are listed in package.json.");
      await learned("Compiler options live in tsconfig.json.");
      const run = await w.svc.curator.run(projectId);
      assert.equal(run.page, "page:src-payments v1", JSON.stringify(run));
      assert.match(model.of(PAGE_PROMPT)[0].user, /^Topic: the files in src\/payments\/$/m);
      assert.equal(claimsOf(model.of(PAGE_PROMPT)[0].user).length, 3);
      assert.equal((await w.svc.curator.run(projectId)).page, "every topic's page stands", "the top folder's files are the project, no topic");
      assert.equal(w.svc.archive.pages.list(projectId).length, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes)
test("a search serves the page in the place of the claims it rests on, in fewer words; page:<name> asks for it; a retired claim's line leaves it at once", async () => {
  const model = scripted({ page: foldingPage });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const c = { pay: await learned(CHECKOUT.pay, "checkout"), tax: await learned(CHECKOUT.tax, "checkout"), card: await learned(CHECKOUT.card, "checkout"), coupons: await learned(CHECKOUT.coupons, "checkout") };
    const ask = "how does checkout take payments, sales tax and the stripe test card";
    const before = await search(w, projectId, ask);
    const found = before.results.map((r) => r.id).filter((id) => [c.pay, c.tax, c.card, c.coupons].some((x) => `i${x.id}` === id));
    assert.ok(found.length >= 2, `the claims are found: ${before.raw}`);
    await w.svc.curator.run(projectId);
    const after = await search(w, projectId, ask);
    const page = after.results.find((r) => r.kind === "page");
    assert.ok(page, after.raw);
    assert.equal(page.id, "page:checkout");
    assert.match(page.text, /^Topic page "checkout" \(page:checkout, v1, [\d-]+; each line ends with the memories it rests on\):\nFacts:\n- /);
    for (const id of found) {
      assert.ok(citesIn(page.text).has(id), `${id} is in the page's lines`);
      assert.ok(!after.results.some((r) => r.id === id), `${id} is not served beside the page`);
    }
    assert.ok(after.raw.length < before.raw.length, `fewer words: ${after.raw.length} < ${before.raw.length}`);
    // Asked for by its name: the page alone.
    const named = await search(w, projectId, "page:checkout");
    assert.deepEqual(named.results.map((r) => r.id), ["page:checkout"]);
    // Another project's search is served none of this project's pages.
    const { sit: elsewhere } = await w.session("other", { cwd: "C:\\evals-other" }).send("hello");
    assert.ok(!(await search(w, elsewhere.project.id, "page:checkout")).results.some((r) => r.kind === "page"));
    // A retired claim's line leaves the page at once, its version as it was.
    await w.svc.brain.setItemStatus(c.tax.id, "dismissed", { by: "owner", reason: "TaxJar was dropped" });
    const text = (await search(w, projectId, "page:checkout")).results[0].text;
    assert.ok(!text.includes("TaxJar") && !citesIn(text).has(`i${c.tax.id}`), text);
    assert.equal(w.svc.archive.pages.latest(projectId, "about:checkout").version, 1);
    // With fewer than two lines left it is no page.
    await w.svc.brain.setItemStatus(c.coupons.id, "dismissed", { by: "owner", reason: "no coupons" });
    assert.deepEqual((await search(w, projectId, "page:checkout")).results.filter((r) => r.kind === "page"), [], "one line left");
  });
});

// (fails before: yes - the review of f7: a page's claims were logged by the claims it stood in for alone, and none of them
// counted in view; a page twice as long as the two claims a narrow search found was served in their place; a claim at
// an id SQLite gave again, or moved to another project, kept the line of the claim the page was written from)
test("a page's claims are in view and, over MCP, shown; a narrow search keeps its claims; a claim no longer the one a line was written from takes the line", async () => {
  const model = scripted({ page: foldingPage });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const c = { pay: await learned(CHECKOUT.pay, "checkout"), tax: await learned(CHECKOUT.tax, "checkout"), card: await learned(CHECKOUT.card, "checkout"), coupons: await learned(CHECKOUT.coupons, "checkout") };
    await w.svc.curator.run(projectId);
    // In view: a page among a memory call's results carries its lines' claims, as a claim's own result does.
    const found = await search(w, projectId, "page:checkout");
    assert.deepEqual([...idsInView([{ kind: "tool", text: found.raw }])].sort(), [c.pay, c.tax, c.card, c.coupons].map((x) => `i${x.id}`).sort());
    // Over MCP: the claims its lines carry are logged as shown, not the page's name, so a retired one reaches the session.
    const where = { folder: "C:\\evals", key: "mcp-pages", client: "mcp:test", meta: null };
    const r = await memoryMcpCall(w.svc, "search", { query: "how does checkout take payments, sales tax and the stripe test card" }, where);
    const said = String(r.content.at(-1)?.text);
    const results = JSON.parse(said).results;
    assert.ok(results.some((/** @type {any} */ x) => x.id === "page:checkout"), said);
    assert.ok(!results.some((/** @type {any} */ x) => x.id === `i${c.coupons.id}`), "coupons is carried by the page alone");
    const logged = w.svc.archive.db.prepare("SELECT memory_id FROM injection_ids").all().map((/** @type {any} */ x) => x.memory_id);
    assert.ok(logged.includes(`i${c.coupons.id}`) && !logged.includes("page:checkout"), JSON.stringify(logged));
    await w.svc.scope({ role: "owner", project: projectId }).forget(`i${c.coupons.id}`, { reason: "no coupons" });
    const next = await memoryMcpCall(w.svc, "questions", {}, where);
    assert.match(next.content[0].text, new RegExp(`\\[i${c.coupons.id}\\]`), "the erratum");
  });
  // A large page and a narrow search: two of its nine claims found, the page longer than they are - they are served.
  const orders = [
    "Orders are numbered from 1000 upward.",
    "Refunds over 500 dollars need a second approver.",
    "Parcels leave the Leipzig warehouse every afternoon.",
    "Orders are archived after one year.",
    "Order confirmation emails go out through Postmark.",
    "Orders over 75 dollars ship free.",
    "Order invoices are rendered by Puppeteer.",
    "Orders placed after 2pm ship the next day.",
    "Order notes are limited to 500 characters.",
  ];
  await world({ models: { summarizer: "judge" }, callModel: scripted({ page: foldingPage }) }, async (w) => {
    const { projectId, learned } = await project(w);
    const ids = [];
    for (const t of orders) ids.push((await learned(t, "orders")).id);
    await w.svc.curator.run(projectId);
    assert.equal(w.svc.archive.pages.latest(projectId, "about:orders")?.cites.length, 9);
    const narrow = await search(w, projectId, "refunds second approver, Leipzig warehouse parcels");
    assert.ok([ids[1], ids[2]].every((id) => narrow.results.some((r) => r.id === `i${id}`)), `the two claims found: ${narrow.raw}`);
    assert.ok(!narrow.results.some((r) => r.kind === "page"), narrow.raw);
    assert.equal((await search(w, projectId, "page:orders")).results[0]?.id, "page:orders", "asked for by name, it is served");
    // A claim whose words changed in place, as at an id given again, and one moved to another project: their lines go.
    w.svc.archive.db.prepare("UPDATE items SET text = ? WHERE id = ?").run("Something else entirely.", ids[0]);
    w.svc.archive.db.prepare("UPDATE items SET project_id = ? WHERE id = ?").run("elsewhere", ids[1]);
    const text = (await search(w, projectId, "page:orders")).results[0].text;
    assert.ok(!citesIn(text).has(`i${ids[0]}`) && !citesIn(text).has(`i${ids[1]}`) && citesIn(text).has(`i${ids[2]}`), text);
  });
});

// (fails before: yes)
test("the dossier links a line to the page that rests on its claims, each page once, and says how to ask for it", async () => {
  const model = scripted({ page: foldingPage, dossier: verbatimDossier });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    for (const t of Object.values(CHECKOUT)) await learned(t, "checkout");
    await learned("The storefront is a single-page app.");
    await w.svc.curator.run(projectId);
    const first = await w.session("later").send("what should I know");
    const system = first.r.body.system;
    const whole = typeof system === "string" ? system : (system || []).map((/** @type {any} */ b) => b?.text || "").join("\n");
    const briefing = /<filament-memory kind="briefing">\n([\s\S]*?)\n<\/filament-memory>/.exec(whole)?.[1] || "";
    const linked = briefing.split("\n").filter((l) => l.endsWith("→ page:checkout"));
    assert.equal(linked.length, 1, briefing);
    assert.match(linked[0], /^- .* \[i\d+\] → page:checkout$/);
    assert.ok(briefing.includes('A line ending "→ page:<name>" has a topic page'), briefing);
    const d = (await w.svc.dossier(projectId)).sections.flatMap((/** @type {any} */ s) => s.lines).filter((/** @type {any} */ l) => l.page);
    assert.deepEqual(d.map((/** @type {any} */ l) => l.page), ["checkout"]);
  });
});

// (fails before: yes)
test("undoing the pass takes its page, the version before it read again; a project's delete takes its pages", async () => {
  const model = scripted({ page: foldingPage });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    for (const t of Object.values(CHECKOUT)) await learned(t, "checkout");
    await w.svc.curator.run(projectId);
    await learned("Checkout sends the order confirmation email through Postmark.", "checkout");
    await learned("Checkout shows the delivery estimate from Shippo.", "checkout");
    const second = await w.svc.curator.run(projectId);
    assert.equal(second.page, "page:checkout v2");
    assert.equal((await w.svc.brain.undoRun(Number(String(second.run).slice(1)), { by: "owner" })).ok, true);
    assert.equal(w.svc.archive.pages.latest(projectId, "about:checkout").version, 1);
    await w.svc.deleteProject(projectId);
    assert.equal(Number(w.svc.archive.db.prepare("SELECT COUNT(*) AS n FROM pages WHERE project_id = ?").get(projectId).n), 0);
  });
});
