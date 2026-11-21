// @ts-check
// The harness's Filament pages (HarnessV4_Settings_Plan HS-4): Connect other apps, Agent loop, Data and privacy, About,
// and Memory's engine and settings. Their settings are drawn from the schema and kept one field at a time
// (lib/config-rows.js) over `PATCH /api/config/fields`. DOM-free: the fake `h`, the real schema, and a scripted `api`
// that keeps a configuration and its version as Filament does.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { schemaAsJson } from "../src/core/schema.js";
import { defaultConfig } from "../src/config.js";
import { keyWords } from "../src/ui/lib/format.js";
import { walkGroup } from "../src/ui/harness/lib/config-rows.js";
import { reachWords, spanWords } from "../src/ui/lib/log-reach.js";
import { renderAgentLoop } from "../src/ui/harness/settings/agent-loop.js";
import { AGENT_LOOP_ELSEWHERE } from "../src/ui/lib/agent-loop-rows.js";
import { WORKSPACE_SEG } from "../src/ui/harness/conversation/start-board.js";
import { renderConnect, rotateWords, SETUPS } from "../src/ui/harness/settings/connect.js";
import { renderDataPrivacy } from "../src/ui/harness/settings/data-privacy.js";
import { renderAbout, restartWords, uptimeWords, checkedWords, UPDATES_DESC } from "../src/ui/harness/settings/about.js";
import { renderMemoryEngine } from "../src/ui/harness/settings/memory-engine.js";
import { renderExperimental, sideWords, NAME_DESC, PARALLEL_DESC, STEER_FORK_WORDS, MEMORY_OFF_WORDS, CURSOR_SDK_DESC, TEAMS_DESC } from "../src/ui/harness/settings/experimental.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { OTHER_ENGINE_WORDS, RESTART_WORDS, stallWords, uninstallWords } from "../src/ui/lib/engine.js";

const ORIGIN = "http://127.0.0.1:20400";
const KEYS = ["sk-filament-aaaa1111bbbb2222", "sk-filament-cccc3333dddd4444"];
const mask = (/** @type {string} */ k) => `${k.slice(0, 4)}…${k.slice(-4)}`;

/** @param {number} status @param {any} body */
const refusal = (status, body) => Object.assign(new Error(body.error || "refused"), { status, body });

/** @param {any} doc @param {string} path @param {any} v */
const putAt = (doc, path, v) => {
  const keys = path.split(".");
  let cur = doc;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  cur[keys[keys.length - 1]] = v;
};
/** @param {any} doc @param {string} path */
const getAt = (doc, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);

/**
 * A page over scripted routes, which keep a configuration as Filament does: a field write saves it and moves the
 * version on. `patch` answers a field write first when it returns or throws something.
 * @param {(body: HTMLElement, cb: any, io: any) => void} render
 * @param {{ schema?: (s: any) => void, cfg?: (c: any) => void, state?: Record<string, any>, patch?: (body: any) => any,
 *   keys?: () => string[], gets?: (path: string, init: any) => any, posts?: (path: string, body: any) => any, confirm?: boolean,
 *   failState?: boolean, app?: any }} [o]  `app`: the desktop app's bridge (`filamentApp`), where the page is the app's
 */
async function open(render, o = {}) {
  const schema = structuredClone(schemaAsJson());
  o.schema?.(schema);
  const cfg = /** @type {any} */ (defaultConfig());
  cfg.server.port = 20400;
  cfg.server.inboundKeysMasked = KEYS.map(mask);
  o.cfg?.(cfg);
  let version = 7;
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {string[]} */
  const copied = [];
  /** @type {any[]} */
  const asked = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    if (path === "/schema") return schema;
    if (path === "/state") {
      if (o.failState) throw refusal(500, { error: "boom" });
      return { version: "9.9.9", uptimeMs: 2 * 3_600_000 + 3 * 60_000, dataDir: "C:\\data\\filament", configFile: "C:\\data\\filament\\config.json", configVersion: version, listening: { host: "127.0.0.1", port: 20400 }, supervisor: null, logReach: null, config: structuredClone(cfg), ...(o.state || {}) };
    }
    if (path === "/config/fields") {
      const own = o.patch?.(init.body);
      if (own !== undefined) return own;
      const { set = {}, unset = [] } = init.body;
      const lines = [];
      for (const [p, v] of Object.entries(set)) { lines.push(`${p}: ${JSON.stringify(getAt(cfg, p))} → ${JSON.stringify(v)}`); putAt(cfg, p, v); }
      for (const p of unset) { const d = getAt(schema.config, p).default; lines.push(`${p}: → ${JSON.stringify(d)}`); putAt(cfg, p, structuredClone(d)); }
      version++;
      const paths = [...Object.keys(set), ...unset];
      return { ok: true, changes: lines, restartNeeded: paths.includes("server.port") && cfg.server.port !== 20400, values: Object.fromEntries(paths.map((p) => [p, getAt(cfg, p)])), version };
    }
    if (path === "/keys") return { keys: o.keys ? o.keys() : KEYS };
    const got = o.gets?.(path, init);
    if (got !== undefined) return got;
    if (path === "/memory/mcp") return { path: "/mcp/memory", keyed: true };
    if (method === "POST") {
      const r = o.posts?.(path, init.body);
      if (r !== undefined) return r;
      return { ok: true };
    }
    throw refusal(404, { error: `no route ${path}` });
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  /** @type {Set<(msg: any) => void>} */
  const listeners = new Set();
  const bus = (/** @type {(msg: any) => void} */ fn) => (listeners.add(fn), () => void listeners.delete(fn));
  /** Each model picker a page drew: what it was handed, and its callbacks. @type {any[]} */
  const picks = [];
  const modelSelect = (/** @type {any} */ pickCb) => {
    const pick = { cb: pickCb, value: "", models: /** @type {any[]} */ ([]), el: fakeH("button", {}, "chip"), set(/** @type {string} */ v) { pick.value = v; }, setModels(/** @type {any[]} */ ms) { pick.models = ms; }, setFamilies() {}, setNote() {}, setLocked() {} };
    picks.push(pick);
    return pick;
  };
  const io = {
    h: fakeH,
    api,
    origin: ORIGIN,
    bus,
    copy: async (/** @type {string} */ t) => void copied.push(t),
    confirm: async (/** @type {any} */ q) => (asked.push(q), o.confirm ?? true),
    now: () => Date.parse("2026-10-15T12:00:00Z"),
    app: o.app,
    modelSelect,
  };
  render(body, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => toasts.push([msg, kind]) }, io);
  await settle();
  const say = (/** @type {any} */ msg) => { for (const fn of [...listeners]) fn(msg); };
  return { body, calls, toasts, copied, asked, cfg, schema, say, picks, writes: () => calls.filter(([m, p]) => m === "PATCH" && p === "/config/fields").map((c) => c[2]), reads: () => calls.filter(([, p]) => p === "/state").length };
}
const settle = async () => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
};

/** Every node under `el` carrying a class. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** Every node under `el` with a tag. @param {any} el @param {string} tag @returns {any[]} */
const tags = (el, tag) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.tag === tag) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** The rows' labels, in order. @param {any} el */
const labels = (el) => all(el, "settings-row-label").map((n) => textOf(n));
/** A row by its label. @param {any} el @param {string} label */
const rowOf = (el, label) => {
  const r = all(el, "settings-row").find((n) => textOf(all(n, "settings-row-label")[0]) === label);
  assert.ok(r, `a row "${label}" in: ${labels(el).join(", ")}`);
  return r;
};
/** A button by its accessible name, or its text. @param {any} el @param {string} name */
const button = (el, name) => {
  const b = buttonsOf(el).find((x) => x.attrs["aria-label"] === name || textOf(x) === name);
  assert.ok(b, `a button "${name}"`);
  return b;
};
const ctrlEnter = { key: "Enter", ctrlKey: true, preventDefault() {} };

