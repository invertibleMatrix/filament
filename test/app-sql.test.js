// @ts-check
// One SQLite database per app (the Space Apps plan of 10-29): what a page's SQL may be and reach (core/app-sql.js), and
// the process apart it runs in (services/app-sql.js), ended at a statement's time while Filament's own goes on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants } from "node:sqlite";
import http from "node:http";
import { SQL_REACH, SQL_ROWS_MAX, SQL_TOO_BIG, SQL_WAITING_MAX, aloneIn, sizeOut, sqlFailure, sqlMay, sqlRefusal, valueOut } from "../src/core/app-sql.js";
import { createAppSql, sqlEnvOf } from "../src/services/app-sql.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { artifactNameOfHost } from "../src/core/artifacts.js";

const C = /** @type {any} */ (constants);

describe("an app's SQL, as its page sends it", () => {
  // (fails before: yes — an app had no database of its own)
  test("a statement given whole, one at a time, with values; a VACUUM refused before SQLite reads it", () => {
    assert.equal(sqlRefusal("", undefined), "Give the statement to run: { sql, params }.");
    assert.equal(sqlRefusal("-- only a comment\n", undefined), "Give the statement to run: { sql, params }.");
    assert.equal(sqlRefusal("SELECT ?", [1, "a", null, true]), null);
    assert.equal(sqlRefusal("SELECT :a", { a: 1 }), null);
    assert.equal(sqlRefusal("SELECT ?", [{ x: 1 }]), "Each value is text, a number, true or false, or null.");
    assert.equal(sqlRefusal("SELECT ?", "1"), "params is a list of values, or an object of them by name.");
    assert.match(String(sqlRefusal("x".repeat(100_001), undefined)), /^A statement is 100,000 characters at most/);
    assert.equal(sqlRefusal("/* c */ VACUUM INTO 'C:/elsewhere/copy.db'", undefined), `Not run: ${SQL_REACH}.`);
    // (fails before: yes — found reviewing it: a plain VACUUM was let through, and failed in SQLite's own words, as its
    // copy is made by attaching it)
    assert.equal(sqlRefusal("VACUUM", undefined), `Not run: ${SQL_REACH}.`);
    assert.match(SQL_REACH, /no VACUUM,/);
    assert.deepEqual([aloneIn("SELECT 1; ", "SELECT 1;"), aloneIn("SELECT 1; -- done\n", "SELECT 1;"), aloneIn("SELECT 1; DROP TABLE t", "SELECT 1;")], [true, true, false]);
  });

  test("what it reaches: no other database, no extension, a PRAGMA that reads a table's shape; its values as the page reads them", () => {
    assert.deepEqual([sqlMay(C.SQLITE_ATTACH, "x.db", null, C), sqlMay(C.SQLITE_DETACH, "o", null, C)], [false, false]);
    assert.deepEqual([sqlMay(C.SQLITE_PRAGMA, "table_info", "t", C), sqlMay(C.SQLITE_PRAGMA, "journal_mode", "WAL", C), sqlMay(C.SQLITE_PRAGMA, "user_version", "3", C), sqlMay(C.SQLITE_PRAGMA, "user_version", null, C)], [true, false, true, true]);
    assert.deepEqual([sqlMay(C.SQLITE_FUNCTION, null, "load_extension", C), sqlMay(C.SQLITE_FUNCTION, null, "count", C), sqlMay(C.SQLITE_INSERT, "t", null, C)], [false, true, true]);
    assert.deepEqual([valueOut(5n), valueOut(2n ** 60n), valueOut(new Uint8Array([1, 2])), valueOut(undefined), valueOut("a")], [5, "1152921504606846976", { blob: "AQI=" }, null, "a"]);
    assert.equal(sqlFailure("not authorized", 1024), `Not run: ${SQL_REACH}.`);
    // (fails before: yes — found reviewing it: a VACUUM's attach is refused in these words, said as they came, and a
    // control character's six JSON characters were counted as one)
    assert.equal(sqlFailure("authorization denied", 1024), `Not run: ${SQL_REACH}.`);
    assert.deepEqual([sizeOut("\u0001"), sizeOut("ab")], [8, 4]);
    // (fails before: yes — found reviewing it again: characters were counted, not bytes, so text of emoji passed at twice its most)
    assert.equal(sizeOut("😀"), 6);
    assert.equal(sqlFailure("database or disk is full", 64), "Not kept: its database is at its cap of 64 MB.");
    assert.equal(sqlFailure("no such table: x", 1), "Not run: no such table: x.");
  });
});

