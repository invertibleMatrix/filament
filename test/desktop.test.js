// @ts-check
// The desktop app's own logic (HarnessV3-Native NA2), in plain Node: what it finds on Filament's port, how it runs its
// server, what its windows may show, where they open, its tray's words, its log. Electron itself is driven by
// `npm run test:desktop`; nothing here needs it (NA-D13).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { followPort, foundAt, hostOf, portOf, refusedWords } from "../desktop/lib/start.js";
import { createSupervisor, END_WAIT_MS, LATE_MS, RESTART_GAP_MS } from "../desktop/lib/supervisor.js";
import { ACTIVATION_MS, askedByPerson, isPress, mayGrant, routeOf, serverArgs, serverEnv, SUPERVISOR } from "../desktop/lib/policy.js";
import { keepPlace, placeOf, readPlaces } from "../desktop/lib/window-state.js";
import { trayRows, trayTip } from "../desktop/lib/tray.js";
import { createLog, serverTail } from "../desktop/lib/log.js";
import { defaultConfig } from "../src/config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fresh = () => mkdtempSync(join(tmpdir(), "filament-desktop-"));

// (fails before: yes — no desktop app; HarnessV3-Native NA-D7)
describe("what the app finds on Filament's port", () => {
  test("the port: --port where given, else the config's server.port, else the default; the config's secrets are never read", () => {
    const dir = fresh();
    try {
      const fallback = Number(defaultConfig().server.port);
      assert.equal(portOf(dir), fallback, "no config yet");
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { port: 20411, inboundKeys: ["enc:v1:not-opened"] } }));
      assert.equal(portOf(dir), 20411);
      assert.equal(portOf(dir, "20999"), 20999, "--port wins");
      assert.throws(() => portOf(dir, "http"), /port/);
      writeFileSync(join(dir, "config.json"), "{ not json");
      assert.equal(portOf(dir), fallback, "a config that is no JSON: the server's own start says so");
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { port: 70000 } }));
      assert.equal(portOf(dir), fallback, "no port at all");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nothing there: start; a Filament: attach, with its version, data folder and supervisor; anything else: refuse, in words", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const at = (/** @type {any} */ answer) => foundAt(20411, { fetch: /** @type {any} */ (async () => { if (answer instanceof Error) throw answer; return answer; }) });
    const json = (/** @type {number} */ status, /** @type {any} */ body) => ({ ok: status < 300, status, json: async () => body });
    assert.deepEqual(await at(refused), { kind: "start" });
    assert.deepEqual(await at(json(200, { version: "0.1.0", dataDir: "C:\\d", supervisor: "tray", config: {} })), { kind: "attach", version: "0.1.0", dataDir: "C:\\d", supervisor: "tray" });
    assert.deepEqual(await at(json(200, { hello: "world" })), { kind: "refuse", why: "another program answers on port 20411 (HTTP 200), not Filament" });
    assert.deepEqual(await at(json(404, null)), { kind: "refuse", why: "another program answers on port 20411 (HTTP 404), not Filament" });
    assert.deepEqual(await at(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })), { kind: "refuse", why: "port 20411 could not be asked (ECONNRESET)" });
    // One that holds the connection and never answers.
    const silent = await foundAt(20411, { waitMs: 30, fetch: /** @type {any} */ ((/** @type {any} */ _u, /** @type {any} */ o) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))))) });
    assert.deepEqual(silent, { kind: "refuse", why: "a program holds port 20411 and gave no answer in 0 s" });
  });

  // (fails before: yes — the review of NA2: a config.json broken by hand moved the app to the default port, onto another
  // data folder's Filament, whose chats it then showed as its own)
  test("before a start again: a config that does not read moves nothing; the host is the config's; a Filament of another folder is refused", async () => {
    const dir = fresh();
    try {
      assert.equal(followPort(dir, undefined, 20411), Number(defaultConfig().server.port), "no config: the default, as Filament reads it");
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { port: 20412, host: "localhost" } }));
      assert.deepEqual([followPort(dir, undefined, 20411), hostOf(dir)], [20412, "localhost"]);
      assert.equal(followPort(dir, "20999", 20411), 20999, "--port wins");
      writeFileSync(join(dir, "config.json"), "{ broken");
      assert.deepEqual([followPort(dir, undefined, 20411), hostOf(dir, "localhost")], [20411, "localhost"], "unreadable: where it is");
      for (const [given, seen] of [["0.0.0.0", "127.0.0.1"], ["::", "127.0.0.1"], ["::1", "[::1]"], ["192.168.1.5", "192.168.1.5"], ["", "127.0.0.1"]]) {
        writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { port: 20412, host: given } }));
        assert.equal(hostOf(dir), seen, given);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const json = (/** @type {any} */ body) => /** @type {any} */ (async (/** @type {string} */ url) => ({ ok: true, status: 200, url, json: async () => body }));
    const theirs = { version: "0.1.0", dataDir: "C:\\Users\\x\\AppData\\Roaming\\filament", supervisor: "tray" };
    assert.deepEqual(await foundAt(20300, { fetch: json(theirs), dataDir: "C:\\throwaway" }), { kind: "refuse", why: "port 20300 is held by a Filament of another data folder (C:\\Users\\x\\AppData\\Roaming\\filament)" });
    assert.equal((await foundAt(20300, { fetch: json(theirs), dataDir: "c:\\users\\X\\appdata\\roaming\\filament" })).kind, process.platform === "win32" ? "attach" : "refuse", "the same folder, as Windows reads a path");
    /** @type {string[]} */
    const asked = [];
    await foundAt(20412, { host: "localhost", fetch: /** @type {any} */ (async (/** @type {string} */ u) => (asked.push(u), { ok: false, status: 404, json: async () => null })) });
    assert.deepEqual(asked, ["http://localhost:20412/api/state"]);
  });

  test("on real sockets: a closed port is free, a web server that is no Filament holds it", async () => {
    const other = createServer((_q, s) => s.end("<html>not Filament</html>"));
    await new Promise((r) => other.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {any} */ (other.address()).port;
    try {
      assert.equal((await foundAt(port)).kind, "refuse");
    } finally {
      await new Promise((r) => other.close(() => r(undefined)));
    }
    assert.equal((await foundAt(port)).kind, "start", "closed now");
  });

  test("the refusal says which port, why, and where Filament's port is set", () => {
    const w = refusedWords(20300, "another program answers on port 20300 (HTTP 200), not Filament", "C:\\data");
    assert.deepEqual(w, {
      title: "Port 20300 is taken",
      message: "Filament cannot start: another program answers on port 20300 (HTTP 200), not Filament.",
      detail: `Filament listens on the port in its config: server.port in ${join("C:\\data", "config.json")}. Change it there, or stop the program on port 20300, then open Filament again.`,
    });
    const again = refusedWords(20300, "another program answers on port 20300 (HTTP 200), not Filament", "C:\\data", { again: true });
    assert.equal(again.message, "Filament stopped and cannot start again: another program answers on port 20300 (HTTP 200), not Filament.");
    assert.match(again.detail, /, then choose Restart Filament in the tray\.$/);
    // (fails before: yes — the review of NA2: a port given with --port was said to be the config's)
    const given = refusedWords(20300, "another program answers on port 20300 (HTTP 200), not Filament", "C:\\data", { given: true });
    assert.equal(given.detail, "The app was started with --port 20300. Start it on another port, or stop the program on port 20300, then open Filament again.");
  });
});