describe("Agent loop: drawn by hand", () => {
  /** The rows the page draws, in order (the owner's of 11-09: only what is set here, none as JSON). */
  const ROWS = ["Roots", "Reader model", "Result cap characters", "Tree snapshots", "Variables passed to commands", "Where they edit", keyWords("searchEndpoint"), keyWords("searchProvider"), keyWords("searchApiKey"), keyWords("allowPrivate"), "Go on after a restart", "Check in on an idle agent after (minutes)", "Filament as co-author on commits"];

  // (fails before: yes — every leaf of the group was drawn: Slots as a JSON area, Ask and Teams as boxes of lines, and
  // Enabled, Permissions, After approvals, Worktree and the sub-agents' Memory beside them; the owner's of 11-09)
  test("its own rows under their headings, nothing another place sets, no list as JSON or as lines", async () => {
    const p = await open(renderAgentLoop, { schema: (s) => { s.config.agentLoop.brandNew = { type: "boolean", default: false, description: "A setting a later version adds.", effect: "What it does." }; } });
    assert.deepEqual(labels(p.body), ROWS);
    assert.deepEqual(all(p.body, "nset-h").map((n) => textOf(n)), ["Where it works", "Its tools", "Its commands", "Sub-agents", "Web", "After a restart", "While a command runs", "Commits"]);
    assert.deepEqual(tags(p.body, "textarea"), [], "no area: no list as JSON, none as lines");
    assert.ok(!labels(p.body).includes("Brand new"), "a setting a later version adds waits for its row here");
    assert.equal(all(rowOf(p.body, "Tree snapshots"), "settings-row-text")[0].attrs.title, String(p.schema.config.agentLoop.treeSnapshots.effect).replace(/`/g, ""), "a row's effect on hover");
  });

  // (fails before: yes — the page drew every leaf of the group, so nothing named what it leaves to another place)
  test("every setting of the agent loop is drawn here or named as another place's, never both", async () => {
    const p = await open(renderAgentLoop);
    const drawn = all(p.body, "settings-row").map((n) => String(n.attrs["data-path"] || "")).filter((x) => x.startsWith("agentLoop.")).map((x) => x.slice("agentLoop.".length));
    const leaves = walkGroup(p.schema.config.agentLoop).map(([path]) => path);
    assert.deepEqual([...drawn, ...AGENT_LOOP_ELSEWHERE].sort(), [...leaves].sort());
    assert.ok(!leaves.includes("enabled"), "the loop has no off switch (the owner's of 11-09)");
    assert.ok(!leaves.includes("subagents.memory"), "nor has memory's brief for sub-agents");
  });

  // (fails before: yes — no field writes)
  test("a switch is kept at once, naming the field and the version read; the toast says it; the page is read again", async () => {
    const p = await open(renderAgentLoop);
    const before = p.reads();
    tags(rowOf(p.body, "Tree snapshots"), "button").find((b) => b.attrs.role === "switch").dispatch("click");
    await settle();
    assert.deepEqual(p.writes(), [{ set: { "agentLoop.treeSnapshots": false }, base: 7 }]);
    assert.deepEqual(p.toasts, [["Tree snapshots: off", undefined]]);
    assert.equal(p.reads(), before + 1);
    const row = rowOf(p.body, "Tree snapshots");
    assert.equal(textOf(all(row, "nset-from")[0]), "Set by you|Reset");
    button(row, "Reset").dispatch("click");
    await settle();
    assert.deepEqual(p.writes()[1], { unset: ["agentLoop.treeSnapshots"], base: 8 }, "the version the page read after the first write");
    assert.deepEqual(p.toasts[1], ["Tree snapshots: back to Filament's default (on)", undefined]);
    assert.equal(textOf(all(rowOf(p.body, "Tree snapshots"), "nset-from")[0]), "Filament's default");
  });

  // (fails before: yes — no field writes; HS-D3 for one field)
  test("a write refused as changed elsewhere says so and shows the page as it stands", async () => {
    const p = await open(renderAgentLoop, { patch: () => { throw refusal(409, { error: "This setting changed since the page read it: read it again", stale: true }); } });
    const before = p.reads();
    tags(rowOf(p.body, "Tree snapshots"), "button").find((b) => b.attrs.role === "switch").dispatch("click");
    await settle();
    assert.deepEqual(p.toasts, [["Not changed: it was changed elsewhere since this page read it, and shows that now", "err"]]);
    assert.equal(p.reads(), before + 1);
  });

  // (fails before: yes — no field writes)
  test("a number that is not one is refused on the page and put back", async () => {
    const p = await open(renderAgentLoop);
    const num = tags(rowOf(p.body, "Result cap characters"), "input")[0];
    num.value = "lots";
    num.onblur();
    await settle();
    assert.deepEqual(p.toasts, [["Result cap characters is a number", "err"]]);
    assert.equal(num.value, "0");
    assert.deepEqual(p.writes(), [], "nothing sent");
  });

  // (fails before: yes — Roots was a box of one path a line; the owner's of 11-09: a list as Permissions' folders are)
  test("Roots: each folder with its ×, a path added by Add or Enter, one listed already said and not sent", async () => {
    const p = await open(renderAgentLoop, { cfg: (c) => { c.agentLoop.roots = ["C:\\a"]; } });
    assert.deepEqual(all(rowOf(p.body, "Roots"), "nset-path").map((n) => textOf(n)), ["C:\\a"]);
    const input = () => tags(rowOf(p.body, "Roots"), "input")[0];
    input().value = " C:\\b ";
    button(rowOf(p.body, "Roots"), "Add").dispatch("click");
    await settle();
    assert.equal(input().value, "", "a path kept leaves the field empty, in the page drawn again after the write");
    input().value = "C:\\b";
    input().onkeydown({ key: "Enter", preventDefault() {} });
    await settle();
    button(rowOf(p.body, "Roots"), "Remove C:\\a").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "agentLoop.roots": ["C:\\a", "C:\\b"] }, { "agentLoop.roots": ["C:\\b"] }]);
    assert.deepEqual(p.toasts.map((t) => t[0]), ["Roots: C:\\a, C:\\b", "C:\\b is listed already", "Roots: C:\\b"]);
    assert.deepEqual(all(rowOf(p.body, "Roots"), "nset-path").map((n) => textOf(n)), ["C:\\b"]);
    assert.equal(input().value, "", "a path kept leaves the field empty");
  });

  // (fails before: yes — no such row: r-hands of 11-12, the variables a command is given beside what a build needs)
  test("Variables passed to commands: each name with its ×, a name added by Add or Enter, one listed already said and not sent", async () => {
    const p = await open(renderAgentLoop, { cfg: (c) => { c.agentLoop.envPass = ["HTTPS_PROXY"]; } });
    const row = () => rowOf(p.body, "Variables passed to commands");
    assert.deepEqual(all(row(), "nset-path").map((n) => textOf(n)), ["HTTPS_PROXY"]);
    const input = () => tags(row(), "input")[0];
    input().value = " MY_LICENCE ";
    button(row(), "Add").dispatch("click");
    await settle();
    assert.equal(input().value, "", "a name kept leaves the field empty");
    input().value = "MY_LICENCE";
    input().onkeydown({ key: "Enter", preventDefault() {} });
    await settle();
    button(row(), "Remove HTTPS_PROXY").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "agentLoop.envPass": ["HTTPS_PROXY", "MY_LICENCE"] }, { "agentLoop.envPass": ["MY_LICENCE"] }]);
    assert.deepEqual(p.toasts.map((t) => t[0]), ["Variables passed to commands: HTTPS_PROXY, MY_LICENCE", "MY_LICENCE is listed already", "Variables passed to commands: MY_LICENCE"]);
    assert.deepEqual(all(row(), "nset-path").map((n) => textOf(n)), ["MY_LICENCE"]);
  });

  // (fails before: yes — no such row)
  test("Variables passed to commands: none says what is passed then; a name Filament refuses is said in its words and stays to be put right", async () => {
    const words = `the change would leave an invalid configuration: agentLoop.envPass[0] "FILAMENT_HOME" is one of Filament's own variables, which no command is given`;
    const p = await open(renderAgentLoop, { patch: () => { throw refusal(400, { error: words }); } });
    const row = () => rowOf(p.body, "Variables passed to commands");
    assert.equal(textOf(all(row(), "nset-none")[0]), "None: only what Filament passes by itself.");
    assert.equal(tags(row(), "input")[0].attrs.placeholder, "A variable's name: HTTPS_PROXY");
    tags(row(), "input")[0].value = "FILAMENT_HOME";
    button(row(), "Add").dispatch("click");
    await settle();
    assert.deepEqual(p.toasts, [[`Not changed: ${words}`, "err"]]);
    assert.equal(tags(row(), "input")[0].value, "FILAMENT_HOME", "in the page drawn again after the refusal");
    assert.deepEqual(all(row(), "nset-path"), []);
  });

  // (fails before: yes — Reader model was a field of free text for a route's name; the owner's of 11-09)
  test("Reader model: Settings' model picker, the coding agents' models left out; a pick is kept, Use the default puts none back", async () => {
    const p = await open(renderAgentLoop, { cfg: (c) => { c.agentLoop.readerModel = "m-cheap"; }, gets: (path) => (path === "/models?all=1" ? { models: [{ id: "m-cheap" }, { id: "claude-code", codingAgent: true }], families: [] } : undefined) });
    const pick = p.picks.at(-1);
    assert.equal(pick.value, "m-cheap");
    assert.deepEqual(pick.models.map((/** @type {any} */ x) => x.id), ["m-cheap"]);
    pick.cb.onChange("m-other");
    await settle();
    p.picks.at(-1).cb.onUseDefault();
    await settle();
    assert.deepEqual(p.writes().map(({ set, unset }) => ({ set, unset })), [{ set: { "agentLoop.readerModel": "m-other" }, unset: undefined }, { set: undefined, unset: ["agentLoop.readerModel"] }]);
    assert.deepEqual(p.toasts.map((t) => t[0]), ["Reader model: m-other", "Reader model: none, the agent reads for itself"]);
  });

  // (fails before: yes — Workspace was a menu of auto, patch, worktree and folder; the owner's of 11-09: as the New chat
  // board's Where they edit)
  test("Where they edit: the New chat board's four, the one in force said under its name", async () => {
    const p = await open(renderAgentLoop);
    const row = rowOf(p.body, "Where they edit");
    assert.deepEqual(tags(row, "button").filter((b) => b.attrs.role === "tab").map((b) => textOf(b)), WORKSPACE_SEG.map(([, label]) => label));
    assert.ok(textOf(all(row, "settings-row-desc")[0]).endsWith(`${WORKSPACE_SEG[0][2]}.`));
    button(row, "Session folder").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "agentLoop.subagents.workspace": "folder" }]);
    assert.deepEqual(p.toasts, [["Where they edit: Session folder", undefined]]);
    assert.ok(textOf(all(rowOf(p.body, "Where they edit"), "settings-row-desc")[0]).endsWith(`${WORKSPACE_SEG[3][2]}.`));
  });

  // (fails before: yes — no field writes; on Data and privacy's alerts, the one group a page still draws from the schema
  // since Agent loop and the log's rows are drawn by hand, the owner's of 11-09)
  test("a page drawn from the schema: JSON that does not parse is refused and put back, a menu keeps its choice", async () => {
    const p = await open(renderDataPrivacy, { schema: (s) => {
      s.config.alerts.brandList = { type: "list", default: [], description: "A list of objects a later version adds." };
      s.config.alerts.brandMenu = { type: "string", default: "one", options: ["one", "two", "three", "four", "five"], description: "A menu a later version adds." };
    } });
    const area = tags(rowOf(p.body, "Brand list"), "textarea")[0];
    const was = area.value;
    area.value = "[{";
    area.onkeydown(ctrlEnter);
    await settle();
    assert.match(p.toasts[0][0], /^Brand list is JSON: /);
    assert.equal(p.toasts[0][1], "err");
    assert.equal(area.value, was);
    assert.deepEqual(p.writes(), [], "nothing sent");
    tags(rowOf(p.body, "Brand menu"), "select")[0].dispatch("change", { target: { value: "five" } });
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "alerts.brandMenu": "five" }]);
    assert.deepEqual(p.toasts.at(-1), ["Brand menu: five", undefined]);
  });

  // (fails before: yes — the page drawn again after Enter's save took the field away, its blur sent the value again from
  // the old read, and the refusal said "changed elsewhere"; found by HS-4's drive)
  test("Enter keeps a field once: the blur that follows while it is on its way sends nothing", async () => {
    const p = await open(renderConnect);
    const port = tags(rowOf(p.body, "Port"), "input")[0];
    port.value = "5000";
    port.onkeydown({ key: "Enter", preventDefault() {} });
    port.onblur();
    await settle();
    assert.deepEqual(p.writes(), [{ set: { "server.port": 5000 }, base: 7 }]);
    assert.deepEqual(p.toasts, [["Port: 5000 — Filament listens there after a restart", undefined]]);
    const area = tags(rowOf(p.body, "Allowed hosts"), "textarea")[0];
    area.value = "a.test";
    area.onkeydown(ctrlEnter);
    area.onblur();
    await settle();
    assert.equal(p.writes().length, 2, "the area too");
  });

  // (fails before: yes — no such page)
  test("settings that could not be read say why", async () => {
    const p = await open(renderAgentLoop, { failState: true });
    assert.equal(textOf(all(p.body, "set-error")[0]), "Filament's settings could not be read: boom");
  });
});