describe("an app's database, in its process apart", () => {
  /** @param {Parameters<typeof createAppSql>[0] extends infer O ? Partial<O> : never} [o] */
  const world = (o = {}) => {
    const dataDir = mkdtempSync(join(tmpdir(), "filament-app-sql-"));
    const sql = createAppSql({ dataDir, ...o });
    return { dataDir, sql, done: async () => (await sql.stop(), rmSync(dataDir, { recursive: true, force: true })) };
  };

  // (fails before: yes — an app had no database of its own)
  test("its own file: tables made, rows written with values and read back with their columns; another app's apart; forgotten with it", async () => {
    const w = world();
    try {
      assert.deepEqual(await w.sql.run("pipe-ab12", "CREATE TABLE runs (id INTEGER PRIMARY KEY, title TEXT, n INTEGER, data BLOB)"), { ok: true, rows: [], columns: [], changes: 0, lastId: null, more: false });
      assert.deepEqual(await w.sql.run("pipe-ab12", "INSERT INTO runs (title, n) VALUES (?, ?)", ["build", 3]), { ok: true, rows: [], columns: [], changes: 1, lastId: 1, more: false });
      // (fails before: yes — found driving it: a statement that changed no row said the last INSERT's count and id)
      assert.deepEqual(await w.sql.run("pipe-ab12", "CREATE INDEX runs_n ON runs (n)"), { ok: true, rows: [], columns: [], changes: 0, lastId: null, more: false });
      assert.deepEqual(await w.sql.run("pipe-ab12", "UPDATE runs SET n = 0 WHERE title = 'none'"), { ok: true, rows: [], columns: [], changes: 0, lastId: null, more: false });
      assert.equal((await w.sql.run("pipe-ab12", "INSERT INTO runs (title, n, data) VALUES (:t, :n, x'0102')", { t: "test", n: 2 ** 60 })).ok, true);
      const got = await w.sql.run("pipe-ab12", "SELECT title, n, data FROM runs ORDER BY id");
      assert.deepEqual(got, { ok: true, rows: [{ title: "build", n: 3, data: null }, { title: "test", n: "1152921504606846976", data: { blob: "AQI=" } }], columns: ["title", "n", "data"], changes: 0, lastId: null, more: false });
      assert.deepEqual(await w.sql.run("pipe-ab12", "SELECT count(*) AS n FROM runs -- the count\n"), { ok: true, rows: [{ n: 2 }], columns: ["n"], changes: 0, lastId: null, more: false });
      assert.deepEqual(await w.sql.run("other-cd34", "SELECT * FROM runs"), { ok: false, error: "Not run: no such table: runs." }, "another app's database is its own");
      assert.ok(existsSync(w.sql.fileOf("pipe-ab12")));
      // (fails before: yes — found reviewing it again: what SQLite keeps aside, a temporary table past its memory, went to
      // the computer's own temporary folder, not the app's)
      const tmp = join(w.dataDir, "app-sql", "pipe-ab12.tmp");
      assert.equal((await w.sql.run("pipe-ab12", "CREATE TEMP TABLE big AS WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 2000) SELECT randomblob(4000) AS b FROM c")).ok, true);
      if (process.platform === "win32") assert.ok(readdirSync(tmp).length > 0, "SQLite's own temporary file is in the app's folder");
      const env = sqlEnvOf(tmp);
      assert.deepEqual([env.TEMP, env.TMP, env.TMPDIR, env.SQLITE_TMPDIR, env.ELECTRON_RUN_AS_NODE], [tmp, tmp, tmp, tmp, "1"]);
      assert.deepEqual(Object.keys(env).filter((k) => !["TEMP", "TMP", "TMPDIR", "SQLITE_TMPDIR", "ELECTRON_RUN_AS_NODE", "SystemRoot", "SYSTEMROOT"].includes(k)), [], "nothing else of Filament's environment");
      // (fails before: yes — found reviewing it again: a statement sent as its app's deletion began ran after it, and made
      // its database again)
      const [, late] = await Promise.all([w.sql.drop("pipe-ab12"), w.sql.run("pipe-ab12", "CREATE TABLE again (x)")]);
      assert.deepEqual(late, { ok: false, error: "Not run: the app was deleted." });
      assert.deepEqual([existsSync(w.sql.fileOf("pipe-ab12")), existsSync(tmp)], [false, false]);
      assert.deepEqual(await w.sql.run("pipe-ab12", "SELECT * FROM runs"), { ok: false, error: "Not run: no such table: runs." }, "forgotten");
      assert.deepEqual(await w.sql.run("../x", "SELECT 1"), { ok: false, error: "No app is named ../x." });
    } finally {
      await w.done();
    }
  });

  // (fails before: yes — the same)
  test("what its SQL reaches: one statement, its own file — no ATTACH, no copy elsewhere, no PRAGMA that changes it, no extension; rows past the most said", async () => {
    const w = world();
    const elsewhere = join(w.dataDir, "elsewhere.db");
    try {
      await w.sql.run("pipe-ab12", "CREATE TABLE t (x)");
      assert.deepEqual(await w.sql.run("pipe-ab12", "INSERT INTO t VALUES (1); DROP TABLE t"), { ok: false, error: "Not run: one statement at a time — send the next one by itself." });
      assert.deepEqual((await w.sql.run("pipe-ab12", "SELECT count(*) AS n FROM t")).ok && (await w.sql.run("pipe-ab12", "SELECT count(*) AS n FROM t")), { ok: true, rows: [{ n: 0 }], columns: ["n"], changes: 0, lastId: null, more: false }, "nothing of it ran");
      for (const q of [`ATTACH DATABASE '${elsewhere}' AS o`, `VACUUM INTO '${elsewhere}'`, "VACUUM", "; VACUUM", "PRAGMA journal_mode=DELETE", "PRAGMA writable_schema=ON", "SELECT load_extension('x')"])
        assert.deepEqual(await w.sql.run("pipe-ab12", q), { ok: false, error: `Not run: ${SQL_REACH}.` }, q);
      assert.equal(existsSync(elsewhere), false, "no file written elsewhere");
      // (fails before: yes — found reviewing it: true and false were refused by SQLite, which binds neither)
      assert.deepEqual((await w.sql.run("pipe-ab12", "SELECT ? AS a, ? AS b", [true, false])).ok && (await w.sql.run("pipe-ab12", "SELECT ? AS a, ? AS b", [true, false])), { ok: true, rows: [{ a: 1, b: 0 }], columns: ["a", "b"], changes: 0, lastId: null, more: false });
      assert.deepEqual(/** @type {any} */ (await w.sql.run("pipe-ab12", "SELECT :t AS t", { t: true })).rows, [{ t: 1 }]);
      assert.deepEqual((await w.sql.run("pipe-ab12", "PRAGMA table_info(t)")).ok, true);
      await w.sql.run("pipe-ab12", `INSERT INTO t WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < ${SQL_ROWS_MAX + 3}) SELECT i FROM c`);
      const many = /** @type {any} */ (await w.sql.run("pipe-ab12", "SELECT x FROM t"));
      assert.deepEqual([many.rows.length, many.more, many.rows.at(-1)], [SQL_ROWS_MAX, true, { x: SQL_ROWS_MAX }]);
      // (fails before: yes — found reviewing it: one huge value went whole through Filament's own process, and a page that
      // sent without waiting was held without end)
      assert.deepEqual(await w.sql.run("pipe-ab12", "SELECT randomblob(20000000) AS b"), { ok: false, error: SQL_TOO_BIG });
      const all = await Promise.all(Array.from({ length: SQL_WAITING_MAX + 10 }, () => w.sql.run("pipe-ab12", "SELECT 1 AS one")));
      assert.deepEqual([all.filter((a) => a.ok).length, all.filter((a) => !a.ok && a.error === `Not run: ${SQL_WAITING_MAX} statements wait their turn already. Await each before sending the next.`).length], [SQL_WAITING_MAX, 10]);
      assert.equal((await w.sql.run("pipe-ab12", "SELECT 1 AS one")).ok, true, "and once they ran, the next");
    } finally {
      await w.done();
    }
  });

  // (fails before: yes — measured on Node 24: a worker thread ended mid-query kept running, and held its process's exit)
  test("a statement that runs past its time is stopped with its process, Filament's own and another app's going on; the next one runs on a new process, its data kept; a full database refused", async () => {
    const w = world({ timeoutMs: 1000, maxMb: 1 });
    const forever = "WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c) SELECT count(*) FROM c";
    const STOPPED = { ok: false, error: "Stopped: it ran past 1 s, an app's statement's time. A query over many rows wants an index, or a LIMIT." };
    try {
      await w.sql.run("pipe-ab12", "CREATE TABLE t (x)");
      await w.sql.run("pipe-ab12", "INSERT INTO t VALUES ('kept')");
      for (const app of ["other-cd34", "gone-ef56"]) await w.sql.run(app, "CREATE TABLE t (x)");
      let ticks = 0;
      const tick = setInterval(() => ticks++, 20);
      const t0 = Date.now();
      /** @type {string[]} */
      const order = [];
      // (fails before: yes — found reviewing it: every app's statements shared one process, so one app's runaway held
      // another's, and its stop ended theirs; and an app deleted as its statement ran kept its files)
      const [stopped, other, goneStopped] = await Promise.all([
        w.sql.run("pipe-ab12", forever).then((a) => (order.push("pipe"), a)),
        w.sql.run("other-cd34", "INSERT INTO t VALUES (1)").then((a) => (order.push("other"), a)),
        w.sql.run("gone-ef56", forever),
        w.sql.drop("gone-ef56"),
      ]);
      clearInterval(tick);
      assert.deepEqual(stopped, STOPPED);
      assert.ok(Date.now() - t0 < 4000, `stopped at its time (${Date.now() - t0} ms)`);
      assert.ok(ticks >= 10, `Filament's own went on meanwhile (${ticks} ticks)`);
      assert.deepEqual([other.ok, order[0]], [true, "other"], "another app's statement ran meanwhile");
      assert.deepEqual(/** @type {any} */ (await w.sql.run("other-cd34", "SELECT count(*) AS n FROM t")).rows, [{ n: 1 }]);
      assert.deepEqual(goneStopped, STOPPED);
      assert.deepEqual(["", "-wal", "-shm"].map((end) => existsSync(`${w.sql.fileOf("gone-ef56")}${end}`)), [false, false, false], "a deleted app's files go once its statement stopped");
      assert.deepEqual(await w.sql.run("pipe-ab12", "SELECT x FROM t"), { ok: true, rows: [{ x: "kept" }], columns: ["x"], changes: 0, lastId: null, more: false });
      assert.deepEqual(await w.sql.run("pipe-ab12", "INSERT INTO t VALUES (randomblob(2000000))"), { ok: false, error: "Not kept: its database is at its cap of 1 MB." });
      // (fails before: yes — found reviewing it: a temporary table had no cap, and could fill the disk)
      assert.deepEqual(await w.sql.run("pipe-ab12", "CREATE TEMP TABLE big AS SELECT randomblob(2000000) AS b"), { ok: false, error: "Not kept: its database is at its cap of 1 MB." });
      // (fails before: yes — found reviewing it: a statement after Filament began to stop started a process again)
      await w.sql.stop();
      assert.deepEqual(await w.sql.run("pipe-ab12", "SELECT 1"), { ok: false, error: "Not run: Filament is stopping." });
    } finally {
      await w.done();
    }
  });
});

