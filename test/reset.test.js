// `npm run reset` (HarnessV3-AtHome AH-C4): the clean slate. It keeps how Filament is reached and what it reaches — the
// server's host, port, inbound keys and admin token, the upstreams and the routes, secret.key, the saved model lists,
// the token calibration and the installed engine — and moves everything else into reset-backups/<stamp>/: every other
// setting, memory wherever it lives with its backups, the runs, the usage, every generation of the logs, the agents'
// session state, and the browser profiles of the desktop app and the app window. Each run works on a folder of its own,
// with a stand-in Filament on a port this file holds, so the script never reaches a real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKey, seal, sealConfig } from "../src/services/config/secrets.js";
import { loadConfig } from "../src/services/config/store.js";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "reset.mjs");
const KEPT = ["config.json", "memory-engine", "models-cache.json", "reset-backups", "secret.key", "token-calib.json"];

/**
 * A stand-in Filament on a port of its own: /api/state names the folder `serves` set, POST /api/shutdown answers and
 * stops it. Every request it sees is kept, with the admin header it carried.
 * @param {string} [host]  where it listens
 * @returns {Promise<{ port: number, seen: { method: string, path: string, admin: string | null }[], serves: (dir: string) => void, close: () => Promise<void> }>}
 */
const standIn = (host = "127.0.0.1") =>
  new Promise((resolve) => {
    let servesDir = "";
    /** @type {{ method: string, path: string, admin: string | null }[]} */
    const seen = [];
    const srv = createServer((req, res) => {
      seen.push({ method: String(req.method), path: String(req.url), admin: /** @type {string | undefined} */ (req.headers["x-filament-admin"]) || null });
      if (req.url === "/api/state") return void res.end(JSON.stringify({ version: "stand-in", dataDir: servesDir }));
      if (req.method === "POST" && req.url === "/api/shutdown") {
        res.end(JSON.stringify({ ok: true }));
        setImmediate(() => {
          srv.close();
          srv.closeAllConnections();
        });
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    srv.listen(0, host, () =>
      resolve({
        port: /** @type {import("node:net").AddressInfo} */ (srv.address()).port,
        seen,
        serves: (dir) => (servesDir = dir),
        close: () =>
          new Promise((r) => {
            srv.closeAllConnections();
            srv.close(() => r());
          }),
      }),
    );
  });

/**
 * The script on `dir`, with `typed` as what the person types.
 * @param {string} dir @param {string[]} args @param {string} [typed]
 * @returns {Promise<{ code: number | null, out: string, err: string }>}
 */
const reset = (dir, args, typed = "") =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, "--data-dir", dir, ...args], { env: { ...process.env, FILAMENT_DATA_DIR: dir } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(typed);
  });

/** Every file under `dir`, by its path inside it, with its bytes. @param {string} dir */
const snapshot = (dir) => {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} at @param {string} rel */
  const walk = (at, rel) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(at, e.name), next);
      else out[next] = readFileSync(join(at, e.name), "latin1");
    }
  };
  walk(dir, "");
  return out;
};

/**
 * An install as this build leaves it, pointed at `port`: the data folder, with memory and its backups kept outside it
 * (the backup folder shared with a file of the person's own). Removed after `body`, pass or fail.
 * @param {number} port
 * @param {(w: { root: string, dir: string, memory: string, backups: string, foreign: string }) => Promise<void>} body
 * @param {{ sealed?: boolean, host?: string }} [opts]  `sealed` false writes the secrets in plain text, with no
 * secret.key; `host`, the server's host as config.json writes it
 */
