// @ts-check
// A store's file of another build's version (services/store-files.js; r-itself, 11-12). The way back runs an older
// build on the data folder a newer one wrote: a file whose version a build does not read is set aside before anything
// is saved over it — beside itself, under a name that says its version and that no other file has, never removed —,
// the build that saved it takes it back when it runs again, nothing is merged, and the log says each once. Here: the
// rule itself, then each store that reads a versioned file through it — the teams, the agents, a Space, the usage
// files, telemetry — started on a newer build's file and saved, then the newer build again.
// (fails before: yes — teams.json, agents.json and telemetry.json of another version were started empty over and
// written over at the next save; a Space's file and the usage files went to one `.broken` name, over the file moved
// there before; and no build took its own file back)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORE_FILES, STORE_FILES_BEFORE, asidesOf, readStoreFile, setAside, setAsideIn, unreadBy } from "../src/services/store-files.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { DailyUsage } from "../src/services/daily-usage.js";
import { createEventBus } from "../src/services/events.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createTelemetry } from "../src/services/telemetry.js";
import { teamStore } from "./helpers/team.js";
import { removeDirs } from "./helpers/wait.js";

/** 2026-11-12 09:30:05 UTC, and its name in a file's. */
const AT = Date.UTC(2026, 10, 12, 9, 30, 5);
const WHEN = "20261112T093005Z";

/** @type {string[]} */
const made = [];
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-store-files-"));
  made.push(dir);
  return dir;
};
test.after(() => removeDirs(...made));

/** A log that keeps its lines, each "<level> <words>". */
const logOf = () => {
  /** @type {string[]} */
  const said = [];
  return { said, log: (/** @type {string} */ level, /** @type {string} */ msg) => void said.push(`${level} ${msg}`) };
};
/** Reading throws ENOENT: there is no file for the store. @param {() => any} fn */
const none = (fn) => assert.throws(fn, (/** @type {any} */ e) => e?.code === "ENOENT");
/** A folder's files, sorted. @param {string} dir */
const files = (dir) => readdirSync(dir).sort();
/** @param {string} path */
const text = (path) => readFileSync(path, "utf8");

