// @ts-check
// The plan of 11-11, its v2-d: the sheet of a watcher that runs a program, and of one a program posts to.
// A script watcher's Switch on… sheet says what it runs — its command, how it is run, the files the press approves by
// their content, each to open and read, the secrets it is handed by name and which of them have no value yet, and that
// it runs as the person — and the press is of what it showed: the sheet reads a seal over what a Switch on would pin
// (`GET /space/:project/routines/:id/script`), sends it with the press, and a press whose seal is another's, or none,
// switches nothing on. One that is on lists what was approved, and says of a file that differs that it does.
// A webhook watcher's sheet has its address: said before Switch on, there in place right after it, with Copy, its
// secret the once it is shown, an example to paste, its bounds, and Make a new address…; the address and the secret
// stand in their fields and nowhere else.
// (fails before: yes — the sheet drew neither part: a person approved a program unseen, the route pinned whatever
// stood there at the press, and a webhook watcher's address could be read on no page)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as watchersCore from "../src/core/watchers.js";
import * as routinesCore from "../src/core/routines.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { hashOf } from "../src/services/script-pins.js";
import * as scriptWatch from "../src/app/watchers/script.js";
import * as webhookWatch from "../src/app/watchers/webhook.js";
import { pressClass } from "../src/http/admin/press.js";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs, until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The modules as a test reads what they may not have yet. */
const core = /** @type {any} */ (watchersCore);
const source = /** @type {any} */ (scriptWatch);

/** @type {string[]} */
const made = [];
/** What a test started that holds a timer or a process. @type {(() => unknown)[]} */
const stops = [];
after(async () => {
  for (const stop of stops.splice(0)) await stop();
  await removeDirs(...made);
});
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-watch-sheet-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} folder @param {string} path @param {string | Buffer} text */
const put = (folder, path, text) => {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), text);
};
/** @param {() => unknown} fn */
const refusal = (fn) => {
  try {
    fn();
  } catch (/** @type {any} */ e) {
    return [e.status, e.message, e.moved === true];
  }
  return null;
};

const T = 1_800_000_000_000;
const BY = { chain: "c1", byName: "Lead", model: "m", nameOf: () => "Lead" };
/** @type {any} */
const MENTIONS = { kind: "script", command: ["node", "scripts/mentions.mjs"] };
const RUNS_AS = "It runs as you, outside any agent's permission mode, for as long as the watcher is on.";
const APPROVES = "Switch on approves these files as they are now: once one changes, the program is not started again and the watcher is off until you switch it on.";
const APPROVED = "You approved these files as they were when you switched it on: once one changes, the program is not started again and the watcher is off until you switch it on again.";
const DIFFERS = "What it runs is not what you approved: Filament switches the watcher off at its program's next start, and Switch on then shows what it runs.";
const MADE = "Made as you switch it on. It answers this computer, and its tailnet where Filament is served there: it is never public.";
const SIGNED = "It takes only posts signed as GitHub signs its webhooks. Its secret is shown once, right after Switch on.";
const HEADER = "A post must carry X-Hub-Signature-256: sha256=<HMAC-SHA256 of the body under the secret>.";
const BOUNDS = "256 KB a post, 60 a minute; a post while it is paused is taken and dropped.";

describe("the sheet's words (core)", () => {
  test("a script watcher's: the secrets no app keeps a value for are named, and said before the press; one that is on says what was approved", () => {
    const t = { ...MENTIONS, secrets: ["SLACK_TOKEN", "GH_TOKEN"] };
    const none = core.scriptSheet(t, ["scripts/mentions.mjs"]);
    assert.deepEqual([none.unkept, none.unkeptWords, none.approves], [[], "", APPROVES]);
    const one = core.scriptSheet(t, ["scripts/mentions.mjs"], { unkept: ["SLACK_TOKEN"] });
    assert.deepEqual([one.unkept, one.unkeptWords], [["SLACK_TOKEN"], "No app of this project keeps a value for SLACK_TOKEN yet: the program will not start until one does."]);
    const two = core.scriptSheet(t, ["scripts/mentions.mjs"], { unkept: ["SLACK_TOKEN", "GH_TOKEN"] });
    assert.equal(two.unkeptWords, "No app of this project keeps a value for SLACK_TOKEN or GH_TOKEN yet: the program will not start until each has one.");
    // On: the files are those approved, and the sentence under them says so.
    assert.equal(core.scriptSheet(t, ["scripts/mentions.mjs"], { on: true }).approves, APPROVED);
    assert.equal(core.scriptSheet({ kind: "script", command: ["gh", "api", "notifications"] }, [], { on: true }).approves,
      "It names no file Filament reads: your Switch on approved the command alone, and the program is this computer's as it stands at each start.");
  });

  test("a webhook watcher's: where its address answers, how its posts are signed, and its bounds", () => {
    assert.equal(typeof core.webhookSheet, "function", "core says a webhook watcher's sheet");
    assert.deepEqual(core.webhookSheet({ kind: "webhook" }), { made: MADE, signed: "", header: "", bounds: BOUNDS });
    assert.deepEqual(core.webhookSheet({ kind: "webhook", sign: "github" }), { made: MADE, signed: SIGNED, header: HEADER, bounds: BOUNDS });
  });
});

/**
 * A Space with one script watcher proposed, its project a real folder, and its source: no program is started here.
 * @param {{ trigger?: any, files?: Record<string, string | Buffer>, secrets?: Record<string, string> }} [o]
 */
