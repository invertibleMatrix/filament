// @ts-check
// HarnessV3-ACP AC3-8, the server's side of Settings → Coding agents: ACP's registry as read and checked, its icons
// kept (adapters/agents/registry.js); Filament's installs of its agents — planned, found, settled, removed, swept
// (adapters/agents/installs.js); through the whole app, every agent's entry, an agent installed in a terminal (npm's
// and uv's stand-ins, in a stand-in for node-pty), updated, failed and stopped, installed in a terminal of one's own
// then connected, a known agent installed for the whole computer, turned off and on, removed, and the refusals; and
// the section's steps one at a time over stand-ins (app/coding-agents.js). The test's own PATH is the computer's
// programs, and a stand-in answers for the registry's CDN: nothing installs, downloads or signs in for real.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

import {
  ICON_MAX_BYTES,
  REGISTRY_MAX_BYTES,
  REGISTRY_STALE_MS,
  REGISTRY_URL,
  checkRegistry,
  createRegistry,
  isAgentId,
  platformTarget,
  safeSvg,
} from "../src/adapters/agents/registry.js";
import { createInstalls, npmCommandName, throughLink } from "../src/adapters/agents/installs.js";
import { createCodingAgents } from "../src/app/coding-agents.js";
import { commandExists } from "../src/adapters/agents/agent-process.js";
import { findSdkDir } from "../src/adapters/agents/cursor-sdk.js";
import { AGENT_CATALOGUE, RETIRED_AGENTS, catalogueUpstream, commandLine, entryOf, installCommand } from "../src/core/catalogues.js";
import { normalizeConfig, withoutRetiredAgents } from "../src/services/config/store.js";
import { startApp, FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const win = process.platform === "win32";
/** An icon at the registry's own address. @param {string} id */
const ICON = (id) => `https://cdn.agentclientprotocol.com/registry/v1/latest/${id}.svg`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 2h12v12H2z"/></svg>`;
/** This computer as the registry names it, and another. */
const TARGET = platformTarget(process.platform, process.arch);
const OTHER = TARGET === "linux-x86_64" ? "darwin-aarch64" : "linux-x86_64";

/**
 * A registry agent as checked. @param {string} id @param {string} version
 * @param {Partial<import("../src/adapters/agents/registry.js").RegistryAgent>} [ways]
 * @returns {import("../src/adapters/agents/registry.js").RegistryAgent}
 */
const agentOf = (id, version, ways = {}) => ({
  id, name: id, version, description: "", authors: [], license: null, licenseUrl: null, website: null, repository: null, icon: null,
  npx: null, uvx: null, binary: null, ...ways,
});

/**
 * A zip of `files` (name -> content), as a maker's release holds one: each entry deflated, its mode a program's, its
 * name as given — one that climbs out (`../x`) too, which no zip tool writes. `{ link }`: a symbolic link to it, as
 * zip keeps one (its mode a link's, its content where it leads).
 * @param {Record<string, string | { link: string }>} files @returns {Buffer}
 */
const zipOf = (files) => {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let at = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(typeof content === "string" ? content : content.link);
    const packed = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(((typeof content === "string" ? 0o100755 : 0o120777) << 16) >>> 0, 38);
    central.writeUInt32LE(at, 42);
    locals.push(local, n, packed);
    centrals.push(central, n);
    at += 30 + n.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, directory, end]);
};
/**
 * A tar.gz of `files` (name -> content), each a program's, its name as given — one outside its folder too. `{ link }`:
 * a symbolic link to it.
 * @param {Record<string, string | { link: string }>} files @returns {Buffer}
 */