describe("a file of another build's version: the rule", () => {
  const TEAMS = { version: 2, starts: "no saved teams" };

  test("one this build does not read is set aside whole under a name that says its version, before anything is saved over it; said once", () => {
    const dir = folder();
    const file = join(dir, "teams.json");
    const newer = JSON.stringify({ version: 3, teams: { mine: { name: "A newer build's" } } });
    writeFileSync(file, newer);
    const { said, log } = logOf();
    none(() => readStoreFile(file, TEAMS, log, { now: () => AT }));
    assert.deepEqual(files(dir), [`teams.json.v3.${WHEN}`], "moved beside itself: nothing is in place to save over");
    assert.equal(text(join(dir, `teams.json.v3.${WHEN}`)), newer, "whole");
    assert.deepEqual(said, [
      `warn teams.json is version 3, which this Filament does not read (it reads version 2): another build of Filament saved it. It is kept beside it as teams.json.v3.${WHEN}, with nothing saved over it, and this build starts with no saved teams. The build that saved it takes it back when it runs again.`,
    ]);
    // The same build started again: nothing more to say, and the file stays where it is.
    none(() => readStoreFile(file, TEAMS, log, { now: () => AT + 60_000 }));
    assert.equal(said.length, 1, "said once");
    assert.deepEqual(files(dir), [`teams.json.v3.${WHEN}`]);
  });

  test("its name never collides: a second one of the same version at the same second is kept beside the first", () => {
    const dir = folder();
    const file = join(dir, "teams.json");
    writeFileSync(file, JSON.stringify({ version: 3, n: 1 }));
    none(() => readStoreFile(file, TEAMS, () => {}, { now: () => AT }));
    writeFileSync(file, JSON.stringify({ version: 3, n: 2 }));
    none(() => readStoreFile(file, TEAMS, () => {}, { now: () => AT }));
    assert.deepEqual(files(dir), [`teams.json.v3.${WHEN}`, `teams.json.v3.${WHEN}-2`]);
    assert.deepEqual([JSON.parse(text(join(dir, `teams.json.v3.${WHEN}`))).n, JSON.parse(text(join(dir, `teams.json.v3.${WHEN}-2`))).n], [1, 2], "neither written over");
    assert.deepEqual(asidesOf(file, 3), [`teams.json.v3.${WHEN}-2`, `teams.json.v3.${WHEN}`], "the newest first");
  });

  test("the build that saved it takes it back: where none is in place, and where the one in place is another build's, which is set aside in its turn — nothing merged", () => {
    const dir = folder();
    const file = join(dir, "teams.json");
    const mine = { version: 2, teams: { mine: { name: "Mine" } } };
    writeFileSync(file, JSON.stringify(mine));
    // An older build runs: it reads version 1, and saves nothing.
    none(() => readStoreFile(file, { version: 1, starts: "no saved teams" }, () => {}, { now: () => AT }));
    const a = logOf();
    assert.deepEqual(readStoreFile(file, TEAMS, a.log, { now: () => AT + 1000 }), mine, "none in place: taken back");
    assert.deepEqual(files(dir), ["teams.json"]);
    assert.deepEqual(a.said, [`info teams.json.v2.${WHEN}, which this build saved before another build of Filament ran, is teams.json again.`]);
    // The older build again, and this time it saves a file of its own.
    none(() => readStoreFile(file, { version: 1, starts: "no saved teams" }, () => {}, { now: () => AT + 2000 }));
    const older = JSON.stringify({ version: 1, teams: { theirs: {} } });
    writeFileSync(file, older);
    const b = logOf();
    assert.deepEqual(readStoreFile(file, TEAMS, b.log, { now: () => AT + 3000 }), mine, "another build's in place: this build's is back");
    assert.deepEqual(files(dir), ["teams.json", "teams.json.v1.20261112T093008Z"]);
    assert.equal(text(join(dir, "teams.json.v1.20261112T093008Z")), older, "the other build's, whole beside it");
    assert.deepEqual(b.said, [
      "warn teams.json is version 1, which this Filament does not read (it reads version 2): another build of Filament saved it. It is kept beside it as teams.json.v1.20261112T093008Z, with nothing saved over it, and teams.json.v2.20261112T093007Z, which this build saved before, is teams.json again. Nothing was merged: what was saved since is in teams.json.v1.20261112T093008Z.",
    ]);
    // And the older build finds its own in its turn.
    assert.deepEqual(readStoreFile(file, { version: 1, starts: "no saved teams" }, () => {}, { now: () => AT + 4000 }), JSON.parse(older));
    assert.deepEqual(files(dir), ["teams.json", "teams.json.v2.20261112T093009Z"]);
  });

  test("one of this version in place and one set aside before: both kept, the one in place read, said once where they differ — never merged", () => {
    const dir = folder();
    const file = join(dir, "teams.json");
    const before = JSON.stringify({ version: 2, teams: { before: {} } });
    const since = { version: 2, teams: { since: {} } };
    writeFileSync(file, before);
    setAside(file, "2", { now: () => AT, copy: true });
    writeFileSync(file, JSON.stringify(since));
    const { said, log } = logOf();
    assert.deepEqual(readStoreFile(file, TEAMS, log), since, "the one in place is read");
    assert.deepEqual(files(dir), ["teams.json", `teams.json.v2.${WHEN}.kept`]);
    assert.equal(text(join(dir, `teams.json.v2.${WHEN}.kept`)), before, "the other whole");
    assert.deepEqual(said, [
      `warn teams.json.v2.${WHEN} holds what this build saved before another build of Filament ran, and teams.json was saved since: both are kept, and nothing was merged. Filament reads teams.json; the other is teams.json.v2.${WHEN}.kept now — to use it instead, stop Filament and rename it to teams.json.`,
    ]);
    assert.deepEqual(readStoreFile(file, TEAMS, log), since);
    assert.equal(said.length, 1, "said once: nothing looks at one marked kept again");
    // A copy that says what is in place says nothing: it is marked, and that is all.
    setAside(file, "2", { now: () => AT + 1000, copy: true });
    assert.deepEqual(readStoreFile(file, TEAMS, log), since);
    assert.equal(said.length, 1);
    assert.deepEqual(files(dir), ["teams.json", `teams.json.v2.${WHEN}.kept`, "teams.json.v2.20261112T093006Z.kept"]);
  });

  test("a file that names no version is the store's to refuse, as before: nothing is moved; one that does not parse throws as it did", () => {
    const dir = folder();
    const file = join(dir, "teams.json");
    writeFileSync(file, JSON.stringify({ teams: {} }));
    const { said, log } = logOf();
    assert.deepEqual(readStoreFile(file, TEAMS, log), { teams: {} });
    writeFileSync(file, "{ not json");
    assert.throws(() => readStoreFile(file, TEAMS, log), SyntaxError);
    assert.deepEqual([files(dir), said], [["teams.json"], []]);
    none(() => readStoreFile(join(dir, "none.json"), TEAMS, log));
  });

  test("what a data folder holds that a build does not read: each store's file, a Space's each, by the build's own table", () => {
    const dir = folder();
    mkdirSync(join(dir, "spaces"));
    writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 3 }));
    writeFileSync(join(dir, "agents.json"), JSON.stringify({ version: 1 }));
    writeFileSync(join(dir, "daily-usage.json"), "{ not json");
    writeFileSync(join(dir, "spaces", "p1.json"), JSON.stringify({ version: 2 }));
    writeFileSync(join(dir, "spaces", "p2.json"), JSON.stringify({ version: 1 }));
    writeFileSync(join(dir, "spaces", "_set-aside.json"), JSON.stringify({ at: 1 }));
    assert.deepEqual(unreadBy(dir, STORE_FILES).map((u) => [u.key, u.name, u.found, u.reads]), [["teams", "teams.json", "3", 2], ["spaces", "spaces/p1.json", "2", 1]]);
    assert.deepEqual(unreadBy(dir, STORE_FILES_BEFORE).map((u) => u.name), ["teams.json", "spaces/p1.json"], "a build from before read the same versions");
    assert.deepEqual(setAsideIn(join(dir, "spaces"), 1), []);
    writeFileSync(join(dir, "spaces", `p3.json.v1.${WHEN}`), "{}");
    writeFileSync(join(dir, "spaces", `p3.json.v2.${WHEN}`), "{}");
    assert.deepEqual(setAsideIn(join(dir, "spaces"), 1), ["p3.json"]);
  });
});

