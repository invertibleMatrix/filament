// @ts-check
// Value classes (HarnessV3-Memory M3-2): the typed values read out of a claim's words. Each class reads its own
// wording only, names exactly one current value or none, and says whether the value is this project's. The near misses
// matter as much as the hits: a command, another folder, a bread bun.
import { test } from "node:test";
import assert from "node:assert/strict";
import { valuesOf, rivals, withinFolder } from "../src/services/memory/values.js";

/** The values as "class=value", "(other)" marking one that is not this project's. @param {Parameters<typeof valuesOf>[0]} claim */
const read = (claim) => [...valuesOf(claim)].map(([k, v]) => `${k}=${v.value}${v.project ? "" : " (other)"}`);

test("package manager: a manager's wording names it, a command or the registry does not", () => {
  assert.deepEqual(read("I always use pnpm for package installs in this project"), ["package manager=pnpm"]);
  assert.deepEqual(read("This project uses pnpm as its package manager."), ["package manager=pnpm"]);
  assert.deepEqual(read("no, we switched to bun for installs now"), ["package manager=bun"]);
  assert.deepEqual(read("Package manager: bun"), ["package manager=bun"]);
  assert.deepEqual(read("install deps with pnpm"), ["package manager=pnpm"]);
  assert.deepEqual(read("run yarn install after a pull"), ["package manager=yarn"], "an install names the manager that does it");
  assert.deepEqual(read("no, don't run npm test directly in this shell; run it as env -u CLAUDECODE npm test."), [], "a command is not a package manager");
  assert.deepEqual(read("the package is published on npm"), [], "the registry is not a package manager");
  assert.deepEqual(read("I had a bun with butter for lunch"), [], "a bread bun");
});

test("package manager: the value left behind is set aside, and a refusal names none", () => {
  assert.deepEqual(read("We use bun instead of pnpm."), ["package manager=bun"]);
  assert.deepEqual(read("Switched from pnpm to bun."), ["package manager=bun"]);
  assert.deepEqual(read("pnpm → bun for installs"), ["package manager=bun"]);
  assert.deepEqual(read("use pnpm → use bun"), ["package manager=bun"], "the arrow's left side is the value left behind");
  assert.deepEqual(read("don't run npm install, use bun install"), ["package manager=bun"]);
  assert.deepEqual(read("we do not use pnpm"), [], "a refused value is no value");
  assert.deepEqual(read("we use pnpm locally and use yarn in CI"), [], "two current values: none is THE value");
});

test("package manager: another subject's manager is read but not this project's", () => {
  assert.deepEqual(read("the frontend uses yarn"), ["package manager=yarn (other)"]);
  assert.deepEqual(read("remember that the frontend uses yarn"), ["package manager=yarn (other)"]);
  assert.deepEqual(read("no the frontend uses yarn"), ["package manager=yarn (other)"], "a bare 'no' opens, it is no subject");
  assert.deepEqual(read("Remember that Hermes uses uv"), ["package manager=uv (other)"]);
  assert.deepEqual(read("their repo uses yarn"), ["package manager=yarn (other)"]);
  assert.deepEqual(read("The docs site's package manager is yarn"), ["package manager=yarn (other)"]);
  assert.deepEqual(read("the repo uses yarn"), ["package manager=yarn"], "the repo is this one");
  assert.deepEqual(read("remember that this project uses pnpm as its package manager."), ["package manager=pnpm"], "'remember that' opens, it is no subject");
  assert.deepEqual(read("The user prefers pnpm for installs."), ["package manager=pnpm"], "the learner's third person is the person's own work");
  assert.deepEqual(read("As a rule, we use pnpm"), ["package manager=pnpm"]);
});

