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
import { FOLDER_STATS_HUNG, SHARE_ANSWERED_MS, folderHung, folderThere, remoteKeys, remoteRead, shareOf } from "../src/adapters/git/inspect.js";
import { FOLDER_UNANSWERED, ownChangesOf } from "../src/adapters/git/changes.js";
import { allowedFolder, allowedFolderSoon } from "../src/http/admin/folder.js";
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
  // (and the review of x2: past two such stats anywhere, every folder was unknown; one share's hang is that share's now)
  // (and the review of x31: only stats already late were counted, so folders on one dead share asked at once each held
  // a thread; a share's root is looked at first now, once for all of them)
  test("a folder on a share that does not answer: unread within its wait, its share's root asked once however often it is read and no folder there asked; one on another share is read; past a few such shares, none is; the list goes without it", async () => {
    const share = gate();
    /** @type {string[]} */
    const asked = [];
    /** A stat on a share offline: once the share answers, its root is there and the folder is not. @param {string} f */
    const offline = (f) => (asked.push(f), share.p.then(() => (f.startsWith("//") ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })) : {})));
    const there = { ms: 50, statOf: offline };
    try {
      const t0 = Date.now();
      assert.deepEqual(await remoteRead("//nas/share/a", { there }), { remote: null, unread: true });
      assert.ok(Date.now() - t0 < 1000, `answered in ${Date.now() - t0} ms`);
      const t1 = Date.now();
      assert.deepEqual(await remoteRead("//nas/share/a", { there }), { remote: null, unread: true }, "read again while its share's look is under way");
      assert.ok(Date.now() - t1 < 40, `at once, not after another wait: ${Date.now() - t1} ms`);
      assert.deepEqual(asked, ["\\\\nas\\share"], "its share's root asked once, the folder not at all");
      // The desk's list: answered within its wait, a folder on that share not known, nor asked — its share does not answer.
      const keys = remoteKeys({ read: (f) => remoteRead(f, { there }) });
      const t2 = Date.now();
      assert.equal((await keys.of(["//nas/share/b"], { waitMs: REMOTES_WAIT_MS })).get("//nas/share/b"), undefined);
      assert.ok(Date.now() - t2 < 40, `the list answered at once: ${Date.now() - t2} ms`);
      assert.deepEqual(asked, ["\\\\nas\\share"], "no folder on that share is asked");
      assert.deepEqual([folderHung("//NAS/share/b"), folderHung("//nas/other/x"), shareOf("//nas/share/a/deep"), shareOf("Z:\\work\\shop"), shareOf("/Volumes/Backup/x")], [true, false, "\\\\nas\\share", "Z:", "/Volumes/Backup"]);
      // A path's long forms are on the share they name.
      assert.deepEqual([shareOf("\\\\?\\UNC\\NAS\\share\\a"), shareOf("//./unc/nas/share/a"), shareOf("\\\\?\\Z:\\work")], ["\\\\nas\\share", "\\\\nas\\share", "Z:"]);
      // (the hunt on s1c) The system's own disk is no share: one folder there that hangs — a dead junction — is its own.
      const system = String(process.env.SystemDrive || "C:").toUpperCase();
      assert.deepEqual([shareOf(`${system}\\work\\shop`), shareOf("/home/me/shop")], [`${system}\\work\\shop`, "/home/me/shop"]);
      // A folder on another disk is read while it hangs.
      assert.equal(await folderThere("//ok/share/x", { ms: 50, statOf: async () => ({}) }), true, "another share's folder read");
      // Each share that hangs holds a thread: past FOLDER_STATS_HUNG of them, no folder is asked.
      assert.deepEqual([FOLDER_STATS_HUNG, SHARE_ANSWERED_MS], [3, 2000]);
      assert.deepEqual(await remoteRead("//usb/drive/c", { there }), { remote: null, unread: true });
      assert.deepEqual(await remoteRead("//box/x/d", { there }), { remote: null, unread: true });
      assert.deepEqual(await remoteRead("//more/y/e", { there }), { remote: null, unread: true });
      assert.deepEqual(asked, ["\\\\nas\\share", "\\\\usb\\drive", "\\\\box\\x"], "a fourth share is not asked while three hold threads");
      // The folder fence answers at once for a folder on a share that does not answer, and never looks at it here.
      const fenceAt = Date.now();
      const own = { server: { host: "127.0.0.1" } };
      assert.deepEqual(allowedFolder(own, "//nas/share/q"), { ok: false, status: 503, error: "//nas/share/q does not answer: its drive or share is offline, or too slow to say. Read it again once it answers" });
      assert.equal(/** @type {any} */ (await allowedFolderSoon(own, "//usb/drive/z")).status, 503);
      // A share the folder rules keep out (a listener open beyond this machine, no roots listed) is refused unasked.
      if (process.platform === "win32") {
        assert.equal(/** @type {any} */ (await allowedFolderSoon({}, "//kept/out/x", there)).status, 403);
        assert.ok(!asked.some((p) => /kept/.test(p)), "never asked");
      }
      // A turn's changes in a place there answer at once, its place said not to answer, nothing read of it.
      const turn = await ownChangesOf([{ place: "//nas/share/p", round: 1, agent: "a1", before: "b", after: "c", base: "head", own: ["x.txt"], command: false, turn: 1 }]);
      assert.deepEqual(turn.errors, [{ place: "//nas/share/p", error: FOLDER_UNANSWERED }]);
      assert.ok(Date.now() - fenceAt < 200, `the fence and the changes answered at once: ${Date.now() - fenceAt} ms`);
    } finally {
      share.open();
    }
    // The shares answer: their stats end, and a folder there is asked again.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(folderHung("//nas/share/b"), false);
    assert.deepEqual(await remoteRead("//nas/share/b", { there }), { remote: null, unread: false }, "not there, once the share says so");
    assert.deepEqual(asked, ["\\\\nas\\share", "\\\\usb\\drive", "\\\\box\\x", "//nas/share/b"], "its root answered: the folder is asked");
  });

  test("many folders on one share that does not answer, asked at once: its root alone is asked, once, and each answers within the wait", async () => {
    const share = gate();
    /** @type {string[]} */
    const asked = [];
    const statOf = (/** @type {string} */ f) => (asked.push(f), share.p);
    try {
      const at = Date.now();
      const got = await Promise.all(["//dead/s/a", "//dead/s/b", "//dead/s/c", "//dead/s/d", "//dead/s/e"].map((f) => folderThere(f, { ms: 50, statOf })));
      assert.deepEqual(got, [null, null, null, null, null]);
      assert.ok(Date.now() - at < 1000, `answered in ${Date.now() - at} ms`);
      assert.deepEqual(asked, ["\\\\dead\\s"], "one thread held, not one for each folder");
    } finally {
      share.open();
    }
    await new Promise((r) => setTimeout(r, 10));
  });

  test("a folder that hangs on a drive that answers (a dead link to a share): that folder alone does not answer, every other there is read", async () => {
    const link = gate();
    const statOf = (/** @type {string} */ f) => (f.endsWith("dead") ? link.p : Promise.resolve({}));
    try {
      assert.equal(await folderThere("Q:\\proj\\dead", { ms: 50, statOf }), null);
      assert.equal(await folderThere("Q:\\proj\\live", { ms: 50, statOf }), true, "another folder on that drive is read");
      assert.deepEqual([folderHung("Q:\\proj\\dead"), folderHung("Q:\\proj\\live")], [true, false]);
    } finally {
      link.open();
    }
    await new Promise((r) => setTimeout(r, 10));
  });

  test("more folders asked at once than stats may be under way: each waits its turn within its wait, and all are read", async () => {
    const statOf = () => new Promise((r) => setTimeout(r, 5));
    const got = await Promise.all(["//a1/s/x", "//a2/s/x", "//a3/s/x", "//a4/s/x", "//a5/s/x"].map((f) => folderThere(f, { ms: 1000, statOf })));
    assert.deepEqual(got, [true, true, true, true, true]);
  });

  test("a stat's error: not there where it says so, there where it may not be looked in, unknown where it says nothing of the folder", async () => {
    const failing = (/** @type {string} */ code) => () => Promise.reject(Object.assign(new Error(code), { code }));
    const got = await Promise.all(["ENOENT", "ENOTDIR", "EACCES", "EHOSTUNREACH"].map((code, i) => folderThere(`/plain-${i}`, { ms: 500, statOf: failing(code) })));
    assert.deepEqual(got, [false, false, true, null]);
  });

  test("a listed root on a share that does not answer holds no folder, and a folder under another root is allowed without looking at it", async () => {
    const dead = gate();
    const there = { ms: 50, statOf: (/** @type {string} */ p) => (/^[\\/]{2}/.test(p) ? dead.p : Promise.resolve({})) };
    const home = realpathSync(tmpdir());
    try {
      const f = await allowedFolderSoon({ agentLoop: { roots: ["//dead2/s/work", home] } }, home, there);
      assert.equal(f.ok, true, JSON.stringify(f));
      assert.equal(folderHung("//dead2/s/work"), true);
    } finally {
      dead.open();
    }
    await new Promise((r) => setTimeout(r, 10));
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
