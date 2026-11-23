// @ts-check
// What a machine tells another machine's desk (the remote desk of 11-22, s1c): its desk flags at GET /remote/me
// (`DESK`), and its chats' and projects' repositories' remotes' keys where a list asks (`?remotes=1`), read through one
// cache that reads each folder once, a few at a time, and keeps what it read (`remoteKeys`); the app's watch reads both.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { FOLDER_STATS_HUNG, remoteKeys, remoteRead } from "../src/adapters/git/inspect.js";
import { DESK, PAGES } from "../src/http/admin/remote.js";
import { REMOTES_WAIT_MS } from "../src/http/admin/memory.js";
import { CHATS_MS, createWatch, deskFlagsOf } from "../desktop/lib/watch.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** A fresh folder under the system's temp, as the filesystem spells it. @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

/** A promise and its resolve, for a read the test lets go of. */
const gate = () => {
  /** @type {(v?: any) => void} */
  let open = () => {};
  const p = new Promise((r) => (open = r));
  return { p, open };
};

describe("remoteKeys: each folder's remote's key, kept a while", () => {
  // (fails before: yes — the cache was the Space feed's own, one folder at a time, with no lanes nor wait)
  test("a folder's key, null for none; one git could not read, or a read that threw, none and kept for no while", async () => {
    /** @type {string[]} */
    const asked = [];
    /** @type {Record<string, any>} */
    const answers = {
      "/w/app": { remote: { name: "origin", url: "https://github.com/O/App.git" }, unread: false },
      "/w/none": { remote: null, unread: false },
      "/w/busy": { remote: null, unread: true },
    };
    const keys = remoteKeys({
      read: async (f) => {
        asked.push(f);
        if (f === "/w/throws") throw new Error("spawn EAGAIN");
        return answers[f];
      },
    });
    const got = await keys.of(["/w/app", "/w/none", "/w/busy", "/w/throws", "", "/w/app"]);
    assert.deepEqual([...got], [["/w/app", "github.com/o/app"], ["/w/none", null], ["/w/busy", undefined], ["/w/throws", undefined]], "each folder once; an empty one asked nothing");
    assert.deepEqual(asked.sort(), ["/w/app", "/w/busy", "/w/none", "/w/throws"]);
    asked.length = 0;
    await keys.of(["/w/app", "/w/none", "/w/busy", "/w/throws"]);
    assert.deepEqual(asked.sort(), ["/w/busy", "/w/throws"], "what it read kept; what it could not, read again");
  });

  test("kept `ttl`, then read again", async () => {
    let t = 1_000;
    let reads = 0;
    const keys = remoteKeys({ ttl: 5000, now: () => t, read: async () => (reads++, { remote: { name: "origin", url: "git@github.com:o/r.git" }, unread: false }) });
    assert.equal((await keys.of(["/w/r"])).get("/w/r"), "github.com/o/r");
    t += 4999;
    await keys.of(["/w/r"]);
    assert.equal(reads, 1, "kept");
    t += 1;
    await keys.of(["/w/r"]);
    assert.equal(reads, 2, "read again once it is `ttl` old");
  });

  // (fails before: yes — the review of s1c: a key past `ttl` was none while it was read again, so a desk's list came
  // apart every five minutes; and a read that threw at once left its folder read for ever)
  test("a key read again past `ttl` is its last while the read is under way; a read that throws at once lets its folder go", async () => {
    let t = 0;
    let url = "https://h/old";
    /** @type {ReturnType<typeof gate> | null} */
    let hold = null;
    const keys = remoteKeys({
      ttl: 1000,
      now: () => t,
      read: async () => {
        const u = url;
        if (hold) await hold.p;
        return { remote: { name: "origin", url: u }, unread: false };
      },
    });
    assert.equal((await keys.of(["/r"])).get("/r"), "h/old");
    t += 1000;
    url = "https://h/new";
    hold = gate();
    assert.equal((await keys.of(["/r"], { waitMs: 10 })).get("/r"), "h/old", "its last while it is read again");
    hold.open();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await keys.of(["/r"], { waitMs: 0 })).get("/r"), "h/new", "then the new one");

    let first = true;
    const sync = remoteKeys({
      read: /** @type {any} */ (
        () => {
          if (!first) return Promise.resolve({ remote: null, unread: false });
          first = false;
          throw new Error("spawn EMFILE");
        }
      ),
    });
    assert.equal((await sync.of(["/x"])).get("/x"), undefined);
    assert.equal((await sync.of(["/x"])).get("/x"), null, "read again at the next ask");
  });

  test("a folder read once however many ask at once; `lanes` read at a time, the rest waiting their turn", async () => {
    /** @type {Map<string, ReturnType<typeof gate>>} */
    const held = new Map();
    let now = 0;
    let most = 0;
    /** @type {string[]} */
    const asked = [];
    const keys = remoteKeys({
      lanes: 2,
      read: async (f) => {
        asked.push(f);
        most = Math.max(most, ++now);
        const g = gate();
        held.set(f, g);
        await g.p;
        now--;
        return { remote: { name: "origin", url: `https://h/${f.slice(1)}` }, unread: false };
      },
    });
    const one = keys.of(["/a", "/b", "/c", "/d"]);
    const two = keys.of(["/a", "/c"]);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(asked, ["/a", "/b"], "two lanes: two read, two wait");
    held.get("/a")?.open();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(asked, ["/a", "/b", "/c"], "a lane let go takes the next");
    for (const f of ["/b", "/c"]) held.get(f)?.open();
    await new Promise((r) => setImmediate(r));
    held.get("/d")?.open();
    const [a, b] = await Promise.all([one, two]);
    assert.deepEqual([...a.values()], ["h/a", "h/b", "h/c", "h/d"]);
    assert.deepEqual([...b], [["/a", "h/a"], ["/c", "h/c"]]);
    assert.deepEqual(asked, ["/a", "/b", "/c", "/d"], "each folder read once, the second ask waiting on the first's reads");
    assert.equal(most, 2);
  });

  test("`waitMs`: what is not read by then is said as not known, and kept for the next ask once it lands", async () => {
    const slow = gate();
    let reads = 0;
    const keys = remoteKeys({
      read: async (f) => {
        reads++;
        if (f === "/slow") await slow.p;
        return { remote: { name: "origin", url: `https://h${f}` }, unread: false };
      },
    });
    const got = await keys.of(["/quick", "/slow"], { waitMs: 20 });
    assert.deepEqual([...got], [["/quick", "h/quick"], ["/slow", undefined]], "the list goes without it");
    slow.open();
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual([...(await keys.of(["/quick", "/slow"], { waitMs: 0 }))], [["/quick", "h/quick"], ["/slow", "h/slow"]], "the next ask has it");
    assert.equal(reads, 2, "read once");
    assert.ok(REMOTES_WAIT_MS >= 500 && REMOTES_WAIT_MS <= 3000, "a list waits a moment, not a git's whole time");
  });

  // (fails before: yes — the review of s1c: a folder on a mount gone offline was looked for on the server's thread, which
  // waited as long as the share did, every request with it, at each desk's ask)
  test("a folder whose stat does not answer: unread within its wait and asked once however often it is read; past a few such, none is asked; the list goes without it", async () => {
    const share = gate();
    /** @type {string[]} */
    const asked = [];
    /** A stat on the share: it answers once the share does, that the folder is not there. @param {string} f */
    const offline = (f) => (asked.push(f), share.p.then(() => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))));
    const there = { ms: 50, statOf: offline };
    try {
      const t0 = Date.now();
      assert.deepEqual(await remoteRead("/offline/a", { there }), { remote: null, unread: true });
      assert.ok(Date.now() - t0 < 1000, `answered in ${Date.now() - t0} ms`);
      const t1 = Date.now();
      assert.deepEqual(await remoteRead("/offline/a", { there }), { remote: null, unread: true }, "read again while its stat is under way");
      assert.ok(Date.now() - t1 < 40, `at once, not after another wait: ${Date.now() - t1} ms`);
      assert.deepEqual(asked, ["/offline/a"], "asked once");
      // The desk's list: answered within its wait, the folder not known, kept for no while.
      const keys = remoteKeys({ read: (f) => remoteRead(f, { there }) });
      const t2 = Date.now();
      assert.equal((await keys.of(["/offline/b"], { waitMs: REMOTES_WAIT_MS })).get("/offline/b"), undefined);
      assert.ok(Date.now() - t2 < REMOTES_WAIT_MS, `the list answered in ${Date.now() - t2} ms`);
      // As many stats as hold threads now: another folder is not asked.
      assert.equal(FOLDER_STATS_HUNG, 2);
      assert.deepEqual(await remoteRead("/offline/c", { there }), { remote: null, unread: true });
      assert.deepEqual(asked, ["/offline/a", "/offline/b"], "a third is not asked while two hold threads");
    } finally {
      share.open();
    }
    // The share answers: its stats end, and a folder is asked again.
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await remoteRead("/offline/c", { there }), { remote: null, unread: false }, "not there, once the share says so");
    assert.deepEqual(asked, ["/offline/a", "/offline/b", "/offline/c"]);
  });
});