const rig = ({ trigger = MENTIONS, files = { "scripts/mentions.mjs": "console.log('one')\n", "scripts/lib.mjs": "export const n = 1;\n", "notes.md": "data\n" }, secrets = {} } = {}) => {
  const folder = fresh("project");
  for (const [p, text] of Object.entries(files)) put(folder, p, text);
  const store = createSpaceStore({ dir: null, now: () => T });
  const watch = /** @type {any} */ (scriptWatch.createScriptWatch({
    store,
    heard: () => 0,
    folderOf: (p) => (p === "p1" ? folder : null),
    secretsOf: (_p, names) => Object.fromEntries(names.filter((n) => n in secrets).map((n) => [n, secrets[n]])),
    start: () => ({ kill: async () => {} }),
  }));
  stops.push(() => watch.stop());
  const f = routinesCore.routineFields({ title: "Mentions", text: "Read the new mentions.", trigger }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  store.routinePropose("p1", f.fields, BY);
  const w = () => /** @type {import("../src/core/routines.js").Routine} */ (store.get("p1").routines[0]);
  return { folder, store, watch, w };
};

describe("what a Switch on would approve, read for the sheet (the script source)", () => {
  test("the seal is one hash over the pins, the same in any order, another where a file's bytes or the files differ", () => {
    assert.equal(typeof source.sealOf, "function", "the source seals its pins");
    const a = source.sealOf({ "scripts/a.mjs": "1".repeat(64), "scripts/b.mjs": "2".repeat(64) });
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(source.sealOf({ "scripts/b.mjs": "2".repeat(64), "scripts/a.mjs": "1".repeat(64) }), a, "in any order");
    assert.notEqual(source.sealOf({ "scripts/a.mjs": "3".repeat(64), "scripts/b.mjs": "2".repeat(64) }), a, "a file's bytes");
    assert.notEqual(source.sealOf({ "scripts/a.mjs": "1".repeat(64) }), a, "a file fewer");
    assert.notEqual(source.sealOf({ "scripts/a.mjs1": "1".repeat(63), "scripts/b.mjs": "2".repeat(64) }), a, "a path is not run into its hash");
    assert.match(source.sealOf({}), /^[0-9a-f]{64}$/, "a command that names no file has its seal too");
  });

  test("approvalOf: the seal of what a Switch on would pin now, and each file by its path and size; none for another kind", () => {
    const r = rig();
    assert.equal(typeof r.watch.approvalOf, "function", "the source reads an approval");
    const got = r.watch.approvalOf("p1", r.w());
    const pins = r.watch.pinsFor("p1", r.w());
    assert.deepEqual(Object.keys(pins).sort(), ["scripts/lib.mjs", "scripts/mentions.mjs"]);
    assert.equal(got.seal, source.sealOf(pins), "the real hashes, as the press pins them");
    assert.deepEqual(got.files.map((/** @type {any} */ f) => f.path), r.watch.sheetOf("p1", r.w()).files, "the files its row's words name, in their order");
    assert.deepEqual([...got.files].sort((x, y) => x.path.localeCompare(y.path)), [
      { path: "scripts/lib.mjs", bytes: statSync(join(r.folder, "scripts", "lib.mjs")).size },
      { path: "scripts/mentions.mjs", bytes: statSync(join(r.folder, "scripts", "mentions.mjs")).size },
    ]);
    assert.equal("differs" in got, false, "nothing differs from an approval there is none of");
    // A watcher of any other kind, and a routine at times, have none.
    const other = routinesCore.routineFields({ title: "Main moved", text: "x", trigger: { kind: "commit", branch: "main" } }, { create: true });
    assert.ok(other.ok);
    const commit = r.store.routinePropose("p1", other.fields, BY);
    assert.equal(r.watch.approvalOf("p1", commit), null);
    assert.equal(r.watch.fileOf("p1", commit, "scripts/mentions.mjs"), null);
    assert.equal(r.watch.approve("p1", commit, null), null, "its Switch on approves nothing by content, with a seal or without");
  });

  test("fileOf: one of those files' text, capped; a file that is none of them is not read; one that is no text says so", () => {
    const big = "a".repeat(200_050);
    const r = rig({ files: { "scripts/mentions.mjs": "console.log('one')\n", "scripts/big.mjs": big, "scripts/blob.js": Buffer.from([0x23, 0x21, 0x00, 0x01, 0x02, 0xff]), "notes.md": "data\n", ".env": "SECRET=1\n" } });
    assert.equal(typeof r.watch.fileOf, "function", "the source reads a file");
    assert.deepEqual(r.watch.fileOf("p1", r.w(), "scripts/mentions.mjs"), { path: "scripts/mentions.mjs", text: "console.log('one')\n", cut: false, bytes: 19 });
    const cut = r.watch.fileOf("p1", r.w(), "scripts/big.mjs");
    assert.deepEqual([cut.text.length, cut.cut, cut.bytes], [200_000, true, 200_050], "200,000 characters, and said where it is cut");
    const blob = r.watch.fileOf("p1", r.w(), "scripts/blob.js");
    assert.deepEqual(blob, { path: "scripts/blob.js", bytes: 6, unread: "It does not read as text, so it is not shown: it is approved by its bytes all the same." });
    // Only what the press pins: no data file, no secret's file, nothing by a path that climbs or is whole.
    for (const path of ["notes.md", ".env", "../outside.mjs", join(r.folder, "scripts", "mentions.mjs"), "scripts/../scripts/mentions.mjs", "", "scripts"]) assert.equal(r.watch.fileOf("p1", r.w(), path), null, path);
  });

  test("approve: the pins a press keeps where its seal is the sheet's; no seal is refused; another seal switches nothing on and names what differs", () => {
    const r = rig();
    assert.equal(typeof r.watch.approve, "function", "the source approves by a seal");
    const { seal } = r.watch.approvalOf("p1", r.w());
    assert.deepEqual(r.watch.approve("p1", r.w(), seal), r.watch.pinsFor("p1", r.w()));
    assert.deepEqual(refusal(() => r.watch.approve("p1", r.w(), null)), [400, "“Mentions” runs a program as you: it is switched on from its sheet, which shows what the press approves.", false]);
    assert.deepEqual(refusal(() => r.watch.approve("p1", r.w(), "")), [400, "“Mentions” runs a program as you: it is switched on from its sheet, which shows what the press approves.", false]);
    // Changed since the sheet was drawn: the store's Switch on takes nothing.
    put(r.folder, "scripts/mentions.mjs", "console.log('another program')\n");
    const on = () => r.store.routineOn("p1", "r1", null, { pins: (/** @type {any} */ x) => r.watch.approve("p1", x, seal) });
    assert.deepEqual(refusal(on), [409, "what “Mentions” runs changed since this sheet was drawn (scripts/mentions.mjs): read it again", true]);
    assert.deepEqual([r.w().state, r.w().script], ["proposed", undefined], "nothing switched on, nothing pinned");
    // A new file beside it, and one gone, differ too.
    put(r.folder, "scripts/mentions.mjs", "console.log('one')\n");
    assert.deepEqual(r.watch.approve("p1", r.w(), seal), r.watch.pinsFor("p1", r.w()), "as it was drawn again: taken");
    put(r.folder, "scripts/new.mjs", "export {};\n");
    rmSync(join(r.folder, "scripts", "lib.mjs"));
    assert.equal(refusal(on)?.[1], "what “Mentions” runs changed since this sheet was drawn (scripts/lib.mjs, scripts/new.mjs): read it again");
    // A seal this Filament never said: refused, with no file to name.
    assert.deepEqual(refusal(() => r.watch.approve("p1", r.w(), "f".repeat(64))), [409, "what “Mentions” runs changed since this sheet was drawn: read it again", true]);
    // Read again, the press is of what stands.
    const again = r.watch.approvalOf("p1", r.w());
    assert.notEqual(again.seal, seal);
    r.store.routineOn("p1", "r1", null, { pins: (/** @type {any} */ x) => r.watch.approve("p1", x, again.seal) });
    assert.deepEqual([r.w().state, r.w().script?.pins], ["on", { "scripts/mentions.mjs": hashOf(join(r.folder, "scripts", "mentions.mjs")), "scripts/new.mjs": hashOf(join(r.folder, "scripts", "new.mjs")) }]);
  });

  test("one that is on: the files approved, each as it stands now — changed, gone, or new beside them — and that the watcher is switched off at its next start", () => {
    const r = rig();
    const { seal } = r.watch.approvalOf("p1", r.w());
    r.store.routineOn("p1", "r1", null, { pins: (/** @type {any} */ x) => r.watch.approve("p1", x, seal) });
    const same = r.watch.approvalOf("p1", r.w());
    assert.deepEqual([same.seal, same.files.some((/** @type {any} */ f) => "changed" in f), "differs" in same], [seal, false, false], "as approved: nothing said");
    assert.equal(r.watch.sheetOf("p1", r.w()).approves, APPROVED);
    put(r.folder, "scripts/mentions.mjs", "console.log('another program')\n");
    put(r.folder, "scripts/new.mjs", "export {};\n");
    rmSync(join(r.folder, "scripts", "lib.mjs"));
    const now = r.watch.approvalOf("p1", r.w());
    assert.deepEqual([...now.files].sort((x, y) => x.path.localeCompare(y.path)), [
      { path: "scripts/lib.mjs", bytes: null, changed: "gone since you switched it on" },
      { path: "scripts/mentions.mjs", bytes: 31, changed: "changed since you switched it on" },
      { path: "scripts/new.mjs", bytes: 11, changed: "new since you switched it on" },
    ]);
    assert.equal(now.differs, DIFFERS);
    assert.notEqual(now.seal, seal, "its seal is of what a Switch on would pin now");
    // Each is read as it stands now; one gone says so.
    assert.equal(r.watch.fileOf("p1", r.w(), "scripts/mentions.mjs").text, "console.log('another program')\n");
    assert.equal(r.watch.fileOf("p1", r.w(), "scripts/new.mjs").text, "export {};\n");
    assert.deepEqual(r.watch.fileOf("p1", r.w(), "scripts/lib.mjs"), { path: "scripts/lib.mjs", unread: "It is not there now." });
  });

  test("sheetOf names the secrets no app keeps a value for, by name alone, from what its start reads", () => {
    const r = rig({ trigger: { ...MENTIONS, secrets: ["SLACK_TOKEN", "GH_TOKEN"] }, secrets: { GH_TOKEN: "ghp-a-value-nobody-reads" } });
    const sheet = r.watch.sheetOf("p1", r.w());
    assert.deepEqual([sheet.secrets, sheet.unkept, sheet.unkeptWords], [["SLACK_TOKEN", "GH_TOKEN"], ["SLACK_TOKEN"], "No app of this project keeps a value for SLACK_TOKEN yet: the program will not start until one does."]);
    assert.ok(!JSON.stringify(sheet).includes("ghp-a-value-nobody-reads"), "never a value");
    const kept = rig({ trigger: { ...MENTIONS, secrets: ["GH_TOKEN"] }, secrets: { GH_TOKEN: "x" } });
    assert.deepEqual([kept.watch.sheetOf("p1", kept.w()).unkept, kept.watch.sheetOf("p1", kept.w()).unkeptWords], [[], ""]);
  });
});

describe("a webhook watcher's sheet words come with its row (the webhook source)", () => {
  test("sheetOf: core's words for a watcher a program posts to; none for another kind", () => {
    const store = createSpaceStore({ dir: null, now: () => T });
    const hooks = /** @type {any} */ ({ all: () => [], ensure: () => ({ token: "t", onAt: T }), posts: () => [] });
    const watch = /** @type {any} */ (webhookWatch.createWebhookWatch({ store, hooks, heard: () => 0, base: () => "http://127.0.0.1:20300", tailnet: () => null }));
    assert.equal(typeof watch.sheetOf, "function", "the source says its sheet");
    /** @param {any} trigger */
    const propose = (trigger) => {
      const f = routinesCore.routineFields({ title: "W", text: "x", trigger }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      return store.routinePropose("p1", f.fields, BY);
    };
    assert.deepEqual(watch.sheetOf(propose({ kind: "webhook", sign: "github" })), { made: MADE, signed: SIGNED, header: HEADER, bounds: BOUNDS });
    assert.equal(watch.sheetOf(propose({ kind: "commit", branch: "main" })), null);
  });
});

describe("in a real Filament: the sheet's read, and the press that is of it", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-watch-sheet-app-"));
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  let project = "";
  let chat = "";
  const dir = join(base, "mentions");
  before(async () => {
    up = await fakeUpstream();
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [base], readerModel: "" };
      },
    });
    put(dir, "scripts/two.mjs", 'console.log(JSON.stringify({ id: "a1", summary: "first" }));\n');
    put(dir, "package.json", "{}\n");
    const session = await shim.api("/api/sessions", { method: "POST", body: { cwd: dir, model: "agent/brain-model", preset: "plain" } });
    assert.equal(session.status, 200, await session.clone().text());
    chat = String((await session.json()).id);
    project = String(/** @type {any} */ (shim.app).memory.archive?.getChain(chat)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    /** @type {any} */ (shim.app).spaces.make(project);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(base);
  });
  /** A watcher proposed in the project's Space. @param {any} fields */
  const propose = (fields) => {
    const f = routinesCore.routineFields(fields, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    return /** @type {any} */ (shim.app).spaces.routinePropose(project, f.fields, { chain: chat, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" });
  };
  const at = () => `/api/space/${encodeURIComponent(project)}`;
  /** @param {string} id */
  const kept = (id) => /** @type {any} */ (shim.app).spaces.get(project).routines.find((/** @type {any} */ x) => x.id === id);

  test("GET …/script answers the seal and the files, ?file= one of them alone; it is a read, not a press", async () => {
    const w = propose({ title: "Mentions", text: "", trigger: { kind: "script", command: [process.execPath, "scripts/two.mjs"], everyMin: 5 }, wakes: "you" });
    const path = `${at()}/routines/${encodeURIComponent(w.id)}/script`;
    const read = await shim.api(path);
    assert.equal(read.status, 200, await read.clone().text());
    assert.deepEqual(await read.json(), { seal: source.sealOf({ "scripts/two.mjs": hashOf(join(dir, "scripts", "two.mjs")) }), files: [{ path: "scripts/two.mjs", bytes: statSync(join(dir, "scripts", "two.mjs")).size }] });
    const file = await shim.api(`${path}?file=${encodeURIComponent("scripts/two.mjs")}`);
    assert.equal(file.status, 200, await file.clone().text());
    assert.deepEqual(await file.json(), { path: "scripts/two.mjs", text: readFileSync(join(dir, "scripts", "two.mjs"), "utf8"), cut: false, bytes: statSync(join(dir, "scripts", "two.mjs")).size });
    // A file of the project the press does not pin is not this row's to read.
    const other = await shim.api(`${path}?file=${encodeURIComponent("package.json")}`);
    assert.deepEqual([other.status, (await other.json()).error], [404, "“Mentions” names no file “package.json”: its sheet lists the files it runs."]);
    const none = await shim.api(`${at()}/routines/r999/script`);
    assert.equal(none.status, 404);
    // The table of presses says it reads: the person's page reads these files anyway.
    assert.deepEqual(pressClass("GET /space/:project/routines/:id/script"), pressClass("GET /space/:project/procedures"));
    assert.notDeepEqual(pressClass("GET /space/:project/routines/:id/script"), pressClass("GET /space/:project/routines/:id/address"));
    assert.match(readFileSync("test/fixtures/admin-routes.txt", "utf8"), /\nGET \/api\/space\/\*\/routines\/\*\/address\nGET \/api\/space\/\*\/routines\/\*\/script\n/);
  });

  test("Switch on is of the seal: none is refused, another's switches nothing on and says which file moved, the sheet's own pins the bytes", async () => {
    const w = propose({ title: "Sealed", text: "", trigger: { kind: "script", command: [process.execPath, "scripts/two.mjs"], everyMin: 5 }, wakes: "you" });
    const path = `${at()}/routines/${encodeURIComponent(w.id)}`;
    const { seal } = await (await shim.api(`${path}/script`)).json();
    // An old page's press, with no seal: nothing is approved unseen.
    const bare = await shim.api(`${path}/on`, { method: "POST", body: { at: w.at } });
    assert.deepEqual([bare.status, (await bare.json()).error], [400, "“Sealed” runs a program as you: it is switched on from its sheet, which shows what the press approves."]);
    const odd = await shim.api(`${path}/on`, { method: "POST", body: { at: w.at, seal: 7 } });
    assert.equal(odd.status, 400, await odd.clone().text());
    assert.deepEqual([kept(w.id).state, kept(w.id).script], ["proposed", undefined]);
    // Changed between the sheet and the press.
    const was = readFileSync(join(dir, "scripts", "two.mjs"), "utf8");
    put(dir, "scripts/two.mjs", "console.log('another program')\n");
    const moved = await shim.api(`${path}/on`, { method: "POST", body: { at: w.at, seal } });
    const said = await moved.json();
    assert.deepEqual([moved.status, said.error, said.moved, typeof said.space?.runs], [409, "what “Sealed” runs changed since this sheet was drawn (scripts/two.mjs): read it again", true, "object"]);
    assert.deepEqual([kept(w.id).state, kept(w.id).script], ["proposed", undefined], "nothing switched on");
    // Read again: the press is of what it shows.
    const again = await (await shim.api(`${path}/script`)).json();
    assert.notEqual(again.seal, seal);
    const on = await shim.api(`${path}/on`, { method: "POST", body: { at: w.at, seal: again.seal } });
    assert.equal(on.status, 200, await on.clone().text());
    assert.deepEqual([kept(w.id).state, kept(w.id).script?.pins], ["on", { "scripts/two.mjs": hashOf(join(dir, "scripts", "two.mjs")) }]);
    // On: its read lists what was approved, and says where a file differs.
    put(dir, "scripts/two.mjs", was);
    const differs = await (await shim.api(`${path}/script`)).json();
    assert.deepEqual([differs.files, differs.differs], [[{ path: "scripts/two.mjs", bytes: statSync(join(dir, "scripts", "two.mjs")).size, changed: "changed since you switched it on" }], DIFFERS]);
    assert.equal((await shim.api(`${path}`, { method: "DELETE" })).status, 200);
  });

  test("a watcher of another kind is switched on with no seal, and has nothing to read there; a webhook's row carries its sheet's words", async () => {
    const hook = propose({ title: "Build is red", text: "Read what the build posted.", trigger: { kind: "webhook", sign: "github" }, wakes: "you" });
    const path = `${at()}/routines/${encodeURIComponent(hook.id)}`;
    const row = (await (await shim.api(at())).json()).runs.routines.find((/** @type {any} */ x) => x.id === hook.id);
    assert.deepEqual(row.words.webhook, { made: MADE, signed: SIGNED, header: HEADER, bounds: BOUNDS });
    assert.equal(row.words.script, undefined);
    const none = await shim.api(`${path}/script`);
    assert.deepEqual([none.status, (await none.json()).error], [409, "“Build is red” runs no program of its own: only a watcher of what a program prints has files to approve."]);
    const on = await shim.api(`${path}/on`, { method: "POST", body: { at: hook.at, seal: "of-no-use" } });
    assert.equal(on.status, 200, await on.clone().text());
    assert.equal(kept(hook.id).state, "on");
  });
});

describe("the page asks for a watcher's address as the app's own press", () => {
  test("a read that ends in /address carries the desktop app's key, as the keys' read does", () => {
    const api = readFileSync("src/ui/lib/api.js", "utf8");
    assert.match(api, /\nconst PRESS_READS = \["\/api\/keys", "\/address"\];\n/);
    assert.match(api, /PRESS_READS\.some\(\(p\) => String\(url\)\.split\("\?"\)\[0\]\.endsWith\(p\)\)/, "matched by the end of its path, its query aside");
  });
});

/** Every element under one, in order. @param {any} el @returns {any[]} */
const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];

