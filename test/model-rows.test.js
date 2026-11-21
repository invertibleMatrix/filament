// @ts-check
// HarnessV4_Settings_Plan HS-2, the part a provider's page and a coding agent's card share: the providers' state (one
// version read, the writes that name it, a refusal read again) and a provider's models as rows on the fake DOM — the
// tick that keeps a model in the picker or out, add one by name, a typed name's ×, Ping, Refresh list, Tune › in a
// dialog kept on Save — and the words they say (pure answers). The page itself is in providers-page.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIMIT, LIMIT_MOST, PING_SAYS, atWorkWords, createModelRows, dayBefore, familyUse, goneNames, heldWords, limitOf, pingWords, priceWords, tokWords, useWords,
} from "../src/ui/harness/lib/model-rows.js";
import { providersState, refusedWords } from "../src/ui/harness/lib/providers-state.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { apiError, cardOf, every, fakeBus, fakeServer, familyOf, flush, named, recordingDialogs, viewOf } from "./helpers/providers-fake.js";

const NOW = 1_758_000_000_000;
const button = (/** @type {any} */ el, /** @type {string} */ words) => {
  const b = buttonsOf(el).find((x) => textOf(x) === words || x.attrs["aria-label"] === words);
  assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
  return b;
};
const stale = () => apiError(409, { error: "zai changed since", stale: true, changes: ["upstreams.zai.enabled", "upstreams.zai.models"], version: 14 });

/** Z.ai with two chat families (GLM 5.3 with a fast id, GLM 4.6) and an embedding model. @param {Record<string, any>} [o] */
const zai = (o = {}) => fakeServer({
  families: { zai: [familyOf("zai", "GLM 5.3", ["glm-5.3", "glm-5.3-fast"]), familyOf("zai", "GLM 4.6", ["glm-4.6"]), familyOf("zai", "embedding-3", ["embedding-3"], { kind: "other" })] },
  cards: { zai: [cardOf("zai/glm-5.3", { price: { input: 0.6, output: 2.2, source: "upstream", stated: ["input", "output"] } }), cardOf("zai/glm-4.6")] },
  info: { zai: { all: ["glm-5.3", "glm-5.3-fast", "glm-4.6", "embedding-3"], listed: ["glm-5.3", "glm-5.3-fast", "glm-4.6", "embedding-3"] } },
  ...o,
});

/** The rows of one provider over a server, with recording toasts, dialogs and a confirm that answers `yes`. @param {ReturnType<typeof fakeServer>} srv @param {{ id?: string, yes?: boolean }} [o] */
const rowsOver = async (srv, o = {}) => {
  const bus = fakeBus();
  const state = providersState(srv.api, bus.subscribe);
  await state.read();
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const { dialog, shown } = recordingDialogs();
  /** @type {any[]} */
  const asked = [];
  const rows = createModelRows({ state, id: o.id || "zai", onToast: (msg, kind) => toasts.push([msg, kind]), subscribe: bus.subscribe, now: () => NOW },
    /** @type {any} */ ({ h: fakeH, api: srv.api, dialog, confirm: async (/** @type {any} */ q) => { asked.push(q); return o.yes ?? true; } }));
  await flush();
  return { state, bus, rows, el: /** @type {any} */ (rows.el), toasts, shown, asked };
};
const famRow = (/** @type {any} */ el, /** @type {string} */ id) => every(el, "mrow").find((r) => r.attrs["data-family"] === id);