describe("the desk's flags and the app's watch", () => {
  // (fails before: yes — /remote/me said `pages` alone)
  test("DESK names what this Filament does for another machine's desk, `remote-key` first", () => {
    assert.ok(Object.isFrozen(DESK));
    assert.equal(DESK[0], "remote-key");
    for (const f of DESK) assert.match(f, /^[a-z][a-z0-9-]{0,39}$/, "each a name the desk reads (`deskFlagsOf`)");
    assert.deepEqual(deskFlagsOf({ desk: [...DESK] }), [...DESK]);
  });

  test("deskFlagsOf: names alone, each once, at most 32; none from a Filament from before", () => {
    assert.deepEqual(deskFlagsOf({ desk: ["remote-key", "ask-events", "remote-key", "Upper", "<b>x</b>", 7, null, "a".repeat(41), ""] }), ["remote-key", "ask-events"]);
    assert.deepEqual(deskFlagsOf({ who: "device", pages: ["new"] }), [], "one from before says none");
    assert.deepEqual(deskFlagsOf(null), []);
    assert.deepEqual(deskFlagsOf({ desk: "remote-key" }), [], "a list or nothing");
    assert.equal(deskFlagsOf({ desk: Array.from({ length: 50 }, (_, i) => `f${i}`) }).length, 32);
  });

  // (fails before: yes — the watch read no /remote/me, and asked no remotes' keys)
  test("the watch reads the machine's flags at its chats' pace, a failed read keeping the last, and asks its chats with their remotes' keys", async () => {
    let t = 5_000_000;
    /** @type {string[]} */
    const asked = [];
    /** @type {any} */
    let me = { who: "device", desk: ["remote-key"] };
    let down = false;
    const w = createWatch({
      now: () => t,
      call: async (p) => {
        asked.push(p);
        if (p === "/runs?limit=50") return { runs: [] };
        if (p.startsWith("/memory/sessions")) return { sessions: [{ id: "c1", title: "One", remoteKey: "github.com/o/r" }] };
        if (p === "/remote/me") {
          if (down) throw new Error("HTTP 502");
          return me;
        }
        return {};
      },
    });
    const first = /** @type {any} */ (await w.look());
    assert.deepEqual(first.flags, ["remote-key"]);
    assert.deepEqual(first.recent.map((/** @type {any} */ c) => c.remoteKey), ["github.com/o/r"]);
    assert.ok(asked.includes("/memory/sessions?limit=200&kind=interactive,fork,team&remotes=1"));
    const reads = () => asked.filter((p) => p === "/remote/me").length;
    me = { who: "device", desk: ["remote-key", "ask-events"] };
    t += 10_000;
    assert.deepEqual((/** @type {any} */ (await w.look())).flags, ["remote-key"], "read again at the chats' pace, not every look");
    assert.equal(reads(), 1);
    // (fails before: yes — the review of s1c: this step once followed a read of none, and could not tell)
    down = true;
    t += CHATS_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).flags, ["remote-key"], "a read that failed keeps the last");
    down = false;
    t += 1;
    assert.deepEqual((/** @type {any} */ (await w.look())).flags, ["remote-key", "ask-events"], "and is asked again at the next look");
    me = { who: "device" };
    t += CHATS_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).flags, [], "an older Filament there now: none");
  });
});