/**
 * A supervisor over a fake child and a fake clock: `tick` moves time and runs what falls due.
 * @param {{ answers?: () => Promise<boolean>, shutdown?: (ifIdle: boolean) => Promise<any>, vacant?: () => Promise<any>, killExits?: boolean }} [o]
 */
function rig({ answers = async () => true, shutdown = async (_ifIdle) => ({ ok: true }), vacant = undefined, killExits = true } = {}) {
  let t = 0;
  /** @type {{ at: number, fn: () => void }[]} */
  let timers = [];
  /** @type {any[]} */
  const children = [];
  /** @type {string[]} */
  const states = [];
  /** @type {boolean[]} */
  const asked = [];
  const sup = createSupervisor({
    fork: () => {
      /** @type {((code: number | null) => void)[]} */
      const exits = [];
      const c = { pid: 100 + children.length, killed: false, exit: (/** @type {number | null} */ code) => exits.forEach((f) => f(code)), kill: () => ((c.killed = true), killExits && c.exit(1), true), onExit: (/** @type {any} */ f) => exits.push(f) };
      children.push(c);
      return c;
    },
    answers: () => answers(),
    shutdown: (ifIdle) => (asked.push(ifIdle), shutdown(ifIdle)),
    ...(vacant ? { vacant } : {}),
    later: (fn, ms) => timers.push({ at: t + ms, fn }),
    now: () => t,
    onState: (s) => states.push(s),
  });
  const flush = () => new Promise((r) => setImmediate(r));
  const tick = async (/** @type {number} */ ms) => {
    const end = t + ms;
    for (;;) {
      await flush();
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      t = Math.max(t, due.at);
      due.fn();
    }
    t = end;
    await flush();
  };
  return { sup, children, states, asked, tick, flush };
}