describe("the words (pure)", () => {
  test("30 days of use: tokens in short, what was paid, and on a plan what the same tokens cost at list", () => {
    assert.equal(dayBefore(NOW, 29).length, 10);
    assert.deepEqual([tokWords(950), tokWords(2100), tokWords(18_400_000), tokWords(3e9)], ["950", "2.1K", "18.4M", "3B"]);
    assert.equal(useWords(null), "—");
    assert.equal(useWords({ requests: 3, tokens: 2100, cost: 0.034, costN: 3, listCost: 0, listCostN: 0 }), "2.1K tok · $0.03");
    assert.equal(useWords({ requests: 3, tokens: 2100, cost: 0, costN: 3, listCost: 1.5, listCostN: 3 }), "2.1K tok · plan, $1.50 at list");
    const use = new Map([["zai|glm-5.3", { requests: 2, input: 1000, output: 100, cost: 0.01, costN: 2 }], ["zai|glm-5.3-fast", { requests: 1, input: 500, cacheRead: 400, cost: 0.02, costN: 1 }]]);
    assert.deepEqual(familyUse(use, "zai", [{ name: "glm-5.3" }, { name: "glm-5.3-fast" }]), { requests: 3, tokens: 2000, cost: 0.03, costN: 3, listCost: 0, listCostN: 0 });
    assert.equal(familyUse(use, "zai", [{ name: "glm-4.6" }]), null);
  });

  test("a Ping's answer, a list price (an agent's is its plan), and what a Refresh took away (a typed name stays)", () => {
    assert.equal(pingWords({ ok: true, ms: 840, text: "pong" }), "Answered in 840 ms: “pong”");
    assert.equal(pingWords({ ok: true, ms: 2300 }), "Answered in 2.3 s");
    assert.equal(pingWords({ ok: false, status: 404, error: "model not found" }), "Failed (404): model not found");
    assert.equal(priceWords({ price: { input: 0.6, output: 2.2 } }, false), "$0.6 / $2.2");
    assert.equal(priceWords({ price: { input: 0, output: 0 } }, false), null);
    assert.equal(priceWords({ price: { input: 15, output: 75, source: "builtin" } }, true), "plan", "a built-in rate never prices an agent's turn");
    assert.equal(priceWords({ price: { input: 15, output: 75, source: "upstream" } }, true), "plan · $15 / $75");
    const fams = [familyOf("zai", "GLM 5.3", ["glm-5.3"])];
    assert.deepEqual(goneNames(new Set(["glm-5.3", "glm-4.6", "GLM-X"]), fams, ["glm-x"]), ["glm-4.6"]);
  });

  test("a refused change is said in words: changed elsewhere, what changed, and that it shows as it is now", () => {
    assert.equal(refusedWords(stale(), "Z.ai"), "Z.ai changed elsewhere since this page read it: upstreams.zai.enabled and 1 more. It now shows as it is: make your change again if you still want it.");
    assert.equal(refusedWords(apiError(400, { error: "a prefix is letters" }), "Z.ai"), "a prefix is letters");
  });
});

describe("the providers' state", () => {
  // (fails before: yes — HS-D3: the harness had no way to name the version it read, so a write undid a newer change)
  test("a write names the version read; its answer is the page's own when it follows straight on, and the next write names it", async () => {
    const srv = zai();
    const state = providersState(srv.api);
    assert.equal(state.all(), null, "nothing before the first read");
    await state.read();
    assert.deepEqual(state.all()?.map((u) => u.id), ["zai"]);
    const u = await state.patch("zai", { enabled: false });
    assert.equal(u.enabled, false);
    assert.equal(state.get("zai")?.enabled, false, "the answer's provider takes the page's copy's place");
    await state.patch("zai", { enabled: true });
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body.base), [10, 11]);
    assert.equal(srv.made("GET", "/upstreams").length, 1, "its own writes are not read back");
  });

  test("a change that landed between is read, never swallowed: a write's version that skips one reads every provider again", async () => {
    const srv = zai();
    const state = providersState(srv.api);
    await state.read();
    srv.version += 1; // someone else's save
    await state.patch("zai", { name: "GLM" });
    await flush();
    assert.equal(srv.made("GET", "/upstreams").length, 2);
    await state.patch("zai", { name: "GLM 2" });
    assert.equal(srv.made("PATCH", "/upstreams/zai").at(-1)?.body.base, 12, "the version read again, which holds both");
  });

  test("a save heard on the stream reads again unless it was its own; hello reads again; the stream is held only while someone listens", async () => {
    const srv = zai();
    const bus = fakeBus();
    const state = providersState(srv.api, bus.subscribe);
    await state.read();
    let told = 0;
    const off = state.listen(() => { told++; });
    assert.equal(bus.listeners(), 1);
    await state.patch("zai", { enabled: false });
    bus.say({ type: "config-changed", version: 11 });
    await flush();
    assert.equal(srv.made("GET", "/upstreams").length, 1, "version 11 was the page's own write");
    srv.version = 12;
    bus.say({ type: "config-changed", version: 12 });
    await flush();
    assert.equal(srv.made("GET", "/upstreams").length, 2, "version 12 was not");
    bus.say({ type: "hello" });
    await flush();
    assert.equal(srv.made("GET", "/upstreams").length, 3);
    assert.ok(told >= 3);
    off();
    assert.equal(bus.listeners(), 0);
  });

  test("a stale refusal reads every provider again before it is thrown on; a failed first read says why", async () => {
    const srv = zai();
    const state = providersState(srv.api);
    await state.read();
    srv.refuse = (p, m) => (m === "PATCH" ? stale() : undefined);
    await assert.rejects(state.patch("zai", { enabled: false }), (e) => /** @type {any} */ (e).body.stale === true);
    assert.equal(srv.made("GET", "/upstreams").length, 2);
    const down = fakeServer();
    down.refuse = () => new Error("Filament is not running");
    const s2 = providersState(down.api);
    await s2.read();
    assert.equal(s2.failed(), "Filament is not running");
  });

  test("a removal reads every provider again: the routes it took were other providers' too", async () => {
    const srv = zai({ upstreams: [viewOf(), viewOf({ id: "kimi", name: "Kimi", prefix: "kimi", provider: null })] });
    const state = providersState(srv.api);
    await state.read();
    const r = await state.remove("zai", true);
    assert.equal(r.name, "Z.ai");
    assert.deepEqual(srv.made("DELETE", "/upstreams/").map((c) => c.path), ["/upstreams/zai?also=1"]);
    assert.deepEqual(state.all()?.map((u) => u.id), ["kimi"]);
  });
});

