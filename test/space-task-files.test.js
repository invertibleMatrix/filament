// @ts-check
// Files and pictures on a Space's tasks (the owner's of 11-02: "i should be able to attach files on any task … attach
// files and pictures in the task to store information that i want"): a file's name and kind (core/space.js,
// services/space-files.js), its bytes kept and swept (services/space-files.js), the task that holds it in the Space's
// file (services/spaces.js), and the routes the board attaches, reads and removes it through (http/admin/spaces.js).
// (fails before: yes — a task held words alone; no route took a file)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPACE_FILES, spaceFileName } from "../src/core/space.js";
import { SWEEP_AFTER_MS, createSpaceFiles, fileKindOf } from "../src/services/space-files.js";
import { SPACE_BACK_MS, createSpaceStore } from "../src/services/spaces.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const YOU = /** @type {const} */ ({ kind: "you" });
const temps = /** @type {string[]} */ ([]);
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "space-files-"));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
/** A file as a task holds it. @param {string} id @param {number} bytes */
const fileRow = (id, bytes = 10) => ({ id, name: `${id}.txt`, kind: /** @type {const} */ ("text"), type: "text/plain; charset=utf-8", bytes, at: 1 });
/** @param {() => any} fn */
const refusalOf = (fn) => {
  try {
    fn();
  } catch (/** @type {any} */ e) {
    return [e.status, e.message];
  }
  assert.fail("refused");
};

describe("a task's file: its name and its kind", () => {
  test("a name as a task shows it: its last part, one line, no control characters, 120 at most, never empty", () => {
    assert.equal(spaceFileName("C:\\Users\\me\\Desktop\\shot 1.png"), "shot 1.png");
    assert.equal(spaceFileName("../../etc/passwd"), "passwd");
    assert.equal(spaceFileName("a\u0000b\nc\td.txt"), "a b c d.txt");
    assert.equal(spaceFileName(`${"x".repeat(200)}.md`).length, 120);
    assert.equal(spaceFileName(""), "file");
    assert.equal(spaceFileName("dir/"), "file");
    assert.equal(spaceFileName(null), "file");
  });
  test("its kind by its first bytes: a picture a page shows, a PDF, UTF-8 text, else a file — never by its name", () => {
    assert.deepEqual(fileKindOf(PNG), { kind: "image", type: "image/png" });
    assert.deepEqual(fileKindOf(Buffer.from("%PDF-1.7\n...")), { kind: "pdf", type: "application/pdf" });
    assert.deepEqual(fileKindOf(Buffer.from("# Notes\nnaïve café ✓\n")), { kind: "text", type: "text/plain; charset=utf-8" });
    assert.deepEqual(fileKindOf(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 1])), { kind: "file", type: "application/octet-stream" }, "a zip: a zero byte");
    assert.deepEqual(fileKindOf(Buffer.from([0x61, 0xff, 0xfe, 0x62])), { kind: "file", type: "application/octet-stream" }, "no UTF-8");
    assert.deepEqual(fileKindOf(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")).kind, "text", "an SVG is text, never a picture shown");
  });
});