describe("a real Filament says its desk flags and its repositories' remotes", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let repo;
  /** @type {string} */
  let plain;
  before(async () => {
    const base = fresh("filament-desk-flags-");
    repo = join(base, "shop");
    mkdirSync(repo);
    git(repo, ["init", "-q"]);
    git(repo, ["remote", "add", "origin", "https://ci-bot:s3cret@GitHub.com/Owner/Shop.git"]);
    plain = join(base, "notes");
    mkdirSync(plain);
    up = await fakeUpstream(() => anthropicReply("Done.", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [base], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  /** A chat in a folder, as one of Filament's own calls makes it. @param {string} cwd @param {string} session */
  const chatIn = async (cwd, session) => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }, { "x-filament-cwd": cwd, "x-session-id": session });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await shim.record(r.headers.get("x-filament-request-id"))).memory.chain);
  };
  /**
   * A list's rows, asked again until `ok` holds of them (ten seconds at most): a key git read past REMOTES_WAIT_MS — a
   * slow machine's first reads — is said at a later ask, as the desk's next look has it.
   * @param {string} path @param {"sessions" | "projects"} key @param {(rows: any[]) => boolean} ok @returns {Promise<any[]>}
   */
  const listed = async (path, key, ok) => {
    /** @type {any[]} */
    let rows = [];
    for (let i = 0; i < 40; i++) {
      rows = (await (await shim.api(path)).json())[key] || [];
      if (ok(rows)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return rows;
  };

  // (fails before: yes — /remote/me said no desk flags)
  test("GET /api/remote/me lists its desk flags beside its pages", async () => {
    const me = await (await shim.api("/api/remote/me")).json();
    assert.deepEqual([me.who, me.pages, me.desk], ["local", [...PAGES], [...DESK]]);
  });

  // (fails before: yes — no list said a chat's repository)
  test("GET /api/memory/sessions?remotes=1: a git project's chats carry its remote's key, credentials and case gone; a folder with none, null; unasked, none", async () => {
    const inRepo = await chatIn(repo, "desk-shop");
    const inPlain = await chatIn(plain, "desk-notes");
    const known = (/** @type {any[]} */ rows) => [inRepo, inPlain].every((id) => rows.some((s) => s.id === id && "remoteKey" in s));
    const rows = await listed("/api/memory/sessions?limit=50&remotes=1", "sessions", known);
    const of = (/** @type {string} */ id) => rows.find((/** @type {any} */ s) => s.id === id);
    assert.equal(of(inRepo)?.remoteKey, "github.com/owner/shop", JSON.stringify(of(inRepo)));
    assert.equal(of(inPlain)?.remoteKey, null, "no repository: no remote");
    assert.ok(!JSON.stringify(rows).includes("s3cret"), "no credential said");
    const unasked = (await (await shim.api("/api/memory/sessions?limit=50")).json()).sessions;
    assert.ok(unasked.length >= 2 && unasked.every((/** @type {any} */ s) => !("remoteKey" in s)), "a list that does not ask says none");
  });

  test("GET /api/memory/projects?remotes=1: each project with its remote's key", async () => {
    await chatIn(repo, "desk-shop-2");
    const isShop = (/** @type {any} */ p) => String(p.cwd).toLowerCase() === repo.toLowerCase();
    const projects = await listed("/api/memory/projects?remotes=1", "projects", (rows) => rows.some((p) => isShop(p) && "remoteKey" in p));
    const shop = projects.find(isShop);
    assert.equal(shop?.remoteKey, "github.com/owner/shop", JSON.stringify(projects));
    const unasked = (await (await shim.api("/api/memory/projects")).json()).projects;
    assert.ok(unasked.every((/** @type {any} */ p) => !("remoteKey" in p)));
  });
});