describe("a provider's models on the fake DOM", () => {
  // (fails before: yes — Settings had no models of a provider at all: the console's model table was the only one)
  test("a row per model as the picker shows it: the tick, its name and ids, what it can do, its window and list price", async () => {
    const { el } = await rowsOver(zai());
    assert.equal(textOf(every(el, "mrows-count")[0]), "2 of 2 in the picker");
    const glm = famRow(el, "zai/glm-5.3");
    assert.equal(named(glm, "In the picker: GLM 5.3").checked, true);
    assert.match(textOf(glm), /GLM 5\.3\|▸ 2 ids/);
    assert.match(textOf(glm), /\$0\.6 \/ \$2\.2/);
    assert.match(textOf(glm), /200K/);
    assert.equal(every(glm, "mrow-noprice").length, 0);
    // HC-46: a model with no list price says what that means, and offers to set one
    assert.equal(textOf(every(famRow(el, "zai/glm-4.6"), "mrow-noprice")[0]), "No price: spend shows tokens only · |Set price");
    assert.match(textOf(famRow(el, "zai/glm-4.6")), /\|–\|Ping/, "its price column says nothing twice");
    assert.match(textOf(every(el, "mrows-other")[0]), /^Other models, not for chat · 1/);
    assert.match(textOf(el), new RegExp(PING_SAYS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  // (fails before: yes — the owner's of 11-10: Fable 5.2 tuned to 1M, the picker said 1M, while Claude Code ran it in
  // 200K, and nothing on its card said why)
  test("a model whose agent counts a window of its own, other than the one said for it here, says so under its row, with the name that runs it in the window said", async () => {
    const { el } = await rowsOver(zai({ models: [
      { id: "zai/glm-4.6", upstream: "zai", upstreamModel: "glm-4.6", context_window: 1_000_000, agent_window: 200_000, agent_window_add: "glm-4.6[1m]" },
      { id: "zai/glm-5.3-fast", upstream: "zai", upstreamModel: "glm-5.3-fast", context_window: 200_000 },
    ] }));
    assert.equal(textOf(every(famRow(el, "zai/glm-4.6"), "mrow-said")[0]), "Z.ai runs glm-4.6 in 200K, its own count: the 1M said for it here doesn't reach Z.ai. Add glm-4.6[1m] by name on its card to run it in 1M.");
    button(famRow(el, "zai/glm-5.3"), "▸ 2 ids").dispatch("click");
    await flush();
    assert.equal(every(el, "mrow").filter((r) => r.attrs["data-member"]).flatMap((r) => every(r, "mrow-said")).length, 0, "where nothing differs, nothing is said");
  });

  // (fails before: yes — a model's agents at once was set in Library › Models for agents, apart from the model, and a
  // model nothing set ran 4; the owner's of 11-05: "limits are always per model", and none set is none)
  test("Agents at once on a model's row: empty for no limit, a number written at once for its provider's model, a provider's lower hold said under it; a family of ids sets it on each id", async () => {
    const srv = zai({ slots: [{ upstream: "zai", model: "glm-4.6", name: "glm-4.6", set: 3, cap: 2, lowered: { cap: 2, from: "429", liftsAt: NOW + 90_000 }, running: 2, waiting: 1, whom: [] }] });
    const { el, toasts } = await rowsOver(srv);
    const fieldOf = (/** @type {any} */ row, /** @type {string} */ id) => named(row, `${id}: how many agents at once across your chats — empty for no limit`);
    const g46 = famRow(el, "zai/glm-4.6");
    const f46 = fieldOf(g46, "glm-4.6");
    assert.equal(f46.value, "3");
    assert.match(f46.attrs.title, /now 2 at work · 1 waits$/);
    assert.equal(textOf(every(g46, "mrow-said")[0]), "Agents at once: 2 of 3 for now — its provider said too many requests, for 2 more minutes");
    // A family of several ids: each id its own limit, said on the family's row as how many are set.
    const glm = famRow(el, "zai/glm-5.3");
    assert.match(textOf(glm), /\|no limit\|/);
    button(glm, "▸ 2 ids").dispatch("click");
    await flush();
    const fast = every(el, "mrow").find((r) => r.attrs["data-member"] === "zai/glm-5.3-fast");
    const ff = fieldOf(fast, "glm-5.3-fast");
    assert.equal(ff.value, "", "none set: empty, no limit");
    assert.equal(ff.attrs.placeholder, "no limit");
    ff.value = "5";
    ff.onchange();
    await flush();
    assert.deepEqual(srv.made("PUT", "/subagents/slots").map((c) => c.body), [{ upstream: "zai", model: "glm-5.3-fast", n: 5 }]);
    assert.deepEqual(toasts.at(-1), ["glm-5.3-fast runs up to 5 agents at once across your chats", undefined]);
    assert.match(textOf(famRow(el, "zai/glm-5.3")), /\|1 of 2 set\|/);
    // Emptied, the limit goes: null; a number past the most is refused in words and the field reads its number again.
    const again = fieldOf(famRow(el, "zai/glm-4.6"), "glm-4.6");
    again.value = "99";
    again.onchange();
    await flush();
    assert.equal(srv.made("PUT", "/subagents/slots").length, 1);
    assert.deepEqual(toasts.at(-1), ["Agents at once is a whole number from 1 to 64, or empty for no limit", "err"]);
    assert.equal(again.value, "3");
    again.value = "";
    again.onchange();
    await flush();
    assert.deepEqual(srv.made("PUT", "/subagents/slots").at(-1)?.body, { upstream: "zai", model: "glm-4.6", n: null });
    assert.deepEqual(toasts.at(-1), ["glm-4.6 runs agents with no limit", undefined]);
    assert.equal(fieldOf(famRow(el, "zai/glm-4.6"), "glm-4.6").value, "");
  });

  // (fails before: yes — the review of 11-05: the field looked its row up by the name as written, where the server
  // matches a model's name in any case; a row kept as "GLM-4.6" left glm-4.6's field empty, saying no limit)
  test("a model's limit row is found whatever its name's case", async () => {
    const srv = zai({ slots: [{ upstream: "zai", model: "GLM-4.6", name: "GLM-4.6", set: 3, cap: 3, lowered: null, running: 0, waiting: 0, whom: [] }] });
    const { el } = await rowsOver(srv);
    assert.equal(named(famRow(el, "zai/glm-4.6"), "glm-4.6: how many agents at once across your chats — empty for no limit").value, "3");
  });

  test("the limit's words (pure): a field's text, a provider's hold, what runs now", () => {
    assert.deepEqual(["", " ", "4", "64", "0", "65", "2.5", "x"].map(limitOf), [null, null, 4, 64, NaN, NaN, NaN, NaN]);
    assert.equal(LIMIT_MOST, 64);
    assert.equal(heldWords(null, NOW), "");
    assert.equal(heldWords({ cap: 4, set: 4, lowered: null }, NOW), "");
    assert.equal(heldWords({ cap: 3, set: null, lowered: { from: "429", liftsAt: NOW + 60_000 } }, NOW), "Agents at once: 3 for now — its provider said too many requests, for 1 more minute");
    // (the review of 11-05: a provider's rate-limit headers count a minute's requests, and hold no agents)
    assert.equal(heldWords({ cap: 5, set: 8, lowered: { from: "headers" } }, NOW), "");
    assert.equal(heldWords({ cap: 7, set: null, lowered: { from: "429", times: 3, takes: 7, liftsAt: NOW + 5 * 60_000 } }, NOW), "Agents at once: 7 — its provider takes about 7 on your account: it refused the 8th 3 times. One more is tried in 5 minutes");
    assert.equal(heldWords({ cap: 8, set: null, lowered: { from: "429", times: 3, takes: 7, probing: true } }, NOW), "Agents at once: 8 for now, trying one more at a time — its provider refused the 8th 3 times");
    assert.deepEqual([atWorkWords(null), atWorkWords({ running: 2 }), atWorkWords({ running: 0, waiting: 2 })], ["", "2 at work", "2 wait"]);
  });

  test("▸ opens a family to its ids, each with its own tick and Ping", async () => {
    const { el } = await rowsOver(zai());
    button(famRow(el, "zai/glm-5.3"), "▸ 2 ids").dispatch("click");
    await flush();
    const members = every(el, "mrow").filter((r) => r.attrs["data-member"]);
    assert.deepEqual(members.map((r) => r.attrs["data-member"]), ["zai/glm-5.3", "zai/glm-5.3-fast"]);
    assert.match(textOf(members[1]), /glm-5\.3-fast\|Fast/);
    assert.ok(named(members[1], "Ping zai/glm-5.3-fast"));
  });

  // HS-D4: a row is kept at once
  test("unticking a family takes each of its ids out of every picker, kept at once on the version read; Show all brings them back", async () => {
    const srv = zai();
    const { el, toasts } = await rowsOver(srv);
    const t = named(famRow(el, "zai/glm-5.3"), "In the picker: GLM 5.3");
    t.checked = false;
    t.onchange();
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ hiddenModels: ["glm-5.3", "glm-5.3-fast"], base: 10 }]);
    assert.deepEqual(toasts.at(-1), ["GLM 5.3 is out of every picker; its name still answers when asked for", undefined]);
    const off = famRow(el, "zai/glm-5.3");
    assert.match(off.attrs.class, /is-off/);
    assert.match(textOf(off), /out of the picker/);
    assert.equal(textOf(every(el, "mrows-count")[0]), "1 of 2 in the picker");
    const t46 = named(famRow(el, "zai/glm-4.6"), "In the picker: GLM 4.6");
    t46.checked = false;
    t46.onchange();
    await flush();
    // (fails before: yes — every row out of the picker said "No price" in orange, twice, though it is never sent)
    assert.equal(every(famRow(el, "zai/glm-4.6"), "mrow-noprice").length, 0, "a model out of the picker is not nagged about its price");
    button(el, "Show all (3 out)").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").at(-1)?.body, { hiddenModels: [], base: 12 });
  });

  test("a refused tick says so and shows the provider as it now is", async () => {
    const srv = zai();
    const { el, toasts } = await rowsOver(srv);
    srv.refuse = (p, m) => (m === "PATCH" ? stale() : undefined);
    const t = named(famRow(el, "zai/glm-4.6"), "In the picker: GLM 4.6");
    t.checked = false;
    t.onchange();
    await flush();
    assert.equal(toasts.at(-1)?.[1], "err");
    assert.match(String(toasts.at(-1)?.[0]), /^Z\.ai changed elsewhere since this page read it/);
    assert.equal(named(famRow(el, "zai/glm-4.6"), "In the picker: GLM 4.6").checked, true, "drawn again as it is");
  });

  test("add a model by name: kept in the typed names, said when it is not in the provider's list; a listed name says so", async () => {
    const srv = zai();
    const { el, toasts } = await rowsOver(srv);
    button(el, "Add a model by name").dispatch("click");
    await flush();
    const field = named(el, "A model's name at Z.ai");
    field.value = "glm-4.6";
    button(el, "Add").dispatch("click");
    await flush();
    assert.equal(textOf(every(el, "mrows-said")[0]), "glm-4.6 is in Z.ai's own list already");
    assert.equal(srv.made("PATCH", "/upstreams/zai").length, 0);
    field.value = "glm-5.4-preview";
    field.onkeydown({ key: "Enter", preventDefault() {} });
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ models: ["glm-5.4-preview"], base: 10 }]);
    assert.equal(toasts.at(-1)?.[0], "glm-5.4-preview is kept: every picker offers it. It is not in Z.ai's own list: Ping tells whether it answers.");
    assert.equal(named(el, "A model's name at Z.ai"), undefined, "the row closes once kept");
  });

  // (fails before: yes — the row closed before the save was answered, and was drawn anew on every paint, so a refused
  // name was lost and a paint while typing took the field's focus and what was typed)
  test("the add row stays put while open: a paint keeps its field, and a refused name stays in it", async () => {
    const srv = zai();
    const { el, rows } = await rowsOver(srv);
    button(el, "Add a model by name").dispatch("click");
    await flush();
    const field = named(el, "A model's name at Z.ai");
    field.value = "glm-6";
    rows.paint();
    await flush();
    assert.equal(named(el, "A model's name at Z.ai"), field, "the same field after a paint");
    srv.refuse = (p, m) => (m === "PATCH" ? stale() : undefined);
    button(el, "Add").dispatch("click");
    await flush();
    assert.equal(named(el, "A model's name at Z.ai"), field);
    assert.equal(field.value, "glm-6");
    field.onkeydown({ key: "Escape", preventDefault() {} });
    await flush();
    assert.equal(named(el, "A model's name at Z.ai"), undefined);
  });

  test("a typed name is marked, and its × takes it off the typed names", async () => {
    const srv = zai({ upstreams: [viewOf({ models: ["glm-6"] })] });
    srv.families.zai.push(familyOf("zai", "glm-6", ["glm-6"]));
    const { el } = await rowsOver(srv);
    const r = famRow(el, "zai/glm-6");
    assert.match(textOf(r), /typed, not in its list/);
    button(r, "Take glm-6 off the names you typed").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ models: [], base: 10 }]);
  });

  test("Ping sends a tiny request and says its answer on the row", async () => {
    const srv = zai();
    const { el } = await rowsOver(srv);
    button(famRow(el, "zai/glm-4.6"), "Ping zai/glm-4.6").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("POST", "/models/ping").map((c) => c.body), [{ model: "zai/glm-4.6" }]);
    assert.equal(textOf(every(famRow(el, "zai/glm-4.6"), "mrow-said")[0]), "Answered in 840 ms: “pong”");
  });

  test("Refresh list asks the provider again and says what is gone from its list", async () => {
    const srv = zai();
    const { el, toasts } = await rowsOver(srv);
    srv.families.zai = srv.families.zai.filter((f) => f.name !== "GLM 4.6");
    button(el, "Refresh list").dispatch("click");
    await flush();
    assert.ok(srv.calls.some((c) => c.path === "/models?refresh=1"));
    assert.equal(toasts.at(-1)?.[0], "Asked Z.ai again: nothing new, 1 gone from its list");
    assert.match(textOf(el), /Gone from Z\.ai's list at the last Refresh: glm-4\.6\./);
  });

  test("Tune › opens the console's sheet in a wide dialog; Save sends its row at once, and edits not saved are asked about", async () => {
    const srv = zai();
    const { el, shown, asked, toasts } = await rowsOver(srv, { yes: false });
    button(famRow(el, "zai/glm-4.6"), "Tune GLM 4.6").dispatch("click");
    await flush();
    const d = shown.at(-1);
    assert.equal(d.title, "Tune glm-4.6");
    assert.equal(d.wide, true);
    const box = (/** @type {string} */ label) => named(d.body, label);
    box("in price, USD per million tokens").value = "0.5";
    box("in price, USD per million tokens").oninput();
    box("out price, USD per million tokens").value = "2";
    box("out price, USD per million tokens").oninput();
    d.close();
    await flush();
    assert.equal(d.closed, null, "kept open: the person said no to Discard");
    assert.deepEqual(asked.map((q) => [q.title, q.description]), [["Discard your changes to glm-4.6?", "Nothing is kept until you press Save."]]);
    button(d.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ pricingRow: { key: "glm-4.6", row: { input: 0.5, output: 2 } }, base: 10 }]);
    assert.equal(d.closed, "forced");
    assert.equal(toasts.at(-1)?.[0], "glm-4.6 saved; every model picker reads it again");
  });

  test("a refused Save stays on the sheet, said in the page's words", async () => {
    const srv = zai();
    const { el, shown } = await rowsOver(srv);
    button(famRow(el, "zai/glm-4.6"), "Set price").dispatch("click");
    await flush();
    const d = shown.at(-1);
    named(d.body, "out price, USD per million tokens").value = "2";
    named(d.body, "out price, USD per million tokens").oninput();
    srv.refuse = (p, m) => (m === "PATCH" ? stale() : undefined);
    button(d.body, "Save").dispatch("click");
    await flush();
    assert.equal(d.closed, null);
    assert.match(textOf(d.body), /Not kept: Z\.ai changed elsewhere since this page read it/);
  });

  test("why nothing shows: switched off, nothing reaching it, its list failing", async () => {
    const off = await rowsOver(zai({ upstreams: [viewOf({ enabled: false })] }));
    assert.match(textOf(every(off.el, "mrows-why")[0]), /^Switched off: none of Z\.ai's models is offered\.$/);
    const unreached = await rowsOver(zai({ upstreams: [viewOf({ prefix: null })] }));
    assert.match(textOf(every(unreached.el, "mrows-why")[0]), /^Nothing reaches it yet: give it a prefix under Advanced below/);
    const failing = await rowsOver(zai({ info: { zai: { error: "401 Unauthorized." } } }));
    const why = every(failing.el, "mrows-why")[0];
    assert.equal(textOf(why), "Z.ai did not list its models: 401 Unauthorized. Check its key above, then Refresh list.");
    assert.match(why.attrs.class, /is-bad/);
  });

  // (fails before: yes — the filter was drawn anew on each keystroke, so it lost the focus after one letter)
  test("a long list is filtered by one field that stays put; past the limit, Show all", async () => {
    const names = Array.from({ length: LIMIT + 2 }, (_, i) => `m-${i}`);
    const srv = zai({ families: { zai: names.map((n) => familyOf("zai", n, [n])) }, cards: { zai: [] } });
    const { el } = await rowsOver(srv);
    assert.equal(every(el, "mrow").filter((r) => r.attrs["data-family"]).length, LIMIT);
    const f = named(el, "Filter Z.ai's models");
    f.value = "m-4";
    f.oninput();
    await flush();
    assert.equal(named(el, "Filter Z.ai's models"), f);
    assert.deepEqual(every(el, "mrow").filter((r) => r.attrs["data-family"]).map((r) => r.attrs["data-family"]), ["zai/m-4", "zai/m-40", "zai/m-41"]);
    f.value = "";
    f.oninput();
    await flush();
    button(el, `Show all ${LIMIT + 2}`).dispatch("click");
    await flush();
    assert.equal(every(el, "mrow").filter((r) => r.attrs["data-family"]).length, LIMIT + 2);
  });

  test("a list found by a save's discovery is read again; the rows stop listening once off the page", async () => {
    const srv = zai();
    const { el, bus } = await rowsOver(srv);
    const asked = () => srv.made("POST", "/models/caps").length;
    const before = asked();
    bus.say({ type: "models-discovered" });
    await flush();
    assert.equal(asked(), before + 1);
    el.isConnected = false;
    bus.say({ type: "models-discovered" });
    await flush();
    assert.equal(asked(), before + 1);
    assert.equal(bus.listeners(), 0, "neither the state's stream nor the rows' own is held");
  });
});