// (fails before: yes — no desktop app; HarnessV3-Native NA-D3, NA-D9)
describe("the app's own server", () => {
  test("started, it is up at its first answer; asked meanwhile as often as it takes", async () => {
    let yes = false;
    const r = rig({ answers: async () => yes });
    r.sup.start();
    await r.tick(1000);
    assert.equal(r.sup.now().state, "starting");
    yes = true;
    await r.tick(300);
    assert.deepEqual([r.sup.now().state, r.sup.now().pid, r.states], ["up", 100, ["starting", "up"]]);
  });

  test("past 40 s unanswered it says it is late and keeps waiting: a slow start is no failure", async () => {
    let yes = false;
    const r = rig({ answers: async () => yes });
    r.sup.start();
    await r.tick(LATE_MS + 500);
    assert.equal(r.sup.now().state, "late");
    assert.equal(r.children[0].killed, false, "nothing is ended for being slow");
    yes = true;
    await r.tick(300);
    assert.equal(r.sup.now().state, "up");
  });

  test("whatever ends it, it is started again — never sooner than five seconds after its last start", async () => {
    const r = rig();
    r.sup.start();
    await r.tick(1000);
    r.children[0].exit(1);
    assert.equal(r.sup.now().state, "restarting");
    await r.tick(RESTART_GAP_MS - 1000 - 10);
    assert.equal(r.children.length, 1, "the gap is kept");
    await r.tick(20);
    assert.equal(r.children.length, 2);
    await r.tick(300);
    assert.equal(r.sup.now().state, "up");
    // One that lived longer than the gap starts again at once.
    await r.tick(RESTART_GAP_MS * 2);
    r.children[1].exit(0);
    await r.tick(0);
    assert.equal(r.children.length, 3);
  });

  test("Restart asks Filament to stop only while nothing runs: a refusal comes back in its words and nothing moves; else it stops and starts again", async () => {
    let answer = /** @type {any} */ ({ ok: false, note: "1 turn running in “build the parser”" });
    const r = rig({ shutdown: async () => answer });
    r.sup.start();
    await r.tick(300);
    assert.deepEqual(await r.sup.restart(), answer);
    assert.deepEqual([r.asked, r.sup.now().state, r.children.length], [[true], "up", 1]);
    answer = { ok: true };
    const done = r.sup.restart();
    await r.flush();
    assert.equal(r.sup.now().state, "restarting");
    // (fails before: yes — NA5's mutation pass) a second Restart meanwhile asks Filament nothing more.
    assert.deepEqual(await r.sup.restart(), { ok: true });
    assert.deepEqual(r.asked, [true, true], "one stop asked for each Restart that found it up, none while it restarts");
    r.children[0].exit(0);
    assert.deepEqual(await done, { ok: true });
    await r.tick(RESTART_GAP_MS);
    assert.equal(r.children.length, 2, "started again");
  });

  test("Quit stops it for good: refused while it works unless the person chose to stop anyway; its end starts nothing", async () => {
    const r = rig({ shutdown: async (/** @type {any} */ ifIdle) => (ifIdle ? { ok: false, note: "2 sub-agents working" } : { ok: true }) });
    r.sup.start();
    await r.tick(300);
    assert.deepEqual(await r.sup.stop(), { ok: false, note: "2 sub-agents working" });
    assert.equal(r.sup.now().state, "up");
    const forced = r.sup.stop({ force: true });
    await r.flush();
    assert.equal(r.sup.now().state, "stopping");
    r.children[0].exit(0);
    assert.deepEqual(await forced, { ok: true });
    await r.tick(RESTART_GAP_MS * 2);
    assert.deepEqual([r.sup.now().state, r.children.length, r.asked], ["stopped", 1, [true, false]]);
  });

  test("a stopped server that does not end in 25 s is ended; one that cannot be asked is ended at once on a stop anyway", async () => {
    const r = rig();
    r.sup.start();
    await r.tick(300);
    const stop = r.sup.stop();
    await r.tick(END_WAIT_MS - 100);
    assert.equal(r.children[0].killed, false);
    await r.tick(200);
    assert.equal(r.children[0].killed, true);
    assert.deepEqual(await stop, { ok: true });

    const down = rig({ shutdown: async () => { throw new Error("fetch failed"); } });
    down.sup.start();
    await down.tick(300);
    assert.deepEqual(await down.sup.stop(), { ok: false, unanswered: true, note: "fetch failed" }, "unasked, and not forced: said as no answer, never as work");
    const forced = down.sup.stop({ force: true });
    await down.flush();
    assert.equal(down.children[0].killed, true);
    assert.deepEqual(await forced, { ok: true });
  });

  // (fails before: yes — the review of NA2: a Quit while it started asked a server that cannot answer yet, and said
  // "fetch failed" as if a turn held it; a Restart then did the same)
  test("one that has not answered yet runs nothing: Quit ends it without a question, Restart begins it again, the gap kept", async () => {
    const r = rig({ answers: async () => false, shutdown: async () => { throw new Error("fetch failed"); } });
    r.sup.start();
    await r.tick(1000);
    const again = r.sup.restart();
    await r.flush();
    assert.deepEqual([await again, r.children[0].killed, r.asked], [{ ok: true }, true, []]);
    await r.tick(RESTART_GAP_MS);
    assert.equal(r.children.length, 2, "begun again");
    assert.deepEqual(await r.sup.stop(), { ok: true });
    assert.deepEqual([r.children[1].killed, r.asked, r.sup.now().state], [true, [], "stopped"]);
    await r.tick(RESTART_GAP_MS * 2);
    assert.equal(r.children.length, 2, "its end starts nothing");
  });

  // (fails before: yes — the review of NA2: a stop anyway after a question that failed as the server ended threw)
  test("a stop anyway where the server ended while it was asked: no error, nothing started again", async () => {
    /** @type {any} */
    let r;
    r = rig({ shutdown: async () => { r.children[0].exit(1); throw new Error("fetch failed"); } });
    r.sup.start();
    await r.tick(300);
    assert.deepEqual(await r.sup.stop({ force: true }), { ok: true });
    await r.tick(RESTART_GAP_MS * 2);
    assert.deepEqual([r.sup.now().state, r.children.length], ["stopped", 1]);
  });

  // (fails before: yes — the review of NA2: in the five seconds after an end the PowerShell tray, finding nothing
  // answer, starts a Filament of its own on the port; the app's then failed on it every five seconds, for ever)
  test("before it starts again the port is asked: a Filament there is attached to, another program said once, Restart asks anew", async () => {
    /** @type {any} */
    let there = { kind: "start" };
    const r = rig({ vacant: async () => there });
    r.sup.start();
    await r.tick(300);
    there = { kind: "attach", version: "0.1.0", dataDir: "C:\\d", supervisor: null };
    r.children[0].exit(1);
    await r.tick(RESTART_GAP_MS);
    assert.deepEqual([r.children.length, r.sup.now().state], [1, "taken"], "not started on that Filament's");

    const s = rig({ vacant: async () => there });
    s.sup.start();
    await s.tick(300);
    there = { kind: "refuse", why: "another program answers on port 20411 (HTTP 200), not Filament" };
    s.children[0].exit(1);
    await s.tick(RESTART_GAP_MS * 3);
    assert.deepEqual([s.children.length, s.sup.now().state, s.states.filter((x) => x === "taken").length], [1, "taken", 1], "said once, never tried again by itself");
    assert.deepEqual(await s.sup.restart(), { ok: true });
    assert.equal(s.children.length, 1, "still taken: nothing started");
    // (fails before: yes — the review of NA2: Restart on a port still taken said nothing; its state did not move)
    assert.deepEqual(s.sup.now().found, there, "who holds it, for the app to say again");
    there = { kind: "start" };
    await s.sup.restart();
    await s.tick(300);
    assert.deepEqual([s.children.length, s.sup.now().state], [2, "up"], "free again: started");
  });

  // (fails before: yes — the review of NA2: a Filament that could not start (a config.json that does not read) was
  // started again every five seconds, for ever, said nowhere — each start setting a copy of the config aside)
  test("one that ends before it ever answered is not started again by itself: it failed, with its exit; Try again starts it", async () => {
    let yes = false;
    const r = rig({ answers: async () => yes });
    r.sup.start();
    await r.tick(1000);
    r.children[0].exit(3);
    await r.tick(RESTART_GAP_MS * 4);
    assert.deepEqual([r.children.length, r.sup.now().state], [1, "failed"]);
    yes = true;
    assert.deepEqual(await r.sup.restart(), { ok: true });
    await r.tick(300);
    assert.deepEqual([r.children.length, r.sup.now().state], [2, "up"], "tried again on the person's word");
  });

  test("a failed start's facts carry its exit; one whose port a Filament took meanwhile is that Filament's, not a failure", async () => {
    /** @type {any[]} */
    const seen = [];
    const sup = createSupervisor({
      fork: () => ({ pid: 1, kill: () => true, onExit: (f) => seen.push(["exit", f]) }),
      answers: async () => false,
      shutdown: async () => ({ ok: true }),
      later: () => undefined,
      onState: (state, f) => seen.push([state, f.code, f.found?.kind]),
    });
    sup.start();
    /** @type {any} */ (seen.find((x) => x[0] === "exit"))[1](7);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(seen.filter((x) => x[0] !== "exit").map((x) => x.filter((v) => v !== undefined)), [["starting"], ["restarting"], ["failed", 7]]);

    const r = rig({ answers: async () => false, vacant: async () => ({ kind: "attach", version: "0.1.0", dataDir: "C:\\d", supervisor: null }) });
    r.sup.start();
    await r.tick(300);
    r.children[0].exit(1);
    await r.tick(RESTART_GAP_MS);
    assert.deepEqual([r.children.length, r.sup.now().state], [1, "taken"], "its listen lost the race to that Filament's: that one is shown");
  });

  // (fails before: yes — the review of NA2: an answer to "is it up?" still on its way when a restart began set it up)
  test("an answer that comes after the state moved on says nothing", async () => {
    /** @type {(v: boolean) => void} */
    let answer = () => {};
    // A child that is still alive after its kill, as a real one is for a moment: the answer is its own.
    const r = rig({ answers: () => new Promise((res) => (answer = res)), killExits: false });
    r.sup.start();
    await r.flush();
    const again = r.sup.restart();
    assert.deepEqual([r.sup.now().state, r.children[0].killed], ["restarting", true]);
    answer(true);
    await r.flush();
    assert.equal(r.sup.now().state, "restarting", "the killed child's late answer is no start");
    r.children[0].exit(1);
    await again;
  });

  test("Restart on one that does not answer, chosen to be ended: it is ended and started again", async () => {
    const r = rig({ shutdown: async () => { throw new Error("The operation was aborted due to timeout"); } });
    r.sup.start();
    await r.tick(300);
    assert.deepEqual(await r.sup.restart(), { ok: false, unanswered: true, note: "The operation was aborted due to timeout" });
    assert.equal(r.children[0].killed, false, "not ended unasked");
    assert.deepEqual(await r.sup.restart({ force: true }), { ok: true });
    await r.tick(RESTART_GAP_MS);
    assert.deepEqual([r.children[0].killed, r.children.length, r.sup.now().state], [true, 2, "up"]);
  });
});

