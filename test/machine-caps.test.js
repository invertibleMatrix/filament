// @ts-check
// What each machine has, so the agent chooses where to run (the remote-agents plan's p-caps): GET /api/machine/caps
// answers another machine's agents' device what this machine has to work with now — its CPUs and their load, its memory
// free, its GPU (services/machine-caps.js), the coding agents signed in here — and nothing of whose machine it is.
// list_machines says it per machine, with how many models answer there and its clones of this chat's project; the agent
// tool's sentence says to choose the machine by what the work needs, only where a machine is kept for the agents: a
// Filament with none sends the tools it always sent, byte for byte (prompt version 96, which p-caps shares).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { fakeUpstream, anthropicReply } from "./helpers/app.js";
import { asV116Tools, asV119Tools, asV122Tools } from "./helpers/team.js";
import { createMachines } from "../src/services/machines/index.js";
import { RUN_EVERYWHERE_LINE, createRemoteAgents } from "../src/app/agent/remote-agents.js";
import { GPU_KEPT_MS, GPU_TIMEOUT_MS, NVIDIA_ARGS, SAMPLE_MS, createMachineCaps, nvidiaGpus } from "../src/services/machine-caps.js";
import { systemRoutes } from "../src/http/admin/system.js";
import { AGENT_ROUTES } from "../src/http/admin/remote.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { AGENT_TOOL, coderAgentToolFor, loopToolArgs } from "../src/app/agent/tools.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";

const JSON_TYPE = { "content-type": "application/json" };
const ORIGIN = "https://github.com/acme/widgets.git";
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const sha = (/** @type {unknown} */ x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
// The tools a Filament with no agents' machine sends, as agent-tool-machines.test.js pins them: p-caps moves none of them.
const LOOP_AGENT_TOOL_SHA = "4bdb16d0b07eeea317232afc2947400321f00400a6d941ca85bf176a4226b6f4";
const CODER_AGENT_TOOL_SHA = "d8a867a55fe7ae3e2de6c91d3ab45293e946b5a8931d167c654a77044d514311";
const BASH_BACKGROUND_SHA = "d8f77193cf181d430f5ecb7c385b8b739e20d8bac50aee0c5002db20188acffb";

/** git in a folder, as a person types it, its commits by a test's name. @param {string} cwd @param {string[]} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A folder as the filesystem names it, in one case on Windows. @param {string} p */
const real = (p) => {
  const r = realpathSync.native(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};
/** A CPU's times, as os.cpus() gives them. @param {number} busy @param {number} idle */
const times = (busy, idle) => ({ user: busy, nice: 0, sys: 0, idle, irq: 0 });
/**
 * A system of the test's own for createMachineCaps: Linux on x64, two CPUs, its load 1.234, 8 of 32 GB free, no
 * nvidia-smi. @param {Parameters<typeof createMachineCaps>[0]} [o]
 */
const system = (o = {}) => ({
  platform: "linux",
  arch: "x64",
  cpus: () => [{ model: " AMD Ryzen 9 7950X ", times: times(10, 90) }, { model: "AMD Ryzen 9 7950X", times: times(10, 90) }],
  load: () => [1.234, 1, 1],
  free: () => 8 * GIB,
  total: () => 32 * GIB,
  run: async () => null,
  wait: async () => {},
  now: () => 0,
  ...o,
});
/** nvidia-smi's answer to NVIDIA_ARGS, two GPUs, the second saying nothing of its use. */
const SMI = "NVIDIA GeForce RTX 4090, 24564, 1210, 7\r\nNVIDIA A100-SXM4-80GB, 81920, [N/A], [Not Supported]\n\n";
/** A port nothing listens at. */
const deadPort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = /** @type {net.AddressInfo} */ (s.address()).port;
      s.close(() => resolve(port));
    });
  });

