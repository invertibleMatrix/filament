// @ts-check
// HarnessV4_Settings_Plan HS-2, the page: Settings › Providers on the fake DOM — the list (a row per provider, its
// health and plan, today's spend, the line to Coding agents), a provider's page (Test, the switch, the key with
// Replace, how it bills, its plan, its prefix, Advanced, Remove after saying what goes), Add a provider (tiles, plan,
// key, a prefix filled for you, the test with a tick per model, Add — a failed test still adds), and Qoder's sign-in
// in the browser. The words are pure answers. The model rows are model-rows.test.js's; the server's routes are
// providers-settings.test.js's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADD_FOOT, AGENTS_LINE, hueOf, planWords, renderProviders, routesOf, testWords } from "../src/ui/harness/settings/providers.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { ZAI, apiError, every, fakeBus, fakeServer, familyOf, flush, named, recordingDialogs, viewOf } from "./helpers/providers-fake.js";

const NOW = 1_758_000_000_000;
const button = (/** @type {any} */ el, /** @type {string} */ words) => {
  const b = buttonsOf(el).find((x) => textOf(x) === words || x.attrs["aria-label"] === words);
  assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
  return b;
};
const KIMI = viewOf({ id: "kimi", name: "Kimi", prefix: "kimi", baseUrl: "https://api.moonshot.ai/v1", provider: null, billing: null, today: { requests: 4, cost: 0.42, costN: 4 } });
const AGENT = viewOf({ id: "claude-code", name: "Claude Code", type: "acp", agent: true, provider: null, prefix: null });

/**
 * The page over a server, with recording toasts, dialogs, pages opened and timers; `yes` answers every question.
 * @param {ReturnType<typeof fakeServer>} srv @param {{ yes?: boolean, start?: string }} [o]  `start`: what the page opens on
 */
const pageOver = async (srv, o = {}) => {
  const bus = fakeBus();
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const { dialog, shown } = recordingDialogs();
  /** @type {any[]} */
  const asked = [];
  /** @type {string[]} */
  const opened = [];
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  const body = /** @type {any} */ (fakeH("div", {}));
  const page = renderProviders(body, { onToast: (msg, kind) => toasts.push([msg, kind]), now: () => NOW, start: o.start ?? null }, /** @type {any} */ ({
    h: fakeH, api: srv.api, dialog, subscribe: bus.subscribe, open: (/** @type {string} */ u) => opened.push(u),
    confirm: async (/** @type {any} */ q) => { asked.push(q); return o.yes ?? true; },
    later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => { timers.push({ fn, ms }); return timers.length; },
  }));
  await flush();
  /** Runs the timers set so far, as their time came. */
  const tick = async () => {
    for (const t of timers.splice(0)) t.fn();
    await flush();
  };
  return { body, page, bus, toasts, shown, asked, opened, timers, tick, root: () => body.kids[0] };
};
const rowFor = (/** @type {any} */ el, /** @type {string} */ id) => every(el, "prov-row").find((r) => r.attrs["data-provider"] === id);
const crow = (/** @type {any} */ el, /** @type {string} */ label) => every(el, "prov-crow").find((r) => textOf(every(r, "prov-crow-label")[0]) === label);