async function install(port, body, { sealed = true, host = "0.0.0.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "filament-reset-"));
  try {
    const dir = join(root, "data");
    const memory = join(root, "elsewhere", "memory");
    const backups = join(root, "elsewhere", "backups");
    /** @param {string} at @param {Record<string, string>} files */
    const lay = (at, files) => {
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(at, rel)), { recursive: true });
        writeFileSync(join(at, rel), text);
      }
    };
    lay(dir, {
      "models-cache.json": '{"z":{"models":["glm-5.3"]}}',
      "token-calib.json": '{"z::glm-5.3":{"factor":1.1}}',
      "memory-engine/state.json": '{"version":"1.2.3"}',
      "app-profile/Default/Preferences": "{}",
      "reset-backups/2020-01-01T00-00-00-000Z/data/tray.log": "oldest",
      "reset-backups/2020-01-02T00-00-00-000Z/data/tray.log": "older",
      "reset-backups/2020-01-03T00-00-00-000Z/data/tray.log": "old",
      "runs/r1/events.jsonl": '{"type":"start"}\n',
      "daily-usage.json": '{"days":{}}',
      "memory-usage.json": '{"days":{}}',
      "ops.jsonl": '{"op":1}\n',
      "ops.jsonl.1": '{"op":0}\n',
      "requests.jsonl": '{"id":"a"}\n',
      "requests.jsonl.1": '{"id":"b"}\n',
      "requests.jsonl.5": '{"id":"c"}\n',
      "tray.log": "2026-10-04 restart\n",
      "acp-sessions.json": "{}",
      "cursor-sdk-sessions.json": "{}",
      "session-presets.json": "{}",
      "teams.json": '{"version":1,"teams":{}}',
      "config.json.tmp": "{",
      "config.json.broken-2026-01-01T00-00-00-000Z": "{",
    });
    lay(memory, { "memory.json": '{"version":1}', "archive.db": "db", "migrations/archive-v8.db": "v8", "mnemosyne/mnemosyne.db": "mn" });
    lay(backups, { "filament-memory-2026-10-01T03-00-00/manifest.json": "{}", "filament-memory-2026-10-02T03-00-00/manifest.json": "{}", "notes.txt": "mine" });
    const foreign = seal("sk-sealed-on-another-machine", randomBytes(32));
    const cfg = {
      version: 1,
      server: { host, port, inboundKeys: ["sk-inbound"], adminToken: "admin-token", requireAuth: false, logLevel: "debug", allowedHosts: ["proxy.lan"] },
      upstreams: [
        { id: "z", type: "openai-compatible", baseUrl: "https://api.example.test/v1", apiKey: "sk-upstream", headers: { "x-api-key": "header-secret" }, notAField: 1 },
        { id: "far", type: "anthropic-compatible", baseUrl: "https://far.example.test", apiKey: foreign },
      ],
      routes: [{ match: "glm-5.3", upstream: "z", upstreamModel: "glm-5.3" }],
      memory: { enabled: true, folder: memory, backups: { enabled: true, folder: backups, keep: 3 } },
      observability: { tokenCalibration: false },
    };
    writeFileSync(join(dir, "config.json"), JSON.stringify(sealed ? sealConfig(cfg, loadKey(dir)) : cfg, null, 2) + "\n");
    await body({ root, dir, memory, backups, foreign });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// (fails before: yes — the reset kept config.json whole, every setting with it; it left tray.log,