describe("this machine's caps (services/machine-caps.js)", () => {
  // (fails before: yes — there was no such module: nothing said a machine's GPU, so no agent could choose one by it)
  test("nvidia-smi's answer gives each GPU a line, its memory in bytes; none where nvidia-smi is not here", async () => {
    assert.deepEqual(nvidiaGpus(SMI), [
      { kind: "nvidia", name: "NVIDIA GeForce RTX 4090", memoryBytes: 24564 * MIB, usedBytes: 1210 * MIB, busyPercent: 7 },
      { kind: "nvidia", name: "NVIDIA A100-SXM4-80GB", memoryBytes: 81920 * MIB, usedBytes: null, busyPercent: null },
    ]);
    assert.deepEqual(nvidiaGpus(""), []);
    /** @type {any[]} */
    const calls = [];
    const caps = await createMachineCaps(system({ run: async (file, args, ms) => (calls.push([file, args, ms]), SMI) })).read();
    assert.deepEqual(caps.gpus.map((g) => g.name), ["NVIDIA GeForce RTX 4090", "NVIDIA A100-SXM4-80GB"]);
    assert.deepEqual(calls, [["nvidia-smi", NVIDIA_ARGS, GPU_TIMEOUT_MS]], "asked once, with a short timeout");
    assert.ok(GPU_TIMEOUT_MS <= 5000);
    // Not here (null), on Linux, an Intel Mac and Windows: none said, never a guess.
    for (const o of [{}, { platform: "darwin", arch: "x64" }, { platform: "win32" }]) assert.deepEqual((await createMachineCaps(system(o)).read()).gpus, [], JSON.stringify(o));
    // Its answer kept a few seconds: a list asked twice in a row runs it once.
    let t = 0;
    const counted = createMachineCaps(system({ now: () => t, run: async (file, args, ms) => (calls.push([file, args, ms]), SMI) }));
    calls.length = 0;
    await counted.read();
    await counted.read();
    assert.equal(calls.length, 1);
    t = GPU_KEPT_MS;
    await counted.read();
    assert.equal(calls.length, 2, "asked again once its answer is old");
  });

  // (fails before: yes — there was no such module: a Mac's chip and its GPU were said nowhere)
  test("Apple Silicon: the chip's own GPU, sharing the machine's memory; NVIDIA's word first wherever it answers", async () => {
    const chip = () => [{ model: "Apple M2 Pro", times: times(1, 1) }];
    assert.deepEqual((await createMachineCaps(system({ platform: "darwin", arch: "arm64", cpus: chip })).read()).gpus, [{ kind: "apple", name: "Apple M2 Pro", unified: true }]);
    assert.deepEqual((await createMachineCaps(system({ platform: "darwin", arch: "arm64", cpus: () => [] })).read()).gpus, [{ kind: "apple", name: "Apple Silicon", unified: true }], "no CPU named: the chip's family");
    assert.equal((await createMachineCaps(system({ platform: "darwin", arch: "arm64", cpus: chip, run: async () => SMI })).read()).gpus[0].kind, "nvidia");
  });

  // (fails before: yes — there was no such module: /api/state's system said the CPUs and memory as read once at start, never their load or what is free)
  test("the CPUs' load: the load average where the system keeps one, how busy a moment watched on Windows; memory free read anew", async () => {
    let free = 8 * GIB;
    const linux = createMachineCaps(system({ free: () => free }));
    const a = await linux.read();
    assert.deepEqual(a.cpu, { count: 2, model: "AMD Ryzen 9 7950X", load1: 1.23, busyPercent: null });
    assert.deepEqual(a.memory, { freeBytes: 8 * GIB, totalBytes: 32 * GIB });
    free = 2 * GIB;
    assert.equal((await linux.read()).memory.freeBytes, 2 * GIB, "free memory as it is now, not as it was");
    // Windows keeps no load average (os.loadavg is all zeros there): its CPUs watched SAMPLE_MS — 300 of 400 ms busy.
    let reads = 0;
    /** @type {number[]} */
    const waited = [];
    const win = await createMachineCaps(
      system({
        platform: "win32",
        load: () => [0, 0, 0],
        cpus: () => (reads++ === 0 ? [{ model: "Intel(R) Core(TM) i9", times: times(100, 900) }] : [{ model: "Intel(R) Core(TM) i9", times: times(400, 1000) }]),
        wait: async (ms) => void waited.push(ms),
      }),
    ).read();
    assert.deepEqual(win.cpu, { count: 1, model: "Intel(R) Core(TM) i9", load1: null, busyPercent: 75 });
    assert.deepEqual(waited, [SAMPLE_MS]);
  });
});