test("working folder: an absolute path said of this project, never of another folder", () => {
  assert.deepEqual(read("remember that this project is checked out at D:\\old\\proj and builds there."), ["working folder=D:\\old\\proj"]);
  assert.deepEqual(read("the working directory is C:\\Users\\me\\proj."), ["working folder=C:\\Users\\me\\proj"], "the full stop is no part of it");
  assert.deepEqual(read("we cloned it to /home/me/code/app"), ["working folder=/home/me/code/app"]);
  assert.deepEqual(read("This project moved from D:\\old to D:\\new"), ["working folder=D:\\new"]);
  assert.deepEqual(read("this project is now at C:\\new, not D:\\old"), ["working folder=C:\\new"]);
  assert.deepEqual(read("the repo lives in C:\\a and we keep a mirror in D:\\b"), ["working folder=C:\\a"]);
  assert.deepEqual(read("the repo lives in C:\\a on the desktop; on the laptop the repo lives in D:\\b"), [], "two folders said of this project: none is THE folder");
  assert.deepEqual(read("remember that the team's notes vault lives at D:\\vault\\notes."), [], "another folder");
  assert.deepEqual(read("I think the vault lives at D:\\vault"), [], "an 'I' earlier in the sentence is not the vault's subject");
  assert.deepEqual(read("this project's backups are at D:\\backups"), [], "the project's backups, not the project");
  assert.deepEqual(read("we stored backups in D:\\b"), [], "a thing stored in a folder");
  assert.deepEqual(read("the config file is at C:\\proj\\config.json"), [], "a file's place");
  assert.deepEqual(read("see https://example.com/home/x and the route /api/memory"), [], "a link and a route are not folders");
});

test("file tools, platform, region and port", () => {
  assert.deepEqual(read("There are no file tools in this session."), ["file tools=none"]);
  assert.deepEqual(read("file tools are unavailable here"), ["file tools=none"]);
  assert.deepEqual(read("the file tools are now available"), []);
  assert.deepEqual(read("we're on Windows"), ["platform=win32"]);
  assert.deepEqual(read("this machine runs macOS"), ["platform=darwin"]);
  assert.deepEqual(read("we deploy to linux servers"), [], "where it deploys is not the machine it runs on");
  assert.deepEqual(read("no, the staging server is in region eu-central-1 now."), ["region=eu-central-1"]);
  assert.deepEqual(read("moved from eu-west-2 to eu-central-1"), ["region=eu-central-1"]);
  assert.deepEqual(read("use europe-west2 for the bucket"), ["region=europe-west2"]);
  assert.deepEqual(read("Filament listens on port 20300"), ["port=20300"]);
  assert.deepEqual(read("the api listens on port 8080 and the admin on port 9090"), [], "two ports: none is THE port");
  assert.deepEqual(read("the report 2024 says we import 42 modules"), [], "a number after 'report' or 'import' is no port");
});

test("a stored slot is read first, and a slot value that is no value of its class is nothing", () => {
  assert.deepEqual(read({ text: "x", slot: "project · package manager", slot_value: "Bun" }), ["package manager=bun"]);
  assert.deepEqual(read({ text: "We use pnpm.", slot: "frontend · package manager", slot_value: "yarn" }), ["package manager=yarn (other)"], "the slot wins over the words");
  assert.deepEqual(read({ text: "x", slot: "project · package manager", slot_value: "bun (lockfile)" }), []);
  assert.deepEqual(read({ text: "We use pnpm.", slot: "project · editor", slot_value: "vim" }), ["package manager=pnpm"], "a slot of no class leaves the words");
  assert.deepEqual(read({ text: "x", slot: "project · operating system", slot_value: "Windows" }), ["platform=win32"]);
  assert.deepEqual(read({ text: "x", slot: "project · port", slot_value: "3000" }), ["port=3000"]);
  assert.deepEqual(read({ text: "x", slot: "project · port", slot_value: "3000 (dev)" }), [], "a port is its digits alone");
});

test("rivals: different values of one class, within one ecosystem; folders when neither holds the other", () => {
  assert.equal(rivals("package manager", "pnpm", "bun"), true);
  assert.equal(rivals("package manager", "pnpm", "PNPM"), false);
  assert.equal(rivals("package manager", "pnpm", "poetry"), false, "a node and a python manager can both hold");
  assert.equal(rivals("region", "eu-west-2", "eu-central-1"), true);
  assert.equal(rivals("working folder", "C:\\proj", "c:/proj/src"), false);
  assert.equal(rivals("working folder", "D:\\old\\proj", "C:\\proj"), true);
  assert.equal(withinFolder("C:\\proj\\src", "C:\\"), true);
  assert.equal(withinFolder("C:\\project", "C:\\proj"), false, "a longer name is not inside");
  assert.equal(withinFolder("/home/a", "/"), true);
  assert.equal(withinFolder("/Home/a", "/home"), false, "POSIX paths keep their case");
});