describe("Connect other apps", () => {
  // (fails before: yes — no such page)
  test("both addresses, and a block for each app that names the key and never holds it; Copy takes what is shown", async () => {
    const p = await open(renderConnect);
    assert.equal(textOf(all(rowOf(p.body, "Address"), "cset-code")[0]), ORIGIN);
    assert.equal(textOf(all(rowOf(p.body, "Address with /v1"), "cset-code")[0]), `${ORIGIN}/v1`);
    assert.match(textOf(rowOf(p.body, "Address with /v1")), /Codex/, "Codex adds /responses to the address with /v1, as its block says");
    for (const s of SETUPS) {
      button(all(p.body, "cset-setup")[0], s.label).dispatch("click");
      const block = textOf(all(p.body, "cset-pre")[0]);
      for (const k of KEYS) assert.ok(!block.includes(k), `${s.label}: no key in the block`);
      assert.ok(block.includes("<your inbound key>") || block.includes('env_key = "FILAMENT_KEY"'), `${s.label} names the key: ${block}`);
      assert.ok(block.includes(ORIGIN), block);
      button(all(p.body, "cset-setup")[0], "Copy the block").dispatch("click");
      await settle();
      assert.equal(p.copied.at(-1), block);
    }
    assert.match(textOf(all(p.body, "cset-pre")[0]), /base_url="http:\/\/127\.0\.0\.1:20400\/v1"/, "the SDK's OpenAI client at /v1");
    assert.ok(!textOf(p.body).includes(KEYS[0]) && !textOf(p.body).includes(KEYS[1]), "no key anywhere on the page");
  });

  // (fails before: yes — no such page; HC-63)
  test("a key's Copy puts it on the clipboard and nowhere else; keys changed since are shown again, not copied", async () => {
    const p = await open(renderConnect);
    assert.deepEqual(labels(p.body).filter((l) => /key/i.test(l)).slice(0, 2), ["Newest key", "Key 2"]);
    button(rowOf(p.body, "Key 2"), "Copy").dispatch("click");
    await settle();
    assert.deepEqual(p.copied, [KEYS[1]]);
    assert.deepEqual(p.toasts, [["Key copied: paste it where the app asks for an API key", undefined]]);
    assert.ok(!textOf(p.body).includes(KEYS[1]), "the key is not drawn");

    const q = await open(renderConnect, { keys: () => ["sk-filament-eeee5555ffff6666", KEYS[0]] });
    const before = q.reads();
    button(rowOf(q.body, "Newest key"), "Copy").dispatch("click");
    await settle();
    assert.deepEqual(q.copied, []);
    assert.deepEqual(q.toasts, [["The keys changed since the page read them: here they are as they stand", "err"]]);
    assert.equal(q.reads(), before + 1);
  });

  // (fails before: yes — no such words; HC-64)
  test("a new key says which keys keep working", async () => {
    assert.equal(rotateWords(0), "A new key is first in the list.");
    assert.equal(rotateWords(1), "A new key is first in the list. The one before it keeps working.");
    assert.equal(rotateWords(3), "A new key is first in the list. The 3 before it keep working.");
    assert.equal(rotateWords(5), "A new key is first in the list. The 4 before it keep working. The oldest stopped working.");
    const p = await open(renderConnect);
    button(p.body, "Make a new key").dispatch("click");
    await settle();
    assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/keys/rotate"));
    assert.deepEqual(p.toasts, [[rotateWords(2), undefined]]);
  });

  // (fails before: yes — no such page; HC-67)
  test("a port saved away from where Filament listens is said, and its toast says it waits for a restart", async () => {
    const p = await open(renderConnect);
    assert.equal(all(p.body, "is-warn").length, 0, "nothing waits");
    const port = tags(rowOf(p.body, "Port"), "input")[0];
    port.value = "5000";
    port.onkeydown({ key: "Enter", preventDefault() {} });
    await settle();
    assert.deepEqual(p.writes(), [{ set: { "server.port": 5000 }, base: 7 }]);
    assert.deepEqual(p.toasts, [["Port: 5000 — Filament listens there after a restart", undefined]]);
    assert.equal(textOf(all(p.body, "is-warn")[0]), "Saved: 127.0.0.1:5000. Filament listens at 127.0.0.1:20400 until it restarts (About › Restart Filament).");
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, DESK-9's siblings: the note wrote `:::20400` and
  // `::1:20400`, addresses nobody reads as one)
  test("an IPv6 host saved away from where Filament listens is written in brackets, as an address writes it", async () => {
    const p = await open(renderConnect, { cfg: (c) => void (c.server.host = "::"), state: { listening: { host: "::1", port: 20400 } } });
    assert.deepEqual(all(p.body, "is-warn").map((n) => textOf(n)), ["Saved: [::]:20400. Filament listens at [::1]:20400 until it restarts (About › Restart Filament)."]);
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, the roots' decision: nothing in Settings said that
  // Filament listened beyond this machine with no folder in agentLoop.roots)
  test("a listener open beyond this machine with no roots listed is said in the server's words: under Listens on, and over Agent loop's rows", async () => {
    const words = "Filament listens on 0.0.0.0, beyond this machine, and agentLoop.roots lists no folder: the server's words.";
    const c = await open(renderConnect, { state: { exposed: words } });
    const notes = all(c.body, "nset-note").map((n) => textOf(n));
    assert.deepEqual(all(c.body, "is-warn").map((n) => textOf(n)), [words]);
    assert.ok(notes.indexOf(words) > -1, notes.join(" | "));
    const rows = all(c.body, "nset").flatMap((n) => n.kids || []);
    const at = rows.findIndex((n) => textOf(n) === words);
    assert.equal(textOf(all(rows[at - 1], "settings-row-label")[0]), "Listens on", "right under the field that opens it");
    const loop = await open(renderAgentLoop, { state: { exposed: words } });
    const first = all(loop.body, "nset").flatMap((n) => n.kids || [])[0];
    assert.equal(textOf(first), words, "over the rows, Roots among them");
    assert.equal(all((await open(renderAgentLoop)).body, "is-warn").length, 0, "nothing to say: nothing said");
  });

  // (fails before: yes — the owner's of 11-09: Listens on was a field of free text, and Advanced had the largest request)
  test("Listens on is this computer only or every network address; one the configuration holds besides is shown and kept until one is picked", async () => {
    const p = await open(renderConnect);
    const row = rowOf(p.body, "Listens on");
    assert.equal(row.attrs["data-path"], "server.host", "the setting's own row: found by its path, reset as any other");
    const picks = () => buttonsOf(rowOf(p.body, "Listens on")).filter((b) => b.attrs.role === "tab").map((b) => [textOf(b), b.attrs.title, b.attrs["aria-selected"]]);
    assert.deepEqual(picks(), [["This computer only", "127.0.0.1", "true"], ["Every network address", "0.0.0.0", "false"]]);
    assert.equal(tags(row, "input").length, 0, "no field of text");
    assert.match(textOf(all(row, "settings-row-desc")[0]), /Takes effect after a restart\. For a phone or another computer, Settings › Remote access pairs it with a code\.$/);
    button(row, "This computer only").dispatch("click");
    await settle();
    assert.deepEqual(p.writes(), [], "the one it is writes nothing");
    button(rowOf(p.body, "Listens on"), "Every network address").dispatch("click");
    await settle();
    assert.deepEqual(p.writes(), [{ set: { "server.host": "0.0.0.0" }, base: 7 }]);
    assert.deepEqual(picks().map((x) => x[2]), ["false", "true"]);
    assert.equal(textOf(all(p.body, "is-warn")[0]), "Saved: 0.0.0.0:20400. Filament listens at 127.0.0.1:20400 until it restarts (About › Restart Filament).");
    assert.ok(!labels(p.body).includes("Max body bytes") && !textOf(p.body).includes("Largest accepted request body"), "the largest request is the console's");

    const q = await open(renderConnect, { cfg: (c) => void (c.server.host = "192.168.1.5"), state: { listening: { host: "192.168.1.5", port: 20400 } } });
    const other = rowOf(q.body, "Listens on");
    assert.deepEqual(buttonsOf(other).filter((b) => b.attrs.role === "tab").map((b) => b.attrs["aria-selected"]), ["false", "false"], "neither is picked");
    assert.match(textOf(all(other, "settings-row-desc")[0]), /^Now 192\.168\.1\.5, as Filament's configuration says: it stays until you pick one\. /);
    assert.equal(textOf(all(other, "nset-from")[0]), "Set by you|Reset");
    assert.deepEqual(q.writes(), [], "drawn, never written over");
    button(other, "This computer only").dispatch("click");
    await settle();
    assert.deepEqual(q.writes(), [{ set: { "server.host": "127.0.0.1" }, base: 7 }]);
  });

  // (fails before: yes — memory's door was on Memory's page only; since the owner's of 11-09 it is here alone, and
  // Settings › Memory links here)
  test("memory's door for other agents is here: the command at this address, the key named and never shown; Copy puts it on the clipboard; with no key set, no header and this machine only", async () => {
    const URL_ = `${ORIGIN}/mcp/memory`;
    const COMMAND = `claude mcp add --scope user --transport http filament-memory ${URL_} --header "Authorization: Bearer <your inbound key>"`;
    const p = await open(renderConnect);
    const row = rowOf(p.body, "Other agents");
    assert.equal(textOf(all(row, "mset-mcp-cmd")[0]), COMMAND);
    assert.match(textOf(all(row, "settings-row-desc")[0]), /one of your inbound keys; it is not shown here\.$/);
    assert.equal(textOf(all(row, "mset-quiet")[0]), `Another client: ${URL_}, over Streamable HTTP, with the header Authorization: Bearer <your inbound key>.`);
    button(row, "Copy the command").dispatch("click");
    await settle();
    assert.deepEqual(p.copied, [COMMAND]);
    assert.deepEqual(p.toasts.at(-1), ["Copied: run it in a terminal, then fill in your key", undefined]);
    const open_ = await open(renderConnect, { gets: (path) => (path === "/memory/mcp" ? { path: "/mcp/memory", keyed: false } : undefined) });
    const door = rowOf(open_.body, "Other agents");
    assert.equal(textOf(all(door, "mset-mcp-cmd")[0]), `claude mcp add --scope user --transport http filament-memory ${URL_}`);
    assert.equal(textOf(all(door, "mset-quiet")[0]), `Another client: ${URL_}, over Streamable HTTP.`);
    assert.match(textOf(all(door, "settings-row-desc")[0]), /No inbound key is set, so only programs on this machine reach it\.$/);
  });
});

describe("Data and privacy", () => {
  // (fails before: yes — the reach said nothing of how fast whole bodies roll the log; HC-69)
  test("the log's reach, and with whole bodies kept how long the space holds at this pace", () => {
    const when = (/** @type {any} */ at) => String(at).slice(0, 10);
    const now = Date.parse("2026-10-15T00:00:00Z");
    const reach = { since: "2026-10-13T00:00:00Z", files: 3, bytes: 25 * 1048576, maxBytes: 100 * 1048576 };
    assert.equal(reachWords(null, "full", when, now), null);
    assert.deepEqual(reachWords({ ...reach, since: null }, "summary", when, now), { text: "The request log has no records yet.", heavy: false });
    assert.deepEqual(reachWords(reach, "summary", when, now), { text: "The request log reaches back to 2026-10-13: 3 files, 25 MB of at most 100 MB.", heavy: false });
    assert.deepEqual(reachWords(reach, "full", when, now), { text: "The request log reaches back to 2026-10-13: 3 files, 25 MB of at most 100 MB. Each request keeps its whole body (full), so the oldest records roll off fast: at this pace the log holds about 8 days. Summary keeps far more in the same space.", heavy: true });
    assert.match(reachWords({ ...reach, bytes: 99 * 1048576 }, "shaped", when, now)?.text || "", /holds about 2 days\./, "a full log holds what it holds now");
    assert.match(reachWords({ ...reach, bytes: 40_000 }, "summary", when, now)?.text || "", /3 files, 39 KB of at most 100 MB\./, "under a megabyte in KB, not 0.0 MB");
    assert.deepEqual([spanWords(30 * 60_000), spanWords(3_600_000), spanWords(30 * 3_600_000), spanWords(36 * 3_600_000)], ["under an hour", "about 1 hour", "about 30 hours", "about 2 days"]);
  });

  // (fails before: yes — no such page)
  test("the page warns with the reach when whole bodies are kept, and copies where Filament keeps its data", async () => {
    const p = await open(renderDataPrivacy, { cfg: (c) => { c.observability.storeBodies = "full"; }, state: { logReach: { since: "2026-10-14T12:00:00Z", files: 1, bytes: 1048576, maxBytes: 10 * 1048576 } } });
    const warn = all(p.body, "is-warn");
    assert.equal(warn.length, 1);
    assert.match(textOf(warn[0]), /Each request keeps its whole body \(full\).*holds about 10 days\./);
    button(rowOf(p.body, "Configuration file"), "Copy the file's path").dispatch("click");
    await settle();
    assert.deepEqual(p.copied, ["C:\\data\\filament\\config.json"]);
    button(rowOf(p.body, "Your conversations in the log"), "summary").dispatch("click");
    const days = tags(rowOf(p.body, "Keep runs for"), "input")[0];
    days.value = "30";
    days.onkeydown({ key: "Enter", preventDefault() {} });
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [
      { "observability.storeBodies": "summary" },
      { "observability.runEvents.retentionDays": 30 },
    ]);
  });

  // (fails before: yes — the owner's of 11-09: every observability setting was a row named by its key, "Seal secrets on
  // disk" offered to write the keys in plain text, and the day's spend did not say it stops nothing)
  test("the rows a person decides: how much of the conversations the log keeps, how long runs and pictures stay, where it is, the alerts", async () => {
    const p = await open(renderDataPrivacy);
    assert.deepEqual(labels(p.body), [
      "Your conversations in the log", "Filament's own calls in the log",
      "Keep runs for", "Room for pictures",
      "Data folder", "Configuration file",
      "Failover", "Degraded", "A day's spend",
      "Anonymous usage statistics", "What's sent",
    ]);
    assert.deepEqual(all(p.body, "nset-h").map((n) => textOf(n)), ["How much of your conversations the log keeps", "Runs and their pictures", "Where Filament keeps it", "Alerts", "Anonymous usage statistics"]);
    // Each kept row is the setting's own, read and reset as any other.
    assert.deepEqual(all(p.body, "nset-row").map((n) => n.attrs["data-path"]).filter(Boolean), [
      "observability.storeBodies", "observability.storeInternalBodies", "observability.runEvents.retentionDays", "observability.runEvents.imagesMaxMB",
      "alerts.failover", "alerts.degraded", "alerts.dailyCostUsd", "telemetry.enabled",
    ]);
    // Anonymous usage statistics (the owner's of 11-10): what it sends and never sends, said under its switch.
    assert.match(textOf(all(rowOf(p.body, "Anonymous usage statistics"), "settings-row-desc")[0]), /Never a prompt, a reply, code, a path, a name, a key or an account\./);
    assert.match(textOf(all(rowOf(p.body, "A day's spend"), "settings-row-desc")[0]), /It only tells you: no agent or request is stopped or slowed by it\./);
    const text = textOf(p.body);
    for (const gone of ["encryptSecrets", "Seal secrets", "Keep last requests", "Max stored body bytes", "Token calibration", "Persist", "Broadcast", "Kinds"]) assert.ok(!text.includes(gone), gone);
  });
});

describe("Experimental", () => {
  // (fails before: yes — no such page: the owner's of 11-05)
  test("naming chats with memory's model: off until turned on, kept at once; the model it names with, and where it is set", async () => {
    const p = await open(renderExperimental, { gets: (path) => (path === "/memory/models" ? { models: { summarizer: "", effort: "", curatorUsesModel: true, now: "mock-1", from: "default", whyNone: null } } : undefined) });
    // Your defaults not read here: no Weigh your messages aside, and no heading over nothing.
    assert.deepEqual(labels(p.body), ["Name chats with memory's model", "Memory's model", "Parallelize tasks", "Cursor through its SDK", "Teams", "Use memory"]);
    assert.deepEqual(all(p.body, "nset-h").map((n) => textOf(n)), ["Chats", "Planning", "Coding agents", "Teams", "Memory"]);
    const name = rowOf(p.body, "Name chats with memory's model");
    assert.equal(textOf(all(name, "settings-row-desc")[0]), NAME_DESC);
    assert.equal(textOf(all(name, "nset-from")[0]), "Filament's default", "off by Filament's default");
    assert.match(all(name, "settings-row-text")[0].attrs.title, /Only a chat Filament named from its first message is renamed/, "its schema's words on hover");
    const side = rowOf(p.body, "Memory's model");
    assert.equal(textOf(all(side, "settings-row-desc")[0]), "Not set: each chat is named by its compaction model, else its own model.");
    assert.equal(tags(side, "a")[0].attrs.href, "#/settings/memory");
    button(name, "Name chats with memory's model").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "experimental.nameChats": true }]);
    assert.equal(textOf(all(rowOf(p.body, "Name chats with memory's model"), "nset-from")[0]), "Set by you|Reset", "on now, the person's own");
  });

  // (fails before: yes — the owner's of 11-06: Parallelize tasks stood in every chat's message box)
  test("Parallelize tasks: off until turned on, kept at once, its words under it and its schema's on hover", async () => {
    const p = await open(renderExperimental, { gets: () => undefined });
    const row = rowOf(p.body, "Parallelize tasks");
    assert.equal(textOf(all(row, "settings-row-desc")[0]), PARALLEL_DESC);
    assert.equal(textOf(all(row, "nset-from")[0]), "Filament's default", "off by Filament's default");
    assert.match(all(row, "settings-row-text")[0].attrs.title, /^On, in every chat, it is your consent: .* Off, it asks you on a card first: where tasks can run at once your agent suggests them on one, and a sub-agent that changes files it launches is held on one; they start on your Accept, or after 60 seconds /);
    button(row, "Parallelize tasks").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "experimental.parallelizeTasks": true }]);
  });

  // (fails before: yes — the owner's of 11-10: Cursor's SDK stood beside its CLI in Settings › Coding agents, no switch)
  test("Cursor through its SDK: off until turned on, kept at once, its words under it and its schema's on hover", async () => {
    const p = await open(renderExperimental, { gets: () => undefined });
    const row = rowOf(p.body, "Cursor through its SDK");
    assert.equal(textOf(all(row, "settings-row-desc")[0]), CURSOR_SDK_DESC);
    // What its agent's tools are, as its schema says it: under Auto too its shell and file tools are off.
    const TOOLS = "Its agent approves its own tools, so its shell and file tools are off and Filament's checked ones do that work; a chat stricter than Auto also runs without its sub-agents and your MCP servers.";
    assert.ok(CURSOR_SDK_DESC.includes(TOOLS) && all(row, "settings-row-text")[0].attrs.title.includes(TOOLS), "the same sentence under the switch and on hover");
    assert.equal(textOf(all(row, "nset-from")[0]), "Filament's default", "off by Filament's default");
    assert.match(all(row, "settings-row-text")[0].attrs.title, /^On: Settings › Coding agents offers Cursor a second way beside Cursor, its CLI/);
    button(row, "Cursor through its SDK").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "experimental.cursorSdk": true }]);
  });

  // (fails before: yes — the owner's of 11-17: teams stood in every chat and the Library, untested and unfinished)
  test("Teams: off until turned on, kept at once, its words under it and its schema's on hover", async () => {
    const p = await open(renderExperimental, { gets: () => undefined });
    const row = rowOf(p.body, "Teams");
    assert.equal(textOf(all(row, "settings-row-desc")[0]), TEAMS_DESC);
    assert.match(TEAMS_DESC, /Off: none starts and nothing offers one, and a chat you put a team in charge of is answered by your agent until this is on again. A team already at work finishes/);
    assert.equal(textOf(all(row, "nset-from")[0]), "Filament's default", "off by Filament's default");
    assert.equal(button(row, "Teams").attrs["aria-checked"], "false");
    assert.match(all(row, "settings-row-text")[0].attrs.title, /^On: /);
    button(row, "Teams").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "experimental.teams": true }]);
  });

  // (fails before: yes — the owner's of 11-09: it was Settings › New chats › Instructions' row)
  test("Weigh your messages aside: moved here from Instructions with its words, your default for new chats, off until turned on", async () => {
    let fork = false;
    /** Your defaults as `/defaults/settings` answers them, the switch's write kept. @param {any} init */
    const defaults = (init) => {
      if (init.method === "PATCH") fork = init.body.patch.loop.steerFork;
      return { layer: {}, flat: { "loop.steerFork": fork }, sources: { "loop.steerFork": fork ? "yours" : "default" }, ...(init.method === "PATCH" ? { changes: [{ path: "loop.steerFork" }] } : {}) };
    };
    const p = await open(renderExperimental, { gets: (path, init) => (path === "/defaults/settings" ? defaults(init) : undefined) });
    assert.deepEqual(labels(p.body), ["Name chats with memory's model", "Memory's model", "Parallelize tasks", "Weigh your messages aside", "Cursor through its SDK", "Teams", "Use memory"]);
    assert.deepEqual(all(p.body, "nset-h").map((n) => textOf(n)), ["Chats", "Planning", "While your agent works", "Coding agents", "Teams", "Memory"]);
    const row = rowOf(p.body, "Weigh your messages aside");
    assert.equal(textOf(all(row, "settings-row-desc")[0]), STEER_FORK_WORDS);
    assert.match(STEER_FORK_WORDS, /^On: a message you send while Filament's own agent works goes first to a fork of its conversation/);
    assert.equal(textOf(all(row, "nset-from")[0]), "Filament's default");
    button(row, "Weigh your messages aside").dispatch("click");
    await settle();
    assert.deepEqual(p.calls.filter(([m, path]) => m === "PATCH" && path === "/defaults/settings").map((c) => c[2]), [{ patch: { loop: { steerFork: true } } }]);
    assert.match(p.toasts.at(-1)?.[0] || "", /^Your default changed: Weighs your messages aside — every chat that has not chosen its own/);
    assert.equal(button(rowOf(p.body, "Weigh your messages aside"), "Weigh your messages aside").attrs["aria-checked"], "true");
  });

  // (fails before: yes — the owner's of 11-08 and 11-09: memory is core, on by default, its one off switch here and
  // nowhere else — Settings › Memory and the welcome tour each had one)
  test("Use memory: memory's one off switch, for every chat and app, through its own route; what off means said plainly", async () => {
    /** @type {any[]} */
    const posted = [];
    const p = await open(renderExperimental, { posts: (path, body) => (path === "/memory/enabled" ? (posted.push(body), { ok: true, enabled: body.enabled }) : undefined) });
    const row = rowOf(p.body, "Use memory");
    assert.equal(textOf(all(row, "settings-row-desc")[0]), MEMORY_OFF_WORDS);
    assert.match(MEMORY_OFF_WORDS, /^On, Filament's default\. Off, for every chat and every app that uses Filament: nothing is recalled into a chat, nothing is learned from one/);
    assert.equal(button(row, "Use memory").attrs["aria-checked"], "true", "on by default");
    const reads = p.reads();
    button(row, "Use memory").dispatch("click");
    await settle();
    assert.deepEqual(posted, [{ enabled: false }], "through POST /api/memory/enabled, not a field write");
    assert.deepEqual(p.writes(), []);
    assert.deepEqual(p.toasts.at(-1), ["Memory is off for every chat and app", undefined]);
    assert.ok(p.reads() > reads, "the page read again");
    const off = await open(renderExperimental, { cfg: (c) => { c.memory.enabled = false; } });
    assert.equal(button(rowOf(off.body, "Use memory"), "Use memory").attrs["aria-checked"], "false");
  });

  // (fails before: yes — the memory plan's m1: not set, the line said "the cheapest one that has a price is chosen")
  test("memory's model in a line: the one set, off, or each chat's own", () => {
    assert.deepEqual([
      sideWords(null),
      sideWords({ summarizer: "haiku", now: "haiku", from: "memory" }),
      sideWords({ summarizer: "off", now: null, from: "off" }),
      sideWords({ summarizer: "", now: "glm", from: "default" }),
      sideWords({ summarizer: "auto", now: null, from: "none" }),
    ], [
      "",
      "haiku",
      "None: memory's model is off, so no chat is renamed. Pick one in Settings › Memory.",
      "Not set: each chat is named by its compaction model, else its own model.",
      "Not set: each chat is named by its compaction model, else its own model.",
    ]);
  });
});