describe("each store that reads a versioned file: started on a newer build's file and saved, the newer file is whole beside it; the newer build again takes it back", () => {
  /**
   * A store's file as a newer build wrote it, the store started on it and saved (`use`): the newer file is whole under
   * its version's name, the store's own is in place at the version its row says, and it was said once. Then the newer
   * build again, read as its store reads: its file is back, and this build's is kept beside it.
   * @param {{ dir: string, name: string, row: { version: number, starts: string }, says: RegExp, use: (log: (level: string, msg: string) => void) => Promise<void> | void }} o
   */
  async function wayBack({ dir, name, row, says, use }) {
    const file = join(dir, name);
    const at = join(file, "..");
    const base = name.split("/").pop();
    const newer = JSON.stringify({ version: row.version + 1, holds: "what a newer build saved" });
    mkdirSync(at, { recursive: true });
    writeFileSync(file, newer);
    const { said, log } = logOf();
    await use(log);
    const asides = files(at).filter((f) => f.startsWith(`${base}.v${row.version + 1}.`));
    assert.equal(asides.length, 1, `${name}: set aside under its version's name: ${files(at)}`);
    assert.match(asides[0], /\.v\d+\.\d{8}T\d{6}Z$/);
    assert.equal(text(join(at, asides[0])), newer, `${name}: the newer build's file is whole beside it`);
    assert.equal(JSON.parse(text(file)).version, row.version, `${name}: this build's own is in place, at its row's version`);
    assert.deepEqual(unreadBy(dir, STORE_FILES).filter((u) => u.name === name), [], "which this build reads");
    const lines = said.filter((s) => s.includes(`${base} is version ${row.version + 1}`));
    assert.equal(lines.length, 1, `${name}: said once: ${said.join("\n")}`);
    assert.match(lines[0], says);
    assert.ok(lines[0].endsWith(`It is kept beside it as ${asides[0]}, with nothing saved over it, and this build starts with ${row.starts}. The build that saved it takes it back when it runs again.`), lines[0]);
    // Forward again: the newer build reads its file where it left it.
    assert.deepEqual(readStoreFile(file, { version: row.version + 1, starts: row.starts }), JSON.parse(newer), `${name}: taken back`);
    assert.equal(text(file), newer);
    assert.equal(files(at).filter((f) => f.startsWith(`${base}.v${row.version}.`)).length, 1, `${name}: this build's file kept beside it in its turn`);
  }

  test("the teams and the agents", async () => {
    const dir = folder();
    await wayBack({ dir, name: "teams.json", row: STORE_FILES.teams, says: /^warn teams: teams\.json is version 3, which this Filament does not read \(it reads version 2\)/, use: (log) => void teamStore({ dataDir: dir, log }).create({ name: "Mine", lead: "product", members: [{ tag: "builder" }] }) });
    await wayBack({ dir, name: "agents.json", row: STORE_FILES.agents, says: /^warn agents: agents\.json is version 2, which this Filament does not read \(it reads version 1\)/, use: (log) => void createAgentCardStore({ dataDir: dir, log }).create({ tag: "careful", name: "Careful One", goodFor: "Read twice, write once", thinks: "You lead carefully." }) });
  });

  test("the teams and the agents this build saved come back after an older build ran, each with what it held", () => {
    const dir = folder();
    const first = teamStore({ dataDir: dir });
    first.cards.create({ tag: "careful", name: "Careful One", goodFor: "Read twice, write once", thinks: "You lead carefully." });
    first.create({ name: "Mine", lead: "careful", members: [{ tag: "builder" }] });
    // An older build: it reads another version of each, and saves its own teams file.
    for (const name of ["teams.json", "agents.json"]) none(() => readStoreFile(join(dir, name), { version: 0, starts: "none" }, () => {}, { now: () => AT }));
    writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 0, teams: {} }));
    const { said, log } = logOf();
    const again = teamStore({ dataDir: dir, log });
    assert.deepEqual([again.find("mine")?.lead.tag, again.cards.list().some((c) => c.tag === "careful")], ["careful", true]);
    assert.deepEqual(said.map((s) => s.split(" ").slice(0, 3).join(" ")), [`info agents: agents.json.v1.${WHEN},`, "warn teams: teams.json"], said.join("\n"));
    assert.match(said[1], /Nothing was merged: what was saved since is in teams\.json\.v0\.\d{8}T\d{6}Z\.$/);
  });

  test("a Space: set aside under its version's name, never one .broken name; this build's own Space is back as the store starts, before anything reads it", async () => {
    const dir = folder();
    const spaces = join(dir, "spaces");
    // A folder this Filament began on already: the Spaces of before were set aside (10-29), so these files are its own.
    mkdirSync(spaces);
    createSpaceStore({ dir: spaces });
    await wayBack({
      dir,
      name: "spaces/p1.json",
      row: STORE_FILES.spaces,
      says: /^warn spaces: p1\.json is version 2, which this Filament does not read \(it reads version 1\)/,
      use: (log) => {
        const store = createSpaceStore({ dir: spaces, log });
        assert.deepEqual(store.get("p1").tasks, [], "an empty Space");
        assert.deepEqual(store.projects(), [], "which is none, until it is made");
        store.make("p1");
        store.addTask("p1", { title: "Ship it" }, { kind: "you" });
      },
    });
    assert.equal(existsSync(join(spaces, "p1.json.broken")), false);
    // This build's Space, set aside by another build that ran: back as the store starts.
    const mine = createSpaceStore({ dir: spaces });
    mine.make("p2");
    mine.addTask("p2", { title: "Mine" }, { kind: "you" });
    none(() => readStoreFile(join(spaces, "p2.json"), { version: 0, starts: "an empty Space" }, () => {}, { now: () => AT }));
    assert.equal(existsSync(join(spaces, "p2.json")), false);
    const { said, log } = logOf();
    const again = createSpaceStore({ dir: spaces, log });
    assert.ok(again.projects().includes("p2"), "its project has its Space again");
    assert.deepEqual(again.get("p2").tasks.map((t) => t.title), ["Mine"]);
    assert.deepEqual(said, [`info spaces: p2.json.v1.${WHEN}, which this build saved before another build of Filament ran, is p2.json again.`]);
  });

  test("the usage files", async () => {
    const dir = folder();
    for (const [name, row] of /** @type {const} */ ([["daily-usage.json", STORE_FILES.usage], ["memory-usage.json", STORE_FILES.memoryUsage]]))
      await wayBack({
        dir,
        name,
        row,
        says: new RegExp(`^warn ${name.replace(".", "\\.")} is version 3, which this Filament does not read \\(it reads version 2\\)`),
        use: async (log) => {
          const d = new DailyUsage({ dataDir: dir, file: name, log });
          assert.deepEqual(d.list(), [], "a new usage file");
          d.add({ ts: Date.now(), status: "ok", upstream: "u", model: "m1", tokens: { input: 100, output: 20 }, cost: 0.01, totalMs: 900, ttftMs: 100 });
          await d.flush();
        },
      });
    assert.deepEqual(files(dir).filter((f) => f.endsWith(".broken")), []);
  });

  test("telemetry", async () => {
    const dir = folder();
    await wayBack({
      dir,
      name: "telemetry.json",
      row: STORE_FILES.telemetry,
      says: /^warn \[telemetry\] telemetry\.json is version 2, which this Filament does not read \(it reads version 1\)/,
      use: async (log) => {
        const t = createTelemetry({
          dataDir: dir,
          armed: true,
          config: { get: () => ({ upstreams: [], telemetry: { enabled: true, noticeSeen: true } }) },
          usage: { dailyStore: { list: () => [] } },
          events: createEventBus(),
          context: () => ({ version: "0.9.75", platform: "win32", arch: "x64", install: "desktop", locale: "en-US", timeZone: "UTC" }),
          env: {},
          every: () => ({ unref() {} }),
          stopEvery: () => {},
          fetchImpl: /** @type {any} */ (async () => ({ ok: true, status: 204 })),
          log,
        });
        await t.look();
      },
    });
  });
});