// (fails before: yes — no desktop app; HarnessV3-Native NA-D5, NA-D8)
describe("what its windows may show, and what its server is given", () => {
  const origin = "http://127.0.0.1:20300";
  test("Filament's own pages stay; an http(s) address elsewhere goes to the browser; anything else is refused", () => {
    assert.equal(routeOf("http://127.0.0.1:20300/ui/harness.html#/task/abc", origin), "stay");
    assert.equal(routeOf("http://127.0.0.1:20301/", origin), "browser", "another port is another place");
    assert.equal(routeOf("http://localhost:20300/", origin), "browser", "the same server by another name is still not this window's");
    assert.equal(routeOf("https://github.com/x/y", origin), "browser");
    for (const bad of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,hi", "ms-settings:", "not a url"]) assert.equal(routeOf(bad, origin), "refuse", bad);
    // (fails before: yes — the review of NA2: Open in editor was refused in the app's windows)
    for (const editor of ["vscode://file/C:/p/a.js", "vscode-insiders://file/C:/p", "cursor://file/C:/p/a.js", "jetbrains://idea/navigate/reference?project=&path=C%3A%2Fp"]) assert.equal(routeOf(editor, origin), "editor", editor);
    // (fails before: yes — the hunt of p4-local-only: another machine's page opens a path over SSH, which the app refused)
    for (const editor of ["vscode://vscode-remote/ssh-remote+devbox/srv/p/a.js", "vscode-insiders://vscode-remote/ssh-remote+me@devbox.lan/srv/p", "cursor://vscode-remote/ssh-remote+devbox/C%3A/w"]) assert.equal(routeOf(editor, origin), "editor", editor);
    for (const other of ["vscode://vscode-remote/wsl+Ubuntu/home", "vscode://vscode-remote/dev-container+x/w", "cursor://vscode-remote/tunnel+x/w"]) assert.equal(routeOf(other, origin), "refuse", other);
    // (fails before: yes — the review of NA2: any link of an editor's scheme went, its extensions' handlers too)
    for (const other of ["vscode://ms-vscode-remote.remote-ssh/connect?x", "vscode:extension/evil.ext", "cursor://anysphere.cursor-retrieval/x", "jetbrains://idea/settings"]) assert.equal(routeOf(other, origin), "refuse", other);
  });

  // (fails before: yes — the review of NA2: Electron has no popup blocker; a page could open the browser unbidden)
  test("an address outside opens at once only just after the person's own press; else the app asks", () => {
    assert.equal(askedByPerson(1000, 1000 + ACTIVATION_MS), true);
    assert.equal(askedByPerson(1000, 1000 + ACTIVATION_MS + 1), false);
    assert.equal(askedByPerson(-Infinity, 5), false, "no press yet");
    assert.equal(askedByPerson(2000, 1000), false, "a clock that went back is no press");
    // (fails before: yes — the review of NA2: every key typed into the composer let a page open the browser)
    assert.deepEqual(["mouseDown", "mouseUp", "gestureTap"].map((type) => isPress({ type })), [true, true, true]);
    assert.deepEqual([isPress({ type: "keyDown", key: "Enter" }), isPress({ type: "rawKeyDown", key: " " }), isPress({ type: "keyDown", key: "a" }), isPress({ type: "char", key: "a" }), isPress({ type: "mouseMove" })], [true, true, false, false, false]);
  });

  test("only Filament's own pages are granted what they ask of the browser; an artifact's frame in them, its copy, full screen and a game's pointer", () => {
    const grant = (/** @type {string} */ permission, /** @type {any} */ requesting, /** @type {any} */ embedding = undefined) => mayGrant({ permission, requesting, embedding }, origin);
    assert.equal(grant("notifications", "http://127.0.0.1:20300/ui/harness.html"), true);
    assert.equal(grant("clipboard-read", "http://127.0.0.1:20300"), true);
    assert.equal(grant("notifications", "https://evil.example/"), false);
    assert.equal(grant("notifications", undefined), false);
    // (fails before: yes — the review of NA2: an artifact's Copy failed in the app, as it works in a browser)
    const art = "http://chart-1.art.localhost:20300/";
    assert.equal(grant("clipboard-sanitized-write", art, "http://127.0.0.1:20300/ui/harness.html"), true);
    assert.equal(grant("fullscreen", art, "http://127.0.0.1:20300"), true);
    // (fails before: yes — the Space Apps plan of 10-29: a game's pointer; only an app's frame's sandbox lets it ask)
    assert.equal(grant("pointerLock", art, "http://127.0.0.1:20300"), true);
    assert.equal(grant("pointerLock", art, undefined), false, "an artifact on its own, in no page of Filament's");
    assert.equal(grant("keyboardLock", art, "http://127.0.0.1:20300"), false);
    assert.equal(grant("clipboard-read", art, "http://127.0.0.1:20300"), false, "reading the clipboard is not an artifact's");
    assert.equal(grant("notifications", art, "http://127.0.0.1:20300"), false);
    assert.equal(grant("clipboard-sanitized-write", art, undefined), false, "an artifact on its own, in no page of Filament's");
    assert.equal(grant("clipboard-sanitized-write", art, "https://evil.example"), false);
    assert.equal(grant("clipboard-sanitized-write", "http://chart-1.art.localhost:20301/", "http://127.0.0.1:20300"), false, "another port's");
    assert.equal(grant("clipboard-sanitized-write", "http://art.localhost.evil.example:20300/", "http://127.0.0.1:20300"), false);
    // Another machine's page on the rail (the owner's remote Filament of 11-06, Part 4): its artifacts are on its network
    // address, https on its host at the port after its page's (http/artifacts.js `artifactsPort`), each under its path.
    // (fails before: yes — an artifact there was granted nothing; and, the review of p3-shell, an http `.art.localhost`
    // frame matched an https page whose port is none, as both read "")
    const far = (/** @type {string} */ permission, /** @type {any} */ requesting, /** @type {any} */ embedding = undefined) => mayGrant({ permission, requesting, embedding }, "https://192.168.1.20:20343");
    assert.equal(far("clipboard-sanitized-write", "https://192.168.1.20:20344/chart-1/", "https://192.168.1.20:20343"), true);
    assert.equal(far("fullscreen", "https://192.168.1.20:20344/chart-1/", "https://192.168.1.20:20343/ui/harness.html"), true);
    assert.equal(far("clipboard-read", "https://192.168.1.20:20344/chart-1/", "https://192.168.1.20:20343"), false, "reading the clipboard is not an artifact's");
    assert.equal(far("clipboard-sanitized-write", "https://192.168.1.21:20344/chart-1/", "https://192.168.1.20:20343"), false, "another host's");
    assert.equal(far("clipboard-sanitized-write", "https://192.168.1.20:20345/chart-1/", "https://192.168.1.20:20343"), false, "another port's");
    assert.equal(far("clipboard-sanitized-write", "http://192.168.1.20:20344/chart-1/", "https://192.168.1.20:20343"), false, "plain http");
    assert.equal(far("clipboard-read", "https://192.168.1.20:20343/ui/harness.html"), true, "the machine's own page, as This computer's");
    const tailnet = (/** @type {string} */ requesting) => mayGrant({ permission: "fullscreen", requesting, embedding: "https://box.tail1234.ts.net" }, "https://box.tail1234.ts.net");
    assert.equal(tailnet("http://chart-1.art.localhost/"), false, "an http frame in an https page: ports that both read \"\" are no match");
    assert.equal(mayGrant({ permission: "fullscreen", requesting: "http://chart-1.art.localhost:20310/", embedding: "http://localhost:20310" }, "http://localhost:20310"), true, "an SSH tunnel's: this machine's artifacts' own address, on its port");
  });

  // (fails before: yes — the bug hunt of 10-30, DESK-5: Filament's own pages were granted whatever they asked of the
  // browser — the camera, the microphone, the place, a USB device —, though no page of Filament's asks for one)
  test("Filament's own pages are granted what they use — a copy, the terminal's paste, notifications, full screen — and nothing else", () => {
    const grant = (/** @type {string} */ permission) => mayGrant({ permission, requesting: "http://127.0.0.1:20300/ui/harness.html" }, origin);
    for (const p of ["clipboard-sanitized-write", "clipboard-read", "notifications", "fullscreen"]) assert.equal(grant(p), true, p);
    for (const p of ["media", "display-capture", "geolocation", "midi", "midiSysex", "hid", "serial", "usb", "openExternal", "pointerLock", "keyboardLock", "idle-detection", "window-management", "local-fonts", "storage-access", "unknown"])
      assert.equal(grant(p), false, p);
  });

  test("the server runs with the app's environment less Electron's own, told the app starts it again, on this folder and port", () => {
    const env = serverEnv({ PATH: "p", ELECTRON_RUN_AS_NODE: "1", electron_enable_logging: "1", FILAMENT_SUPERVISOR: "tray", KEEP: "k", GONE: undefined });
    assert.deepEqual(env, { PATH: "p", FILAMENT_SUPERVISOR: SUPERVISOR, KEEP: "k" });
    assert.equal(SUPERVISOR, "desktop");
    assert.deepEqual(serverArgs({ dataDir: "C:\\d", port: 20300 }), ["--data-dir", "C:\\d", "--port", "20300"], "a port the app was given");
    // (fails before: yes — the review of NA2: --port always passed, so a port changed in Settings never took)
    assert.deepEqual(serverArgs({ dataDir: "C:\\d" }), ["--data-dir", "C:\\d"], "else Filament reads its config's");
    // (fails before: yes — the packaging Hunter's find: an installed app on a machine with FILAMENT_MEMORY_BUNDLE set
    // read that folder, not the engine it carries) Installed, the app's own bundle; from a checkout, the variable holds.
    assert.deepEqual(serverEnv({ PATH: "p", FILAMENT_MEMORY_BUNDLE: "D:\\b" }, { packaged: true }), { PATH: "p", FILAMENT_SUPERVISOR: SUPERVISOR });
    assert.deepEqual(serverEnv({ PATH: "p", FILAMENT_MEMORY_BUNDLE: "D:\\b" }), { PATH: "p", FILAMENT_MEMORY_BUNDLE: "D:\\b", FILAMENT_SUPERVISOR: SUPERVISOR });
    assert.match(readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8"), /env: serverEnv\(process\.env, \{ packaged: app\.isPackaged \}\)/);
  });

  test("only main.js speaks to Electron: the rest is plain Node, tested here", () => {
    const lib = join(ROOT, "desktop", "lib");
    for (const f of readdirSync(lib)) assert.doesNotMatch(readFileSync(join(lib, f), "utf8"), /from "electron"/, f);
    assert.match(readFileSync(join(ROOT, "desktop", "main.js"), "utf8"), /from "electron"/);
    const main = readFileSync(join(ROOT, "desktop", "main.js"), "utf8");
    assert.ok(main.indexOf('app.setPath("userData", own)') < main.indexOf("requestSingleInstanceLock"), "its profile is moved before anything else asks for it");
  });
});

// (fails before: yes — no desktop app; HarnessV3-Native NA-D8)
describe("where its windows open", () => {
  const main = { x: 0, y: 0, width: 1920, height: 1040 };
  const side = { x: 1920, y: 0, width: 1280, height: 1000 };
  const size = { width: 1440, height: 920 };
  test("where it stood, while a screen shows enough of it; else its usual size, centred on the main screen", () => {
    assert.deepEqual(placeOf({ x: 2000, y: 40, width: 1000, height: 700, maximized: true }, [main, side], size), { x: 2000, y: 40, width: 1000, height: 700, maximized: true });
    assert.deepEqual(placeOf({ x: 2000, y: 40, width: 1000, height: 700 }, [main], size), { x: 240, y: 60, width: 1440, height: 920, maximized: false }, "its screen is gone");
    assert.deepEqual(placeOf({ x: 1880, y: 40, width: 900, height: 700 }, [main], size), { x: 240, y: 60, width: 1440, height: 920, maximized: false }, "40 px of it would show: too little");
    assert.deepEqual(placeOf(null, [main], size).width, 1440);
    assert.deepEqual(placeOf({ x: 0, y: 0, width: 50, height: 50 }, [main], size).width, 1440, "too small to be a window");
    // (fails before: yes — NA5's mutation pass) whole on its screen, and still too small.
    assert.deepEqual(placeOf({ x: 100, y: 100, width: 180, height: 140 }, [main], size).width, 1440, "smaller than a window can be: not kept");
    assert.deepEqual(placeOf(null, [{ x: 0, y: 0, width: 1280, height: 720 }], size), { x: 0, y: 0, width: 1280, height: 720, maximized: false }, "a small screen: no bigger than it");
  });

  test("kept per window, written whole; a record that does not read is none", () => {
    const dir = fresh();
    try {
      const file = join(dir, "desktop", "windows.json");
      assert.deepEqual(readPlaces(file), {});
      keepPlace(file, "harness", { x: 1, y: 2, width: 300, height: 200, maximized: false });
      keepPlace(file, "dashboard", { x: 5, y: 6, width: 700, height: 500 });
      assert.deepEqual(readPlaces(file), { harness: { x: 1, y: 2, width: 300, height: 200, maximized: false }, dashboard: { x: 5, y: 6, width: 700, height: 500 } });
      writeFileSync(file, "[1, 2]");
      assert.deepEqual(readPlaces(file), {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — no desktop app; HarnessV3-Native NA-D9; the card, start at logon and the notifications' rows:
// yes — NA3)
test("the tray: the card, open, restart while the app runs Filament, start at logon, notifications, quit that says what it stops; its tooltip says where Filament stands", () => {
  const ids = (/** @type {any[]} */ rows) => rows.map((r) => (r.type ? "-" : `${r.id}${r.enabled === false ? " (off)" : ""}`)).join(" ");
  const SHAPE = (/** @type {string} */ restart) => `card harness browser dashboard - ${restart} - logon notify - quit`;
  assert.equal(ids(trayRows({ owned: true, state: "up", port: 20300 })), SHAPE("restart"));
  assert.equal(ids(trayRows({ owned: true, state: "starting", port: 20300 })), SHAPE("restart (off)"));
  assert.equal(ids(trayRows({ owned: false, state: "attached", port: 20300 })), SHAPE("restart (off)"));
  const checks = (/** @type {any} */ f) => trayRows(f).filter((/** @type {any} */ r) => r.checked !== undefined).map((/** @type {any} */ r) => `${r.id} ${r.checked ? "on" : "off"}`);
  assert.deepEqual(checks({ owned: true, state: "up", port: 1 }), ["logon off", "notify on"], "start at logon off and notifications on, unless the app says otherwise");
  assert.deepEqual(checks({ owned: true, state: "up", port: 1, logonOn: true, notify: false }), ["logon on", "notify off"]);
  // (fails before: yes — the review of 11-07: Linux has no login item Electron can set, and the check never stuck)
  assert.deepEqual(checks({ owned: true, state: "up", port: 1, logonOn: null }), ["notify on"], "none where the system has no login item");
  assert.match(readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8"), /logonOn: process\.platform === "linux" \? null : logonOn\(\),/);
  assert.equal(trayTip({ owned: false, state: "attached", port: 20300, gone: true }), "Filament · port 20300 · started elsewhere, not answering");
  assert.equal(/** @type {any} */ (trayRows({ owned: true, state: "up", port: 1 }).at(-1)).label, "Quit (stops Filament)");
  assert.equal(/** @type {any} */ (trayRows({ owned: false, state: "attached", port: 1 }).at(-1)).label, "Quit (Filament keeps running)");
  assert.deepEqual(
    ["up", "starting", "late", "restarting", "stopping", "stopped"].map((s) => trayTip({ owned: true, state: /** @type {any} */ (s), port: 20300 })),
    ["Filament · port 20300", "Filament · starting…", "Filament · starting, slower than usual (see server.log)", "Filament · restarting…", "Filament · stopping…", "Filament · not running"],
  );
  assert.equal(trayTip({ owned: false, state: "attached", port: 20300 }), "Filament · port 20300 · started elsewhere");
  // Its port another program's after an end: Restart tries again.
  assert.equal(ids(trayRows({ owned: true, state: "taken", port: 20300 })), SHAPE("restart"));
  assert.equal(trayTip({ owned: true, state: "taken", port: 20300 }), "Filament · not running: port 20300 is another program's");
  assert.equal(ids(trayRows({ owned: true, state: "failed", port: 20300 })), SHAPE("restart"));
  assert.equal(trayTip({ owned: true, state: "failed", port: 20300 }), "Filament · could not start (see server.log)");
});

// (fails before: yes — no desktop app; HarnessV3-Native NA2)
test("the server's log: its lines and the app's, started again past its size with the old one kept once", () => {
  const dir = fresh();
  try {
    const file = join(dir, "desktop", "server.log");
    const log = createLog(file, { max: 100, now: () => new Date("2026-10-22T08:00:00Z") });
    log.write("x".repeat(60));
    log.line("started");
    assert.equal(readFileSync(file, "utf8"), "[desktop] 2026-10-22T08:00:00.000Z started\n", "60 + 43 > 100: the first went to .1");
    assert.equal(readFileSync(`${file}.1`, "utf8"), "x".repeat(60));
    log.write("y".repeat(80));
    assert.equal(statSync(`${file}.1`).size, 43, "only the last is kept beside it");
    // What Filament said last, for the "could not start" dialog: its own lines, not the app's, cut long.
    writeFileSync(file, `[desktop] 2026-10-22T08:00:00.000Z Filament started (pid 7)\nline one\r\n\nError: config.json is not valid JSON ${"z".repeat(300)}\n[desktop] 2026-10-22T08:00:01.000Z Filament ended before it answered (exit 1)\n`);
    const tail = serverTail(file, 6);
    assert.deepEqual([tail.length, tail[0], tail[1].length, tail[1].endsWith("…")], [2, "line one", 200, true]);
    assert.deepEqual(serverTail(join(dir, "none.log")), [], "a log that does not read is none");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of NA2: the app's server.log kept the inbound key whole, and a config that does not
// read printed a stack whose last lines the "could not start" dialog showed instead of the cause)
describe("Filament as the app runs it", () => {
  /** @param {string} dir @param {Record<string, string>} env @returns {Promise<{ code: number | null, out: string }>} */
  const run = (dir, env, { until = /inbound key/ } = {}) =>
    new Promise((resolve) => {
      const c = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "--data-dir", dir, "--port", "0"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let out = "";
      const take = (/** @type {Buffer} */ d) => {
        out += d;
        if (until.test(out)) c.kill();
      };
      c.stdout.on("data", take);
      c.stderr.on("data", take);
      c.on("exit", (code) => resolve({ code, out }));
    });
  test("its key is not written whole where a supervisor keeps the output; a config that does not read says why in one line", async () => {
    const dir = fresh();
    try {
      const cfg = /** @type {any} */ (defaultConfig());
      cfg.server.inboundKeys = ["sk-filament-0123456789abcdef"];
      cfg.observability.logFile = "";
      cfg.memory.enabled = false;
      writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
      const kept = await run(dir, { FILAMENT_SUPERVISOR: "desktop" });
      assert.match(kept.out, /inbound key : sk-f…cdef \(print-key shows it whole\)/);
      assert.doesNotMatch(kept.out, /sk-filament-0123456789abcdef/);
      const plain = await run(dir, { FILAMENT_SUPERVISOR: "" });
      assert.match(plain.out, /inbound key : sk-filament-0123456789abcdef/, "in your own terminal, whole as before");
      writeFileSync(join(dir, "config.json"), "{ broken");
      const broken = await run(dir, { FILAMENT_SUPERVISOR: "desktop" }, { until: /^$/ });
      // Its last line says why (node's own warning about SQLite may come first); no stack under it.
      const lines = broken.out.trim().split(/\r?\n/);
      assert.equal(broken.code, 1, broken.out);
      assert.match(String(lines.at(-1)), /^Filament failed to start: .*config\.json is not valid JSON/);
      assert.doesNotMatch(broken.out, /^\s+at /m, "no stack");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