describe("GET /api/machine/caps (http/admin/system.js)", () => {
  /** A response as sendJson writes one. */
  const fakeRes = () => {
    const res = { writableEnded: false, destroyed: false, status: 0, body: "", writeHead(/** @type {number} */ s) { res.status = s; }, end(/** @type {string} */ b) { res.body = b; res.writableEnded = true; } };
    return res;
  };
  const CAPS = { cpu: { count: 4, model: "M", load1: 0.5, busyPercent: null }, memory: { freeBytes: GIB, totalBytes: 4 * GIB }, gpus: [] };

  // (fails before: yes — there was no such route, and nothing said which coding agents another machine has signed in)
  test("the coding agents signed in here, by name: connected, their program here, an account on that no agent said is signed out — never whose", async () => {
    const entries = [
      { name: "Claude Code", state: "connected", gone: false, upstreams: ["claude-code", "claude-code-work"] },
      { name: "Codex", state: "connected", gone: false, upstreams: ["codex"] },
      { name: "Cursor", state: "connected", gone: true, upstreams: ["cursor"] },
      { name: "Gemini CLI", state: "ready", gone: false, upstreams: [] },
      { name: "Qoder CLI", state: "connected", gone: false, upstreams: ["qoder", "qoder-off"] },
    ];
    /** @type {Record<string, any>} */
    const views = {
      // One account signed out, the other signed in as someone: Claude Code is signed in.
      "claude-code": { identity: { kind: "none" }, signedOut: true },
      "claude-code-work": { identity: { kind: "account", email: "dev@example.com", name: "Dev" }, signedOut: false },
      codex: { identity: { kind: "none" }, signedOut: true },
      // Its account turned off by itself is no account on; the one on has said nothing yet.
      "qoder-off": { identity: { kind: "account", email: "off@example.com" }, signedOut: false },
    };
    const upstreams = ["claude-code", "claude-code-work", "codex", "cursor", "qoder"].map((id) => ({ id, enabled: true })).concat([{ id: "qoder-off", enabled: false }]);
    const rows = systemRoutes({ config: { get: () => ({ upstreams }) }, codingAgents: { list: () => ({ entries }) }, accounts: { view: (/** @type {string} */ id) => views[id] ?? null }, machineCaps: { read: async () => CAPS } });
    const row = rows.find(([m, p]) => m === "GET" && p === "/machine/caps");
    assert.ok(row, "the row is there");
    const res = fakeRes();
    await row[2](/** @type {any} */ ({ res, who: { kind: "device", scope: "agent", device: { id: "d1", name: "Filament agents", grants: { agents: true } } } }), {});
    assert.equal(res.status, 200);
    const j = JSON.parse(res.body);
    assert.deepEqual(j, { ...CAPS, codingAgents: ["Claude Code", "Qoder CLI"] });
    assert.doesNotMatch(res.body, /example\.com|Dev/, "never whose accounts they are");
  });

  // (fails before: yes — the row was not on the agents' fence: Workstation refused it to Laptop's agents)
  test("another machine's agents may read it", () => {
    assert.ok(AGENT_ROUTES.includes("GET /machine/caps"));
  });
});