describe("the words (pure)", () => {
  test("a test's answer, a provider's plan in the list's words, the routes a prefix is checked against, a tile's hue", () => {
    assert.deepEqual(testWords({ ok: true, ms: 120, at: NOW - 90_000 }, NOW), { text: "Answered in 120 ms · tested 2 min ago", bad: false });
    assert.deepEqual(testWords({ ok: false, status: 401, error: "invalid key" }, NOW), { text: "It answered 401: invalid key", bad: true });
    assert.deepEqual(testWords({ ok: false, status: 0, error: "connect ECONNREFUSED" }, NOW), { text: "No answer: connect ECONNREFUSED", bad: true });
    assert.equal(testWords(null, NOW), null);
    assert.equal(planWords(viewOf()), "GLM Coding Plan");
    assert.equal(planWords(viewOf({ provider: { ...viewOf().provider, plans: [ZAI.plans[1]], plan: ZAI.plans[1] } })), "Per token");
    assert.equal(planWords(KIMI), "api.moonshot.ai · per token");
    assert.equal(planWords(viewOf({ type: "qoder", qoder: { signedIn: true, email: "a@b.c" } })), "Qoder account · a@b.c");
    assert.equal(planWords(viewOf({ type: "qoder", qoder: { signedIn: false } })), "Qoder account · not signed in");
    assert.deepEqual(routesOf([viewOf({ routes: [{ match: "glm-*", as: "first", enabled: true }] }), AGENT]), {
      upstreams: [{ id: "zai", name: "Z.ai" }, { id: "claude-code", name: "Claude Code" }],
      routes: [{ match: "zai/*" }, { match: "glm-*" }],
    });
    assert.equal(hueOf("zai"), hueOf("zai"));
  });

  // (fails before: yes — HS-D12: Settings had a Models section and no Providers)
  test("Providers sits first under Models and agents, on the orange cable", () => {
    assert.deepEqual(SECTIONS.find((s) => s.id === "providers"), { id: "providers", group: "Models and agents", label: "Providers", icon: "cable" });
    assert.equal(SECTIONS.filter((s) => s.group === "Models and agents")[0].id, "providers");
    assert.match(readFileSync("src/ui/harness/aqua.css", "utf8"), /\.settings-item\[href\$="\/providers"\] \.settings-ic \{ --tile: var\(--color-sys-orange\); \}/);
  });
});

describe("the list", () => {
  test("a row per provider — not the coding agents — its dot, name, plan, counts and today's spend; the line to Coding agents", async () => {
    const srv = fakeServer({
      upstreams: [viewOf({ test: { ok: true, ms: 120, at: NOW } }), KIMI, AGENT],
      info: { zai: { all: ["glm-5.3", "glm-4.6", "embedding-3"] } },
      families: { zai: [familyOf("zai", "GLM 5.3", ["glm-5.3"]), familyOf("zai", "GLM 4.6", ["glm-4.6"])] },
    });
    const { root } = await pageOver(srv);
    assert.deepEqual(every(root(), "prov-row").map((r) => r.attrs["data-provider"]), ["zai", "kimi"]);
    const z = rowFor(root(), "zai");
    assert.equal(textOf(z), "Z.ai|GLM Coding Plan · 3 listed · 2 in the picker|plan");
    assert.equal(every(z, "prov-dot")[0].attrs.class, "prov-dot is-ok");
    assert.equal(textOf(rowFor(root(), "kimi")), "Kimi|api.moonshot.ai · per token · 0 in the picker|$0.42 today");
    assert.equal(every(rowFor(root(), "kimi"), "prov-dot")[0].attrs.class, "prov-dot", "never tested: no colour");
    const foot = every(root(), "prov-foot")[0];
    assert.equal(textOf(foot), `${AGENTS_LINE}| |Open Coding agents`);
    assert.ok(buttonsOf(root()).some((b) => textOf(b) === "Add a provider"));
  });

  test("a failed test is said on its row, in red; an off provider says off", async () => {
    const srv = fakeServer({ upstreams: [viewOf({ enabled: false, test: { ok: false, status: 401, error: "invalid key", at: NOW } })] });
    const { root } = await pageOver(srv);
    const z = rowFor(root(), "zai");
    assert.match(z.attrs.class, /is-off/);
    assert.equal(textOf(every(z, "prov-row-sub")[0]), "It answered 401: invalid key");
    assert.equal(every(z, "prov-row-sub")[0].attrs.class, "prov-row-sub is-bad");
    assert.match(textOf(z), /^Z\.ai\|off\|/);
  });

  test("a failed read says why and offers Try again; no provider says how to start", async () => {
    const down = fakeServer();
    down.refuse = (p) => (p === "/upstreams" ? new Error("Filament is not running") : undefined);
    const d = await pageOver(down);
    assert.match(textOf(d.root()), /^Filament is not running\|Try again$/);
    down.refuse = null;
    button(d.root(), "Try again").dispatch("click");
    await flush();
    assert.ok(rowFor(d.root(), "zai"));
    const none = await pageOver(fakeServer({ upstreams: [AGENT] }));
    assert.equal(textOf(every(none.root(), "prov-empty")[0]), "No provider yet. Add one with its key, and its models join the picker.");
  });

  // HC-44 (fails before: yes — no list of providers in the harness)
  test("more than eight providers: a search over them, the same field across paints", async () => {
    const many = Array.from({ length: 9 }, (_, i) => viewOf({ id: `p${i}`, name: `Provider ${i}`, prefix: `p${i}`, provider: null, baseUrl: `https://p${i}.example/v1` }));
    const { root, page } = await pageOver(fakeServer({ upstreams: many }));
    const s = named(root(), "Search the providers");
    s.value = "provider 3";
    s.oninput();
    assert.deepEqual(every(root(), "prov-row").map((r) => r.attrs["data-provider"]), ["p3"]);
    page.paint();
    assert.equal(named(root(), "Search the providers"), s);
    s.value = "nothing";
    s.oninput();
    assert.equal(textOf(every(root(), "prov-quiet")[0]), "No provider matches “nothing”.");
  });

  test("a row opens its provider's page in the list's place; ‹ Providers goes back", async () => {
    const { root } = await pageOver(fakeServer({ upstreams: [viewOf(), KIMI] }));
    rowFor(root(), "kimi").dispatch("click");
    assert.equal(textOf(every(root(), "prov-name")[0]), "Kimi");
    button(root(), "‹ Providers").dispatch("click");
    assert.ok(rowFor(root(), "kimi"));
  });
});