describe("About", () => {
  // (fails before: yes — no such page)
  test("which Filament this is, how long it has run, and Records in the console", async () => {
    assert.deepEqual([uptimeWords(10_000), uptimeWords(5 * 60_000), uptimeWords(123 * 60_000), uptimeWords(25 * 3_600_000)], ["under a minute", "5 min", "2 h 3 min", "1 d 1 h"]);
    const p = await open(renderAbout);
    assert.equal(textOf(all(rowOf(p.body, "Version"), "cset-code")[0]), "9.9.9");
    assert.equal(textOf(all(rowOf(p.body, "Running for"), "cset-plain")[0]), "2 h 3 min");
    assert.equal(tags(rowOf(p.body, "Records"), "a")[0].attrs.href, "/ui/#requests");
    // (fails before: yes — the owner's of 11-09: the data folder was Data and privacy's and About's both, and the
    // terminal log's level, which the console's Settings › Server has, stood here)
    assert.deepEqual(labels(p.body), ["Version", "Running for", "Stop Filament", "Open the console", "Records"]);
  });

  // (fails before: yes — HarnessV3-Native NA2: started by the desktop app, the page said nothing starts Filament again and
  // asked before a stop)
  test("started by the Filament app, it restarts at once, and says the app starts it again", async () => {
    assert.match(restartWords("desktop").desc, /^Filament stops and the Filament app starts it again/);
    const t = await open(renderAbout, { state: { supervisor: "desktop" } });
    assert.equal(textOf(all(rowOf(t.body, "Restart Filament"), "settings-row-desc")[0]), restartWords("desktop").desc);
    button(t.body, "Restart Filament").dispatch("click");
    await settle();
    assert.deepEqual([t.asked.length, t.calls.filter(([, path]) => path === "/shutdown").map((c) => c[2])], [0, [{ ifIdle: true }]]);
    assert.deepEqual(t.toasts, [["Restarting Filament: back in a few seconds", undefined]]);
  });

  // (fails before: yes — no such page; HC-66)
  // (fails before: yes — the PowerShell tray, removed on the owner's word of 10-22, still read as one that starts it again)
  test("started any other way — nothing, or the PowerShell tray of before — it says it only stops and asks first", async () => {
    assert.deepEqual(restartWords("tray"), restartWords(null), "the PowerShell tray is gone: no word of it starts Filament again");
    assert.match(restartWords(null).desc, /\(the Filament app did not start it\)/);

    const no = await open(renderAbout, { confirm: false });
    const stop = button(no.body, "Stop Filament");
    assert.match(stop.attrs.class, /danger/);
    stop.dispatch("click");
    await settle();
    assert.deepEqual(no.asked.map((q) => [q.title, q.description, q.destructive]), [["Stop Filament?", restartWords(null).desc, true]]);
    assert.equal(no.calls.filter(([, path]) => path === "/shutdown").length, 0, "kept running: the question was declined");

    const yes = await open(renderAbout);
    button(yes.body, "Stop Filament").dispatch("click");
    await settle();
    assert.equal(yes.calls.filter(([, path]) => path === "/shutdown").length, 1);
    assert.deepEqual(yes.toasts, [["Filament is stopping", undefined]]);
  });

  // (fails before: yes — no such page; HC-65)
  test("a restart refused while a turn runs names the chat", async () => {
    const p = await open(renderAbout, {
      state: { supervisor: "desktop" },
      posts: (path) => { if (path === "/shutdown") throw refusal(409, { error: "busy", note: "not stopped: 1 turn running in “Fix the parser”", chats: ["Fix the parser"] }); },
    });
    button(p.body, "Restart Filament").dispatch("click");
    await settle();
    assert.deepEqual(p.toasts, [["Not restarted: 1 turn running in “Fix the parser”. Try again once it ends.", "err"]]);
  });

  // (fails before: yes — the owner's of 11-08: an update was found only by the app's own looks, up to six hours apart)
  test("in the desktop app, Check now looks at once and says what it found; an update offered, its button is the next step", async () => {
    assert.ok(!labels((await open(renderAbout)).body).includes("Updates"), "a browser: no row");
    /** @type {any[]} */
    const acts = [];
    /** @type {Function[]} */
    const heard = [];
    /** @type {(v: any) => void} */
    let answer = () => {};
    const app = {
      update: async () => null,
      updateAct: async (/** @type {string} */ a) => (acts.push(a), true),
      onUpdate: (/** @type {Function} */ f) => (heard.push(f), () => void (offs += 1)),
      checkUpdates: () => new Promise((r) => (answer = r)),
    };
    let offs = 0;
    const p = await open(renderAbout, { app });
    const row = () => rowOf(p.body, "Updates");
    const desc = () => textOf(all(row(), "settings-row-desc")[0]);
    assert.equal(desc(), UPDATES_DESC);
    assert.equal(all(row(), "settings-row-desc")[0].kids[0].kids[0].attrs.role, "status", "what Check now finds is read out");
    const check = button(row(), "Check now");
    check.dispatch("click");
    await settle();
    // (fails before: yes — the review of 11-08: `disabled` threw the keyboard's focus off the button it was on)
    assert.deepEqual([textOf(check), "disabled" in check.attrs, check.attrs["aria-disabled"]], ["Checking…", false, "true"], "one look at a time, the focus kept");
    check.dispatch("click");
    answer({ result: "newest", version: "9.9.9" });
    await settle();
    assert.deepEqual([desc(), textOf(check), check.attrs["aria-disabled"]], ["Filament 9.9.9 is the newest version.", "Check now", "false"]);
    // the app offers one (the look found it, or one by itself did): the notice's words, and its button
    for (const f of heard) f({ phase: "available", version: "10.0.0", kind: "mac", page: "", received: 0, size: 0, why: "" });
    assert.deepEqual([desc(), textOf(check), check.classList.contains("primary")], ["Filament 10.0.0 is out. It downloads while you work, then asks before it installs.", "Update", true]);
    check.dispatch("click");
    await settle();
    assert.deepEqual(acts, ["get"], "Update: the download, as the notice's Update");
    for (const f of heard) f({ phase: "downloading", version: "10.0.0", kind: "mac", page: "", received: 45, size: 100, why: "" });
    assert.deepEqual([desc(), textOf(check), check.attrs["aria-disabled"]], ["Downloading Filament 10.0.0… 45% of 0 MB", "Downloading…", "true"]);
    for (const f of heard) f({ phase: "ready", version: "10.0.0", kind: "mac", page: "", received: 100, size: 100, why: "" });
    assert.equal(textOf(check), "Restart to update");
    check.dispatch("click");
    await settle();
    assert.deepEqual(acts, ["get", "restart"]);
    // (fails before: yes — the same review: an offer gone, the row said again what an earlier Check now found)
    for (const f of heard) f(null);
    assert.deepEqual([desc(), textOf(check)], [UPDATES_DESC, "Check now"]);
    // (fails before: yes — the same review: the row heard the app as long as the window lived, one more each visit)
    p.body.isConnected = false;
    for (const f of heard) f({ phase: "available", version: "10.0.1", kind: "mac", page: "", received: 0, size: 0, why: "" });
    assert.deepEqual([offs, desc()], [1, UPDATES_DESC], "Settings left: it stops hearing, and paints nothing");
    // what a look found, each in words
    assert.deepEqual(
      [{ result: "out", version: "1.2.0" }, { result: "none", why: "release 1.2.0 carries no Filament-1.2.0-mac-arm64.zip" }, { result: "failed", why: "fetch failed" }, { result: "checkout" }, { result: "attached" }, null].map(checkedWords),
      ["Filament 1.2.0 is out.", "No update to take: release 1.2.0 carries no Filament-1.2.0-mac-arm64.zip.", "Couldn't check: fetch failed.", "This Filament runs from its code folder: it updates with git pull.", "This app shows a Filament started elsewhere, so it offers no update while that one runs.", "Couldn't check: the app didn't answer."],
    );
  });
});

