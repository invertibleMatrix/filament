// @ts-check
// The walk's version (`WALK_VERSION`), in what a turn's or a run's changes kept on disk rest on (services/changes-kept.js):
// a cut written by one walk is read back by a later process only while the walk that would answer it reads git and
// shapes its answer alike. Pinned here to the walk's source — adapters/git/changes.js whole, and the cuts the routes keep
// (`treeFirst`, `collatorOf`, `firstOf`) —: a change to any of them fails this test until WALK_VERSION moves and its
// source is pinned under the new version. A change that answers alike may move it too: the cuts are read again once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { WALK_VERSION } from "../src/adapters/git/changes.js";
import { collatorOf, treeFirst } from "../src/http/admin/memory.js";
import { firstOf } from "../src/http/admin/runs.js";

/** Each version's source, by its digest. @type {Record<number, string>} */
const PINS = {
  1: "9ae21338d19449a91bc8ab8e2c5291debeea65a50809a4f32231ed461c5b7873",
  2: "95afad937e189de9af8ee9276217732a6f44e6d317fb5693ac2d1e6dfaef35d8",
  3: "847836ca5b0b4a61f3b1441f3473dd37e20fe6e7f6effb8b7e747dc4f3953fae",
};

test("WALK_VERSION moves with the walk's source", () => {
  const src = [readFileSync(new URL("../src/adapters/git/changes.js", import.meta.url), "utf8"), treeFirst.toString(), collatorOf.toString(), firstOf.toString()].join("\n").replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(src).digest("hex");
  assert.equal(PINS[WALK_VERSION], digest, `the walk's source changed under WALK_VERSION ${WALK_VERSION}: move WALK_VERSION in src/adapters/git/changes.js, and pin ${digest} under it here`);
});