// The owner's of 11-11 (key-models.test.js): a Claude Code account on an Anthropic API key also offers the models
// Anthropic lists for the key and Claude Code's own list lacks; `GET /api/models` names them (`keyed`) and says why
// they could not be asked for (`keyNote`).
describe("a Claude Code account's models from its API key", () => {
  /** Claude Code's card: `sonnet` its own, claude-fable-5-2 from its key, claude-nova-6 typed. @param {Record<string, any>} info */
  const claude = (info) => fakeServer({
    upstreams: [viewOf({ id: "cc", name: "Claude Code", type: "acp", agent: true, prefix: "cc", provider: null, models: ["claude-nova-6"] })],
    families: { cc: [familyOf("cc", "Sonnet 5", ["sonnet"]), familyOf("cc", "Claude Fable 5.2", ["claude-fable-5-2"]), familyOf("cc", "claude-nova-6", ["claude-nova-6"])] },
    cards: { cc: [cardOf("cc/sonnet"), cardOf("cc/claude-fable-5-2"), cardOf("cc/claude-nova-6")] },
    info: { cc: { all: ["sonnet", "claude-fable-5-2", "claude-nova-6"], listed: ["sonnet"], ...info } },
  });

  // (fails before: yes — a model from the key read as one Claude Code lists itself)
  test("a model from the key says so on its row; one Claude Code lists, and a typed one, read as before", async () => {
    const { el } = await rowsOver(claude({ keyed: ["claude-fable-5-2"] }), { id: "cc" });
    const mark = every(famRow(el, "cc/claude-fable-5-2"), "mrow-keyed")[0];
    assert.ok(mark, textOf(famRow(el, "cc/claude-fable-5-2")));
    assert.equal(textOf(mark), "from your API key");
    assert.equal(mark.attrs.title, "Anthropic lists it for this account's API key. Claude Code does not list it itself.");
    assert.equal(every(famRow(el, "cc/sonnet"), "mrow-keyed").length, 0);
    assert.equal(every(famRow(el, "cc/claude-nova-6"), "mrow-keyed").length, 0);
    assert.match(textOf(every(famRow(el, "cc/claude-nova-6"), "mrow-typed")[0]), /^typed, not in its list/);
    assert.equal(every(el, "mrows-key").length, 0, "no line while nothing went wrong");
  });

  // (fails before: yes — there was no such line)
  test("why the key's models could not be asked for is one quiet line over the rows", async () => {
    const keyNote = "Anthropic's list of the models this account's API key can use was refused (401 authentication_error): only the models Claude Code lists itself are offered.";
    const { el } = await rowsOver(claude({ keyNote }), { id: "cc" });
    const line = every(el, "mrows-key")[0];
    assert.ok(line, textOf(el));
    assert.equal(textOf(line), keyNote);
    assert.deepEqual(String(line.attrs.class).split(/\s+/), ["mrows-why", "mrows-key"], "quiet: not an error's colour");
    assert.ok(famRow(el, "cc/sonnet"), "its own rows stand");
  });
});