describe("the sheet, on the page", () => {
  /** Every request the page made, in order. @type {{ url: string, method: string, body: any }[]} */
  const asked = [];
  /**
   * What the stand-in server answers the page by its address: a body; `{ refuse: status, error }` for a refusal; or
   * undefined for a 404.
   * @type {(url: string, method: string) => any}
   */
  let serve = () => undefined;
  const realFetch = g.fetch;
  /** What the page copied. @type {string[]} */
  const copied = [];
  /** @type {PropertyDescriptor | undefined} */
  let hadNavigator;
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    // A sheet asks what had the focus; nothing in the stub page is an element of the browser's.
    HTMLElement: class {},
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  before(() => {
    // The page asks by a path; a test's own Filament is asked by its whole address, which the real fetch takes.
    g.fetch = async (/** @type {any} */ url, /** @type {any} */ init = {}) => {
      if (typeof url !== "string" || /^https?:/i.test(url)) return realFetch(url, init);
      const method = String(init.method || "GET");
      asked.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
      const body = serve(url, method);
      if (body === undefined) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      if (body && typeof body === "object" && "refuse" in body) return new Response(JSON.stringify({ error: body.error }), { status: body.refuse, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    // A toast's own timer: kept on the page here, so no test waits for one to go.
    g.window.setTimeout = () => 0;
    hadNavigator = Object.getOwnPropertyDescriptor(g, "navigator");
    Object.defineProperty(g, "navigator", { value: { clipboard: { writeText: async (/** @type {string} */ text) => void copied.push(text) } }, configurable: true, writable: true });
  });
  after(() => {
    g.fetch = realFetch;
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    if (hadNavigator) Object.defineProperty(g, "navigator", hadNavigator);
    else delete g.navigator;
  });
  beforeEach(() => {
    asked.length = 0;
    copied.length = 0;
    serve = () => undefined;
    doc.document.body.replaceChildren();
  });

  /** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
  const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
  const NOW = at(10);
  /** @param {string} c */
  const nameOf = (c) => (c === "c1" ? "Lead" : "an untitled chat");
  /** A watcher on, as its Space keeps it. @param {any} [o] @returns {any} */
  const watcher = (o = {}) => ({
    id: "r1", title: "Supervisor", when: "", task: "", writes: false, trigger: { kind: "commit", branch: "main" }, wakes: "you", state: "on", paused: false,
    madeIn: "c1", madeBy: "Lead", model: "m", at: at(9), onAt: at(9), upTo: null, last: null, skipped: null, seen: { from: at(9), at: null, ids: [] }, pending: null, ...o,
  });
  /** A routine as the Space's read gives it: as kept, with its project, its chat's name and Filament's words. @param {any} r @param {Record<string, any>} [more] */
  const said = (r, more = {}) => ({ ...r, project: "p1", madeName: nameOf(r.madeIn), words: { ...routinesCore.rowWords(r, { now: NOW, nameOf }), ...more } });
  const SCRIPT = { kind: "script", command: ["node", "scripts/mentions.mjs"], secrets: ["SLACK_TOKEN", "GH_TOKEN"] };
  const FILES = ["scripts/mentions.mjs", "scripts/lib.mjs"];
  /** A script watcher's row, its sheet's words with it. @param {any} [o] @param {any} [sheet] */
  const scripted = (o = {}, sheet = {}) => {
    const r = watcher({ id: "s1", title: "Mentions", trigger: SCRIPT, ...o });
    return said(r, { script: core.scriptSheet(sheet.trigger || SCRIPT, sheet.files || FILES, { on: r.state === "on", unkept: sheet.unkept || [] }) });
  };
  /** A webhook watcher's row. @param {any} [o] */
  const hooked = (o = {}) => {
    const r = watcher({ id: "h1", title: "Build is red", trigger: { kind: "webhook" }, ...o });
    return said(r, { webhook: typeof core.webhookSheet === "function" ? core.webhookSheet(r.trigger) : undefined });
  };
  /** What runs by itself, as the Space's read says it. @param {any[]} routines */
  const runsOf = (routines) => ({ head: "", listening: "Listening: 1 watcher", pausedSince: null, routines, watches: [] });

  /** The Watchers part drawn by itself, with what the page hands it. @param {{ answer?: (path: string, body: any) => any }} [o] */
  const mount = async (o = {}) => {
    const { watchersPart } = await import("../src/ui/harness/space/watchers.js");
    const did = { wrote: /** @type {any[]} */ ([]) };
    const part = watchersPart({
      all: false,
      place: () => ({ id: "p1", name: "web", cwd: "/w" }),
      write: async (project, method, path, body) => (did.wrote.push([project, method, path, body]), o.answer ? o.answer(path, body) : {}),
      pauseAll: async () => true,
      startWith: () => {},
      openChat: () => {},
      askChat: () => {},
      openTab: () => {},
    });
    doc.document.body.append(part.el);
    /** @param {string} id */
    const rowOf = (id) => /** @type {any} */ (part.el.querySelector(`.swt-row[data-watcher="${id}"]`));
    return { part, did, rowOf };
  };
  /** @param {any} root @param {string} sel */
  const texts = (root, sel) => root.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);
  const sheets = () => doc.document.body.querySelectorAll(".srt-sheet");
  /** The newest of what the page shows over itself. @param {string} sel @returns {any} */
  const newest = (sel) => doc.document.body.querySelectorAll(sel).at(-1);
  /** The newest menu's rows, opened from a button. @param {any} b */
  const menuOf = async (b) => {
    b.dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), "its ⋯");
    return /** @type {any[]} */ (newest(".zc-menu").querySelectorAll(".zc-menu-item"));
  };
  /** @param {any[]} items */
  const labels = (items) => items.map((i) => i.querySelector(".zc-menu-label-line").textContent);
  /** @param {any[]} items @param {string} label */
  const item = (items, label) => items.find((i) => i.querySelector(".zc-menu-label-line").textContent === label);
  /** The button of a dialog's foot that reads so. @param {string} label */
  const dialogButton = (label) => {
    const b = doc.document.body.querySelectorAll(".zc-dialog-foot .zc-btn").find((/** @type {any} */ x) => x.textContent === label);
    assert.ok(b, `the dialog's ${label}`);
    return b;
  };
  /** The page's reads, by their addresses. */
  const reads = () => asked.filter((a) => a.method === "GET").map((a) => a.url);
  const SCRIPT_AT = "/api/space/p1/routines/s1/script";
  /** @param {string} path */
  const fileAt = (path) => `${SCRIPT_AT}?file=${encodeURIComponent(path)}`;

  test("a script watcher's Switch on… sheet: what it runs, the files the press approves, the secrets it is handed and which have no value, and whom it runs as", async () => {
    const { part, rowOf } = await mount();
    serve = (u) => (u === SCRIPT_AT ? { seal: "seal-1", files: [{ path: "scripts/mentions.mjs", bytes: 1234 }, { path: "scripts/lib.mjs", bytes: 87 }] } : undefined);
    const S = scripted({ state: "proposed", seen: null, at: at(9, 5) }, { unkept: ["SLACK_TOKEN"] });
    part.paint(runsOf([S]));
    part.show(true);
    rowOf("s1").querySelector(".swt-go").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    assert.ok(sheet, "its sheet");
    // The part stands between When and What it may do.
    assert.deepEqual(texts(sheet, ".sdb-keep-h"), ["When", "What it runs", "Switch on approves", "Handed to it", "What it may do", "Made in"]);
    assert.deepEqual([sheet.querySelector(".srs-cmd").textContent, sheet.querySelector(".srs-cmd").tagName, sheet.querySelector(".srs-how").textContent],
      ["node scripts/mentions.mjs", "CODE", "Kept running while the watcher is on, and started again where it ends."]);
    // The press waits for the read of what it would approve, and says so.
    const go = sheet.querySelector(".srt-on");
    assert.deepEqual([go.disabled, go.title], [true, "Reading what Switch on would approve…"]);
    await until(() => !go.disabled, "the seal, read");
    assert.equal(go.title, "");
    assert.deepEqual(reads(), [SCRIPT_AT]);
    assert.deepEqual(sheet.querySelectorAll(".srs-file").map((/** @type {any} */ f) => [f.getAttribute("data-path"), f.querySelector(".srs-path").textContent, f.querySelector(".srs-bytes").textContent]),
      [["scripts/mentions.mjs", "scripts/mentions.mjs", "1 KB"], ["scripts/lib.mjs", "scripts/lib.mjs", "87 bytes"]]);
    assert.equal(sheet.querySelector(".srs-approves").textContent, APPROVES);
    assert.equal(sheet.querySelector(".srs-changed"), null, "nothing was approved yet: nothing changed since");
    // Its secrets by name, one of them with no value kept: said under them, in the server's words.
    assert.deepEqual(sheet.querySelectorAll(".srs-secret").map((/** @type {any} */ c) => [c.textContent, c.classList.contains("is-unkept")]), [["SLACK_TOKEN", true], ["GH_TOKEN", false]]);
    assert.equal(sheet.querySelector(".srs-handed").textContent, "Their values reach the program's environment and nothing else.");
    assert.equal(sheet.querySelector(".srs-unkept").textContent, "No app of this project keeps a value for SLACK_TOKEN yet: the program will not start until one does.");
    assert.equal(go.disabled, false, "a secret with no value holds no press back");
    // Whom it runs as: its own line, the shield in the tone of what is the person's to weigh.
    const { ICONS } = await import("../src/ui/harness/lib/icons.js");
    assert.deepEqual([sheet.querySelector(".srs-as").textContent, sheet.querySelector(".srs-as-ic").innerHTML], [RUNS_AS, ICONS.shieldAlert]);
    // One that names no secret has no part for them.
    part.paint(runsOf([scripted({ state: "proposed", seen: null, at: at(9, 5) }, { trigger: { kind: "script", command: ["node", "scripts/mentions.mjs"] } })]));
    sheet.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Not now").dispatch("click");
    rowOf("s1").querySelector(".swt-go").dispatch("click");
    const bare = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual(texts(bare, ".sdb-keep-h"), ["When", "What it runs", "Switch on approves", "What it may do", "Made in"]);
    assert.deepEqual([bare.querySelector(".srs-secret"), bare.querySelector(".srs-unkept")], [null, null]);
  });

  test("a file's row opens what would be approved: its text, read only, under its row — cut where it is long, said where it is no text or could not be read", async () => {
    const { part, rowOf } = await mount();
    serve = (u) => {
      if (u === SCRIPT_AT) return { seal: "seal-1", files: [{ path: "scripts/mentions.mjs", bytes: 19 }, { path: "scripts/lib.mjs", bytes: 900_000 }, { path: "scripts/blob.js", bytes: 6 }, { path: "scripts/gone.mjs", bytes: 4 }] };
      if (u === fileAt("scripts/mentions.mjs")) return { path: "scripts/mentions.mjs", text: "console.log('one')\n", cut: false, bytes: 19 };
      if (u === fileAt("scripts/lib.mjs")) return { path: "scripts/lib.mjs", text: "x".repeat(50), cut: true, bytes: 900_000 };
      if (u === fileAt("scripts/blob.js")) return { path: "scripts/blob.js", bytes: 6, unread: "It does not read as text, so it is not shown: it is approved by its bytes all the same." };
      if (u === fileAt("scripts/gone.mjs")) return { refuse: 404, error: "“Mentions” names no file “scripts/gone.mjs”: its sheet lists the files it runs." };
      return undefined;
    };
    part.paint(runsOf([scripted({ state: "proposed", seen: null, at: at(9, 5) }, { files: ["scripts/mentions.mjs", "scripts/lib.mjs", "scripts/blob.js", "scripts/gone.mjs"] })]));
    part.show(true);
    rowOf("s1").querySelector(".swt-go").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    await until(() => !sheet.querySelector(".srt-on").disabled, "the seal, read");
    /** @param {string} path */
    const file = (path) => sheet.querySelector(`.srs-file[data-path="${path}"]`);
    const open = file("scripts/mentions.mjs").querySelector(".srs-file-open");
    assert.deepEqual([open.tagName, open.getAttribute("aria-expanded"), file("scripts/mentions.mjs").querySelector(".srs-text")], ["BUTTON", "false", null]);
    open.dispatch("click");
    await until(() => file("scripts/mentions.mjs").querySelector(".srs-text"), "its text");
    assert.deepEqual([file("scripts/mentions.mjs").querySelector(".srs-text").tagName, file("scripts/mentions.mjs").querySelector(".srs-text").textContent, open.getAttribute("aria-expanded"), file("scripts/mentions.mjs").querySelector(".srs-cut")],
      ["PRE", "console.log('one')\n", "true", null]);
    assert.ok(!sheet.querySelector("textarea") && !sheet.querySelector("input"), "read only: nothing to type in");
    // A second press folds it; opening it again reads it again, as it stands then.
    open.dispatch("click");
    assert.deepEqual([open.getAttribute("aria-expanded"), file("scripts/mentions.mjs").querySelector(".srs-text")], ["false", null]);
    open.dispatch("click");
    await until(() => file("scripts/mentions.mjs").querySelector(".srs-text"), "its text, again");
    assert.equal(reads().filter((u) => u === fileAt("scripts/mentions.mjs")).length, 2);
    // Long: its first characters, and said so.
    file("scripts/lib.mjs").querySelector(".srs-file-open").dispatch("click");
    await until(() => file("scripts/lib.mjs").querySelector(".srs-text"), "the long one's text");
    assert.deepEqual([file("scripts/lib.mjs").querySelector(".srs-text").textContent.length, file("scripts/lib.mjs").querySelector(".srs-cut").textContent], [50, "Its first 50 characters: the file is longer."]);
    // No text: the server's words in its place.
    file("scripts/blob.js").querySelector(".srs-file-open").dispatch("click");
    await until(() => file("scripts/blob.js").querySelector(".srs-unread"), "why it is not shown");
    assert.deepEqual([file("scripts/blob.js").querySelector(".srs-unread").textContent, file("scripts/blob.js").querySelector(".srs-text")], ["It does not read as text, so it is not shown: it is approved by its bytes all the same.", null]);
    // Refused: said under its row, and the rest stands.
    file("scripts/gone.mjs").querySelector(".srs-file-open").dispatch("click");
    await until(() => file("scripts/gone.mjs").querySelector(".srs-file-err"), "its refusal");
    assert.equal(file("scripts/gone.mjs").querySelector(".srs-file-err").textContent, "“Mentions” names no file “scripts/gone.mjs”: its sheet lists the files it runs.");
    assert.equal(file("scripts/mentions.mjs").querySelector(".srs-text").textContent, "console.log('one')\n");
  });

  test("Switch on sends the seal the sheet read; refused, the sheet reads what it runs now and the next press is of that", async () => {
    let refuse = true;
    const { part, did, rowOf } = await mount({ answer: () => (refuse ? null : {}) });
    let seal = "seal-1";
    let files = [{ path: "scripts/mentions.mjs", bytes: 19 }];
    serve = (u) => (u === SCRIPT_AT ? { seal, files } : undefined);
    part.paint(runsOf([scripted({ state: "proposed", seen: null, at: at(9, 5) }, { files: ["scripts/mentions.mjs"] })]));
    part.show(true);
    rowOf("s1").querySelector(".swt-go").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    await until(() => !sheet.querySelector(".srt-on").disabled, "the seal, read");
    // The file changed, and one came beside it, between the sheet and the press: the server refuses it.
    seal = "seal-2";
    files = [{ path: "scripts/mentions.mjs", bytes: 31 }, { path: "scripts/new.mjs", bytes: 11 }];
    sheet.querySelector(".srt-on").dispatch("click");
    await until(() => did.wrote.length === 1, "Switch on");
    assert.deepEqual(did.wrote[0], ["p1", "POST", "/routines/s1/on", { at: at(9, 5), seal: "seal-1" }]);
    await until(() => reads().length === 2, "what it runs now, read again");
    await until(() => sheet.querySelectorAll(".srs-file").length === 2 && !sheet.querySelector(".srt-on").disabled, "what it runs now, shown");
    assert.deepEqual([sheets().length, sheets().at(-1) === sheet], [1, true], "the same sheet, still open");
    assert.deepEqual(texts(sheet, ".srs-path"), ["scripts/mentions.mjs", "scripts/new.mjs"]);
    refuse = false;
    sheet.querySelector(".srt-on").dispatch("click");
    await until(() => did.wrote.length === 2, "Switch on, of what it shows now");
    assert.deepEqual(did.wrote[1], ["p1", "POST", "/routines/s1/on", { at: at(9, 5), seal: "seal-2" }]);
    await until(() => sheets().length === 0, "taken: the sheet closed");
  });

  test("a read that fails is said in the part's place, and Switch on stays off; a long list shows its first files, then all", async () => {
    const { part, did, rowOf } = await mount();
    serve = (u) => (u === SCRIPT_AT ? { refuse: 409, error: "“Mentions” has no folder to read its files in." } : undefined);
    part.paint(runsOf([scripted({ state: "proposed", seen: null, at: at(9, 5) })]));
    part.show(true);
    rowOf("s1").querySelector(".swt-go").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    await until(() => sheet.querySelector(".srs-err"), "the refusal, in the part's place");
    const go = sheet.querySelector(".srt-on");
    assert.deepEqual([sheet.querySelector(".srs-err").textContent, sheet.querySelector(".srs-file"), go.disabled, go.title],
      ["“Mentions” has no folder to read its files in.", null, true, "What it runs could not be read: nothing can be approved"]);
    go.dispatch("click");
    assert.deepEqual(did.wrote, [], "no press goes out unsealed");
    assert.deepEqual(texts(sheet, ".sdb-keep-h"), ["When", "What it runs", "Switch on approves", "Handed to it", "What it may do", "Made in"], "the rest of the sheet stands");
    sheet.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Not now").dispatch("click");
    // Ten files: eight, then the rest behind one press.
    const many = Array.from({ length: 10 }, (_, i) => `scripts/f${i}.mjs`);
    serve = (u) => (u === SCRIPT_AT ? { seal: "seal-1", files: many.map((path) => ({ path, bytes: 10 })) } : undefined);
    part.paint(runsOf([scripted({ state: "proposed", seen: null, at: at(9, 5) }, { files: many })]));
    rowOf("s1").querySelector(".swt-go").dispatch("click");
    const long = /** @type {any} */ (sheets().at(-1));
    await until(() => !long.querySelector(".srt-on").disabled, "the seal, read");
    assert.deepEqual([long.querySelectorAll(".srs-file").length, long.querySelector(".srs-all").textContent], [8, "Show all 10 files"]);
    long.querySelector(".srs-all").dispatch("click");
    assert.deepEqual([long.querySelectorAll(".srs-file").length, long.querySelector(".srs-all")], [10, null]);
  });

  test("one that is on: What it does lists what was approved, says of a file that it changed since, and that the watcher is switched off at its next start", async () => {
    const { part, rowOf } = await mount();
    serve = (u) => (u === SCRIPT_AT ? { seal: "seal-9", files: [{ path: "scripts/mentions.mjs", bytes: 31, changed: "changed since you switched it on" }, { path: "scripts/lib.mjs", bytes: 87 }], differs: DIFFERS } : undefined);
    part.paint(runsOf([scripted()]));
    part.show(true);
    const menu = await menuOf(rowOf("s1").querySelector(".swt-more"));
    assert.deepEqual(labels(menu), ["What it does", "Ask for a change…", "Remove"], "no address: it takes no posts");
    item(menu, "What it does").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual(texts(sheet, ".sdb-keep-h"), ["When", "What it runs", "Approved when you switched it on", "Handed to it", "What it may do", "Made in"]);
    assert.equal(sheet.querySelector(".srs-approves").textContent, APPROVED);
    await until(() => sheet.querySelector(".srs-changed"), "what changed since");
    assert.deepEqual(sheet.querySelectorAll(".srs-file").map((/** @type {any} */ f) => [f.getAttribute("data-path"), f.querySelector(".srs-changed")?.textContent ?? null]),
      [["scripts/mentions.mjs", "changed since you switched it on"], ["scripts/lib.mjs", null]]);
    assert.equal(sheet.querySelector(".srs-differs").textContent, DIFFERS);
    assert.equal(sheet.querySelector(".srt-on"), null, "What it does has no press");
  });

  const TOKEN = "0123456789abcdef0123456789abcdef";
  const URL1 = `http://127.0.0.1:20300/watch/${TOKEN}`;
  const TOKEN2 = "fedcba9876543210fedcba9876543210";
  const URL2 = `http://127.0.0.1:20300/watch/${TOKEN2}`;
  const ADDRESS_AT = "/api/space/p1/routines/h1/address";

  test("a webhook watcher's Switch on… sheet says where its address will answer and reads none; switched on, the sheet stays and becomes What it does, its address in sight", async () => {
    const { part, did, rowOf } = await mount();
    serve = (u, method) => (u === ADDRESS_AT && method === "GET" ? { url: URL1, sign: null } : undefined);
    part.paint(runsOf([hooked({ state: "proposed", seen: null, at: at(9, 5) })]));
    part.show(true);
    rowOf("h1").querySelector(".swt-go").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual(texts(sheet, ".sdb-keep-h"), ["When", "Its address", "What it may do", "Made in"]);
    assert.deepEqual([sheet.querySelector(".srw-made").textContent, sheet.querySelector(".srw-signed"), sheet.querySelector(".srw-url")], [MADE, null, null]);
    assert.equal(sheet.querySelector(".srt-on").disabled, false, "no seal to wait for");
    assert.deepEqual(reads(), [], "one proposed has no address: none is asked for");
    sheet.querySelector(".srt-on").dispatch("click");
    await until(() => sheet.querySelector(".srw-url"), "its address, in place");
    assert.deepEqual(did.wrote, [["p1", "POST", "/routines/h1/on", { at: at(9, 5) }]], "its press carries no seal");
    assert.deepEqual([sheets().length, sheets().at(-1) === sheet, sheet.querySelector(".sp-sheet-title").textContent, sheet.querySelector(".srt-on")], [1, true, "What “Build is red” does", null]);
    assert.deepEqual(texts(sheet, ".sdb-keep-h"), ["When", "Its address", "What it may do", "Made in"]);
    assert.deepEqual(reads(), [ADDRESS_AT]);
    // The address in its field, with Copy; an example to paste; its bounds.
    const CURL = `curl -X POST "${URL1}" -H "content-type: application/json" -d '{"status":"red"}'`;
    assert.deepEqual([sheet.querySelector(".srw-url").textContent, sheet.querySelector(".srw-url").tagName, sheet.querySelector(".srw-example").textContent, sheet.querySelector(".srw-bounds").textContent],
      [URL1, "CODE", CURL, BOUNDS]);
    assert.deepEqual([sheet.querySelector(".srw-tailnet"), sheet.querySelector(".srw-secret"), sheet.querySelector(".srw-header")], [null, null, null], "no tailnet's, no secret, no signing");
    const copies = sheet.querySelectorAll(".srw-copy");
    assert.deepEqual(copies.map((/** @type {any} */ b) => b.textContent), ["Copy", "Copy"]);
    copies[0].dispatch("click");
    await until(() => copied.length === 1, "the address, copied");
    copies[1].dispatch("click");
    await until(() => copied.length === 2, "the example, copied");
    assert.deepEqual(copied, [URL1, CURL]);
    assert.deepEqual(texts(doc.document.body, ".zc-toast").slice(-2), ["The address is copied", "The example is copied"]);
    // The address stands in its fields and nowhere else: no tip, no attribute, no toast.
    const holds = all(sheet).filter((el) => el.children.length === 0 && String(el.textContent).includes(TOKEN));
    assert.ok(holds.length === 2 && holds.every((el) => el.classList.contains("srw-field")), "its fields alone");
    assert.deepEqual(all(doc.document.body).filter((el) => el.attributes.some((/** @type {any} */ a) => String(a.value).includes(TOKEN))).map((el) => el.className), []);
    assert.ok(texts(doc.document.body, ".zc-toast").every((/** @type {string} */ t) => !t.includes(TOKEN)));
  });

  test("Its address…, on one that is on: the tailnet's, the secret the once it is shown, what a signed post carries; Make a new address… asks first and shows the new one in place", async () => {
    const { part, rowOf } = await mount();
    let renewed = false;
    serve = (u, method) => {
      if (u === ADDRESS_AT && method === "GET") return { url: URL1, urlTailnet: `https://box.tail1234.ts.net/watch/${TOKEN}`, sign: "github", secret: "s3cr3t-shown-once" };
      if (u === `${ADDRESS_AT}/renew` && method === "POST") return renewed ? { refuse: 403, error: "This is a press: it is made in Filament's own window on this computer." } : ((renewed = true), { ok: true, url: URL2, sign: "github", secret: "an0ther-s3cr3t" });
      return undefined;
    };
    part.paint(runsOf([hooked({ trigger: { kind: "webhook", sign: "github" } })]));
    part.show(true);
    const menu = await menuOf(rowOf("h1").querySelector(".swt-more"));
    assert.deepEqual(labels(menu), ["What it does", "Its address…", "Ask for a change…", "Remove"]);
    assert.equal(item(menu, "Its address…").querySelector(".zc-menu-desc").textContent, "Where a program posts to wake it: yours to copy");
    item(menu, "Its address…").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    assert.equal(sheet.querySelector(".sp-sheet-title").textContent, "What “Build is red” does");
    await until(() => sheet.querySelector(".srw-url"), "its address");
    assert.deepEqual([sheet.querySelector(".srw-url").textContent, sheet.querySelector(".srw-tailnet").textContent, sheet.querySelector(".srw-secret").textContent],
      [URL1, `https://box.tail1234.ts.net/watch/${TOKEN}`, "s3cr3t-shown-once"]);
    assert.deepEqual(texts(sheet, ".srw-label"), ["From its tailnet", "Its secret"]);
    assert.equal(sheet.querySelector(".srw-once").textContent, "Shown this once: copy it now. Make a new address… gives another.");
    // Signed: what a post must carry, and no line to paste.
    assert.deepEqual([sheet.querySelector(".srw-header").textContent, sheet.querySelector(".srw-example")], [HEADER, null]);
    assert.equal(sheet.querySelector(".srw-bounds").textContent, BOUNDS);
    const copies = sheet.querySelectorAll(".srw-copy");
    assert.equal(copies.length, 3, "the address, the tailnet's, the secret");
    copies[2].dispatch("click");
    await until(() => copied.length === 1, "the secret, copied");
    assert.deepEqual([copied, texts(doc.document.body, ".zc-toast").at(-1)], [["s3cr3t-shown-once"], "The secret is copied"]);
    // Make a new address…: behind its word.
    const renew = sheet.querySelector(".srw-renew");
    assert.equal(renew.textContent, "Make a new address…");
    renew.dispatch("click");
    assert.deepEqual([newest(".zc-dialog-title").textContent, newest(".zc-dialog-desc").textContent], ["Make a new address for “Build is red”?", "The old address stops at once: whatever posts to it must be given the new one."]);
    assert.equal(asked.filter((a) => a.method === "POST").length, 0, "nothing renewed by opening it");
    dialogButton("Make a new address").dispatch("click");
    await until(() => sheet.querySelector(".srw-url")?.textContent === URL2, "the new address, in place");
    assert.deepEqual(asked.filter((a) => a.method === "POST").map((a) => [a.url, a.body]), [[`${ADDRESS_AT}/renew`, {}]]);
    assert.deepEqual([sheets().at(-1) === sheet, sheet.querySelector(".srw-secret").textContent, sheet.querySelector(".srw-tailnet")], [true, "an0ther-s3cr3t", null]);
    // Refused: the server's words in the part's place, the address it has still shown.
    sheet.querySelector(".srw-renew").dispatch("click");
    dialogButton("Make a new address").dispatch("click");
    await until(() => sheet.querySelector(".srw-renew-err"), "the refusal");
    assert.deepEqual([sheet.querySelector(".srw-renew-err").textContent, sheet.querySelector(".srw-url").textContent], ["This is a press: it is made in Filament's own window on this computer.", URL2]);
    // Neither the address nor the secret is anywhere but its field.
    for (const secret of [TOKEN2, "an0ther-s3cr3t"]) {
      assert.ok(all(sheet).filter((el) => el.children.length === 0 && String(el.textContent).includes(secret)).every((el) => el.classList.contains("srw-field")), secret);
      assert.deepEqual(all(doc.document.body).filter((el) => el.attributes.some((/** @type {any} */ a) => String(a.value).includes(secret))).length, 0, secret);
    }
  });

  test("a refusal of the address read is said in the part's place, in the server's words, and nothing else on the sheet breaks", async () => {
    const { part, rowOf } = await mount();
    serve = (u) => (u === ADDRESS_AT ? { refuse: 403, error: "This is a press: it is made in Filament's own window on this computer." } : undefined);
    part.paint(runsOf([hooked()]));
    part.show(true);
    item(await menuOf(rowOf("h1").querySelector(".swt-more")), "Its address…").dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    await until(() => sheet.querySelector(".srw-err"), "the refusal");
    assert.deepEqual([sheet.querySelector(".srw-err").textContent, sheet.querySelector(".srw-url"), sheet.querySelector(".srw-renew")], ["This is a press: it is made in Filament's own window on this computer.", null, null]);
    assert.deepEqual(texts(sheet, ".sdb-keep-h"), ["When", "Its address", "What it may do", "Made in"]);
    assert.ok(sheet.querySelectorAll("button").some((/** @type {any} */ b) => b.textContent === "Close"));
    // A proposed one that takes signed posts says so before the press.
    sheet.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Close").dispatch("click");
    part.paint(runsOf([hooked({ state: "proposed", seen: null, trigger: { kind: "webhook", sign: "github" } })]));
    rowOf("h1").querySelector(".swt-go").dispatch("click");
    assert.deepEqual([newest(".srt-sheet").querySelector(".srw-made").textContent, newest(".srt-sheet").querySelector(".srw-signed").textContent], [MADE, SIGNED]);
  });

  test("its look: the theme's tokens alone; a field keeps one line and scrolls inside itself, its Copy beside it; the shield in the Space's amber", () => {
    const css = readFileSync("src/ui/harness/space/space.css", "utf8");
    const mine = css.split("\n").filter((l) => /\.srs-|\.srw-/.test(l)).join("\n");
    assert.ok(mine.length > 300, "its rules stand with the sheet's");
    assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, "no raw colour");
    assert.doesNotMatch(mine, /font-size:\s*\d/, "no size of its own: the scale's");
    assert.match(mine, /\.srw-field \{[^}]*flex: 1;[^}]*min-width: 0;[^}]*white-space: nowrap;[^}]*overflow-x: auto;/, "one line, scrolled inside its field");
    assert.match(mine, /\.srw-copy \{[^}]*flex: none;/, "Copy stays in sight");
    assert.match(mine, /\.srs-as-ic \{[^}]*color: var\(--color-sys-orange-text\);/, "the amber of what is yours to weigh");
    assert.match(mine, /\.srs-text \{[^}]*font-family: var\(--mono\);[^}]*max-height: [^;]+;[^}]*overflow: auto;/, "a file's text: monospace, scrolled in its fold");
    // Seen in the page (11-11): the address part is a column of the sheet's wrapping row, and a column that wraps is as
    // wide as its widest field — the example's line pushed both Copy buttons out of the sheet.
    assert.match(css, /\n\.srw \{[^}]*flex-direction: column;[^}]*flex-wrap: nowrap;[^}]*align-items: stretch;/, "its column is the sheet's width, whatever a field holds");
    // The sheet's foot: its note takes what is left and wraps, never its buttons' words ("Ask for a / change…").
    assert.match(css, /\n\.sdb-keep-foot > button \{[^}]*flex: none;[^}]*white-space: nowrap;/, "the foot's buttons keep one line");
    // What stops its program, or runs unapproved, reads as the warning it is: in the amber, not the note's grey.
    assert.match(mine, /\.sdb-keep-note\.srs-unkept, \.sdb-keep-note\.srs-differs \{[^}]*color: var\(--color-sys-orange-text\);/, "the amber of what stops it");
  });
});