describe("a provider's page", () => {
  const open = async (/** @type {ReturnType<typeof fakeServer>} */ srv, /** @type {{ yes?: boolean }} */ o = {}) => {
    const p = await pageOver(srv, o);
    p.page.go(srv.upstreams[0].id);
    await flush();
    return p;
  };

  // (fails before: yes — HC-112: the page always opened on the list, so a search result could not open a provider)
  test("a Settings search result opens on that provider's page; one whose provider is gone opens the list", async () => {
    const { root } = await pageOver(fakeServer(), { start: "provider:zai" });
    assert.ok(crow(root(), "Key"), `its Key row in: ${textOf(root())}`);
    assert.equal(every(root(), "prov-row").length, 0, "not the list");
    const gone = await pageOver(fakeServer(), { start: "provider:nobody" });
    assert.ok(rowFor(gone.root(), "zai"), "the list, once the providers are read");
  });

  test("its head: tile, name, last test; Test asks it and says how it answered, and the page reads it again", async () => {
    const srv = fakeServer();
    const { root, toasts } = await open(srv);
    assert.equal(textOf(every(root(), "prov-tile")[0]), "Z");
    assert.equal(textOf(every(root(), "prov-meta")[0]), "Not tested since Filament started");
    button(root(), "Test").dispatch("click");
    await flush();
    assert.equal(srv.made("GET", "/upstreams/zai/test").length, 1);
    assert.deepEqual(toasts.at(-1), ["Z.ai: Answered in 120 ms · tested just now · 2 models", ""]);
    assert.match(textOf(every(root(), "prov-meta")[0]), /^Answered in 120 ms · tested /);
  });

  test("the switch is kept at once, on the version read", async () => {
    const srv = fakeServer();
    const { root, toasts } = await open(srv);
    const sw = named(root(), "Use Z.ai");
    assert.equal(sw.attrs["aria-checked"], "true");
    sw.dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ enabled: false, base: 10 }]);
    assert.equal(toasts.at(-1)?.[0], "Z.ai is off: its models leave every picker, and a chat on one is told when it next sends");
    assert.equal(named(root(), "Use Z.ai").attrs["aria-checked"], "false");
  });

  // HC-34 (fails before: yes)
  test("the key is sealed: Replace opens a field; an empty one keeps the key, a typed one replaces it", async () => {
    const srv = fakeServer();
    const { root, toasts } = await open(srv);
    const key = crow(root(), "Key");
    assert.equal(textOf(key), "Key|Sealed on this computer: never shown again|sk-a…f9|Replace|Get a key");
    button(key, "Replace").dispatch("click");
    const field = named(root(), "Z.ai's new key");
    assert.equal(field.attrs.type, "password");
    button(crow(root(), "Key"), "Save").dispatch("click");
    await flush();
    assert.equal(srv.made("PATCH", "/upstreams/zai").length, 0, "an empty field keeps the key it has");
    button(crow(root(), "Key"), "Replace").dispatch("click");
    named(root(), "Z.ai's new key").value = "sk-new-0123456789";
    named(root(), "Z.ai's new key").onkeydown({ key: "Enter", preventDefault() {} });
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ apiKey: "sk-new-0123456789", base: 10 }]);
    assert.equal(toasts.at(-1)?.[0], "Z.ai's key replaced: Test checks it");
    assert.match(textOf(crow(root(), "Key")), /sk-n…89/);
  });

  test("how it bills: picking the catalogue's own way sends none of its own; its plan moves its address", async () => {
    const srv = fakeServer();
    const { root } = await open(srv);
    const seg = named(root(), "How it bills");
    assert.equal(textOf(every(seg, "on")[0]), "A plan");
    button(seg, "Per token").dispatch("click");
    await flush();
    button(named(root(), "How it bills"), "A plan").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body.billing), ["metered", null]);
    const sel = named(root(), "Its plan");
    sel.value = "api";
    sel.onchange();
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").at(-1)?.body, { baseUrl: "https://api.z.ai/api/paas/v4", modelsPath: "", base: 12 });
  });

  // HC-33 (fails before: yes)
  test("a prefix is kept on Enter; a taken one is refused in words with a free one to use; Esc puts it back", async () => {
    const srv = fakeServer();
    const { root, toasts } = await open(srv);
    srv.refuse = (p, m, b) => (m === "PATCH" && b.prefix === "glm" ? apiError(409, { error: "The route glm/* already catches names starting with glm/", free: "glm-2" }) : undefined);
    const f = named(root(), "Its prefix");
    f.value = "glm";
    f.onkeydown({ key: "Enter", preventDefault() {} });
    await flush();
    const err = every(root(), "prov-err")[0];
    assert.equal(textOf(err), "The route glm/* already catches names starting with glm/| |Use glm-2");
    button(err, "Use glm-2").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").at(-1)?.body, { prefix: "glm-2", base: 10 });
    assert.equal(toasts.at(-1)?.[0], "Your chats ask for Z.ai's models as glm-2/… now");
    const f2 = named(root(), "Its prefix");
    f2.value = "other";
    f2.onkeydown({ key: "Escape", preventDefault() {} });
    assert.equal(f2.value, "glm-2");
  });

  test("Advanced: a header that carries a key shows as set and goes back sealed; the console's rule overrides are said", async () => {
    const srv = fakeServer({ upstreams: [viewOf({ headers: { "X-Org": "acme", "X-Api-Key": "__SECRET__" }, ruleOverrides: 2 })] });
    const { root } = await open(srv);
    assert.match(textOf(every(root(), "prov-adv")[0]), /2 rule overrides, set in the console/);
    assert.equal(every(root(), "prov-pair").length, 2);
    assert.match(textOf(every(root(), "prov-pair")[1]), /••••••••/);
    button(root(), "Save headers").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ headers: { "X-Org": "acme", "X-Api-Key": "__SECRET__" }, base: 10 }]);
  });

  // (fails before: yes — the bug hunt of 10-30: a key this secret.key cannot read was drawn as no key, and a kept header's
  // name could be changed, so Save headers sent its kept value under a name the server holds none under)
  test("a key this secret.key cannot read says so, with how it opens again; a kept header holds its name, as the console's card does", async () => {
    const srv = fakeServer({ upstreams: [viewOf({ key: { stored: true, masked: "", unreadable: true }, headers: { "X-Org": "acme", "X-Api-Key": "__SECRET__" } })] });
    const { root, toasts } = await open(srv);
    assert.equal(textOf(crow(root(), "Key")), "Key|Sealed with another secret.key: Filament cannot read it. Put that secret.key back beside config.json and restart Filament to read it again; a key set here replaces it.|unreadable|Replace|Get a key");
    const name = every(every(root(), "prov-pair")[1], "prov-hk")[0];
    name.value = "X-Key";
    name.oninput?.();
    name.onchange?.();
    assert.equal(name.value, "X-Api-Key", "the name stays");
    assert.deepEqual(toasts.at(-1), ["X-Api-Key keeps its stored value under its own name: give it a new value to rename it, or remove it and add it again", "err"]);
    button(root(), "Save headers").dispatch("click");
    await flush();
    assert.deepEqual(srv.made("PATCH", "/upstreams/zai").map((c) => c.body), [{ headers: { "X-Org": "acme", "X-Api-Key": "__SECRET__" }, base: 10 }]);
  });

  // HS-D15 (fails before: yes)
  test("Remove first says what goes — its prefix route, the routes that name it, its last 30 days — then takes them", async () => {
    const srv = fakeServer({ upstreams: [viewOf({ routes: [{ match: "glm-*", as: "first", enabled: true }, { match: "smart", as: "backup", enabled: true }] }), KIMI] });
    const { root, shown, toasts } = await open(srv);
    button(root(), "Remove this provider…").dispatch("click");
    await flush();
    const d = shown.at(-1);
    assert.equal(d.title, "Remove Z.ai?");
    assert.match(d.description, /^Your routes name it, so they are changed too/);
    assert.equal(textOf(d.body), "Its prefix route |zai/*|Your route |glm-*| goes: it sends to it first|Your route |smart| loses it as a backup|It answered 1,234 requests in the last 30 days ($4.50): a chat on one of its models is told when it next sends.");
    assert.deepEqual(d.actions.map((/** @type {any} */ a) => a.label), ["Cancel", "Remove it and those routes"]);
    d.actions[1].onClick();
    await flush();
    assert.deepEqual(srv.made("DELETE", "/upstreams/").map((c) => c.path), ["/upstreams/zai?also=1"]);
    assert.equal(toasts.at(-1)?.[0], "Z.ai removed, with 3 routes");
    assert.deepEqual(every(root(), "prov-row").map((r) => r.attrs["data-provider"]), ["kimi"], "back on the list");
  });

  test("a change refused as stale is said, and the page shows the provider as it now is", async () => {
    const srv = fakeServer();
    const { root, toasts } = await open(srv);
    srv.upstreams[0].name = "Z.ai (work)";
    srv.version = 11;
    srv.refuse = (p, m) => (m === "PATCH" ? apiError(409, { error: "stale", stale: true, changes: ["upstreams.zai.name"], version: 11 }) : undefined);
    named(root(), "Use Z.ai").dispatch("click");
    await flush();
    assert.deepEqual(toasts.at(-1), ["Z.ai changed elsewhere since this page read it: upstreams.zai.name. It now shows as it is: make your change again if you still want it.", "err"]);
    assert.equal(textOf(every(root(), "prov-name")[0]), "Z.ai (work)");
  });
});