// The owner's of 11-10 ("look at this crappy UI. the text broken"): a coding agent's card and a provider's page left a
// model's name 23 px of a 675 px list, its figures' columns fixed widths and its buttons' 190 px.
describe("the rows' layout (settings.css)", () => {
  const css = readFileSync(new URL("../src/ui/harness/settings/settings.css", import.meta.url), "utf8");
  test("one table: each row on the list's columns, a figure's as wide as its widest, the name the rest", () => {
    assert.match(css, /\.mrows-list \{ display: grid; grid-template-columns: 18px minmax\(0, 1fr\) repeat\(3, auto\) auto;/);
    assert.match(css, /\.mrows-list\.has-use \{ grid-template-columns: 18px minmax\(0, 1fr\) repeat\(4, auto\) auto; \}/);
    assert.match(css, /\.mrow \{ display: grid; grid-template-columns: subgrid;/);
    assert.doesNotMatch(css, /\.mrow[^{]*\{[^}]*grid-template-columns:[^;}]*\d+px \d+px/, "no figure column of a fixed width");
    assert.doesNotMatch(css, /min-width: 190px/);
  });
  test("under a wide window's width — a Settings page, about 700 px — the figures go under the name, each with its word", () => {
    const narrow = css.match(/@container mrows \(max-width: (\d+)px\) \{([^]*?)\n\}/);
    assert.ok(narrow, "the narrow rows' block");
    assert.ok(Number(narrow[1]) >= 860, `stacked up to ${narrow[1]} px`);
    assert.match(narrow[2], /\.mrows-list, \.mrows-list\.has-use \{ display: flex; flex-direction: column; \}/);
    assert.match(narrow[2], /\.mrow-figs \.mrow-fig\[data-k\]::before \{ content: attr\(data-k\) " ";/);
  });
  test("Agents at once has no spin buttons, which took the room its \"no limit\" needs", () => {
    assert.match(css, /\.mrow-limit-in \{[^}]*appearance: textfield;/);
    assert.match(css, /\.mrow-limit-in::-webkit-inner-spin-button[^{]*\{ margin: 0; -webkit-appearance: none; \}/);
  });
});