describe("two Filaments: what Workstation has, read by Laptop's agents", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-machine-caps-"));
  const hereRepo = join(base, "here", "widgets");
  const thereMain = join(base, "there", "widgets-main");
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  let deviceId = "";
  /** Switch the agents' grant there, as its own computer does. @param {boolean} on */
  const grant = async (on) => {
    const r = await two.there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: { agents: on } } });
    assert.equal(r.status, 200, await r.clone().text());
  };

  before(async () => {
    for (const d of [hereRepo, join(base, "there")]) mkdirSync(d, { recursive: true });
    gitIn(hereRepo, "init", "-q", "-b", "main");
    writeFileSync(join(hereRepo, "readme.md"), "widgets\n");
    gitIn(hereRepo, "add", ".");
    gitIn(hereRepo, "commit", "-q", "-m", "first");
    gitIn(join(base, "there"), "clone", "-q", hereRepo, thereMain);
    gitIn(hereRepo, "remote", "add", "origin", ORIGIN);
    gitIn(thereMain, "remote", "set-url", "origin", ORIGIN);
    up = await fakeUpstream(() => anthropicReply("ok", { model: "m-1" }));
    const models = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    };
    two = await startTwoMachines({ here: { configure: models }, there: { configure: models } });
    // The agents' device, minted by Laptop's full device and switched on by Workstation's own computer; kept on Laptop.
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    createMachines({ dataDir: two.here.dataDir }).keep({ url: two.remote.url, fingerprint: two.remote.fingerprint, machine: two.remote.machine, device: minted.device, token: minted.token });
    await grant(true);
    // A chat the person started there, in its clone: a folder /clones looks at.
    const r = await two.there.api("/api/sessions", { method: "POST", body: { cwd: thereMain, model: "m-1" } });
    assert.equal(r.status, 200, await r.clone().text());
  });

  after(async () => {
    await two?.stop();
    await up?.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — GET /api/machine/caps was no row: Workstation answered 404, and its agents' fence refused it)
  test("the route answers the agents' device what Workstation has now, and nothing of whose machine it is; its grant off, nothing", async () => {
    const client = await createMachines({ dataDir: two.here.dataDir }).clientOf("Workstation", { agents: true });
    const caps = await client.get("/machine/caps");
    assert.deepEqual(Object.keys(caps).sort(), ["codingAgents", "cpu", "gpus", "memory"]);
    assert.deepEqual(Object.keys(caps.cpu).sort(), ["busyPercent", "count", "load1", "model"]);
    assert.deepEqual(Object.keys(caps.memory).sort(), ["freeBytes", "totalBytes"]);
    assert.ok(caps.cpu.count >= 1);
    assert.ok(caps.cpu.load1 !== null || caps.cpu.busyPercent !== null, "a load, or how busy");
    assert.ok(caps.memory.freeBytes > 0 && caps.memory.freeBytes <= caps.memory.totalBytes);
    assert.ok(Array.isArray(caps.gpus));
    for (const g of caps.gpus) assert.ok(["nvidia", "apple"].includes(g.kind) && typeof g.name === "string");
    assert.deepEqual(caps.codingAgents, [], "no coding agent is connected on Workstation");
    // Nothing of whose machine it is: its data folder, the home folder, the user, the environment.
    const text = JSON.stringify(caps);
    for (const s of [two.there.dataDir, homedir(), String(process.env.PATH || "").split(/[;:]/)[0]].filter((x) => x && x.length > 2))
      assert.ok(!text.includes(s) && !text.includes(JSON.stringify(s).slice(1, -1)), `says ${s}`);
    const user = userInfo().username;
    if (user.length >= 3) assert.doesNotMatch(text, new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    // Its grant switched off there: refused, saying so.
    await grant(false);
    try {
      await assert.rejects(client.get("/machine/caps"), (/** @type {any} */ e) => e.body?.grant === "agents");
    } finally {
      await grant(true);
    }
  });

  // (fails before: yes — list_machines said each machine's name, system and grants alone: nothing of its CPUs, load,
  // memory, GPU, coding agents, models or clones, so an agent could not choose a machine by them)
  test("list_machines: each machine's system, what it has now, its coding agents and models, and its clone of this project; one that does not answer, a line", async (t) => {
    const dead = await deadPort();
    const store = createMachines({ dataDir: two.here.dataDir });
    store.keep({ url: `https://127.0.0.1:${dead}`, fingerprint: two.remote.fingerprint, machine: { id: "11111111-1111-4111-8111-111111111111", name: "Offline box" }, device: { id: "d-off", name: "Filament agents", scope: "agent" }, token: "fdt_offline" });
    const text = await createRemoteAgents({ machines: store }).machinesText({ folder: hereRepo });
    t.diagnostic(text);
    const lines = text.split("\n");
    assert.equal(lines[0], "Machines this Filament's agents may work on (2):");
    const at = lines.findIndex((l) => l.startsWith("- Workstation: "));
    assert.match(lines[at], /^- Workstation: answers · .+ · grants on there: agents$/);
    assert.match(lines[at + 1], /^ {2}\d+ CPUs? (\(.+\))?, (load [\d.]+|\d+% busy) · [\d.]+ of [\d.]+ GB memory free · GPU: .+$/);
    assert.match(lines[at + 2], /^ {2}no coding agent signed in · \d+ models? answers? · clone of this project at (.+) on main \(clean\)$/);
    const clone = /clone of this project at (.+) on main/.exec(lines[at + 2])?.[1] ?? "";
    assert.equal(real(clone), real(thereMain));
    assert.match(text, /^- Offline box: does not answer now \(.+\)$/m);
    assert.equal(lines.filter((l) => l.startsWith("  ")).length, 2, "one that does not answer is one line");
    // A folder outside git: nothing to find a clone by, so none is said.
    const plain = mkdtempSync(join(base, "plain-"));
    const outside = await createRemoteAgents({ machines: store }).machinesText({ folder: plain });
    assert.doesNotMatch(outside, /clone/);
    assert.match(outside, /^ {2}no coding agent signed in · \d+ models? answers?$/m);
  });
});

// (fails before: yes — machinesText had no caps, models or clones to say: each machine's line held its system and grants alone)
test("list_machines' lines, as said for each kind of machine: one with a clone, one without, one older, one that does not answer", async () => {
  const repo = mkdtempSync(join(tmpdir(), "filament-caps-repo-"));
  try {
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "remote", "add", "origin", ORIGIN);
    const rows = ["Studio", "Server", "Laptop", "Old box", "Away"].map((name) => ({ name, machine: { id: `id-${name}`, name }, device: { scope: "agent" } }));
    const at = `/clones?remote=${encodeURIComponent(ORIGIN)}`;
    /** @type {Record<string, Record<string, any>>} */
    const answers = {
      Studio: {
        "/remote/me": { device: { grants: { agents: true, models: true } } },
        "/machine/caps": { cpu: { count: 12, model: "Apple M2 Pro", load1: 0.42, busyPercent: null }, memory: { freeBytes: 12.4 * GIB, totalBytes: 32 * GIB }, gpus: [{ kind: "apple", name: "Apple M2 Pro", unified: true }], codingAgents: ["Claude Code", "Codex"] },
        "/models": { models: [{ id: "a", answers: true }, { id: "b", answers: true }, { id: "c", answers: false }] },
        [at]: { clones: [{ path: "/Users/dev/work/widgets", head: "abc", branch: "main", dirty: false }, { path: "/Users/dev/work/widgets-ui", head: "abd", branch: "ui", dirty: true }] },
      },
      Server: {
        "/remote/me": { device: { grants: { agents: true } } },
        "/machine/caps": { cpu: { count: 8, model: "Intel(R) Xeon(R)", load1: null, busyPercent: 3 }, memory: { freeBytes: 7.46 * GIB, totalBytes: 16 * GIB }, gpus: [{ kind: "nvidia", name: "NVIDIA GeForce RTX 4090", memoryBytes: 24564 * MIB, usedBytes: 1210 * MIB, busyPercent: 7 }], codingAgents: [] },
        "/models": { models: [{ id: "a", answers: true }] },
        [at]: { clones: [] },
      },
      // (fails before: yes — the swarm's review of 11-10: none nvidia-smi sees was said as no GPU, an AMD's or Intel's among them)
      Laptop: {
        "/remote/me": { device: { grants: { agents: true } } },
        "/machine/caps": { cpu: { count: 16, model: "AMD Ryzen 9", load1: null, busyPercent: 12 }, memory: { freeBytes: 20 * GIB, totalBytes: 64 * GIB }, gpus: [], codingAgents: [] },
        "/models": { models: [] },
        [at]: { clones: [] },
      },
      // An older Filament: no caps route (404), its models not listed.
      "Old box": { "/remote/me": { device: { grants: { agents: true } } }, [at]: { clones: [{ path: "D:\\src\\widgets", head: null, branch: null, dirty: null }] } },
    };
    const systems = { Studio: { os: "macOS 15.1", arch: "arm64" }, Server: { os: "Ubuntu 22.04.4 LTS", arch: "x64" }, Laptop: { os: "Windows 11 Home", arch: "x64" }, "Old box": { os: "Windows 11 Pro", arch: "x64" } };
    const store = /** @type {any} */ ({
      list: () => rows,
      find: (/** @type {string} */ w) => rows.find((m) => m.name === w) ?? null,
      clientOf: async (/** @type {any} */ m) => {
        if (m.name === "Away") throw new Error("No Filament answers at https://10.0.0.9:7443");
        return {
          state: { system: /** @type {any} */ (systems)[m.name] },
          get: async (/** @type {string} */ path) => {
            const j = answers[m.name][path];
            if (j === undefined) throw Object.assign(new Error(`HTTP 404 for ${path}`), { status: 404 });
            return j;
          },
        };
      },
    });
    const text = await createRemoteAgents({ machines: store }).machinesText({ folder: repo });
    assert.equal(
      text,
      [
        "Machines this Filament's agents may work on (5):",
        "- Studio: answers · macOS 15.1 arm64 · grants on there: agents, models",
        "  12 CPUs (Apple M2 Pro), load 0.42 · 12 of 32 GB memory free · GPU: Apple M2 Pro's, sharing the machine's memory",
        "  coding agents signed in: Claude Code, Codex · 2 models answer · clones of this project: /Users/dev/work/widgets on main (clean); /Users/dev/work/widgets-ui on ui (uncommitted changes)",
        "- Server: answers · Ubuntu 22.04.4 LTS x64 · grants on there: agents",
        "  8 CPUs (Intel(R) Xeon(R)), 3% busy · 7.5 of 16 GB memory free · GPU: NVIDIA GeForce RTX 4090, 24 GB, 1.2 GB used, 7% busy",
        "  no coding agent signed in · 1 model answers · no clone of this project",
        "- Laptop: answers · Windows 11 Home x64 · grants on there: agents",
        "  16 CPUs (AMD Ryzen 9), 12% busy · 20 of 64 GB memory free · GPU: none nvidia-smi sees",
        "  no coding agent signed in · no models answer · no clone of this project",
        "- Old box: answers · Windows 11 Pro x64 · grants on there: agents",
        "  its CPUs, memory, GPU and coding agents unsaid",
        "  its models unsaid · clone of this project at D:\\src\\widgets on a detached HEAD",
        "- Away: does not answer now (No Filament answers at https://10.0.0.9:7443)",
        `Launch a sub-agent there with machine: "<its name>" — its report comes back here.`,
        RUN_EVERYWHERE_LINE,
      ].join("\n"),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

describe("the tool text", () => {
  // (fails before: no — it guards that a Filament with no agents' machine sends the tools it always sent, byte for byte)
  test("no machine kept for the agents: the agent tool, a coding agent's and bash_background as they were", () => {
    assert.equal(PROMPT_VERSION, 129, "p-caps shares the remote-agents plan's release (106); 107 to 116 move none of these tools, 117 the agent tool's line on what a sub-agent goes without alone (asV116Tools), and 118 none of them either (a running task's checklist as its steps), nor 119; 120 a coding agent's task field alone (asV119Tools); 123 bash_background's sentence on the filtered environment alone (asV122Tools)");
    assert.equal(sha(asV116Tools(AGENT_TOOL)), LOOP_AGENT_TOOL_SHA);
    assert.equal(loopToolArgs({}).find((t) => t.name === "agent"), AGENT_TOOL);
    assert.equal(sha(asV119Tools(coderAgentToolFor({ asks: [] }))), CODER_AGENT_TOOL_SHA);
    const bg = HAND_TOOLS.find((t) => t.name === "bash_background");
    assert.equal(sha(asV122Tools(bg)), BASH_BACKGROUND_SHA);
    assert.equal(loopToolArgs({}).find((t) => t.name === "bash_background"), bg);
  });

  // (fails before: yes — the machine sentence said where a sub-agent there runs, never which machine to choose or that
  // list_machines says what each has)
  test("a machine kept: the agent tool says to choose the machine by what the work needs, list_machines first when unsure; a coding agent's copy stays whole", () => {
    assert.match(TOOL_TEXT.agentMachine, /Choose the machine by what the work needs \(macOS for a Mac build, a GPU for training or local models, the idle one for a long suite\), calling list_machines first when unsure\.$/);
    const agent = /** @type {any} */ (loopToolArgs({ machines: true }).find((t) => t.name === "agent"));
    assert.ok(agent.description.endsWith(TOOL_TEXT.agentMachine));
    assert.match(agent.input_schema.properties.list_machines.description, /what it has to work with \(system, CPUs and load, memory, GPU, coding agents, models\) and its clones of this project/);
    const coder = coderAgentToolFor({ asks: [], machines: true });
    assert.ok(coder.description.length < 2048, `${coder.description.length}: whole where Claude Code cuts a description at 2,048 characters`);
  });
});