describe("Memory's engine and settings", () => {
  const STATUS = { enabled: true, engine: { installed: true, version: "3.15.1", dir: "C:\\eng", state: "ready", bundle: { ready: true, why: null, current: true } }, jobs: [] };

  // (fails before: yes — the harness had no engine controls nor memory's settings; then an Update, which no engine has
  // now: a new one comes with a new Filament)
  // (fails before: yes — the owner's of 11-09: every key of `memory` was drawn by its name, the bank — a free-text box
  // that switched the database — and memory's and its parts' own switches among them)
  test("an installed engine: Restart and Uninstall; then recall by meaning, the backups and, under Advanced, the memory folder — no other key of memory drawn", async () => {
    const p = await open(renderMemoryEngine, { gets: (path) => (path === "/memory/status" ? STATUS : undefined) });
    const line = all(p.body, "mset-engine-line")[0];
    assert.equal(textOf(all(line, "settings-row-desc")[0]), "Mnemosyne 3.15.1 in C:\\eng · ready.");
    assert.deepEqual(buttonsOf(line).map((b) => textOf(b)), ["Restart", "Uninstall"]);
    assert.equal(button(line, "Restart").attrs.title, RESTART_WORDS);
    assert.deepEqual(labels(p.body), ["The engine", "Recall by meaning", "Back up daily", "Backup folder", "Hour of day", "Backups kept", "Memory folder"]);
    assert.deepEqual(all(p.body, "nset-h").map((n) => textOf(n)), ["Memory's engine", "Backups", "Advanced"]);
    const drawn = all(p.body, "settings-row").map((n) => n.attrs["data-path"]).filter(Boolean);
    assert.deepEqual(drawn, ["memory.engine.embeddings", "memory.backups.enabled", "memory.backups.folder", "memory.backups.hour", "memory.backups.keep", "memory.folder"]);
    for (const gone of ["memory.enabled", "memory.engine.bank", "memory.autopilot.enabled", "memory.curator.enabled", "memory.rules.act", "memory.capture.excludeFolders"]) assert.ok(!drawn.includes(gone), gone);
    button(line, "Uninstall").dispatch("click");
    await settle();
    assert.deepEqual(p.asked.map((q) => q.description), [uninstallWords({ again: true })], "memory on, installing by itself: it comes back");
    assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/memory/uninstall"));
    assert.deepEqual(p.toasts, [["Memory's engine removed", undefined]]);
    button(rowOf(p.body, "Back up daily"), "Back up daily").dispatch("click");
    await settle();
    assert.deepEqual(p.writes().map((w) => w.set), [{ "memory.backups.enabled": true }], "kept at once");
  });

  // (fails before: yes — MEMR-8: an engine Filament restarted after it stalled said nothing of it on its row)
  test("an engine that stalled says so on its row: when, for how long, the calls it held, and that Filament restarted it", async () => {
    const stalled = { at: Date.parse("2026-10-30T10:42:00"), quietMs: 60_000, calls: 2, ops: ["recall", "get"], pid: 9, count: 2 };
    const p = await open(renderMemoryEngine, { gets: (path) => (path === "/memory/status" ? { ...STATUS, engine: { ...STATUS.engine, stalled } } : undefined) });
    const line = all(p.body, "mset-engine-line")[0];
    assert.equal(textOf(all(line, "settings-row-desc")[0]), `Mnemosyne 3.15.1 in C:\\eng · ready. ${stallWords(stalled)}`);
    assert.match(String(stallWords(stalled)), /^At .+ the engine answered nothing for 60 s, not even a ping, with 2 calls \(recall, get\) in flight: Filament restarted it, and those calls ended with an error\. It has stalled 2 times since Filament started\.$/);
  });

  // (fails before: yes — no engine controls in the harness)
  test("a missing engine offers Install, follows its percent on the feed and reads the engine again at its end", async () => {
    /** @type {any} */
    let status = { enabled: true, engine: { installed: false, bundle: { ready: true, why: null, current: false } }, jobs: [] };
    const p = await open(renderMemoryEngine, { gets: (path) => (path === "/memory/status" ? status : undefined) });
    const line = () => all(p.body, "mset-engine-line")[0];
    assert.deepEqual(buttonsOf(line()).map((b) => textOf(b)), ["Install"]);
    assert.match(textOf(all(line(), "settings-row-desc")[0]), /^Its engine isn't installed, so .* from the copy that came with Filament, offline/);
    button(line(), "Install").dispatch("click");
    await settle();
    assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/memory/install"));
    p.say({ type: "engine", engine: { state: "installing", percent: 40, source: "bundle" } });
    assert.equal(textOf(all(line(), "settings-row-desc")[0]), "Memory is getting ready — 40%: installing its engine from the copy that came with Filament");
    assert.equal(button(line(), "Install").attrs.disabled, "", "no second install while one runs");
    status = STATUS;
    const reads = p.calls.filter(([, path]) => path === "/memory/status").length;
    p.say({ type: "engine", engine: { state: "ready" } });
    await settle();
    assert.equal(p.calls.filter(([, path]) => path === "/memory/status").length, reads + 1);
    assert.deepEqual(buttonsOf(line()).map((b) => textOf(b)), ["Restart", "Uninstall"]);
  });

  // (fails before: yes — Install was offered with no bundle, as a download, and never over an engine already there)
  test("with no bundle here, no Install: the words say why; over another engine than this Filament's, Install puts its own in", async () => {
    const why = "this Filament has no memory engine bundle for win32-x64 in C:\\f\\vendor\\memory-engine: reinstall Filament, or in a checkout build it with npm run engine:bundle";
    const none = await open(renderMemoryEngine, { gets: (path) => (path === "/memory/status" ? { enabled: true, engine: { installed: false, bundle: { ready: false, why, current: false } }, jobs: [] } : undefined) });
    const noneLine = all(none.body, "mset-engine-line")[0];
    assert.deepEqual(buttonsOf(noneLine).map((b) => textOf(b)), []);
    assert.equal(textOf(all(noneLine, "settings-row-desc")[0]), `Its engine isn't installed, and can't be: ${why}. Meanwhile memory recalls by matching words only, not by meaning; sessions are recorded and learned from as usual.`);
    // (fails before: yes — the second Hunter's find) An engine there, none to bring it back: Uninstall says so.
    const lone = await open(renderMemoryEngine, { gets: (path) => (path === "/memory/status" ? { ...STATUS, engine: { ...STATUS.engine, bundle: { ready: false, why, current: false } } } : undefined) });
    button(all(lone.body, "mset-engine-line")[0], "Uninstall").dispatch("click");
    await settle();
    assert.deepEqual(lone.asked.map((q) => q.description), [uninstallWords({ again: true, bundled: false })]);
    const other = await open(renderMemoryEngine, { gets: (path) => (path === "/memory/status" ? { ...STATUS, engine: { ...STATUS.engine, bundle: { ready: true, why: null, current: false } } } : undefined) });
    const otherLine = all(other.body, "mset-engine-line")[0];
    assert.deepEqual(buttonsOf(otherLine).map((b) => textOf(b)), ["Install", "Restart", "Uninstall"]);
    assert.equal(textOf(all(otherLine, "settings-row-desc")[0]), `Mnemosyne 3.15.1 in C:\\eng · ready. ${OTHER_ENGINE_WORDS}`);
  });
});

// (fails before: yes — the group was "Data and statistics", with Records in it; and since the owner's of 11-05, it had
// no Experimental)
test("Settings' last group is Filament's own pages, and Records is the console's", () => {
  assert.deepEqual(SECTIONS.filter((s) => s.group === "Filament").map((s) => s.id), ["connect", "remote", "agent-loop", "space", "data", "usage", "import", "features", "experimental", "about"]);
  assert.ok(!SECTIONS.some((s) => s.id === "records"));
});