describe("an app's database at its own address", () => {
  // (fails before: yes — an app's address had no /_filament/sql)
  test("its own page runs a statement and reads its rows; another origin, a page that is no app, a GET each refused in words", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "filament-app-sql-http-"));
    const store = createArtifactStore({ dataDir });
    const sql = createAppSql({ dataDir });
    const by = { chain: "c1", model: "m-1", folder: "/work", helper: null };
    const publish = (/** @type {any} */ input) => /** @type {any} */ (artifactCall({ action: "publish", ...input }, { who: "c1", by, within: [], port: 20300, maxBytes: 1_000_000 }, store)).event.name;
    const app = publish({ type: "app", title: "Pipe", html: "<main></main>", sources: { runs: { command: ["node", "-e", "1"], key: "id" } } });
    const page = publish({ type: "page", title: "Plain", html: "<p>x</p>" });
    /** @type {number} */
    let port = 0;
    // Its store as the handler reads it, told when a name is read: a statement's request is in once its app was.
    /** @type {((name: string) => void) | null} */
    let onRead = null;
    const watched = Object.assign(Object.create(store), { get: (/** @type {string} */ n) => (onRead?.(n), store.get(n)) });
    const answer = createArtifactsHandler({ store: watched, server: () => ({ host: "127.0.0.1", allowedHosts: [], maxBodyBytes: 10_000_000 }), port: () => port, sql });
    const srv = http.createServer((req, res) => {
      const name = artifactNameOfHost(String(req.headers.host || "").replace(/:\d+$/, "")) ?? "";
      Promise.resolve(answer(req, res, name, new URL(String(req.url), "http://x"))).catch((e) => res.writeHead(500).end(String(e)));
    });
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(null)));
    port = /** @type {any} */ (srv.address()).port;
    /** @param {string} name @param {{ method?: string, origin?: string, body?: any }} [o] @returns {Promise<{ status: number, json: any }>} */
    const ask = (name, { method = "POST", origin = `http://${name}.art.localhost:${port}`, body } = {}) =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/_filament/sql", method, headers: { host: `${name}.art.localhost:${port}`, origin, "content-type": "application/json" } }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (d) => (text += d));
          res.on("end", () => resolve({ status: res.statusCode || 0, json: JSON.parse(text) }));
        });
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    try {
      assert.deepEqual(await ask(app, { body: { sql: "CREATE TABLE runs (title TEXT)" } }), { status: 200, json: { rows: [], columns: [], changes: 0, lastId: null, more: false } });
      assert.equal((await ask(app, { body: { sql: "INSERT INTO runs VALUES (?)", params: ["build"] } })).json.changes, 1);
      assert.deepEqual(await ask(app, { body: { sql: "SELECT title FROM runs" } }), { status: 200, json: { rows: [{ title: "build" }], columns: ["title"], changes: 0, lastId: null, more: false } });
      assert.deepEqual(await ask(app, { body: { sql: "SELECT * FROM nope" } }), { status: 400, json: { error: "Not run: no such table: nope." } });
      assert.deepEqual(await ask(app, { origin: `http://${page}.art.localhost:${port}`, body: { sql: "DROP TABLE runs" } }), { status: 403, json: { error: "Only the app's own page runs its SQL." } });
      assert.deepEqual(await ask(page, { body: { sql: "SELECT 1" } }), { status: 404, json: { error: "Plain has no database: an app has one." } });
      assert.deepEqual(await ask(app, { method: "GET" }), { status: 405, json: { error: "A statement is sent by POST: { sql, params }." } });
      assert.equal((await ask(app, { body: { sql: "SELECT count(*) AS n FROM runs" } })).json.rows[0].n, 1, "the refused DROP ran nothing");
      // (fails before: yes — found reviewing it: a statement's request was taken up to Filament's own most, and fifty of
      // them could wait in memory; and an app deleted while its statement came in ran it all the same)
      assert.deepEqual(await ask(app, { body: { sql: "SELECT ?", params: ["x".repeat(1_100_000)] } }), { status: 413, json: { error: "A statement and its values are 1 MB at most: send big data in several." } });
      const late = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/_filament/sql", method: "POST", headers: { host: `${app}.art.localhost:${port}`, origin: `http://${app}.art.localhost:${port}`, "content-type": "application/json" } }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (d) => (text += d));
          res.on("end", () => resolve({ status: res.statusCode || 0, json: JSON.parse(text) }));
        });
        req.on("error", reject);
        onRead = (n) => {
          if (n !== app) return;
          onRead = null;
          // Its request is in, its body not yet whole: the app is deleted, then the rest of it comes.
          setImmediate(() => (store.remove(app), req.end(`"CREATE TABLE again (x)"}`)));
        };
        req.write(`{"sql":`);
      });
      assert.deepEqual(late, { status: 404, json: { error: "This app was deleted: it has no database now." } });
      assert.deepEqual(/** @type {any} */ (await sql.run(app, "SELECT name FROM sqlite_master WHERE name = 'again'")).rows, [], "it ran nothing");
      // (fails before: yes — found driving it: a deleted app's address said it had never had a database)
      assert.deepEqual(await ask(app, { body: { sql: "SELECT 1" } }), { status: 404, json: { error: "Pipe was deleted: it has no database now." } });
    } finally {
      srv.closeAllConnections();
      await new Promise((resolve) => srv.close(resolve));
      await sql.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