describe("the files' bytes on disk", () => {
  test("kept whole under a new id, found by it, forgotten; nothing kept where it has no folder or the project is none", () => {
    const dir = temp();
    const files = createSpaceFiles({ dir });
    const id = /** @type {string} */ (files.keep("p1", PNG));
    assert.match(id, /^f[0-9a-f]{16}$/);
    assert.notEqual(files.keep("p1", PNG), id, "each its own id");
    assert.equal(files.pathOf("p1", id), join(dir, "p1", id));
    assert.deepEqual(readdirSync(join(dir, "p1")).filter((n) => n.endsWith(".tmp")), [], "no temporary file left");
    assert.equal(files.pathOf("p1", "../p1"), null, "an id that is none of the store's");
    assert.equal(files.pathOf("p2", id), null, "another project's");
    files.forget("p1", [id, "../../x"]);
    assert.equal(files.pathOf("p1", id), null);
    const off = createSpaceFiles({ dir: null });
    assert.equal(off.on, false);
    assert.equal(off.keep("p1", PNG), null);
    assert.equal(files.keep("../up", PNG), null);
  });
  test("a sweep takes what no Space holds, an hour old at least, and a folder left empty; a project it cannot read is left whole", () => {
    const dir = temp();
    let at = Date.now();
    const files = createSpaceFiles({ dir, now: () => at });
    const kept = /** @type {string} */ (files.keep("p1", PNG));
    const gone = /** @type {string} */ (files.keep("p1", PNG));
    const young = /** @type {string} */ (files.keep("p1", PNG));
    const other = /** @type {string} */ (files.keep("p2", PNG));
    const old = (at - SWEEP_AFTER_MS - 1000) / 1000;
    for (const [p, id] of [["p1", kept], ["p1", gone], ["p2", other]]) utimesSync(join(dir, p, id), old, old);
    /** @type {Record<string, Set<string> | Error>} */
    const held = { p1: new Set([kept]), p2: new Set() };
    assert.equal(files.sweep((p) => {
      const h = held[p];
      if (h instanceof Error) throw h;
      return h;
    }), 2);
    assert.deepEqual([files.pathOf("p1", kept) !== null, files.pathOf("p1", gone), files.pathOf("p1", young) !== null], [true, null, true], "held and young stay");
    assert.equal(existsSync(join(dir, "p2")), false, "a folder left empty goes");
    const third = /** @type {string} */ (files.keep("p1", PNG));
    utimesSync(join(dir, "p1", third), old, old);
    held.p1 = new Error("a deleted Space's file would not read");
    assert.equal(files.sweep(() => { throw held.p1; }), 0);
    assert.notEqual(files.pathOf("p1", third), null, "nothing goes where what is held could not be read");
  });
});

describe("the task that holds them", () => {
  test("attached, counted against a task's 20 and the Space's 500 MB, taken off — the field gone with the last —, removed with its task", () => {
    const store = createSpaceStore({ dir: null });
    const t = store.addTask("p1", { title: "Logo" }, YOU);
    for (let i = 0; i < SPACE_FILES.files; i++) store.taskFileAdd("p1", t.id, fileRow(`f${String(i).padStart(16, "0")}`));
    assert.match(refusalOf(() => store.taskFileAdd("p1", t.id, fileRow("faaaaaaaaaaaaaaaa")))[1], /holds 20 files already/);
    const u = store.addTask("p1", { title: "Big" }, YOU);
    assert.deepEqual(refusalOf(() => store.taskFileAdd("p1", u.id, fileRow("fbbbbbbbbbbbbbbbb", SPACE_FILES.spaceBytes))), [409, "This Space keeps 500 MB of files at most: remove some first."]);
    assert.deepEqual(store.taskFileRemove("p1", t.id, "f0000000000000000").id, "f0000000000000000");
    assert.equal(store.get("p1").tasks.find((x) => x.id === t.id)?.files?.length, 19);
    assert.deepEqual(refusalOf(() => store.taskFileRemove("p1", t.id, "f0000000000000000")), [404, "“Logo” holds no such file."]);
    store.taskFileAdd("p1", u.id, fileRow("fcccccccccccccccc"));
    store.taskFileRemove("p1", u.id, "fcccccccccccccccc");
    assert.equal("files" in /** @type {any} */ (store.get("p1").tasks.find((x) => x.id === u.id)), false, "no files: no field");
    assert.equal(store.removeTask("p1", t.id).files?.length, 19, "the task removed, its files for the caller to forget");
  });
  test("kept in the Space's file and read back; held while the Space is, and while a deleted one may come back — then not", () => {
    const dir = temp();
    let at = Date.now();
    const store = createSpaceStore({ dir, now: () => at, madeOnly: true });
    store.make("p1");
    const t = store.addTask("p1", { title: "Logo" }, YOU);
    store.taskFileAdd("p1", t.id, { id: "f1111111111111111", name: "logo.png", kind: "image", type: "image/png", bytes: 70, at });
    const again = createSpaceStore({ dir, now: () => at, madeOnly: true });
    assert.deepEqual(again.get("p1").tasks[0].files, [{ id: "f1111111111111111", name: "logo.png", kind: "image", type: "image/png", bytes: 70, at }]);
    assert.deepEqual([...again.filesHeld("p1")], ["f1111111111111111"]);
    again.remove("p1");
    assert.deepEqual([...again.filesHeld("p1")], ["f1111111111111111"], "a deleted Space may come back with them");
    at += SPACE_BACK_MS + 1000;
    assert.deepEqual([...again.filesHeld("p1")], [], "past its 30 days");
    assert.deepEqual([...again.filesHeld("p9")], [], "a project with no Space holds none");
  });
});