const tarGzOf = (files) => {
  /** @type {Buffer[]} */
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const link = typeof content === "string" ? null : content.link;
    const data = Buffer.from(link == null ? /** @type {string} */ (content) : "");
    const head = Buffer.alloc(512);
    head.write(name, 0, 100);
    head.write(link == null ? "0000755\0" : "0000777\0", 100);
    head.write("0000000\0", 108);
    head.write("0000000\0", 116);
    head.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    head.write("00000000000\0", 136);
    head.write("        ", 148);
    head.write(link == null ? "0" : "2", 156);
    if (link != null) head.write(link, 157, 100);
    head.write("ustar\0", 257);
    head.write("00", 263);
    const sum = head.reduce((s, b) => s + b, 0);
    head.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(head, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
};
/** @param {Buffer} b */
const sha256Of = (b) => createHash("sha256").update(b).digest("hex");

describe("ACP's registry as read (adapters/agents/registry.js)", () => {
  test("each entry checked: an agent kept with what it says rightly, its own wrong words and links dropped; one that can't be run left out, saying why", () => {
    const { agents, kept, dropped } = checkRegistry({
      agents: [
        {
          id: "good", name: "  Good \n Agent ", version: "1.2.3", description: "Does   things.", authors: ["A", "  B ", 7, "C", "D", "E", "F"],
          license: "MIT", license_url: "https://user:pw@example.test/l", website: "http://example.test", repository: "https://example.test/repo",
          icon: "javascript:alert(1)", distribution: { npx: { package: "@scope/good@1.2.3", args: ["--acp"], env: { GOOD_MODE: "acp" } } },
        },
        { id: "py", name: "Py", version: "0.1.0", distribution: { uvx: { package: "py-agent@v0.1.0" } } },
        { id: "prog", name: "Prog", version: "2026.1", distribution: { binary: { "windows-x86_64": { archive: "https://example.test/p.zip", cmd: "./p.exe", sha256: "A".repeat(64) } } } },
        { id: "../up", name: "Up", version: "1", distribution: { npx: { package: "x@1" } } },
        { id: "con", name: "Con", version: "1", distribution: { npx: { package: "x@1" } } },
        { id: "no-name", version: "1", distribution: { npx: { package: "x@1" } } },
        { id: "long-name", name: "L".repeat(81), version: "1", distribution: { npx: { package: "x@1" } } },
        { id: "no-version", name: "V", version: "1.0.", distribution: { npx: { package: "x@1" } } },
        { id: "bad-npm", name: "N", version: "1", distribution: { npx: { package: "x; rm -rf /" } } },
        { id: "bad-uv", name: "U", version: "1", distribution: { uvx: { package: "py agent==1" } } },
        { id: "bad-args", name: "Args", version: "1", distribution: { npx: { package: "x@1", args: ["ok", "line\nbreak"] } } },
        { id: "many-args", name: "Many", version: "1", distribution: { npx: { package: "x@1", args: Array(17).fill("a") } } },
        { id: "bad-env", name: "Env", version: "1", distribution: { npx: { package: "x@1", env: { "BAD-NAME": "x" } } } },
        { id: "plain-http", name: "H", version: "1", distribution: { binary: { "linux-x86_64": { archive: "http://example.test/h.tgz", cmd: "./h" } } } },
        { id: "odd-target", name: "T", version: "1", distribution: { binary: { "plan9-mips": { archive: "https://example.test/t.tgz", cmd: "./t" } } } },
        // The registry names systems Filament runs on none of (11-11: linux-aarch64-musl and linux-x86_64-musl, on nine
        // agents): such a program is passed over, whatever it says, and the agent stays.
        {
          id: "musl", name: "Musl", version: "3", distribution: {
            npx: { package: "musl-agent@3" },
            binary: { "windows-x86_64": { archive: "https://example.test/m.zip", cmd: "./m.exe" }, "linux-aarch64-musl": { archive: "https://example.test/m-musl.tgz", cmd: "./m" }, "linux-x86_64-musl": { archive: "not an address" } },
          },
        },
        { id: "bad-sum", name: "S", version: "1", distribution: { binary: { "linux-x86_64": { archive: "https://example.test/s.tgz", cmd: "./s", sha256: "abc" } } } },
        { id: "nothing", name: "Nothing", version: "1", distribution: {} },
        { id: "good", name: "Twice", version: "9", distribution: { npx: { package: "y@9" } } },
      ],
    });
    assert.deepEqual(agents, [
      {
        id: "good", name: "Good Agent", version: "1.2.3", description: "Does things.", authors: ["A", "B", "C", "D", "E"], license: "MIT",
        licenseUrl: null, website: null, repository: "https://example.test/repo", icon: null,
        npx: { name: "@scope/good", version: "1.2.3", args: ["--acp"], env: { GOOD_MODE: "acp" } }, uvx: null, binary: null,
      },
      { ...agentOf("py", "0.1.0"), name: "Py", uvx: { name: "py-agent", version: "0.1.0", args: [], env: {} } },
      { ...agentOf("prog", "2026.1"), name: "Prog", binary: { "windows-x86_64": { archive: "https://example.test/p.zip", cmd: "./p.exe", args: [], env: {}, sha256: "a".repeat(64) } } },
      // (fails before: yes — both were left out, "its program for plan9-mips isn't said rightly" and "… for
      // linux-aarch64-musl …": one program for a system Filament does not know took the whole agent, its npm package
      // and its Windows program with it)
      // One whose programs are all for such systems is listed with none: no build for this computer, as a Mac-only
      // agent is on Windows (installs.js `plan`).
      { ...agentOf("odd-target", "1"), name: "T", binary: {} },
      { ...agentOf("musl", "3"), name: "Musl", npx: { name: "musl-agent", version: "3", args: [], env: {} }, binary: { "windows-x86_64": { archive: "https://example.test/m.zip", cmd: "./m.exe", args: [], env: {}, sha256: null } } },
    ]);
    assert.deepEqual(kept.map((/** @type {any} */ k) => k.id), ["good", "py", "prog", "odd-target", "musl"], "kept as given");
    assert.deepEqual(dropped, [
      { id: "../up", why: "its id isn't one" },
      { id: "con", why: "its id isn't one" },
      { id: "no-name", why: "it has no name" },
      // (fails before: no — a guard the mutation pass asked for: no name was too long, and no agent took too many
      // arguments)
      { id: "long-name", why: "it has no name" },
      { id: "no-version", why: "its version isn't one" },
      { id: "bad-npm", why: "its npm package isn't one" },
      { id: "bad-uv", why: "its Python package isn't one" },
      { id: "bad-args", why: "its npm package isn't one" },
      { id: "many-args", why: "its npm package isn't one" },
      { id: "bad-env", why: "its npm package isn't one" },
      { id: "plain-http", why: "its program for linux-x86_64 isn't said rightly" },
      { id: "bad-sum", why: "its program for linux-x86_64 isn't said rightly" },
      { id: "nothing", why: "it says no way to install it" },
      { id: "good", why: "its id is another entry's" },
    ]);
    assert.throws(() => checkRegistry({ version: "1" }), { message: "it lists no agents" });
  });

  test("an icon is served only as an SVG with no script, no event, no embedded document and no reference outside itself", () => {
    assert.equal(safeSvg(SVG), true);
    assert.equal(safeSvg(`<?xml version="1.0"?>\n<!-- drawn by hand -->\n<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>`), true);
    assert.equal(safeSvg(`<svg><rect fill="url('#g')"/><use xlink:href=" #g"/><use href=#g /></svg>`), true, "its own references, however quoted");
    for (const bad of [
      `<svg><script>alert(1)</script></svg>`,
      `<svg onload="alert(1)"></svg>`,
      `<svg><a href="https://example.test">x</a></svg>`,
      `<svg><a href=https://example.test>x</a></svg>`,
      `<svg><rect fill="url( 'https://example.test/x')"/></svg>`,
      `<svg><image xlink:href="data:image/png;base64,AAAA"/></svg>`,
      `<svg><rect style="fill: url(https://example.test/x)"/></svg>`,
      `<svg><foreignObject><div/></foreignObject></svg>`,
      `<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>`,
      `<html><svg></svg></html>`,
      `<svg>${" ".repeat(ICON_MAX_BYTES)}</svg>`,
      "",
    ])
      assert.equal(safeSvg(bad), false, bad.slice(0, 40));
  });

  test("an agent's id is a folder's name safe on every system; this computer as the registry names systems", () => {
    assert.deepEqual(["claude-acp", "a", "a.b_c-d", "x".repeat(64)].map(isAgentId), [true, true, true, true]);
    assert.deepEqual(["", "a.", ".a", "a/b", "..", "CON", "nul.txt", "x".repeat(65), 7].map(isAgentId), Array(9).fill(false));
    assert.deepEqual(
      [["win32", "x64"], ["darwin", "arm64"], ["linux", "x64"], ["linux", "ia32"], ["freebsd", "x64"]].map(([p, a]) => platformTarget(p, a)),
      ["windows-x86_64", "darwin-aarch64", "linux-x86_64", null, null],
    );
  });

  test("read from its CDN and kept with its icons — the registry's own, each checked; a read under way shared; older than a day, stale; one that fails keeps the copy and says why", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-registry-"));
    try {
      let t = 1_000_000;
      /** @type {string[]} */
      const asked = [];
      /** @param {string} id @param {string} [icon] */
      const listed = (id, icon = ICON(id)) => ({ id, name: id, version: "1.0.0", icon, distribution: { npx: { package: `${id}@1.0.0` } } });
      let index = { agents: [listed("one"), listed("two", "https://elsewhere.example.test/two.svg"), listed("three"), listed("four"), { ...listed("bad id"), id: "bad id" }] };
      let down = false;
      /** @param {any} url */
      const get = async (url) => {
        asked.push(String(url));
        if (url === REGISTRY_URL) return down ? new Response("no", { status: 503 }) : new Response(JSON.stringify(index));
        if (String(url).endsWith("/three.svg")) return new Response(`<svg onload="x()"></svg>`);
        if (String(url).endsWith("/four.svg")) return new Response("gone", { status: 404 });
        return new Response(SVG);
      };
      /** @type {string[]} */
      const logs = [];
      const reg = createRegistry({ dir, fetch: /** @type {any} */ (get), log: (level, msg) => logs.push(`${level} ${msg}`), now: () => t });
      assert.deepEqual([reg.view(), reg.stale()], [{ at: null, agents: [], asking: false, error: null }, true]);
      const reading = reg.refresh();
      assert.equal(reg.refresh(), reading, "a read under way is shared");
      assert.equal(reg.view().asking, true);
      await reading;
      assert.equal(asked.filter((u) => u === REGISTRY_URL).length, 1);
      assert.deepEqual([reg.view().at, reg.view().agents.map((a) => a.id), reg.view().asking, reg.view().error], [t, ["one", "two", "three", "four"], false, null]);
      assert.deepEqual(asked.filter((u) => u !== REGISTRY_URL).sort(), [ICON("four"), ICON("one"), ICON("three")], "the registry's own icons only");
      assert.equal(readFileSync(String(reg.iconOf("one")), "utf8"), SVG);
      // (fails before: no — a guard the mutation pass asked for: no id reached a kept icon from outside its folder)
      assert.deepEqual(
        ["two", "three", "four", "../one", "bad id", "../icons/one"].map((id) => reg.iconOf(id)),
        [null, null, null, null, null, null],
        "one elsewhere, one that runs a script, one not found; no id that isn't one",
      );
      assert.ok(logs.includes("warn registry: bad id left out: its id isn't one"), logs.join("\n"));
      const again = createRegistry({ dir, fetch: /** @type {any} */ (async () => assert.fail("not read again")), now: () => t });
      assert.deepEqual([again.view().at, again.view().agents.length, again.stale()], [t, 4, false], "the copy kept in its folder");
      // (fails before: no — a guard the mutation pass asked for: no copy kept in the folder was wrong)
      const kept = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8"));
      writeFileSync(join(dir, "registry.json"), JSON.stringify({ ...kept, agents: [...kept.agents, { ...listed("five"), id: "../five" }] }));
      const checked = createRegistry({ dir, fetch: /** @type {any} */ (async () => assert.fail("not read again")), now: () => t });
      assert.deepEqual(checked.view().agents.map((a) => a.id), ["one", "two", "three", "four"], "the copy is checked again as it is read");
      t += REGISTRY_STALE_MS + 1;
      assert.equal(reg.stale(), true, "older than a day");
      down = true;
      await reg.refresh();
      assert.deepEqual([reg.view().at, reg.view().agents.length, reg.view().error], [1_000_000, 4, "it answered 503"]);
      down = false;
      index = { agents: [listed("two", "https://elsewhere.example.test/two.svg")] };
      await reg.refresh();
      assert.deepEqual([reg.view().at, reg.view().agents.map((a) => a.id), reg.view().error], [t, ["two"], null]);
      assert.equal(reg.iconOf("one"), null, "an agent no longer listed loses its icon");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an index larger than a megabyte, or sent on somewhere that isn't https, is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-registry-"));
    try {
      const big = createRegistry({ dir, fetch: /** @type {any} */ (async () => new Response("x".repeat(REGISTRY_MAX_BYTES + 1))) });
      await big.refresh();
      assert.equal(big.view().error, `it is larger than ${REGISTRY_MAX_BYTES} bytes`);
      const moved = { ok: true, status: 200, url: "http://example.test/registry.json", headers: new Headers(), body: new Response("{}").body };
      const sent = createRegistry({ dir, fetch: /** @type {any} */ (async () => moved) });
      await sent.refresh();
      assert.equal(sent.view().error, "it was sent on somewhere that isn't https");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Filament's installs of the registry's agents (adapters/agents/installs.js)", () => {
  test("an npm package's command, told as t3 tells it", () => {
    assert.equal(npmCommandName("x", "@scope/tool", "cli.js"), "tool");
    // (fails before: no — a guard the mutation pass asked for: no lone script's package had a name that isn't a file's)
    assert.equal(npmCommandName("x", "tool.", "cli.js"), null);
    assert.equal(npmCommandName("x", "@scope/tool", { one: "a.js" }), "one");
    assert.equal(npmCommandName("x", "tool", { other: "a.js", tool: "b.js" }), "tool");
    assert.equal(npmCommandName("agent-id", "pkg", { "agent-id": "a.js", other: "b.js" }), "agent-id");
    assert.equal(npmCommandName("x", "pkg", { beta: "a.js", alpha: "a.js" }), "alpha", "all run one file: the first by name");
    assert.equal(npmCommandName("x", "pkg", { beta: "a.js", alpha: "b.js" }), null);
    assert.equal(npmCommandName("x", "pkg", { "../evil": "a.js", ok: "b.js" }), "ok", "a name that isn't a file's is passed over");
    assert.equal(npmCommandName("x", "pkg", null), null);
  });

  // (fails before: yes — a program to download had no plan: Filament installed only what npm or uv installs)
  test("an install planned at the registry's exact version in a folder of its own — npm's prefix there, uv's tool folders, or a program's download for this computer; none where its build is another computer's or its command is outside its download", () => {
    const dir = join(tmpdir(), "filament-plans-are-not-written", "installed");
    const ins = createInstalls({ dir, platform: "linux", arch: "x64" });
    const folder = join(dir, "one", "1.2.0");
    const argv = ["npm", "install", "--global", "--prefix", folder, "@s/one@1.2.0"];
    assert.deepEqual(ins.plan(agentOf("one", "1.2.0", { npx: { name: "@s/one", version: "1.2.0", args: ["--acp"], env: { A: "1" } } })), {
      id: "one", version: "1.2.0", way: "npx", package: "@s/one", folder, argv, env: {}, line: commandLine(argv, {}, "linux"), start: { args: ["--acp"], env: { A: "1" } },
    });
    const uv = ins.plan(agentOf("two", "0.3.0", { uvx: { name: "two-acp", version: "0.3.0", args: [], env: {} } }));
    const env = { UV_TOOL_DIR: join(dir, "two", "0.3.0", "tools"), UV_TOOL_BIN_DIR: join(dir, "two", "0.3.0", "bin") };
    assert.deepEqual([uv?.argv, uv?.env, uv?.line], [["uv", "tool", "install", "--force", "two-acp==0.3.0"], env, commandLine(["uv", "tool", "install", "--force", "two-acp==0.3.0"], env, "linux")]);
    const program = { archive: "https://example.test/t.tgz", cmd: "./bin\\t", args: ["acp"], env: { B: "2" }, sha256: null };
    assert.deepEqual(ins.plan(agentOf("three", "1", { binary: { "linux-x86_64": program, "windows-x86_64": { ...program, cmd: "t.exe" } } })), {
      id: "three", version: "1", way: "binary", package: program.archive, folder: join(dir, "three", "1"), argv: [], env: {}, line: program.archive,
      start: { args: ["acp"], env: { B: "2" } }, program,
    });
    assert.equal(ins.plan(agentOf("three", "1", { binary: { "darwin-aarch64": program } })), null, "no build for this computer");
    for (const cmd of ["../t", "./bin/../../t", "/usr/bin/t", "C:\\t.exe", "./", ""])
      assert.equal(ins.plan(agentOf("three", "1", { binary: { "linux-x86_64": { ...program, cmd } } })), null, cmd);
    assert.equal(ins.plan(agentOf("../x", "1", { npx: { name: "x", version: "1", args: [], env: {} } })), null);
    assert.equal(existsSync(dirname(dir)), false, "a plan writes nothing");
  });

  /**
   * Filament's installs here, fetching through a stand-in for the makers' addresses: `served` maps an address to what
   * it answers — an archive, or a redirect's `{ to }` — any other answers 404; `asked` keeps each address asked.
   * @param {{ maxBytes?: number }} [o]
   */
  const programs = (o = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "filament-programs-"));
    /** @type {Map<string, Buffer | { to: string } | { length: number }>} */
    const served = new Map();
    /** @type {string[]} */
    const asked = [];
    /** @param {any} url @param {any} init */
    const get = async (url, init) => {
      asked.push(String(url));
      assert.equal(init?.redirect, "manual", "a redirect is followed by hand, each hop checked");
      const s = served.get(String(url));
      if (!s) return new Response("not here", { status: 404 });
      if ("to" in s) return new Response(null, { status: 302, headers: { location: s.to } });
      if (!Buffer.isBuffer(s)) return new Response("x", { headers: { "content-length": String(s.length) } });
      return new Response(new Uint8Array(s), { headers: { "content-length": String(s.length) } });
    };
    const ins = createInstalls({ dir: join(dir, "installed"), fetch: /** @type {any} */ (get), now: () => 7, ...o });
    /** @type {string[]} */
    const said = [];
    /** A program's download, its words kept. @param {any} p @param {AbortSignal} [signal] */
    const download = (p, signal = new AbortController().signal) => ins.download(p, { say: (t) => void said.push(t), signal });
    /** A program for this computer. @param {string} id @param {Partial<import("../src/adapters/agents/registry.js").ProgramWay>} way @returns {any} */
    const planOf = (id, way) =>
      ins.plan(agentOf(id, "1.0.0", { binary: { [String(TARGET)]: { archive: `https://example.test/${id}.zip`, cmd: `./${id}`, args: [], env: {}, sha256: null, ...way } } }));
    return { dir, served, asked, ins, said, download, planOf };
  };
  /** A program's file as it is named on this computer. @param {string} name */
  const exe = (name) => (win ? `${name}.exe` : name);

  // (fails before: yes — a program to download had no install: its row linked the raw archive and waited for its
  // command on the PATH, which Filament reads once at its start)
  test("a program downloaded into its version's folder: a zip, a tar.gz and a raw program, each checked against the registry's checksum where it gives one, unpacked or copied as it is; its receipt names its command's full path", async () => {
    const t = programs();
    try {
      const zip = zipOf({ [`bin/${exe("zip-agent")}`]: "the zip's agent", "bin/README": "read me" });
      t.served.set("https://example.test/zip-agent.zip", zip);
      // As Devin's registry entry names it: a folder, then Windows' separator.
      const p = t.planOf("zip-agent", { cmd: `./bin\\${exe("zip-agent")}`, args: ["acp"], env: { A: "1" }, sha256: sha256Of(zip) });
      assert.equal(t.ins.found(p), null, "nothing there");
      await t.download(p);
      const command = join(p.folder, "program", "bin", exe("zip-agent"));
      assert.equal(readFileSync(command, "utf8"), "the zip's agent");
      assert.deepEqual(readdirSync(p.folder), ["program"], "the archive goes once unpacked");
      const words = t.said.join("");
      for (const w of ["Downloading https://example.test/zip-agent.zip", "100%", "Its checksum is the one ACP's registry gives.", "Unpacking", `Installed: ${command}`])
        assert.ok(words.includes(w), `${w} in ${JSON.stringify(words)}`);
      const receipt = { id: "zip-agent", version: "1.0.0", way: "binary", package: "https://example.test/zip-agent.zip", command, args: ["acp"], env: { A: "1" }, at: 7 };
      assert.deepEqual([t.ins.settle(p), t.ins.receipt("zip-agent")], [receipt, receipt]);
      // A tar.gz with no checksum, its command in a folder of the archive's own (as Cortex Code's), through a redirect.
      t.served.set("https://example.test/tar-agent.tar.gz", { to: "https://cdn.example.test/tar-agent-1.tar.gz" });
      t.served.set("https://cdn.example.test/tar-agent-1.tar.gz", tarGzOf({ [`coco-1/${exe("cortex")}`]: "the tar's agent" }));
      const q = t.planOf("tar-agent", { archive: "https://example.test/tar-agent.tar.gz", cmd: `./coco-1/${exe("cortex")}` });
      t.said.length = 0;
      await t.download(q);
      assert.equal(readFileSync(join(q.folder, "program", "coco-1", exe("cortex")), "utf8"), "the tar's agent");
      assert.ok(t.said.join("").includes("ACP's registry gives no checksum for it: it isn't checked."), t.said.join(""));
      assert.deepEqual(t.asked.slice(-2), ["https://example.test/tar-agent.tar.gz", "https://cdn.example.test/tar-agent-1.tar.gz"]);
      // A raw program, copied as it is under its command's name.
      const raw = Buffer.from("MZ the raw agent");
      t.served.set(`https://example.test/${exe("raw-agent-amd64")}`, raw);
      const r = t.planOf("raw-agent", { archive: `https://example.test/${exe("raw-agent-amd64")}`, cmd: `./${exe("raw-agent-amd64")}`, sha256: sha256Of(raw) });
      await t.download(r);
      assert.deepEqual([readFileSync(join(r.folder, "program", exe("raw-agent-amd64")), "utf8"), readdirSync(r.folder)], ["MZ the raw agent", ["program"]]);
      assert.equal(t.ins.settle(r).command, join(r.folder, "program", exe("raw-agent-amd64")));
      assert.deepEqual(t.ins.all().map((x) => x.id).sort(), ["raw-agent", "zip-agent"]);
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — nothing downloaded a program, so nothing refused one)
  test("a download refused in words: a checksum that isn't the registry's, one larger than the cap (said or sent), sent on somewhere that isn't https, an address that answers an error, an entry that would unpack outside its folder, no command where the registry names it; stopped, it stops", async () => {
    const t = programs({ maxBytes: 4096 });
    try {
      const zip = zipOf({ [exe("a")]: "a" });
      t.served.set("https://example.test/a.zip", zip);
      const wrong = "0".repeat(64);
      await assert.rejects(t.download(t.planOf("a", { cmd: exe("a"), sha256: wrong })), {
        message: `its checksum isn't the one ACP's registry gives (sha256 ${sha256Of(zip).slice(0, 12)}…, not ${wrong.slice(0, 12)}…): nothing was installed`,
      });
      assert.equal(existsSync(join(t.dir, "installed", "a", "1.0.0", "program")), false, "nothing unpacked");
      t.served.set("https://example.test/big.zip", { length: 5000 });
      await assert.rejects(t.download(t.planOf("big", {})), { message: "the download is larger than 4096 bytes" });
      t.served.set("https://example.test/sent.zip", Buffer.alloc(5000));
      await assert.rejects(t.download(t.planOf("sent", {})), { message: "the download is larger than 4096 bytes" });
      t.served.set("https://example.test/moved.zip", { to: "http://example.test/plain.zip" });
      await assert.rejects(t.download(t.planOf("moved", {})), { message: "the download was sent on to an address that isn't https" });
      await assert.rejects(t.download(t.planOf("nowhere", {})), { message: "its address answered 404" });
      t.served.set("https://example.test/slip.zip", zipOf({ [exe("slip")]: "ok", "../evil.txt": "out" }));
      const slip = t.planOf("slip", { cmd: exe("slip") });
      await assert.rejects(t.download(slip), { message: "the download holds ../evil.txt, which would unpack outside its folder: nothing was installed" });
      assert.deepEqual([existsSync(join(slip.folder, "evil.txt")), existsSync(join(slip.folder, "program"))], [false, false]);
      t.served.set("https://example.test/abs.tar.gz", tarGzOf({ [exe("abs")]: "ok", "/abs.txt": "out" }));
      await assert.rejects(t.download(t.planOf("abs", { archive: "https://example.test/abs.tar.gz", cmd: exe("abs") })), { message: "the download holds /abs.txt, which would unpack outside its folder: nothing was installed" });
      t.served.set("https://example.test/hollow.zip", zipOf({ "other.txt": "x" }));
      await assert.rejects(t.download(t.planOf("hollow", { cmd: `./bin/${exe("hollow")}` })), { message: `the download holds no ./bin/${exe("hollow")}, the command ACP's registry names` });
      const stop = new AbortController();
      stop.abort();
      await assert.rejects(t.download(t.planOf("a", { cmd: exe("a") }), stop.signal), { name: "AbortError" });
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the re-read's finding 17: the refusal of an entry under a link was tested on lists of names
  // written by hand, never on an archive that holds a link, and the look for a link leading out after unpacking had no
  // test at all; with either check taken out of `download` this fails)
  test("a download that holds a link: an entry under it is refused before anything unpacks; a link that leads outside its folder is refused once unpacked, and nothing of it stays", async () => {
    const t = programs();
    try {
      // `<dir>/installed/<id>/1.0.0/program` is where it unpacks: four folders up is the test's own, with a folder to aim at.
      const out = "../../../../loot";
      mkdirSync(join(t.dir, "loot"));
      t.served.set("https://example.test/through.zip", zipOf({ [exe("through")]: "ok", dot: { link: out }, "dot/authorized_keys": "a key" }));
      const through = t.planOf("through", { cmd: exe("through") });
      await assert.rejects(t.download(through), { message: "the download holds dot/authorized_keys, which would unpack through a link: nothing was installed" });
      assert.deepEqual([readdirSync(join(t.dir, "loot")), existsSync(join(through.folder, "program"))], [[], false], "nothing written through the link, nothing unpacked");
      // A tarball's link with nothing under it unpacks, where this computer lets a program make a link (Windows asks for
      // Developer Mode or an administrator): the look after unpacking finds it. Elsewhere tar itself can't write it.
      const canLink = (() => {
        try {
          symlinkSync("nowhere", join(t.dir, "probe"));
          unlinkSync(join(t.dir, "probe"));
          return true;
        } catch {
          return false;
        }
      })();
      t.served.set("https://example.test/leads.tar.gz", tarGzOf({ [exe("leads")]: "ok", dot: { link: out } }));
      const leads = t.planOf("leads", { archive: "https://example.test/leads.tar.gz", cmd: exe("leads") });
      await assert.rejects(t.download(leads), canLink ? { message: "the download holds dot, a link that leads outside its folder: nothing was installed" } : /couldn't unpack it/);
      if (canLink) assert.equal(existsSync(join(leads.folder, "program")), false, "what it unpacked is gone");
      assert.deepEqual(readdirSync(join(t.dir, "loot")), []);
      // A link that stays inside its folder is a maker's own (a `bin` that points at its program): it installs.
      t.served.set("https://example.test/inside.tar.gz", tarGzOf({ [`lib/${exe("inside")}`]: "ok", current: { link: "lib" } }));
      const inside = t.planOf("inside", { archive: "https://example.test/inside.tar.gz", cmd: `./lib/${exe("inside")}` });
      if (canLink) await t.download(inside);
      if (canLink) assert.equal(readFileSync(join(inside.folder, "program", "lib", exe("inside")), "utf8"), "ok");
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  test("an install that ended well is found where its installer puts it, then settled: its receipt names the command; one half done is not, and settling it says why", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-installs-"));
    try {
      for (const platform of ["win32", "linux"]) {
        const ins = createInstalls({ dir: join(dir, platform), platform, now: () => 42 });
        const p = /** @type {import("../src/adapters/agents/installs.js").InstallPlan} */ (ins.plan(agentOf("one", "1.2.0", { npx: { name: "@s/one", version: "1.2.0", args: ["--acp"], env: {} } })));
        assert.equal(ins.found(p), null, "nothing there");
        mkdirSync(p.folder, { recursive: true });
        assert.throws(() => ins.settle(p), { message: `the install ended, but @s/one isn't in ${p.folder}` });
        const pkg = platform === "win32" ? join(p.folder, "node_modules", "@s", "one") : join(p.folder, "lib", "node_modules", "@s", "one");
        mkdirSync(pkg, { recursive: true });
        writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@s/one", bin: { "one-acp": "bin.js" } }));
        assert.equal(ins.found(p), null, "its command not made yet");
        assert.throws(() => ins.settle(p), { message: "the install ended, but @s/one's command one-acp isn't where npm puts it" });
        const command = platform === "win32" ? join(p.folder, "one-acp.cmd") : join(p.folder, "bin", "one-acp");
        mkdirSync(dirname(command), { recursive: true });
        writeFileSync(command, "");
        assert.equal(ins.found(p), command);
        assert.equal(ins.receipt("one"), null, "found is not settled");
        const receipt = { id: "one", version: "1.2.0", way: "npx", package: "@s/one", command, args: ["--acp"], env: {}, at: 42 };
        assert.deepEqual([ins.settle(p), ins.receipt("one")], [receipt, receipt]);
        // uv's: a command named as the agent, as its package, or as that without `-acp`.
        const u = /** @type {import("../src/adapters/agents/installs.js").InstallPlan} */ (ins.plan(agentOf("two", "0.3.0", { uvx: { name: "two-acp", version: "0.3.0", args: [], env: {} } })));
        mkdirSync(join(u.folder, "bin"), { recursive: true });
        assert.throws(() => ins.settle(u), { message: `the install ended, but uv made none of the commands two, two-acp in ${join(u.folder, "bin")}` });
        const exe = join(u.folder, "bin", platform === "win32" ? "two-acp.exe" : "two-acp");
        writeFileSync(exe, "");
        assert.equal(ins.settle(u).command, exe);
        assert.deepEqual(ins.all().map((r) => r.id).sort(), ["one", "two"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a receipt is trusted only as its own agent's, naming a command inside Filament's folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-installs-"));
    try {
      const ins = createInstalls({ dir });
      /** @param {string} id @param {Record<string, any> | string} r */
      const write = (id, r) => {
        mkdirSync(join(dir, id), { recursive: true });
        writeFileSync(join(dir, id, "install.json"), typeof r === "string" ? r : JSON.stringify(r));
      };
      const good = { id: "a", version: "1", way: "npx", package: "a", command: join(dir, "a", "1", "a.cmd"), args: [], env: {}, at: 5 };
      write("a", good);
      assert.deepEqual(ins.receipt("a"), good);
      // (fails before: yes — a program's download left no receipt Filament trusted)
      const program = { ...good, id: "p", way: "binary", package: "https://example.test/p.zip", command: join(dir, "p", "1", "program", "p.exe") };
      write("p", program);
      assert.deepEqual(ins.receipt("p"), program);
      write("b", { ...good, id: "a" });
      write("c", { ...good, id: "c", command: join(tmpdir(), "elsewhere.cmd") });
      write("d", { ...good, id: "d", way: "brew" });
      write("e", { ...good, id: "e", args: [7] });
      write("f", "{ not json");
      // (fails before: no — a guard the mutation pass asked for: no receipt named the folder itself, or another drive)
      write("g", { ...good, id: "g", command: dir });
      write("h", { ...good, id: "h", command: win ? "Z:\\elsewhere\\h.cmd" : "/elsewhere/h" });
      assert.deepEqual(["b", "c", "d", "e", "f", "g", "h", "../a"].map((id) => ins.receipt(id)), Array(8).fill(null));
      assert.deepEqual(ins.all().map((r) => r.id), ["a", "p"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removed: its receipt, then its folder; an update's other versions dropped; at start, what no receipt names goes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-installs-"));
    try {
      const ins = createInstalls({ dir });
      for (const f of ["one/1.0.0/x", "one/2.0.0/x", "ghost/1.0.0/x", "not an id/x", "two/3.0.0/x"]) {
        mkdirSync(join(dir, dirname(f)), { recursive: true });
        writeFileSync(join(dir, f), "");
      }
      writeFileSync(join(dir, "notes.txt"), "");
      /** @param {string} id @param {string} version */
      const receipt = (id, version) =>
        writeFileSync(join(dir, id, "install.json"), JSON.stringify({ id, version, way: "npx", package: id, command: join(dir, id, version, "x"), args: [], env: {}, at: 1 }));
      receipt("one", "2.0.0");
      receipt("two", "3.0.0");
      assert.deepEqual(await ins.dropOthers("one"), []);
      assert.deepEqual([existsSync(join(dir, "one", "1.0.0")), existsSync(join(dir, "one", "2.0.0"))], [false, true]);
      mkdirSync(join(dir, "one", "0.9.0"));
      await ins.sweep();
      assert.deepEqual(
        ["one/0.9.0", "one/2.0.0", "ghost", "not an id", "two/3.0.0", "notes.txt"].map((f) => existsSync(join(dir, f))),
        [false, true, false, true, true, true],
        "another version and an agent with no receipt go; what isn't an agent's folder stays",
      );
      assert.deepEqual(await ins.remove("one"), { folder: join(dir, "one"), kept: null });
      assert.deepEqual([existsSync(join(dir, "one")), ins.receipt("one")], [false, null]);
      assert.deepEqual(await ins.remove("nope"), { folder: null, kept: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** The command a program's download holds, as its registry entry names it: npm's shim on Windows, elsewhere a script. */
const BIN_CMD = win ? "./bin\\bin-agent.cmd" : "./bin/bin-agent";
/**
 * The registry the stand-in for its CDN serves, its npm agent's, its uv agent's and its program's versions as given.
 * @param {{ npx: string, uv: string, bin?: string }} v
 */
const registryOf = (v) => ({
  version: "1.0.0",
  agents: [
    {
      id: "npx-agent", name: "Npx Agent", version: v.npx, description: "An agent npm installs.", authors: ["Fake Co"], license: "MIT",
      website: "https://example.test/npx", icon: ICON("npx-agent"), distribution: { npx: { package: `@fake/npx-agent@${v.npx}`, args: ["--acp"] } },
    },
    {
      id: "uv-agent", name: "Uv Agent", version: v.uv, description: "An agent uv installs.", authors: ["Fake Co"], license: "Apache-2.0",
      icon: ICON("uv-agent"), distribution: { uvx: { package: `fake-uv-agent==${v.uv}`, args: [FAKE_ACP_AGENT] } },
    },
    { id: "line-agent", name: "Line Agent", version: "1.0.0", description: "Installed in a terminal of one's own.", icon: ICON("line-agent"), distribution: { npx: { package: "@fake/line-agent@1.0.0" } } },
    {
      id: "bin-agent", name: "Bin Agent", version: v.bin || "0.3.0", description: "A program to download.", icon: ICON("bin-agent"),
      distribution: { binary: { [String(TARGET)]: { archive: `https://example.test/bin-agent-${v.bin || "0.3.0"}.zip`, cmd: BIN_CMD, args: ["--quiet"] } } },
    },
    {
      id: "path-agent", name: "Path Agent", version: "0.2.0", description: "Its command outside its download.", icon: ICON("path-agent"),
      distribution: { binary: { [String(TARGET)]: { archive: "https://example.test/path-agent.zip", cmd: "../path-agent.exe" } } },
    },
    {
      id: "far-agent", name: "Far Agent", version: "0.1.0", description: "Made for another computer.", icon: ICON("far-agent"),
      distribution: { binary: { [OTHER]: { archive: "https://example.test/far.tgz", cmd: "./far" } } },
    },
    { id: "qoder", name: "Qoder CLI", version: "0.44.1", authors: ["Qoder"], license: "Proprietary", icon: ICON("qoder"), distribution: { npx: { package: "@qoder-ai/qodercli@0.44.1", args: ["--acp"] } } },
    { id: "claude-acp", name: "Claude Agent", version: "0.76.0", authors: ["Anthropic"], icon: ICON("claude-acp"), distribution: { npx: { package: "@agentclientprotocol/claude-agent-acp@0.76.0" } } },
    { id: "cursor", name: "Cursor", version: "2026.10.1", authors: ["Anysphere"], icon: ICON("cursor"), distribution: { npx: { package: "@fake/cursor@2026.10.1", args: ["acp"] } } },
    { id: "Bad Id", name: "Left out", version: "1", distribution: { npx: { package: "x@1" } } },
  ],
});

/**
 * A command on the test's PATH that runs `js` (beside it) with Node: npm's shim on Windows, which Filament reads to run
 * its script with its own Node; elsewhere a script.
 * @param {string} dir @param {string} name @param {string} js
 */
const shimFor = (dir, name, js) => {
  if (win) writeFileSync(join(dir, `${name}.cmd`), `@ECHO off\r\nnode "%dp0%\\${basename(js)}" %*\r\n`);
  else {
    writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    chmodSync(join(dir, name), 0o755);
  }
};

describe("the agents Filament knows, as Settings → Coding agents offers them (core/catalogues.js)", () => {
  /** One of the catalogue's agents. @param {string} id @returns {any} */
  const knownOne = (id) => AGENT_CATALOGUE.find((a) => a.id === id);

  // (fails before: yes — Cursor's install line was Windows' only: a Mac or Linux was given PowerShell's)
  test("each installs its maker's way on the system it runs on: Cursor its own script on Windows and on the others, an npm package alike on both", () => {
    const cursor = knownOne("cursor");
    assert.deepEqual(installCommand(cursor, "win32"), {
      argv: ["powershell.exe", "-NoProfile", "-Command", "irm 'https://cursor.com/install?win32=true' | iex"],
      line: "irm 'https://cursor.com/install?win32=true' | iex",
    });
    for (const platform of ["linux", "darwin"])
      assert.deepEqual(installCommand(cursor, platform), { argv: ["sh", "-c", "curl https://cursor.com/install -fsS | bash"], line: "curl https://cursor.com/install -fsS | bash" }, platform);
    for (const platform of ["win32", "linux"])
      assert.deepEqual(installCommand(knownOne("qoder"), platform), { argv: ["npm", "install", "-g", "@qoder-ai/qodercli"], line: "npm install -g @qoder-ai/qodercli" }, platform);
    // An update's, at the registry's version (HarnessV3-ACP AF3); a script installs what it installs.
    assert.deepEqual(installCommand(knownOne("claude-code"), "linux", "0.87.0"), {
      argv: ["npm", "install", "-g", "@agentclientprotocol/claude-agent-acp@0.87.0"],
      line: "npm install -g @agentclientprotocol/claude-agent-acp@0.87.0",
    });
    assert.deepEqual(installCommand(cursor, "linux", "2026.10.01"), installCommand(cursor, "linux"));
  });

  // (fails before: yes — Qoder's two sites shared one card, both rows "Default": the cards went by the program an
  // account runs)
  test("each is a card of its own, Qoder's two sites two; an account added beside one is its agent's; Cursor's SDK route is apart from its CLI; a registry agent is its own", () => {
    for (const a of AGENT_CATALOGUE) assert.equal(entryOf(/** @type {any} */ (catalogueUpstream(a)), new Set()), a.id, a.id);
    const claude = /** @type {any} */ (catalogueUpstream(knownOne("claude-code")));
    assert.equal(entryOf({ ...claude, id: "claude-code-work", name: "Claude Code · Work", acp: { ...claude.acp, account: "Work" } }, new Set()), "claude-code");
    assert.equal(entryOf({ id: "cursor-2", type: "cursor-sdk" }, new Set()), "cursor-sdk");
    assert.equal(entryOf({ id: "npx-agent", type: "acp", acp: { command: join(tmpdir(), "npx-agent.cmd") } }, new Set(["npx-agent"])), "npx-agent");
    assert.equal(entryOf({ id: "mine", type: "acp", acp: { command: "/opt/bin/my-agent" } }, new Set()), "my-agent", "one Filament doesn't know: the program it runs");
  });
});

describe("Settings → Coding agents through the app: listed, installed, updated, stopped, connected, turned off, removed", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let bin = "";
  let globalDir = "";
  let installed = "";
  let NPM_JS = "";
  let UV_JS = "";
  let AGENT_JS = "";
  /** The variables the test sets, as they were. @type {Record<string, string | undefined>} */
  const was = {};
  let served = registryOf({ npx: "1.0.0", uv: "2.0.0" });
  let down = false;
  /** No terminal opens here: node-pty, as where it can't load. */
  let noTerminal = false;
  /** @type {{ args: string[], cwd: string, env: Record<string, string>, child: import("node:child_process").ChildProcess }[]} */
  const ran = [];

  /**
   * A stand-in for node-pty (`terminalSpawn`): the installers' stand-ins run as child processes. Nothing else runs —
   * a real npm or uv would be refused, as node-pty refuses a program it can't start.
   * @param {any} o
   */
  const terminalSpawn = (o) => {
    if (noTerminal) throw new Error("no terminal here");
    const script = o.file === process.execPath ? o.args[0] : !win && (o.file === "npm" || o.file === "uv") ? (o.file === "npm" ? NPM_JS : UV_JS) : "";
    if (![NPM_JS, UV_JS].includes(script)) throw new Error(`the stand-in runs only the installers' stand-ins, not ${o.file} ${o.args.join(" ")}`);
    const args = o.file === process.execPath ? o.args : [script, ...o.args];
    const child = spawn(process.execPath, args, { cwd: o.cwd, env: o.env, windowsHide: true });
    ran.push({ args, cwd: o.cwd, env: o.env, child });
    /** @type {((d: string) => void)[]} */
    const data = [];
    /** @type {((e: any) => void)[]} */
    const exits = [];
    const said = (/** @type {Buffer} */ b) => {
      for (const fn of data) fn(String(b));
    };
    child.stdout.on("data", said);
    child.stderr.on("data", said);
    child.on("close", (code) => {
      for (const fn of exits) fn({ exitCode: code, signal: 0 });
    });
    return {
      write: (/** @type {string} */ d) => child.stdin.write(d),
      resize: () => {},
      kill: () => child.kill(),
      onData: (/** @type {any} */ fn) => data.push(fn),
      onExit: (/** @type {any} */ fn) => exits.push(fn),
    };
  };
  /** The program's downloads, by address: a zip holding its command and the fake agent it starts. @type {Map<string, Buffer>} */
  const archives = new Map();
  /**
   * The registry's CDN: its index, and its icons — one of them an SVG that would run a script; and the program's
   * maker's address, its downloads.
   * @param {any} url
   */
  const registryFetch = async (url) => {
    if (url === REGISTRY_URL) return down ? new Response("down", { status: 503 }) : new Response(JSON.stringify(served));
    const archive = archives.get(String(url));
    if (archive) return new Response(new Uint8Array(archive));
    return new Response(String(url).endsWith("/far-agent.svg") ? `<svg onload="alert(1)"></svg>` : SVG);
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-coding-agents-"));
    bin = join(root, "bin");
    globalDir = join(root, "global");
    for (const d of [bin, globalDir, join(root, "appdata"), join(root, "localappdata"), join(root, "work")]) mkdirSync(d);
    NPM_JS = join(bin, "npm.mjs");
    UV_JS = join(bin, "uv.mjs");
    AGENT_JS = join(bin, "agent.mjs");
    writeFileSync(NPM_JS, `import ${JSON.stringify(pathToFileURL(join(FIXTURES, "fake-npm.mjs")).href)};\n`);
    writeFileSync(UV_JS, `import ${JSON.stringify(pathToFileURL(join(FIXTURES, "fake-uv.mjs")).href)};\n`);
    writeFileSync(AGENT_JS, `import ${JSON.stringify(pathToFileURL(FAKE_ACP_AGENT).href)};\n`);
    // This computer's programs: npm and uv (each its stand-in) and Claude's adapter (the fake agent), and npm's global
    // folder, where an install for the whole computer goes. Nothing of the computer's own is in reach.
    for (const [name, js] of [["npm", NPM_JS], ["uv", UV_JS], ["claude-agent-acp", AGENT_JS]]) shimFor(bin, name, js);
    for (const k of ["PATH", "APPDATA", "LOCALAPPDATA", "FAKE_NPM_PREFIX"]) was[k] = process.env[k];
    process.env.PATH = [bin, win ? globalDir : join(globalDir, "bin")].join(delimiter);
    process.env.APPDATA = join(root, "appdata");
    process.env.LOCALAPPDATA = join(root, "localappdata");
    process.env.FAKE_NPM_PREFIX = globalDir;
    for (const c of ["claude", "codex", "agent", "agy_acp_server", "qodercli", "bin-agent", "path-agent"]) assert.equal(commandExists(c), false, `${c} is out of reach`);
    // The program's two versions: its command (npm's shim on Windows, a script elsewhere) starting the fake agent.
    const launcher = win ? `@ECHO off\r\nnode "%dp0%\\agent.mjs" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/agent.mjs" "$@"\n`;
    for (const v of ["0.3.0", "0.4.0"])
      archives.set(`https://example.test/bin-agent-${v}.zip`, zipOf({ [BIN_CMD.slice(2).replace(/\\/g, "/")]: launcher, "bin/agent.mjs": `import ${JSON.stringify(pathToFileURL(FAKE_ACP_AGENT).href)};\n` }));
    shim = await startApp({
      overrides: { terminalSpawn, registryFetch },
      configure: (cfg) => {
        cfg.upstreams = [
          // Claude Code, as the fake agent plays it: connected.
          {
            id: "claude-code", name: "Claude Code (agent via ACP)", type: "acp", enabled: true,
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: join(root, "work"), permissions: "allow-all" },
          },
          { id: "api", name: "API", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "k", enabled: true },
          // An agent neither the catalogue nor the registry offers, made by hand on the console.
          { id: "mine", name: "My Agent", type: "acp", enabled: false, acp: { command: "my-agent" } },
        ];
        cfg.routes = [
          { match: "claude-code/*", upstream: "claude-code", upstreamModel: "{1}", enabled: true },
          { match: "*", upstream: "api", enabled: true },
        ];
      },
    });
    installed = join(shim.dataDir, "agents", "installed");
  });
  after(async () => {
    await shim?.stop();
    for (const t of ran) if (t.child.exitCode === null && t.child.signalCode === null) t.child.kill();
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await removeDirs(root);
  });

  /** @returns {Promise<any>} */
  const list = async () => (await shim.api("/api/coding-agents")).json();
  /** @param {string} id @returns {Promise<any>} */
  const entry = async (id) => (await list()).entries.find((/** @type {any} */ e) => e.id === id);
  /** A route of the section: its status and its answer. @param {string} method @param {string} path @returns {Promise<any>} */
  const call = async (method, path) => {
    const res = await shim.api(`/api/coding-agents${path}`, { method });
    return { status: res.status, ...(await res.json()) };
  };
  /** An entry once `holds` does. @param {string} id @param {(e: any) => boolean} holds @param {string} what */
  const once = (id, holds, what) => until(async () => {
    const e = await entry(id);
    return e && holds(e) ? e : null;
  }, what, { timeoutMs: 30_000 });
  /** @param {string} id @returns {any} */
  const upstream = (id) => shim.app.config.upstreams.find((/** @type {any} */ u) => u.id === id);
  /** An installer's stand-in run in a terminal of one's own. @param {string} js @param {string[]} args @param {Record<string, string>} env */
  const byHand = (js, args, env) => {
    const r = spawnSync(process.execPath, [js, ...args], { env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  };
  /** The command npm makes for a package's one command, in a prefix. @param {string} prefix @param {string} name */
  const npmBin = (prefix, name) => (win ? join(prefix, `${name}.cmd`) : join(prefix, "bin", name));

  test("every agent's entry — the ones Filament knows in its order, then the registry's by name, read on the first look — where each stands and how it installs; their icons served as images that run nothing", async () => {
    const first = await list();
    assert.deepEqual(first.registry, { at: null, asking: true, error: null }, "the first look reads the registry");
    const all = await until(async () => {
      const l = await list();
      return l.registry.at ? l : null;
    }, "the registry to be read");
    // (fails before: no — a guard the mutation pass asked for: no agent upstream was made by hand, and no registry
    // entry folded into a card was another id's)
    assert.deepEqual(all.entries.map((/** @type {any} */ e) => [e.id, e.from, e.state]), [
      ["claude-code", "filament", "connected"],
      ["codex", "filament", "missing"],
      ["cursor", "filament", "missing"],
      ["cursor-sdk", "filament", findSdkDir() ? "ready" : "missing"],
      ["antigravity-acp", "filament", "missing"],
      ["qoder", "filament", "missing"],
      ["qoder-cn", "filament", "missing"],
      ["bin-agent", "registry", "missing"],
      ["far-agent", "registry", "missing"],
      ["line-agent", "registry", "missing"],
      ["npx-agent", "registry", "missing"],
      ["path-agent", "registry", "missing"],
      ["uv-agent", "registry", "missing"],
      ["my-agent", "config", "missing"],
    ]);
    /** @param {string} id @returns {any} */
    const by = (id) => all.entries.find((/** @type {any} */ e) => e.id === id);
    const { profile, models, asking, modelsError, primary, ...npx } = by("npx-agent");
    assert.deepEqual(npx, {
      id: "npx-agent", name: "Npx Agent", about: "An agent npm installs.", authors: ["Fake Co"], license: "MIT", docs: "https://example.test/npx",
      from: "registry", mark: "npx-agent", version: "1.0.0", state: "missing", upstreams: [], installed: null, runs: null, update: null,
      install: { way: "npx", line: commandLine(["npm", "install", "--global", "--prefix", join(installed, "npx-agent", "1.0.0"), "@fake/npx-agent@1.0.0"], {}, process.platform), needs: null },
      download: null, unavailable: false, gone: false, installing: null, lastInstall: null,
    });
    assert.deepEqual([profile, models, asking, modelsError, primary], [null, null, false, null, null]);
    assert.deepEqual([by("uv-agent").install.way, by("uv-agent").install.needs], ["uvx", null]);
    // (fails before: yes — a program to download had no install: its row linked the raw archive, a dead end)
    assert.deepEqual([by("bin-agent").install, by("bin-agent").download, by("bin-agent").unavailable], [{ way: "binary", line: "https://example.test/bin-agent-0.3.0.zip", needs: null }, null, false]);
    assert.deepEqual([by("path-agent").install, by("path-agent").download], [null, { url: "https://example.test/path-agent.zip", program: "path-agent" }], "its command outside its download: no install");
    assert.deepEqual([by("far-agent").download, by("far-agent").unavailable, by("far-agent").mark], [null, true, null], "made for another computer; its icon, which would run a script, left out");
    // Qoder is the catalogue's: its name, the registry's makers and mark, its maker's install.
    const qd = by("qoder");
    assert.deepEqual([qd.name, qd.authors, qd.license, qd.mark, qd.version, qd.install], ["Qoder", ["Qoder"], "Proprietary", "qoder", null, { way: "npm", line: "npm install -g @qoder-ai/qodercli", needs: null }]);
    assert.deepEqual([by("claude-code").upstreams, by("claude-code").primary, by("claude-code").gone], [["claude-code"], "claude-code", false]);
    // (fails before: no — a guard the mutation pass asked for: no card wore the mark of a registry entry another
    // card is)
    assert.deepEqual([by("cursor").mark, by("cursor-sdk").mark, by("cursor-sdk").authors], ["cursor", "cursor", ["Anysphere"]], "Cursor's SDK route wears its CLI's mark");
    assert.equal(all.computer, TARGET);
    const icon = await shim.api("/api/coding-agents/icons/npx-agent");
    assert.deepEqual(
      [icon.status, icon.headers.get("content-type"), icon.headers.get("content-security-policy"), icon.headers.get("x-content-type-options"), await icon.text()],
      [200, "image/svg+xml", "default-src 'none'; style-src 'unsafe-inline'; sandbox", "nosniff", SVG],
    );
    for (const id of ["far-agent", "..%2F..%2Fconfig.json", "nope"]) assert.equal((await shim.api(`/api/coding-agents/icons/${id}`)).status, 404, id);
  });

  // (fails before: yes, on Windows — an agent command given as an npm shim's full path couldn't start: Node refuses
  // to spawn a `.cmd`)
  test("an npm agent installed in a terminal, into Filament's own folder at the registry's version: then connected, its models asked for", async () => {
    const folder = join(installed, "npx-agent", "1.0.0");
    const argv = ["npm", "install", "--global", "--prefix", folder, "@fake/npx-agent@1.0.0"];
    const r = await call("POST", "/npx-agent/install");
    assert.equal(r.status, 200, r.error);
    assert.deepEqual({ ...r.installing, terminal: typeof r.installing.terminal, at: typeof r.installing.at }, { terminal: "string", line: commandLine(argv, {}, process.platform), at: "number", version: "1.0.0" });
    assert.deepEqual(r.entries.find((/** @type {any} */ e) => e.id === "npx-agent").installing, r.installing, "its entry says so");
    assert.deepEqual([ran.at(-1)?.args.slice(1), ran.at(-1)?.cwd], [argv.slice(1), folder], "npm's stand-in, in the version's folder");
    const e = await once("npx-agent", (x) => x.lastInstall?.outcome === "installed" && x.models?.count === 2, "the install to end and its models to come");
    assert.deepEqual([e.state, e.installed.version, e.upstreams, e.primary, e.installing, e.lastInstall.error], ["connected", "1.0.0", ["npx-agent"], "npx-agent", null, null]);
    const command = npmBin(folder, "npx-agent");
    const u = upstream("npx-agent");
    assert.deepEqual([u.name, u.type, u.enabled, u.acp.command, u.acp.args, u.acp.modelSelection], ["Npx Agent", "acp", true, command, ["--acp"], "session"]);
    assert.ok(shim.app.config.routes.some((/** @type {any} */ x) => x.match === "npx-agent/*" && x.upstream === "npx-agent" && x.enabled !== false));
    const receipt = JSON.parse(readFileSync(join(installed, "npx-agent", "install.json"), "utf8"));
    assert.deepEqual({ ...receipt, at: typeof receipt.at }, { id: "npx-agent", version: "1.0.0", way: "npx", package: "@fake/npx-agent", command, args: ["--acp"], env: {}, at: "number" });
  });

  test("updated to the registry's newer version: its account moves to it, and the older version's folder goes", async () => {
    served = registryOf({ npx: "1.1.0", uv: "2.0.0" });
    const r = await call("POST", "/registry/refresh");
    const before = r.entries.find((/** @type {any} */ e) => e.id === "npx-agent");
    assert.deepEqual([before.installed.version, before.update, before.version, before.state], ["1.0.0", "1.1.0", "1.1.0", "connected"]);
    const started = await call("POST", "/npx-agent/install");
    assert.equal(started.installing?.version, "1.1.0", started.error);
    const e = await once("npx-agent", (x) => x.lastInstall?.at > before.lastInstall.at && x.lastInstall.outcome === "installed", "the update to end");
    assert.deepEqual([e.installed.version, e.update, e.state, e.upstreams], ["1.1.0", null, "connected", ["npx-agent"]]);
    assert.equal(upstream("npx-agent").acp.command, npmBin(join(installed, "npx-agent", "1.1.0"), "npx-agent"));
    assert.equal(existsSync(join(installed, "npx-agent", "1.0.0")), false, "the older version's folder gone");
    await once("npx-agent", (x) => x.models?.count === 2 && !x.asking, "its models asked for again");
  });

  test("an update that fails, and one stopped: each said, its half-made folder gone, the agent left as it was", async () => {
    served = registryOf({ npx: "1.2.0", uv: "2.0.0" });
    await call("POST", "/registry/refresh");
    const half = join(installed, "npx-agent", "1.2.0");
    process.env.FAKE_NPM_FAIL = "1";
    try {
      assert.equal((await call("POST", "/npx-agent/install")).status, 200);
      const e = await once("npx-agent", (x) => x.lastInstall?.outcome === "failed", "the install to fail");
      assert.deepEqual([e.lastInstall.error, e.installed.version, e.update, e.state], ["the install ended with code 1", "1.1.0", "1.2.0", "connected"]);
      assert.equal(existsSync(half), false);
    } finally {
      delete process.env.FAKE_NPM_FAIL;
    }
    process.env.FAKE_NPM_WAIT = "1";
    try {
      const r = await call("POST", "/npx-agent/install");
      await until(() => existsSync(join(half, win ? "node_modules" : "lib")), "the install half done");
      assert.deepEqual((await call("POST", "/npx-agent/install")).installing, r.installing, "asked again while it runs, the install under way comes back");
      assert.deepEqual(await call("POST", "/npx-agent/connect"), { status: 409, error: "Npx Agent is being installed: connect it once the install ends" });
      assert.deepEqual(await call("POST", "/npx-agent/off"), { status: 409, error: "Npx Agent is being installed: turn it off once the install ends" });
      assert.equal((await call("POST", "/npx-agent/install/cancel")).stopped, true);
      const e = await once("npx-agent", (x) => x.lastInstall?.outcome === "cancelled", "the install to stop");
      assert.deepEqual([e.lastInstall.error, e.installed.version, e.state, e.installing], [null, "1.1.0", "connected", null]);
      assert.equal(existsSync(half), false);
      assert.equal((await call("POST", "/npx-agent/install/cancel")).stopped, false, "nothing under way, nothing stopped");
    } finally {
      delete process.env.FAKE_NPM_WAIT;
    }
  });

  test("a Python agent installed with uv, its tool folders in Filament's own; started with the registry's arguments", async () => {
    const folder = join(installed, "uv-agent", "2.0.0");
    const env = { UV_TOOL_DIR: join(folder, "tools"), UV_TOOL_BIN_DIR: join(folder, "bin") };
    const r = await call("POST", "/uv-agent/install");
    assert.equal(r.installing?.line, commandLine(["uv", "tool", "install", "--force", "fake-uv-agent==2.0.0"], env, process.platform), r.error);
    const t = ran.at(-1);
    assert.deepEqual([t?.args.slice(1), t?.env.UV_TOOL_DIR, t?.env.UV_TOOL_BIN_DIR], [["tool", "install", "--force", "fake-uv-agent==2.0.0"], env.UV_TOOL_DIR, env.UV_TOOL_BIN_DIR]);
    const e = await once("uv-agent", (x) => x.lastInstall?.outcome === "installed" && x.models?.count === 2, "the install to end and its models to come");
    assert.deepEqual([e.state, e.installed.version], ["connected", "2.0.0"]);
    assert.deepEqual([upstream("uv-agent").acp.command, upstream("uv-agent").acp.args], [join(folder, "bin", win ? "fake-uv-agent.exe" : "fake-uv-agent"), [FAKE_ACP_AGENT]]);
  });

  // (fails before: yes — a program to download had no Install: "Download" linked its raw archive, and Connect waited for
  // its command on the PATH, which Filament reads once at its start; it was never updated either)
  test("a program to download installed in a terminal: fetched into Filament's own folder and unpacked, then connected on its command's full path with the registry's arguments; updated beside it to the registry's newer version", async () => {
    const r = await call("POST", "/bin-agent/install");
    assert.equal(r.status, 200, r.error);
    assert.deepEqual([r.installing?.line, r.installing?.version, typeof r.installing?.terminal], ["https://example.test/bin-agent-0.3.0.zip", "0.3.0", "string"]);
    const e = await once("bin-agent", (x) => x.lastInstall?.outcome === "installed" && x.models?.count === 2, "the download to end and its models to come");
    const command = (/** @type {string} */ v) => join(installed, "bin-agent", v, "program", ...BIN_CMD.slice(2).split(/[\\/]/));
    assert.deepEqual([e.state, e.installed.version, e.update, e.download, e.lastInstall.error], ["connected", "0.3.0", null, null, null]);
    assert.deepEqual([upstream("bin-agent").acp.command, upstream("bin-agent").acp.args], [command("0.3.0"), ["--quiet"]], "its full path, never a name off the PATH");
    const receipt = JSON.parse(readFileSync(join(installed, "bin-agent", "install.json"), "utf8"));
    assert.deepEqual({ ...receipt, at: typeof receipt.at }, { id: "bin-agent", version: "0.3.0", way: "binary", package: "https://example.test/bin-agent-0.3.0.zip", command: command("0.3.0"), args: ["--quiet"], env: {}, at: "number" });
    // A key pasted at its sign-in lives in its account's environment (agent-logins.js), as Antigravity's Gemini API key.
    const st = await (await shim.api("/api/state")).json();
    const keyed = { ...st.config, upstreams: st.config.upstreams.map((/** @type {any} */ u) => (u.id === "bin-agent" ? { ...u, acp: { ...u.acp, env: { ...u.acp.env, BIN_AGENT_KEY: "k-1" } } } : u)) };
    assert.equal((await shim.api("/api/config", { method: "PUT", body: keyed })).status, 200);
    served = registryOf({ npx: "1.2.0", uv: "2.0.0", bin: "0.4.0" });
    const before = (await call("POST", "/registry/refresh")).entries.find((/** @type {any} */ x) => x.id === "bin-agent");
    assert.deepEqual([before.installed.version, before.update, before.install.line], ["0.3.0", "0.4.0", "https://example.test/bin-agent-0.4.0.zip"]);
    assert.equal((await call("POST", "/bin-agent/install")).installing?.version, "0.4.0");
    const next = await once("bin-agent", (x) => x.lastInstall?.at > before.lastInstall.at && x.lastInstall.outcome === "installed", "the update to end");
    assert.deepEqual([next.installed.version, next.update, next.state, upstream("bin-agent").acp.command], ["0.4.0", null, "connected", command("0.4.0")]);
    // (fails before: yes — the review of 11-10: an update set the account's environment to the install's, its key gone)
    assert.equal(upstream("bin-agent").acp.env.BIN_AGENT_KEY, "k-1", "the account's key kept");
    await until(() => !existsSync(join(installed, "bin-agent", "0.3.0")), "the older version's folder to go");
    await once("bin-agent", (x) => x.models?.count === 2 && !x.asking, "its models asked for again");
  });

  test("where no terminal opens here: the line to run in a terminal of one's own, then Connect settles what it installed — an agent new here, and an update", async () => {
    noTerminal = true;
    try {
      const folder = join(installed, "line-agent", "1.0.0");
      const argv = ["npm", "install", "--global", "--prefix", folder, "@fake/line-agent@1.0.0"];
      const r = await call("POST", "/line-agent/install");
      assert.deepEqual([r.status, r.line, r.installing], [200, commandLine(argv, {}, process.platform), undefined]);
      assert.equal(r.entries.find((/** @type {any} */ e) => e.id === "line-agent").installing, null);
      assert.deepEqual(await call("POST", "/line-agent/connect"), { status: 400, error: "Line Agent isn't on this computer: install it first" }, "before it ran");
      byHand(NPM_JS, argv.slice(1), {});
      assert.equal((await entry("line-agent")).state, "ready", "installed, not settled yet");
      const c = await call("POST", "/line-agent/connect");
      const e = c.entries.find((/** @type {any} */ x) => x.id === "line-agent");
      assert.deepEqual([c.status, e.state, e.installed?.version], [200, "connected", "1.0.0"]);
      assert.equal(upstream("line-agent").acp.command, npmBin(folder, "line-agent"));
      served = registryOf({ npx: "1.2.0", uv: "2.1.0" });
      await call("POST", "/registry/refresh");
      const next = join(installed, "uv-agent", "2.1.0");
      const env = { UV_TOOL_DIR: join(next, "tools"), UV_TOOL_BIN_DIR: join(next, "bin") };
      const uvArgv = ["uv", "tool", "install", "--force", "fake-uv-agent==2.1.0"];
      assert.equal((await call("POST", "/uv-agent/install")).line, commandLine(uvArgv, env, process.platform));
      byHand(UV_JS, uvArgv.slice(1), env);
      const moved = await call("POST", "/uv-agent/connect");
      assert.deepEqual(
        [moved.status, moved.entries.find((/** @type {any} */ x) => x.id === "uv-agent").installed.version, upstream("uv-agent").acp.command],
        [200, "2.1.0", join(next, "bin", win ? "fake-uv-agent.exe" : "fake-uv-agent")],
        "its account moved to the version settled",
      );
      assert.equal(existsSync(join(installed, "uv-agent", "2.0.0")), false, "the older version's folder gone");
      await once("uv-agent", (x) => x.models?.count === 2 && !x.asking, "its models asked for again");
    } finally {
      noTerminal = false;
    }
  });

  test("an agent Filament knows installed its maker's way, for the whole computer — npm's global folder — then connected as detection connects it", async () => {
    process.env.FAKE_NPM_BIN = "qodercli";
    try {
      const r = await call("POST", "/qoder/install");
      assert.deepEqual([r.installing?.line, r.installing?.version], ["npm install -g @qoder-ai/qodercli", null], r.error);
      assert.deepEqual([ran.at(-1)?.args.slice(1), ran.at(-1)?.cwd], [["install", "-g", "@qoder-ai/qodercli"], homedir()]);
      const e = await once("qoder", (x) => x.lastInstall?.outcome === "installed" && x.models?.count === 2, "the install to end and its models to come");
      assert.deepEqual([e.state, e.installed, e.upstreams, e.gone], ["connected", null, ["qoder"], false]);
      // Its version as npm installed it (HarnessV3-ACP AF3): newer than the registry's, which is no update.
      assert.deepEqual([e.runs, e.update], ["1.0.0", null]);
      const u = upstream("qoder");
      assert.deepEqual([u.enabled, u.acp.command, u.acp.args], [true, "qodercli", ["--acp"]]);
      assert.ok(existsSync(npmBin(globalDir, "qodercli")), "in npm's global folder");
    } finally {
      delete process.env.FAKE_NPM_BIN;
    }
  });

  // (fails before: yes — detection's guard read two fields nothing sets, so the console's Detect installed agents
  // turned every installed agent back on)
  test("Turn off keeps an agent's accounts and their logins, and detection never turns it on again; Turn on does", async () => {
    const off = await call("POST", "/claude-code/off");
    assert.deepEqual([off.status, off.entries.find((/** @type {any} */ e) => e.id === "claude-code").state], [200, "off"]);
    assert.deepEqual([upstream("claude-code").enabled, upstream("claude-code").acp.turnedOff], [false, true]);
    const d = await (await shim.api("/api/acp/detect", { method: "POST" })).json();
    assert.equal(d.agents.find((/** @type {any} */ a) => a.id === "claude-code").installed, true, "its program is here");
    assert.equal(d.enabled.includes("claude-code"), false);
    assert.deepEqual([upstream("claude-code").enabled, (await entry("claude-code")).state], [false, "off"]);
    const on = await call("POST", "/claude-code/connect");
    assert.equal(on.entries.find((/** @type {any} */ e) => e.id === "claude-code").state, "connected");
    assert.deepEqual([upstream("claude-code").enabled, upstream("claude-code").acp.turnedOff], [true, false]);
  });

  test("Remove from this computer: its accounts, their routes and its folder go; one installed for the whole computer is turned off instead", async () => {
    const r = await call("DELETE", "/npx-agent");
    assert.deepEqual([r.status, r.folder, r.kept], [200, join(installed, "npx-agent"), null], r.error);
    const e = r.entries.find((/** @type {any} */ x) => x.id === "npx-agent");
    assert.deepEqual([e.state, e.installed, e.upstreams, e.lastInstall], ["missing", null, [], null]);
    assert.equal(upstream("npx-agent"), undefined);
    assert.equal(shim.app.config.routes.some((/** @type {any} */ x) => x.upstream === "npx-agent"), false);
    assert.equal(existsSync(join(installed, "npx-agent")), false);
    assert.deepEqual(await call("DELETE", "/qoder"), { status: 400, error: "Filament didn't install Qoder: turn it off instead" });
  });

  test("refusals, in words: no such agent; one with no build for this computer; one whose command is outside its download, until its program is on the PATH; an installer missing; an agent not connected", async () => {
    assert.deepEqual(await call("POST", "/nope/connect"), { status: 404, error: "no such coding agent" });
    // (fails before: yes — an agent with no build for this computer was refused as one Filament "doesn't download yet")
    assert.deepEqual(await call("POST", "/far-agent/install"), { status: 400, error: `ACP's registry has no build of Far Agent for this computer (${TARGET})` });
    assert.deepEqual(await call("POST", "/path-agent/install"), { status: 400, error: "Path Agent's command (../path-agent.exe) isn't inside its download, so Filament can't install it: download it from its page" });
    assert.deepEqual(await call("POST", "/path-agent/connect"), { status: 400, error: "Path Agent isn't on this computer: install it first" });
    assert.deepEqual(await call("POST", "/far-agent/off"), { status: 400, error: "Far Agent isn't connected" });
    assert.deepEqual(await call("POST", "/far-agent/models"), { status: 400, error: "Far Agent isn't connected" });
    // Its program downloaded onto the PATH: Connect runs it by its name, with the registry's arguments.
    shimFor(bin, "path-agent", AGENT_JS);
    assert.equal((await entry("path-agent")).state, "ready");
    const c = await call("POST", "/path-agent/connect");
    assert.deepEqual([c.status, upstream("path-agent").acp.command, upstream("path-agent").acp.args], [200, "path-agent", []], c.error);
    await once("path-agent", (x) => x.models?.count === 2, "its models");
    // npm gone from this computer: an npm agent says it needs it, and its install is refused.
    const npm = join(bin, win ? "npm.cmd" : "npm");
    renameSync(npm, join(root, "npm-away"));
    try {
      assert.equal((await entry("npx-agent")).install.needs, "npm");
      assert.deepEqual(await call("POST", "/npx-agent/install"), { status: 400, error: "Npx Agent installs with npm, which isn't on this computer" });
      // (fails before: no — a guard the mutation pass asked for: no agent Filament knows was installed without npm here)
      assert.equal((await entry("qoder")).install.needs, "npm");
      assert.deepEqual(await call("POST", "/qoder/install"), { status: 400, error: "Qoder installs with npm, which isn't on this computer" });
    } finally {
      renameSync(join(root, "npm-away"), npm);
    }
  });

  // (fails before: no — a guard the mutation pass asked for: no connected agent's program went missing)
  test("a connected agent Filament knows whose program is gone says so", async () => {
    const program = npmBin(globalDir, "qodercli");
    renameSync(program, join(root, "qodercli-away"));
    try {
      const e = await entry("qoder");
      assert.deepEqual([e.state, e.gone], ["connected", true]);
    } finally {
      renameSync(join(root, "qodercli-away"), program);
    }
    assert.equal((await entry("qoder")).gone, false);
  });

  test("ACP's registry that can't be read: said under its line, its copy kept until a read works", async () => {
    const at = (await list()).registry.at;
    down = true;
    try {
      const r = await call("POST", "/registry/refresh");
      assert.deepEqual([r.registry, r.entries.some((/** @type {any} */ e) => e.id === "uv-agent")], [{ at, asking: false, error: "it answered 503" }, true]);
    } finally {
      down = false;
    }
    const ok = await call("POST", "/registry/refresh");
    assert.deepEqual([ok.registry.error, ok.registry.at >= at], [null, true]);
  });
});

describe("Settings → Coding agents one step at a time, over stand-ins (app/coding-agents.js)", () => {
  /** @type {string[]} */
  const roots = [];
  /** The variables the suite sets, as they were. @type {Record<string, string | undefined>} */
  const was = {};
  before(() => {
    const root = mkdtempSync(join(tmpdir(), "filament-agents-steps-"));
    roots.push(root);
    // This computer's programs: npm and uv (nothing runs them here), and nothing of the computer's own.
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "none.mjs"), "");
    for (const name of ["npm", "uv"]) shimFor(bin, name, join(bin, "none.mjs"));
    for (const k of ["PATH", "APPDATA", "LOCALAPPDATA"]) was[k] = process.env[k];
    process.env.PATH = bin;
    process.env.APPDATA = join(root, "appdata");
    process.env.LOCALAPPDATA = join(root, "localappdata");
  });
  after(async () => {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await removeDirs(...roots);
  });
  const settle = () => new Promise((r) => setImmediate(r));
  const API = { id: "api", name: "API", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "k" };
  /** A Claude Code account, as detection or Settings makes one. @param {string} id @param {boolean} enabled @returns {any} */
  const claude = (id, enabled) => ({ id, name: "Claude Code", type: "acp", enabled, acp: { command: "claude-agent-acp" } });
  /** A registry agent npm installs. @param {string} version */
  const npx = (version) => agentOf("npx-agent", version, { name: "Npx Agent", npx: { name: "@fake/npx-agent", version, args: ["--acp"], env: {} } });
  /** Its receipt, its command a file that is there. @param {string} version @returns {any} */
  const receipt = (version) => ({ id: "npx-agent", version, way: "npx", package: "@fake/npx-agent", command: process.execPath, args: ["--acp"], env: {}, at: 1 });
  /** Its upstream, connected. @returns {any} */
  const npxUpstream = () => ({ id: "npx-agent", name: "Npx Agent", type: "acp", enabled: true, acp: { command: process.execPath, args: ["--acp"] } });

  /**
   * The section over stand-ins: the configuration holds `upstreams` and `routes`, and ACP's registry lists `agents`.
   * Filament's installs keep the receipts in `receipts`; an agent's install is found where `found` names it, and settled
   * into the receipt `next` holds for it (`settled` keeps each). An install's terminal ends when the test calls its end
   * (`terminals`); a turn runs on the accounts in `running`; processes let go of, models asked for and sign-ins stopped
   * are kept (`letGo`, `asked`, `cancelled`), as is each agent whose other versions' folders were deleted (`dropped`);
   * `discovery` says how an account's last ask for its models went.
   * @param {{ upstreams?: any[], routes?: any[], agents?: any[] }} [o]
   */
  const stand = ({ upstreams = [], routes = [], agents = [] } = {}) => {
    const root = mkdtempSync(join(tmpdir(), "filament-agents-step-"));
    roots.push(root);
    /** @type {any} */
    let cfg = { upstreams, routes, experimental: { cursorSdk: true } }; // Cursor's SDK stands here, its switch on
    const s = {
      /** @type {Map<string, any>} */
      receipts: new Map(),
      /** @type {Set<string>} */
      found: new Set(),
      /** @type {Map<string, any>} */
      next: new Map(),
      /** @type {string[]} */
      settled: [],
      /** @type {Map<string, (code: number | null, closed: boolean) => void>} */
      terminals: new Map(),
      /** A terminal's task, where it runs one: a program's download. @type {Map<string, (io: any) => Promise<void>>} */
      tasks: new Map(),
      /** Why a program's download fails, where it does. @type {string | null} */
      refuse: null,
      /** @type {Set<string>} */
      running: new Set(),
      /** @type {string[]} */
      letGo: [],
      /** @type {string[]} */
      dropped: [],
      /** @type {string[]} */
      asked: [],
      /** @type {Map<string, { asking: boolean, error?: string }>} */
      discovery: new Map(),
      /** @type {string[]} */
      cancelled: [],
      root,
      /** The configuration as it stands. @returns {any} */
      cfg: () => cfg,
      /** An entry as the section lists it. @param {string} id @returns {any} */
      entry: (id) => section.list().entries.find((e) => e.id === id),
    };
    /** @param {any} a @returns {any} */
    const plan = (a) => {
      const program = a.binary?.[String(TARGET)];
      if (program) {
        const folder = join(root, a.id, a.version);
        return { id: a.id, version: a.version, way: "binary", package: program.archive, folder, argv: [], env: {}, line: program.archive, start: { args: program.args, env: program.env }, program };
      }
      if (!a.npx) return null;
      const folder = join(root, a.id, a.version);
      const argv = ["npm", "install", "--global", "--prefix", folder, `${a.npx.name}@${a.version}`];
      return { id: a.id, version: a.version, way: "npx", package: a.npx.name, folder, argv, env: {}, line: argv.join(" "), start: { args: a.npx.args, env: {} } };
    };
    const section = createCodingAgents({
      config: /** @type {any} */ ({ get: () => cfg, set: (/** @type {any} */ c) => void (cfg = c), save: () => {} }),
      destinationFor: () => ({ agent: { running: (/** @type {string} */ id) => s.running.has(id), letGo: (/** @type {string} */ id) => void s.letGo.push(id) } }),
      terminal: {
        create: (/** @type {any} */ o) => {
          const id = `t${s.terminals.size + 1}`;
          s.terminals.set(id, o.onExit);
          if (o.task) s.tasks.set(id, o.task);
          return { id };
        },
        kill: () => true,
      },
      registry: /** @type {any} */ ({ view: () => ({ agents, at: 1, asking: false, error: null }), iconOf: () => null, refresh: async () => {}, stale: () => false }),
      installs: /** @type {any} */ ({
        all: () => [...s.receipts.values()],
        plan,
        found: (/** @type {any} */ p) => (s.found.has(p.id) ? process.execPath : null),
        receipt: (/** @type {string} */ id) => s.receipts.get(id) || null,
        settle: (/** @type {any} */ p) => {
          s.settled.push(`${p.id} ${p.version}`);
          s.receipts.set(p.id, s.next.get(p.id));
          return s.next.get(p.id);
        },
        dropOthers: async (/** @type {string} */ id) => void s.dropped.push(id),
        remove: async () => ({ folder: null, kept: null }),
        download: async (/** @type {any} */ p, /** @type {any} */ io) => {
          io.say(`Downloading ${p.program.archive}\r\n`);
          if (s.refuse) throw new Error(s.refuse);
        },
      }),
      models: {
        askAgent: async (/** @type {string} */ id) => void s.asked.push(id),
        listed: () => null,
        discoveryOf: (/** @type {string} */ id) => s.discovery.get(id) || null,
      },
      logins: {
        cancelSignIn: async (/** @type {string} */ id) => {
          s.cancelled.push(id);
          return true;
        },
      },
      profileOf: () => null,
      publish: () => {},
      log: () => {},
    });
    return { section, s };
  };

  // (fails before: no — a guard the mutation pass asked for: no entry's first account was other than its Default, and
  // no error was kept while its models were asked for again)
  test("an entry's models line reads its Default while it is on, else the first account on; an error is unsaid while they are asked for again", () => {
    const { s } = stand({ upstreams: [claude("claude-code-ops", true), claude("claude-code", true)] });
    s.discovery.set("claude-code", { asking: true, error: "the last ask failed" });
    const e = s.entry("claude-code");
    assert.deepEqual([e.upstreams, e.primary, e.asking, e.modelsError], [["claude-code-ops", "claude-code"], "claude-code", true, null]);
    s.discovery.set("claude-code", { asking: false, error: "the last ask failed" });
    assert.equal(s.entry("claude-code").modelsError, "the last ask failed");
    s.cfg().upstreams.find((/** @type {any} */ u) => u.id === "claude-code").enabled = false;
    assert.equal(s.entry("claude-code").primary, "claude-code-ops");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent was turned off under a running turn, or with its
  // sign-ins and processes running)
  test("Turn off: refused under a running turn; else its sign-ins stop and its processes are let go of", async () => {
    const { section, s } = stand({ upstreams: [claude("claude-code", true)] });
    s.running.add("claude-code");
    await assert.rejects(section.off("claude-code"), { status: 409, message: "a turn is running on Claude Code: turn it off once it ends" });
    s.running.clear();
    await section.off("claude-code");
    assert.deepEqual([s.cancelled, s.letGo, s.entry("claude-code").state], [["claude-code"], ["claude-code"], "off"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no agent turned on again had lost its route)
  test("Turn on: its accounts on again, and a known agent's own route placed where it has none", async () => {
    const off = { ...claude("claude-code", false), acp: { command: "claude-agent-acp", turnedOff: true } };
    const { section, s } = stand({ upstreams: [off, API], routes: [{ match: "*", upstream: "api" }] });
    await section.connect("claude-code");
    assert.deepEqual(s.cfg().routes.map((/** @type {any} */ r) => `${r.match} → ${r.upstream}`), ["claude-code/* → claude-code", "* → api"]);
    assert.deepEqual([s.entry("claude-code").state, s.asked], ["connected", ["claude-code"]]);
  });

  // (fails before: yes — an agent a fresh install added off kept its route off once connected, so its names went to the
  // catch-all)
  test("Connect: an agent whose own route is off has it turned on, so its names reach it", async () => {
    // Turned off, so it can be connected whether or not its program is on the computer running the test.
    const added = { ...claude("claude-code", false), acp: { command: "claude-agent-acp", turnedOff: true } };
    const { section, s } = stand({
      upstreams: [added, API],
      routes: [{ match: "claude-code/*", upstream: "claude-code", enabled: false }, { match: "*", upstream: "api" }],
    });
    await section.connect("claude-code");
    assert.deepEqual(
      s.cfg().routes.map((/** @type {any} */ r) => `${r.match} → ${r.upstream}${r.enabled === false ? " (off)" : ""}`),
      ["claude-code/* → claude-code", "* → api"],
    );
    assert.equal(s.entry("claude-code").state, "connected");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent was connected under an id another upstream has)
  test("Connect refuses an id another upstream has", async () => {
    const { section, s } = stand({ upstreams: [{ ...API, id: "npx-agent" }], agents: [npx("1.0.0")] });
    s.receipts.set("npx-agent", receipt("1.0.0"));
    await assert.rejects(section.connect("npx-agent"), {
      status: 409,
      message: "there is already an upstream with the id npx-agent that isn't Npx Agent: rename it on the console's Upstreams page first",
    });
  });

  // (fails before: no — a guard the mutation pass asked for: no install was settled twice)
  test("Connect settles an install made in a terminal of one's own once: the version settled is not settled again", async () => {
    const { section, s } = stand({ agents: [npx("1.0.0")] });
    s.found.add("npx-agent");
    s.next.set("npx-agent", receipt("1.0.0"));
    await section.connect("npx-agent");
    await section.connect("npx-agent");
    assert.deepEqual([s.settled, s.asked], [["npx-agent 1.0.0"], ["npx-agent"]]);
  });

  // (fails before: no — a guard the mutation pass asked for: no installed agent was installed again, or lost its
  // program)
  test("an agent installed at the registry's version installs again only once its program is gone", async () => {
    const { section, s } = stand({ upstreams: [npxUpstream()], agents: [npx("1.0.0")] });
    s.receipts.set("npx-agent", receipt("1.0.0"));
    await assert.rejects(section.install("npx-agent"), { status: 400, message: "Npx Agent 1.0.0 is installed already" });
    s.receipts.set("npx-agent", { ...receipt("1.0.0"), command: join(s.root, "gone", "npx-agent") });
    assert.deepEqual([s.entry("npx-agent").state, s.entry("npx-agent").gone], ["connected", true]);
    const again = /** @type {any} */ (await section.install("npx-agent"));
    assert.equal(again.installing?.version, "1.0.0");
  });

  // (fails before: no — a guard the mutation pass asked for: no update brought other arguments, no install's terminal
  // ended after its install was replaced, and nothing checked that an update asks for the models again)
  test("an update ended well: its accounts move to the new version with its arguments, and its models are asked for again; a terminal's end is its own install's", async () => {
    const { section, s } = stand({ upstreams: [npxUpstream()], agents: [npx("1.1.0")] });
    s.receipts.set("npx-agent", receipt("1.0.0"));
    s.next.set("npx-agent", { ...receipt("1.1.0"), args: ["--acp", "--quiet"] });
    await section.install("npx-agent");
    /** @type {any} */ (s.terminals.get("t1"))(1, false);
    for (let i = 0; i < 5; i++) await settle();
    assert.equal(s.entry("npx-agent").lastInstall?.outcome, "failed");
    await section.install("npx-agent");
    /** @type {any} */ (s.terminals.get("t1"))(1, false);
    for (let i = 0; i < 5; i++) await settle();
    assert.equal(s.entry("npx-agent").installing?.terminal, "t2", "the first terminal's end ends nothing it didn't start");
    /** @type {any} */ (s.terminals.get("t2"))(0, false);
    for (let i = 0; i < 5; i++) await settle();
    const e = s.entry("npx-agent");
    assert.deepEqual([e.lastInstall?.outcome, e.installed?.version, e.installing], ["installed", "1.1.0", null]);
    assert.deepEqual(s.cfg().upstreams.find((/** @type {any} */ u) => u.id === "npx-agent").acp.args, ["--acp", "--quiet"]);
    assert.deepEqual([s.letGo, s.asked], [["npx-agent"], ["npx-agent"]]);
  });

  // (fails before: yes — finding 18 of the re-read: an update asked nothing about a running turn, and at its end deleted
  // the old version's folder under the turn still running from it)
  test("an update never takes the old version from under a running turn: refused in words while one runs; one that started while it installed keeps the old folder", async () => {
    const { section, s } = stand({ upstreams: [npxUpstream()], agents: [npx("1.1.0")] });
    s.receipts.set("npx-agent", receipt("1.0.0"));
    s.next.set("npx-agent", receipt("1.1.0"));
    s.running.add("npx-agent");
    await assert.rejects(section.install("npx-agent"), { status: 409, message: "a turn is running on Npx Agent: update it once it ends" });
    assert.deepEqual([s.terminals.size, s.entry("npx-agent").installing], [0, null], "no install started");
    s.running.clear();
    await section.install("npx-agent");
    // A turn starts while it installs: nothing holds a chat back for an install.
    s.running.add("npx-agent");
    /** @type {any} */ (s.terminals.get("t1"))(0, false);
    for (let i = 0; i < 5; i++) await settle();
    assert.deepEqual([s.entry("npx-agent").lastInstall?.outcome, s.entry("npx-agent").installed?.version], ["installed", "1.1.0"]);
    assert.deepEqual(s.letGo, ["npx-agent"], "its processes are let go of: the running turn ends on the one it started with");
    assert.deepEqual(s.dropped, [], "the old version's folder stays under the turn that runs from it");
    // With no turn running, the old version's folder goes as the update ends.
    const quiet = stand({ upstreams: [npxUpstream()], agents: [npx("1.1.0")] });
    quiet.s.receipts.set("npx-agent", receipt("1.0.0"));
    quiet.s.next.set("npx-agent", receipt("1.1.0"));
    await quiet.section.install("npx-agent");
    /** @type {any} */ (quiet.s.terminals.get("t1"))(0, false);
    for (let i = 0; i < 5; i++) await settle();
    assert.deepEqual([quiet.s.entry("npx-agent").installed?.version, quiet.s.dropped], ["1.1.0", ["npx-agent"]]);
  });

  // (fails before: yes — a program to download was refused as one Filament "doesn't download yet")
  test("a program's download runs as its terminal's task, which Filament does itself: ended well, settled and connected; failed, the install says why in its own words", async () => {
    const program = { archive: "https://example.test/b.zip", cmd: "./b.exe", args: ["acp"], env: {}, sha256: null };
    const { section, s } = stand({ agents: [agentOf("bin-agent", "0.3.0", { name: "Bin Agent", binary: { [String(TARGET)]: program } })] });
    assert.deepEqual([s.entry("bin-agent").install, s.entry("bin-agent").download], [{ way: "binary", line: program.archive, needs: null }, null]);
    /** The terminal `id` runs its task to its end, as the terminals do. @param {string} id */
    const run = async (id) => {
      /** @type {string[]} */
      const said = [];
      const code = await /** @type {any} */ (s.tasks.get(id))({ say: (/** @type {string} */ t) => said.push(t), signal: new AbortController().signal }).then(() => 0, () => 1);
      /** @type {any} */ (s.terminals.get(id))(code, false);
      for (let i = 0; i < 5; i++) await settle();
      return said;
    };
    s.refuse = "its checksum isn't the one ACP's registry gives";
    const r = /** @type {any} */ (await section.install("bin-agent"));
    assert.deepEqual([r.installing?.terminal, r.installing?.line, r.installing?.version], ["t1", program.archive, "0.3.0"]);
    assert.deepEqual(await run("t1"), [`Downloading ${program.archive}\r\n`]);
    assert.deepEqual(s.entry("bin-agent").lastInstall, { outcome: "failed", error: "its checksum isn't the one ACP's registry gives", at: s.entry("bin-agent").lastInstall.at });
    s.refuse = null;
    s.next.set("bin-agent", { id: "bin-agent", version: "0.3.0", way: "binary", package: program.archive, command: process.execPath, args: ["acp"], env: {}, at: 1 });
    await section.install("bin-agent");
    await run("t2");
    const e = s.entry("bin-agent");
    assert.deepEqual([e.lastInstall?.outcome, e.state, s.settled, s.cfg().upstreams[0]?.acp.command, s.cfg().upstreams[0]?.acp.args], ["installed", "connected", ["bin-agent 0.3.0"], process.execPath, ["acp"]]);
  });

  // (fails before: yes — the owner's of 11-10: Google retired Gemini CLI for Antigravity, which stood among the
  // registry's agents as `antigravity-acp/*` while Gemini CLI was the catalogue's Google agent)
  test("Antigravity is the catalogue's Google agent, installed from ACP's registry; Gemini CLI is offered no more, and one kept on says why", async () => {
    const program = { archive: "https://example.test/agy.zip", cmd: "./agy_acp_server.exe", args: [], env: {}, sha256: null };
    const gemini = agentOf("gemini", "0.67.0", { name: "Gemini CLI", npx: { name: "@google/gemini-cli", version: "0.67.0", args: ["--acp"], env: {} } });
    const kept = { id: "gemini", name: "Gemini CLI (agent via ACP)", type: "acp", enabled: true, acp: { command: "gemini", args: ["--acp"] } };
    const { section, s } = stand({ upstreams: [kept], agents: [agentOf("antigravity-acp", "1.4.5", { name: "Google Antigravity", binary: { [String(TARGET)]: program } }), gemini] });
    const ids = section.list().entries.map((/** @type {any} */ x) => x.id);
    assert.ok(ids.indexOf("antigravity-acp") >= 0 && ids.indexOf("antigravity-acp") < ids.indexOf("qoder"), `among the catalogue's, before Qoder: ${ids}`);
    const e = s.entry("antigravity-acp");
    assert.deepEqual([e.name, e.from, e.state, e.install], ["Antigravity", "filament", "missing", { way: "binary", line: program.archive, needs: null }]);
    // Gemini CLI: not the registry's to offer; the one kept on is an agent made by hand, saying why.
    assert.deepEqual(section.list().entries.filter((/** @type {any} */ x) => x.id === "gemini").map((/** @type {any} */ x) => [x.from, x.about]), [["config", RETIRED_AGENTS.gemini]]);
    // Installed as the registry's are — its download, its receipt —, then connected as the catalogue makes it.
    s.next.set("antigravity-acp", { id: "antigravity-acp", version: "1.4.5", way: "binary", package: program.archive, command: process.execPath, args: [], env: {}, at: 1 });
    const r = /** @type {any} */ (await section.install("antigravity-acp"));
    const tid = r.installing.terminal;
    await /** @type {any} */ (s.tasks.get(tid))({ say: () => {}, signal: new AbortController().signal });
    /** @type {any} */ (s.terminals.get(tid))(0, false);
    for (let i = 0; i < 5; i++) await settle();
    const u = s.cfg().upstreams.find((/** @type {any} */ x) => x.id === "antigravity-acp");
    assert.deepEqual([u?.name, u?.enabled, u?.acp.command, u?.acp.modelSelection, u?.acp.mode], ["Antigravity (agent via ACP)", true, process.execPath, "session", "agent"]);
    assert.deepEqual(s.cfg().routes.map((/** @type {any} */ x) => `${x.match} → ${x.upstream}`), ["antigravity/* → antigravity-acp"]);
    const now = s.entry("antigravity-acp");
    assert.deepEqual([now.state, now.installed?.version, now.from, s.settled], ["connected", "1.4.5", "filament", ["antigravity-acp 1.4.5"]]);
    // Removed from this computer as the registry's are: its upstream and route go.
    await section.remove("antigravity-acp");
    assert.deepEqual([s.cfg().upstreams.map((/** @type {any} */ x) => x.id), s.cfg().routes], [["gemini"], []]);
  });

  // (fails before: yes — the Fable 5.2 re-read's finding 7: an entry said nothing of whether its connection leaves the
  // settings once turned off, so no card could; one holding arguments of the person's left with them)
  test("a Gemini CLI connection's entry says whether, turned off, it leaves the settings; the next read of the settings does as it said", async () => {
    // As an install wrote it until 11-10, then connected.
    const seeded = {
      id: "gemini", name: "Gemini CLI (agent via ACP)", type: "acp", baseUrl: "", apiKey: "", authStyle: "auto", enabled: true, discoverModels: true, models: [], rules: {},
      acp: {
        command: "gemini", args: ["--acp"], env: {}, listModelsArgs: [], authenticate: false, modelSelection: "arg", mode: "yolo",
        modeAliases: { agent: ["yolo", "autoEdit"], plan: ["plan"], ask: ["plan", "default"] }, permissions: "allow-all", thoughts: "auto", toolActivity: "text", cwdSource: "client",
      },
    };
    const route = { match: "gemini/*", upstream: "gemini", upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {} };
    for (const [why, acp, leaves] of /** @type {[string, any, boolean][]} */ ([["as its install wrote it", {}, true], ["arguments of the person's", { args: ["--acp", "--sandbox"] }, false]])) {
      const { section, s } = stand({ upstreams: [{ ...seeded, acp: { ...seeded.acp, ...acp } }], routes: [route] });
      assert.deepEqual([s.entry("gemini").state, s.entry("gemini").retired], ["connected", { leaves }], why);
      await section.off("gemini");
      assert.deepEqual([s.entry("gemini").state, s.entry("gemini").retired], ["off", { leaves }], why);
      const next = withoutRetiredAgents(normalizeConfig(s.cfg()));
      assert.deepEqual([next.upstreams.map((/** @type {any} */ u) => u.id), next.routes.map((/** @type {any} */ r) => r.match)], leaves ? [[], []] : [["gemini"], ["gemini/*"]], why);
    }
    // An agent made by hand that Filament never drove says nothing of it.
    const { s } = stand({ upstreams: [{ id: "own", name: "Own Agent", type: "acp", enabled: true, acp: { command: "own-agent" } }] });
    assert.equal(s.entry("own-agent").retired, undefined);
  });

  test("an agent of the catalogue that npm installed (HarnessV3-ACP AF3): its version as installed here; the registry's newer one of its package is its update, installed at that version; ended well, or run in a terminal of one's own and then Connect, its processes are let go of and its models asked for again", async () => {
    // Claude's adapter 0.76.0 and another package, laid out as npm lays them out, on the PATH.
    const dir = join(roots[0], "npm-global");
    /** @param {string} spec @param {string} bin */
    const lay = (spec, bin) => {
      const laid = spawnSync(process.execPath, [join(FIXTURES, "fake-npm.mjs"), "install", "-g", spec], { env: { ...process.env, FAKE_NPM_PREFIX: dir, FAKE_NPM_BIN: bin } });
      assert.equal(laid.status, 0, String(laid.stdout));
    };
    lay("@agentclientprotocol/claude-agent-acp@0.76.0", "claude-agent-acp");
    lay("@fake/other-agent@2.0.0", "other-agent");
    const pkg = join(dir, ...(win ? [] : ["lib"]), "node_modules", "@agentclientprotocol", "claude-agent-acp", "package.json");
    /** npm put `version` there. @param {string} version */
    const npmPut = (version) => writeFileSync(pkg, JSON.stringify({ ...JSON.parse(readFileSync(pkg, "utf8")), version }));
    /** The registry's Claude adapter. @param {string} version @param {string} [name] */
    const adapter = (version, name = "@agentclientprotocol/claude-agent-acp") => agentOf("claude-acp", version, { name: "Claude Agent", npx: { name, version, args: [], env: {} } });
    const prior = process.env.PATH;
    process.env.PATH = [win ? dir : join(dir, "bin"), prior].join(delimiter);
    try {
      const agents = [adapter("0.87.0")];
      const { section, s } = stand({ upstreams: [claude("claude-code", true)], agents });
      const said = () => {
        const e = s.entry("claude-code");
        return [e.runs, e.update, e.install.line, e.version];
      };
      const pinned = commandLine(["npm", "install", "-g", "@agentclientprotocol/claude-agent-acp@0.87.0"], {}, process.platform);
      assert.deepEqual(said(), ["0.76.0", "0.87.0", pinned, null]);
      // No update: the registry's own version, an older one, or another package's.
      for (const r of [adapter("0.76.0"), adapter("0.70.1"), adapter("0.87.0", "@other/claude-agent-acp")]) {
        agents[0] = r;
        assert.deepEqual(said().slice(0, 2), ["0.76.0", null], `${r.npx?.name}@${r.version}`);
      }
      agents[0] = adapter("0.87.0");
      npmPut("0.87.0-beta.2");
      assert.deepEqual(said().slice(0, 2), ["0.87.0-beta.2", "0.87.0"], "a release is newer than its pre-release");
      agents[0] = adapter("0.87.0-rc.1");
      assert.deepEqual(said().slice(0, 2), ["0.87.0-beta.2", null], "of two pre-releases of one version, neither is newer");
      npmPut("0.87");
      agents[0] = adapter("0.87.1");
      assert.deepEqual(said().slice(0, 2), ["0.87", "0.87.1"], "a version naming fewer numbers reads zeros after them");
      agents[0] = adapter("0.87.0");
      npmPut("0.76.0");
      // Its account runs another package's program: no version of it here. By the program's path, its version.
      const account = s.cfg().upstreams[0];
      account.acp.command = "other-agent";
      assert.deepEqual(said().slice(0, 2), [null, null], "another package's program");
      account.acp.command = win ? join(dir, "claude-agent-acp.cmd") : join(dir, "bin", "claude-agent-acp");
      assert.deepEqual(said().slice(0, 2), ["0.76.0", "0.87.0"], "the program by its path");
      account.acp.command = "claude-agent-acp";
      const r = /** @type {any} */ (await section.install("claude-code"));
      assert.deepEqual([r.installing?.line, r.installing?.version], [pinned, "0.87.0"]);
      npmPut("0.87.0");
      /** @type {any} */ (s.terminals.get("t1"))(0, false);
      for (let i = 0; i < 5; i++) await settle();
      const e = s.entry("claude-code");
      assert.deepEqual([e.lastInstall?.outcome, e.runs, e.update, s.letGo, s.asked], ["installed", "0.87.0", null, ["claude-code"], ["claude-code"]]);
      await section.connect("claude-code");
      assert.deepEqual([s.letGo, s.asked], [["claude-code", "claude-code"], ["claude-code", "claude-code"]], "Connect after a terminal of one's own");
    } finally {
      process.env.PATH = prior;
    }
  });

  test("Cursor's SDK as found here says its version (HarnessV3-ACP AF3); one whose package.json can't be read says none", () => {
    const sdk = join(roots[0], "sdk");
    const pkg = join(sdk, "@cursor", "sdk", "package.json");
    mkdirSync(dirname(pkg), { recursive: true });
    writeFileSync(pkg, JSON.stringify({ name: "@cursor/sdk", version: "1.0.31" }));
    const prior = process.env.FILAMENT_SDK_DIR;
    process.env.FILAMENT_SDK_DIR = sdk;
    try {
      const { s } = stand();
      assert.deepEqual([s.entry("cursor-sdk").runs, s.entry("cursor-sdk").update], ["1.0.31", null]);
      writeFileSync(pkg, "{");
      assert.equal(s.entry("cursor-sdk").runs, null);
    } finally {
      if (prior === undefined) delete process.env.FILAMENT_SDK_DIR;
      else process.env.FILAMENT_SDK_DIR = prior;
    }
  });
});

// (fails before: yes — an archive whose entry lay under another entry that is no folder (a link) was unpacked: unzip
// wrote it through the link, wherever it led, before the check after unpacking could see it)
test("a download with an entry under one that is no folder, which only a link can be, is refused before it unpacks", () => {
  assert.equal(throughLink(["bin/", "bin/agent", "lib/x.so"]), null);
  assert.equal(throughLink(["bin/agent", "lib/x.so"]), null);
  assert.equal(throughLink(["dot", "dot/authorized_keys"]), "dot/authorized_keys");
  assert.equal(throughLink(["./Dot", "dot/deep/file"]), "dot/deep/file");
  assert.equal(throughLink(["a\\b", "a/b/c"]), "a/b/c");
  assert.equal(throughLink(["link", "link/"]), "link/");
});