describe("Add a provider", () => {
  const PROBE = {
    ok: true, status: 200, ms: 90, models: ["glm-5.3", "glm-5.3-fast", "glm-4.6", "embedding-3"],
    families: [familyOf("zai", "GLM 5.3", ["glm-5.3", "glm-5.3-fast"], { speed: { options: ["standard", "fast"] } }), familyOf("zai", "GLM 4.6", ["glm-4.6"])],
    other: ["embedding-3"],
  };
  const sheet = async (/** @type {ReturnType<typeof fakeServer>} */ srv, /** @type {{ yes?: boolean }} */ o = {}) => {
    const p = await pageOver(srv, o);
    button(p.root(), "Add a provider").dispatch("click");
    await flush();
    const d = p.shown.at(-1);
    return { ...p, d, tile: (/** @type {string} */ id) => all(d.body, id) };
  };
  const all = (/** @type {any} */ el, /** @type {string} */ id) => every(el, "prov-ptile").find((t) => t.attrs["data-tile"] === id);

  // HS-D14 (fails before: yes — the harness could not add a provider)
  test("which one, its plan, the key, a free prefix, the test with a tick per model; Add keeps the unticked ones out of the picker", async () => {
    const srv = fakeServer({ upstreams: [KIMI], probe: PROBE });
    const { d, toasts, timers, tick, root } = await sheet(srv);
    assert.equal(d.title, "Add a provider");
    assert.equal(d.description, AGENTS_LINE);
    assert.deepEqual(every(d.body, "prov-ptile").map((t) => t.attrs["data-tile"]), ["zai", "qoder-cloud", "custom"]);
    all(d.body, "zai").dispatch("click");
    assert.deepEqual(every(d.body, "prov-step-t").map(textOf), ["Which one", "Its plan", "The key", "Prefix", "Test"]);
    assert.equal(named(d.body, "Prefix").value, "zai");
    assert.equal(textOf(every(d.body, "prov-result")[0]), "Paste the key, and it is tested.");
    const key = named(d.body, "The key");
    key.value = "sk-zai-0123456789";
    key.oninput();
    assert.equal(timers.at(-1)?.ms, 600, "it is tested once typing stops");
    await tick();
    assert.equal(srv.made("POST", "/providers/probe").length, 1);
    assert.equal(srv.made("POST", "/providers/probe")[0].body.upstream.apiKey, "sk-zai-0123456789");
    assert.match(textOf(every(d.body, "prov-result-head")[0]), /^Answered · 4 models, shown as 2 in the picker\|2 of 2 ticked$/);
    const t = named(d.body, "In the picker: glm-4.6");
    t.checked = false;
    t.onchange();
    assert.equal(textOf(every(d.body, "prov-count")[0]), "1 of 2 ticked");
    assert.equal(textOf(every(d.body, "prov-add-says")[0]), ADD_FOOT);
    button(d.body, "Add Z.ai").dispatch("click");
    await flush();
    const add = srv.made("POST", "/upstreams")[0].body;
    assert.deepEqual(add, { provider: "zai", type: "openai-compatible", plan: "coding", fields: {}, baseUrl: "", apiKey: "sk-zai-0123456789", prefix: "zai", hiddenModels: ["glm-4.6", "embedding-3"] });
    assert.equal(d.closed, "forced");
    assert.equal(toasts.at(-1)?.[0], "Z.ai added: your chats ask for its models as zai/…, and the picker has them");
    assert.equal(srv.made("GET", "/upstreams/zai/test").length, 1, "tested at once, so the list's dot says how it answers");
    assert.equal(textOf(every(root(), "prov-name")[0]), "Z.ai", "its page is open");
  });

  // HC-30 (fails before: yes)
  test("a failed test is said, and Add still adds", async () => {
    const srv = fakeServer({ upstreams: [], probe: { ok: false, status: 401, ms: 40, error: "invalid key", models: [], families: [], other: [] } });
    const { d, tick } = await sheet(srv);
    all(d.body, "zai").dispatch("click");
    named(d.body, "The key").value = "sk-bad";
    named(d.body, "The key").oninput();
    await tick();
    assert.equal(textOf(every(d.body, "prov-result")[0]), "It answered 401: invalid key|Test again");
    const addBtn = button(d.body, "Add Z.ai");
    assert.equal("disabled" in addBtn.attrs, false);
    addBtn.dispatch("click");
    await flush();
    assert.deepEqual(srv.made("POST", "/upstreams")[0].body.hiddenModels, []);
  });

  // HC-33 (fails before: yes)
  test("a taken prefix says so as it is typed and holds Add back; one the server finds taken is swapped for its free one", async () => {
    const srv = fakeServer({ upstreams: [viewOf()], probe: PROBE });
    const { d } = await sheet(srv);
    all(d.body, "zai").dispatch("click");
    assert.equal(named(d.body, "Prefix").value, "zai-2", "zai is the id of the Z.ai already here");
    const pre = named(d.body, "Prefix");
    pre.value = "zai";
    pre.oninput();
    assert.equal(textOf(every(d.body, "prov-err")[0]), "zai is already the id of Z.ai: pick another prefix.");
    named(d.body, "The key").value = "sk-x";
    named(d.body, "The key").oninput();
    button(d.body, "Add Z.ai").dispatch("click");
    await flush();
    assert.equal(srv.made("POST", "/upstreams").length, 0);
    assert.match(textOf(every(d.body, "prov-add-says")[0]), /zai is already the id of Z\.ai/);
    pre.value = "glm";
    pre.oninput();
    srv.refuse = (p, m) => (p === "/upstreams" && m === "POST" ? apiError(409, { error: "glm is taken.", free: "glm-2" }) : undefined);
    button(d.body, "Add Z.ai").dispatch("click");
    await flush();
    assert.equal(textOf(every(d.body, "prov-add-says")[0]), "glm is taken. glm-2 is free: Add takes it.");
    assert.equal(named(d.body, "Prefix").value, "glm-2");
  });

  test("another address: the API it speaks, the address; the prefix follows its host until one is typed", async () => {
    const srv = fakeServer({ upstreams: [], probe: PROBE });
    const { d, tick } = await sheet(srv);
    all(d.body, "custom").dispatch("click");
    assert.deepEqual(every(d.body, "prov-step-t").map(textOf), ["Which one", "Its address", "The key", "Prefix", "Test"]);
    button(d.body, "Anthropic's API").dispatch("click");
    const url = named(d.body, "Its address");
    url.value = "http://localhost:11434/v1";
    url.oninput();
    assert.equal(named(d.body, "Prefix").value, "local");
    await tick();
    const probe = srv.made("POST", "/providers/probe")[0].body;
    assert.deepEqual([probe.upstream.type, probe.upstream.baseUrl, probe.provider], ["anthropic-compatible", "http://localhost:11434/v1", ""]);
    button(d.body, "Add it").dispatch("click");
    await flush();
    const add = srv.made("POST", "/upstreams")[0].body;
    assert.deepEqual([add.provider, add.type, add.baseUrl, add.prefix], ["", "anthropic-compatible", "http://localhost:11434/v1", "local"]);
  });

  test("typed work is asked about before the sheet goes", async () => {
    const srv = fakeServer({ upstreams: [] });
    const { d, asked } = await sheet(srv, { yes: false });
    d.close();
    assert.equal(d.closed, "asked", "nothing typed: it just closes");
    const again = await sheet(srv, { yes: false });
    all(again.d.body, "zai").dispatch("click");
    named(again.d.body, "The key").value = "sk-x";
    named(again.d.body, "The key").oninput();
    again.d.close();
    await flush();
    assert.equal(again.d.closed, null);
    assert.deepEqual(again.asked.map((q) => q.title), ["Discard this provider?"]);
    assert.equal(asked.length, 0);
  });

  // HC-47 (fails before: yes)
  test("Qoder: Add applies its template; its page signs in with the browser and waits for it, with no clock; Cancel stops", async () => {
    const srv = fakeServer({ upstreams: [] });
    const { d, root, toasts, opened, timers, tick } = await sheet(srv);
    all(d.body, "qoder-cloud").dispatch("click");
    assert.deepEqual(every(d.body, "prov-step-t").map(textOf), ["Which one", "Its account"]);
    button(d.body, "Add Qoder").dispatch("click");
    await flush();
    assert.equal(srv.made("POST", "/templates/qoder-cloud/apply").length, 1);
    assert.equal(toasts.at(-1)?.[0], "Qoder added: sign in on its page");
    const acct = crow(root(), "Account");
    assert.equal(textOf(acct), "Account|Not signed in: its models answer once you are|Sign in");
    button(acct, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(opened, ["https://qoder.example/device"]);
    assert.match(textOf(crow(root(), "Account")), /its code: ABCD-1234/);
    assert.equal(timers.at(-1)?.ms, 2000);
    await tick();
    assert.equal(srv.made("POST", "/qoder/qoder/login/poll").length, 1);
    assert.equal(timers.length, 1, "still waiting: asked again later");
    srv.qoderPolls.push({ status: "ok", email: "dev@example.com" });
    await tick();
    assert.equal(toasts.at(-1)?.[0], "Signed in to Qoder as dev@example.com");
    assert.match(textOf(crow(root(), "Account")), /^Account\|Signed in as dev@example\.com\|Sign out$/);
    button(crow(root(), "Account"), "Sign out").dispatch("click");
    await flush();
    assert.equal(srv.made("POST", "/qoder/qoder/logout").length, 1);
    button(crow(root(), "Account"), "Sign in").dispatch("click");
    await flush();
    button(crow(root(), "Account"), "Cancel").dispatch("click");
    const polls = srv.made("POST", "/qoder/qoder/login/poll").length;
    await tick();
    assert.equal(srv.made("POST", "/qoder/qoder/login/poll").length, polls, "Cancel stops the waiting");
  });
});