describe("the routes the board uses", () => {
  /**
   * A route called as the admin handler calls it. @param {any[]} rows @param {string} method @param {string} path
   * @param {{ json?: any }} [o]
   */
  async function call(rows, method, path, o = {}) {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, headers: /** @type {any} */ ({}), body: /** @type {any} */ (null), raw: /** @type {any} */ (null) };
    const res = {
      headersSent: false,
      writeHead: (/** @type {number} */ s, /** @type {any} */ h) => Object.assign(got, { status: s, headers: h }),
      end: (/** @type {any} */ b) => {
        got.raw = b;
        try {
          got.body = JSON.parse(String(b));
        } catch {}
      },
    };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => o.json }, {});
    return got;
  }
  /** The routes over a store in memory, its files in a folder, a project p1 the archive knows. @param {{ files?: boolean }} [o] */
  const routesOf = (o = {}) => {
    const store = createSpaceStore({ dir: null });
    const dir = temp();
    const files = createSpaceFiles({ dir });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "filament", cwd: "/r" } : null) } },
      spaces: store,
      spaceFiles: o.files === false ? null : files,
    });
    return { rows, store, files, dir };
  };

  test("attach: its bytes kept, its kind read from them, the task and the Space answered; refused in words where it cannot be", async () => {
    const { rows, store, files } = routesOf();
    const t = store.addTask("p1", { title: "Logo" }, YOU);
    const got = await call(rows, "POST", `/space/p1/tasks/${t.id}/files`, { json: { name: "C:\\shots\\logo.png", data: PNG.toString("base64") } });
    assert.equal(got.status, 200);
    const f = got.body.file;
    assert.deepEqual([f.name, f.kind, f.type, f.bytes], ["logo.png", "image", "image/png", PNG.length]);
    assert.deepEqual(got.body.task.files, [f]);
    assert.deepEqual(got.body.space.tasks[0].files, [f], "the Space as it stands, for the board");
    assert.notEqual(files.pathOf("p1", f.id), null);
    assert.deepEqual((await call(rows, "POST", `/space/p1/tasks/${t.id}/files`, { json: { name: "x" } })).body, { error: "data is the file, in base64" });
    assert.deepEqual((await call(rows, "POST", `/space/p1/tasks/t99/files`, { json: { name: "x", data: "eA==" } })).body, { error: "no such task" });
    assert.equal((await call(rows, "POST", `/space/p9/tasks/${t.id}/files`, { json: { name: "x", data: "eA==" } })).status, 404, "no such project");
    assert.deepEqual((await call(routesOf({ files: false }).rows, "POST", `/space/p1/tasks/${t.id}/files`, { json: { name: "x", data: "eA==" } })).body, { error: "this Filament keeps no files on tasks" });
  });

  test("a refusal of the task's keeps no bytes behind", async () => {
    const { rows, store, dir } = routesOf();
    const t = store.addTask("p1", { title: "Full" }, YOU);
    for (let i = 0; i < SPACE_FILES.files; i++) store.taskFileAdd("p1", t.id, fileRow(`f${String(i).padStart(16, "0")}`));
    const got = await call(rows, "POST", `/space/p1/tasks/${t.id}/files`, { json: { name: "one.txt", data: Buffer.from("one more").toString("base64") } });
    assert.equal(got.status, 409);
    assert.deepEqual(readdirSync(join(dir, "p1")), [], "its bytes forgotten");
  });

  test("read: a picture shown and text as text — never sniffed, never run on the page's address —, any other kind downloaded", async () => {
    const { rows, store } = routesOf();
    const t = store.addTask("p1", { title: "Docs" }, YOU);
    const add = async (/** @type {string} */ name, /** @type {Buffer} */ data) => (await call(rows, "POST", `/space/p1/tasks/${t.id}/files`, { json: { name, data: data.toString("base64") } })).body.file;
    const pic = await add("logo.png", PNG);
    const zip = await add("räport \"q1\".zip", Buffer.from([0x50, 0x4b, 3, 4, 0, 0]));
    const svg = await add("x.svg", Buffer.from("<svg><script>alert(1)</script></svg>"));
    let got = await call(rows, "GET", `/space/p1/tasks/${t.id}/files/${pic.id}`);
    assert.equal(got.status, 200);
    assert.ok(Buffer.from(got.raw).equals(PNG));
    assert.deepEqual([got.headers["content-type"], got.headers["x-content-type-options"], got.headers["content-security-policy"], got.headers["content-disposition"]], ["image/png", "nosniff", "sandbox", undefined]);
    got = await call(rows, "GET", `/space/p1/tasks/${t.id}/files/${svg.id}`);
    assert.deepEqual([got.headers["content-type"], got.headers["content-disposition"]], ["text/plain; charset=utf-8", undefined], "an SVG read as text");
    got = await call(rows, "GET", `/space/p1/tasks/${t.id}/files/${zip.id}`);
    assert.equal(got.headers["content-type"], "application/octet-stream");
    assert.equal(got.headers["content-disposition"], `attachment; filename="r_port _q1_.zip"; filename*=UTF-8''r%C3%A4port%20%22q1%22.zip`);
    assert.equal((await call(rows, "GET", `/space/p1/tasks/t99/files/${pic.id}`)).status, 404, "another task's id names none of this one's");
  });

  test("taken off a task, and gone with the task removed: their bytes with them", async () => {
    const { rows, store, files } = routesOf();
    const t = store.addTask("p1", { title: "Logo" }, YOU);
    const add = async () => (await call(rows, "POST", `/space/p1/tasks/${t.id}/files`, { json: { name: "logo.png", data: PNG.toString("base64") } })).body.file;
    const a = await add();
    const b = await add();
    const got = await call(rows, "DELETE", `/space/p1/tasks/${t.id}/files/${a.id}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.space.tasks[0].files.map((/** @type {any} */ f) => f.id), [b.id]);
    assert.equal(files.pathOf("p1", a.id), null);
    assert.equal((await call(rows, "DELETE", `/space/p1/tasks/${t.id}/files/${a.id}`)).status, 404);
    assert.equal((await call(rows, "DELETE", `/space/p1/tasks/${t.id}`)).status, 200);
    assert.equal(files.pathOf("p1", b.id), null);
  });
});

test("the board's file routes are in the admin API", () => {
  const rows = spaceRoutes({}).map(([m, p]) => `${m} ${p}`);
  for (const r of ["POST /space/:project/tasks/:id/files", "GET /space/:project/tasks/:id/files/:file", "DELETE /space/:project/tasks/:id/files/:file"]) assert.ok(rows.includes(r), r);
});

// (fails before: yes — a Hunter's of 11-02: a task's files went to a chat's box all or none, so one the board could not
// read — swept, or gone from the disk — kept every other out of the box)
test("a task's files read for a chat's box: one that cannot be read is said, the rest go all the same", async () => {
  const { readTaskFiles } = await import("../src/ui/harness/lib/space-view.js");
  const row = (/** @type {string} */ id, /** @type {string} */ name) => ({ id, name, kind: /** @type {const} */ ("image"), type: "image/png", bytes: PNG.length, at: 1 });
  /** @type {string[]} */
  const asked = [];
  const got = await readTaskFiles("p1", "t1", [row("fa", "a.png"), row("fb", "gone.png"), row("fc", "c.png")], async (url) => {
    asked.push(url);
    return url.endsWith("/fb") ? new Response("no such file", { status: 404 }) : new Response(PNG, { headers: { "content-type": "image/png" } });
  });
  assert.deepEqual(asked, ["/api/space/p1/tasks/t1/files/fa", "/api/space/p1/tasks/t1/files/fb", "/api/space/p1/tasks/t1/files/fc"]);
  assert.deepEqual(got.files.map((f) => [f.name, f.type, f.size]), [["a.png", "image/png", PNG.length], ["c.png", "image/png", PNG.length]]);
  assert.deepEqual(got.failed, ["gone.png could not be read from the board (404)"]);
});