// the logs' older generations, the session presets, the stale config copies, and memory's backups; and it called the
// server without the admin token). teams.json joined the wiped files with HarnessV3-AtHome P2 step 2 (fails before: no —
// a guard: the reset wipes every entry it does not keep, so your saved teams go with the rest). (fails before: yes —
// the bug hunt of 10-30, DESK-4: the reset kept app-profile, which only `npm run app`'s window uses, and wiped the
// desktop app's folder, its sign-ins and window places, naming it only "desktop")
test("AH-C4: a reset keeps how Filament is reached and what it reaches, and moves everything else into reset-backups/<stamp>/", async () => {
  const filament = await standIn();
  try {
    await install(filament.port, async ({ dir, memory, backups, foreign }) => {
      filament.serves(dir);
      // The desktop app's own folder: its Electron profile, its window places.
      mkdirSync(join(dir, "desktop", "Network"), { recursive: true });
      writeFileSync(join(dir, "desktop", "Network", "Cookies"), "signed in");
      writeFileSync(join(dir, "desktop", "windows.json"), '{"harness":{"x":10,"y":10,"width":1440,"height":920}}');
      const cfgFile = join(dir, "config.json");
      const before = readFileSync(cfgFile);
      const was = snapshot(dir);

      const { code, out, err } = await reset(dir, ["--yes"]);
      assert.equal(code, 0, err || out);

      // It stopped the Filament serving this folder, every call carrying the admin token.
      assert.ok(filament.seen.some((r) => r.method === "POST" && r.path === "/api/shutdown"), JSON.stringify(filament.seen));
      assert.ok(filament.seen.every((r) => r.admin === "admin-token"), JSON.stringify(filament.seen));

      // Its words say what goes: the two browser profiles by what they hold, the desktop app's sign-ins and window
      // places among it; and what stays names neither.
      const wipes = out.split("\n").find((l) => l.startsWith("wipes : ")) || "";
      assert.ok(wipes.includes("the desktop app's own folder (desktop/: its browser sign-ins and cookies, its window places, its notifications setting)"), wipes);
      assert.ok(wipes.includes("the app window's browser profile (app-profile/: its sign-ins and cookies)"), wipes);
      assert.match(out, /^wiped: .*the desktop app's own folder \(desktop\/: its browser sign-ins/m);
      for (const line of out.split("\n").filter((l) => /^(?:keeps :|kept:)/.test(l))) assert.doesNotMatch(line, /profile|desktop/, line);

      // The data folder holds what a reset keeps, and nothing else; what it keeps is untouched.
      assert.deepEqual(readdirSync(dir).sort(), KEPT);
      const now = snapshot(dir);
      for (const rel of ["secret.key", "models-cache.json", "token-calib.json", "memory-engine/state.json"])
        assert.equal(now[rel], was[rel], `${rel} is untouched`);

      // The new config.json: the server's address and access, the upstreams and the routes, as stored — sealed values
      // byte for byte, a key this secret.key cannot open carried as it is, a field no schema knows dropped — and nothing else.
      const stored = JSON.parse(before.toString("utf8"));
      const written = JSON.parse(readFileSync(cfgFile, "utf8"));
      assert.deepEqual(Object.keys(written).sort(), ["routes", "server", "upstreams", "version"]);
      assert.deepEqual(written.server, { host: "0.0.0.0", port: filament.port, inboundKeys: stored.server.inboundKeys, adminToken: stored.server.adminToken });
      assert.deepEqual(written.upstreams, [
        { id: "z", type: "openai-compatible", baseUrl: "https://api.example.test/v1", apiKey: stored.upstreams[0].apiKey, headers: { "x-api-key": stored.upstreams[0].headers["x-api-key"] } },
        { id: "far", type: "anthropic-compatible", baseUrl: "https://far.example.test", apiKey: foreign },
      ]);
      assert.deepEqual(written.routes, [{ match: "glm-5.3", upstream: "z", upstreamModel: "glm-5.3" }]);

      // Filament reads it as kept: the keys open, and every other setting is its default.
      const { config, secretProblems } = loadConfig(dir);
      assert.deepEqual(config.server.inboundKeys, ["sk-inbound"]);
      assert.equal(config.server.adminToken, "admin-token");
      assert.equal(config.upstreams[0].apiKey, "sk-upstream");
      assert.equal(config.upstreams[0].headers["x-api-key"], "header-secret");
      assert.deepEqual(secretProblems, ["upstreams.far.apiKey: could not decrypt (wrong secret.key?)"]);
      assert.equal(config.server.requireAuth, true);
      assert.equal(config.server.logLevel, "info");
      assert.deepEqual(config.server.allowedHosts, []);
      assert.equal(config.memory.folder, "");
      assert.deepEqual(config.memory.backups, { enabled: false, folder: "", hour: 3, keep: 14 });
      assert.equal(config.observability.tokenCalibration, true);

      // Everything wiped is in the new copy: the data folder's entries under data/ (the old config.json byte for byte),
      // memory's folder whole, what an earlier build left in it included, and the backups Filament wrote — the person's
      // own file beside them stays. The newest three copies are kept, this one among them.
      const copies = readdirSync(join(dir, "reset-backups")).sort();
      assert.deepEqual(copies.slice(0, 2), ["2020-01-02T00-00-00-000Z", "2020-01-03T00-00-00-000Z"], String(copies));
      assert.equal(copies.length, 3, String(copies));
      const copy = snapshot(join(dir, "reset-backups", copies[2]));
      assert.equal(copy["data/config.json"], before.toString("latin1"));
      for (const rel of ["runs/r1/events.jsonl", "daily-usage.json", "memory-usage.json", "ops.jsonl", "ops.jsonl.1", "requests.jsonl", "requests.jsonl.1", "requests.jsonl.5", "tray.log", "acp-sessions.json", "cursor-sdk-sessions.json", "session-presets.json", "teams.json", "config.json.tmp", "config.json.broken-2026-01-01T00-00-00-000Z", "app-profile/Default/Preferences", "desktop/Network/Cookies", "desktop/windows.json"])
        assert.equal(copy[`data/${rel}`], was[rel], `data/${rel}`);
      for (const rel of ["memory.json", "archive.db", "migrations/archive-v8.db", "mnemosyne/mnemosyne.db"]) assert.ok(copy[`memory-folder/${rel}`], `memory-folder/${rel}`);
      for (const name of ["filament-memory-2026-10-01T03-00-00", "filament-memory-2026-10-02T03-00-00"]) assert.ok(copy[`memory-backups/${name}/manifest.json`], name);
      assert.ok(!existsSync(memory), "memory's folder is gone");
      assert.deepEqual(readdirSync(backups), ["notes.txt"]);
    });
  } finally {
    await filament.close();
  }
});

// (fails before: yes — the reset shut down whatever answered on the configured port, whichever data folder it served:
// a reset of one install stopped another's Filament)
test("AH-C4: a reset leaves running a Filament that serves another data folder", async () => {
  const other = await standIn();
  try {
    await install(other.port, async ({ root, dir }) => {
      other.serves(join(root, "another-install"));
      const { code, out, err } = await reset(dir, ["--yes"]);
      assert.equal(code, 0, err || out);
      assert.ok(!other.seen.some((r) => r.path === "/api/shutdown"), JSON.stringify(other.seen));
      assert.match(out, /left running: what answers at http:\/\/127\.0\.0\.1:\d+ serves .*another-install, not this one/);
      assert.deepEqual(readdirSync(dir).sort(), KEPT, "the reset itself still ran");
    });
  } finally {
    await other.close();
  }
});

// (fails before: yes — a host config.json writes in brackets was bracketed again, `http://[[::1]]:…`, so the reset
// found no Filament there and went on past one serving another data folder)
test("a reset finds the Filament on an IPv6 host config.json writes in brackets", async () => {
  const other = await standIn("::1");
  try {
    await install(other.port, async ({ root, dir }) => {
      other.serves(join(root, "another-install"));
      const { code, out, err } = await reset(dir, ["--yes"]);
      assert.equal(code, 0, err || out);
      assert.ok(other.seen.some((r) => r.path === "/api/state"), "the reset asked what answers there");
      assert.match(out, /left running: what answers at http:\/\/\[::1\]:\d+ serves .*another-install, not this one/);
    }, { host: "[::1]" });
  } finally {
    await other.close();
  }
});

// (fails before: no — guards the prompt's promise: a kept plain-text key is sealed with a secret.key the reset makes
// only once "reset" is typed)
test("AH-C4: anything typed but reset touches nothing: no file moves, no server is called, no secret.key is made", async () => {
  const filament = await standIn();
  try {
    await install(
      filament.port,
      async ({ dir, memory, backups }) => {
        filament.serves(dir);
        const world = [snapshot(dir), snapshot(memory), snapshot(backups)];
        const { code, out } = await reset(dir, [], "no\n");
        assert.equal(code, 0);
        assert.match(out, /aborted — nothing was touched/);
        assert.deepEqual([snapshot(dir), snapshot(memory), snapshot(backups)], world);
        assert.ok(!existsSync(join(dir, "secret.key")));
        assert.deepEqual(filament.seen, []);
      },
      { sealed: false },
    );
  } finally {
    await filament.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, DESK-3: with the desktop app running on the data folder, the reset stopped
// its Filament, wrote the new config.json and moved what came before desktop, then failed six times on the app's own
// folder and left the data folder half reset)
test("AH-C4: a reset while the desktop app runs on the data folder stops nothing and moves nothing, and says to quit the app", { skip: process.platform !== "win32" && "only Windows keeps a folder with an open file from moving" }, async () => {
  const filament = await standIn();
  try {
    await install(filament.port, async ({ root, dir }) => {
      filament.serves(dir);
      // The app's Electron keeps a file of its profile open for as long as it runs.
      mkdirSync(join(dir, "desktop"));
      writeFileSync(join(dir, "desktop", "lockfile"), "");
      writeFileSync(join(dir, "desktop", "windows.json"), '{"harness":{"x":10,"y":10,"width":1440,"height":920}}');
      const world = snapshot(root);
      const held = openSync(join(dir, "desktop", "lockfile"), "r");
      try {
        const { code, out, err } = await reset(dir, ["--yes"]);
        assert.equal(code, 1, err || out);
        assert.match(err, /desktop, the desktop app's own folder, is in use \(E[A-Z]+\): the app holds it while it runs on this data folder, .* quit it \(its tray's Quit\), then run this again\. Nothing was touched/);
      } finally {
        closeSync(held);
      }
      assert.deepEqual(snapshot(root), world, "every file where it was, config.json byte for byte");
      assert.deepEqual(filament.seen, [], "its Filament left running");
    });
  } finally {
    await filament.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, DESK-4: the reset kept app-profile, so it never asked whether the window
// held it; a reset that takes it, with the window open, would fail on it half way, as DESK-3's did on the desktop app's)
test("AH-C4: a reset while the app window holds its profile stops nothing and moves nothing, and says to close it", { skip: process.platform !== "win32" && "only Windows keeps a folder with an open file from moving" }, async () => {
  const filament = await standIn();
  try {
    await install(filament.port, async ({ root, dir }) => {
      filament.serves(dir);
      // The window's browser keeps a file of its profile open for as long as it is open.
      writeFileSync(join(dir, "app-profile", "lockfile"), "");
      const world = snapshot(root);
      const held = openSync(join(dir, "app-profile", "lockfile"), "r");
      try {
        const { code, out, err } = await reset(dir, ["--yes"]);
        assert.equal(code, 1, err || out);
        assert.match(err, /app-profile, the browser profile of the app window `npm run app` opens, is in use \(E[A-Z]+\): the window holds it while it is open — close it, then run this again\. Nothing was touched/);
      } finally {
        closeSync(held);
      }
      assert.deepEqual(snapshot(root), world, "every file where it was, config.json byte for byte");
      assert.deepEqual(filament.seen, [], "its Filament left running");
    });
  } finally {
    await filament.close();
  }
});

// (fails before: yes — a memory.folder naming a folder the reset keeps (memory-engine) was moved whole, the installed
// engine with it)
test("AH-C4: a memory.folder that would take what a reset keeps is refused before anything moves", async () => {
  const filament = await standIn();
  try {
    for (const folderOf of [(/** @type {{ root: string }} */ w) => w.root, (/** @type {{ dir: string }} */ w) => join(w.dir, "memory-engine")]) {
      await install(filament.port, async (w) => {
        filament.serves(w.dir);
        const cfgFile = join(w.dir, "config.json");
        const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
        cfg.memory.folder = folderOf(/** @type {any} */ (w));
        writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
        const world = snapshot(w.root);
        const { code, err } = await reset(w.dir, ["--yes"]);
        assert.equal(code, 2, err);
        assert.match(err, /^refusing: memory\.folder/);
        assert.deepEqual(snapshot(w.root), world, "nothing moved");
        assert.deepEqual(filament.seen, [], "no server was called");
      });
    }
  } finally {
    await filament.close();
  }
});

// (fails before: yes — --no-backup deleted the old list alone: tray.log, the logs' older generations, the session
// presets, the stale config copies and memory's backups stayed)
test("AH-C4: --no-backup deletes what a reset wipes and copies nothing", async () => {
  const filament = await standIn();
  try {
    await install(filament.port, async ({ dir, memory, backups }) => {
      filament.serves(dir);
      const { code, out, err } = await reset(dir, ["--yes", "--no-backup"]);
      assert.equal(code, 0, err || out);
      assert.deepEqual(readdirSync(dir).sort(), KEPT);
      assert.deepEqual(readdirSync(join(dir, "reset-backups")).sort(), ["2020-01-01T00-00-00-000Z", "2020-01-02T00-00-00-000Z", "2020-01-03T00-00-00-000Z"]);
      assert.ok(!existsSync(memory));
      assert.deepEqual(readdirSync(backups), ["notes.txt"]);
      assert.doesNotMatch(out, /a copy of everything wiped/);
    });
  } finally {
    await filament.close();
  }
});
