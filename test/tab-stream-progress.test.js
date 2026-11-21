// @ts-check
// A harness page's events stream (`?tab=`) carries no request's `progress` (http/events.js `sendRecord`): none of the
// page reads one — a running turn's figures come from its run's events — and a coding agent's says every permission its
// turn was asked, once a second, to every open window (the owner's of 11-17: 2.5 s of a 14.5 s hold of the server went
// to making those lines). The dashboard's stream (no tab), whose live rows read it, still gets it, its record without
// `priorChanges` (`progressSent`: nothing reads them off a progress, and they were 140 KB of its 141 KB); every other
// record event comes to both whole, each line made once for all the windows it goes to.
// (fails before: yes — a tab's stream was sent every progress, and its line made though only tabs were open; then, the
// dashboard's progress carried the turn's every permission)
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createEventBus } from "../src/services/events.js";
import { attachEventsStream } from "../src/http/events.js";

/** A window's stream, stood in: what the route writes, and its request's close. @param {string} url */
const window = (url) => {
  const req = Object.assign(new EventEmitter(), { url });
  /** @type {string[]} */
  const wrote = [];
  const res = { writableEnded: false, destroyed: false, writableNeedDrain: false, writableLength: 0, writeHead: () => res, write: (/** @type {string} */ s) => (wrote.push(s), true), destroy() {} };
  return { req, res, wrote, heard: () => wrote.slice(1).map((l) => JSON.parse(l.slice("data: ".length)).type) };
};

/** JSON.stringify counted for the payloads named. @param {object[]} payloads @param {() => void} fn */
function serialisations(payloads, fn) {
  const counts = new Map(payloads.map((p) => [p, 0]));
  const real = JSON.stringify;
  JSON.stringify = /** @type {any} */ (function (/** @type {any} */ v, /** @type {any[]} */ ...rest) {
    if (counts.has(v)) counts.set(v, /** @type {number} */ (counts.get(v)) + 1);
    return real.call(JSON, v, ...rest);
  });
  try {
    fn();
  } finally {
    JSON.stringify = real;
  }
  return payloads.map((p) => counts.get(p));
}

const record = { id: "r1", model: "m", priorChanges: ["permission: Claude Code asked to run `ls`"] };
const events = () => ["start", "first-byte", "progress", "progress", "finish"].map((type) => ({ type, record }));

test("a harness page's stream gets a request's start, first byte and finish but no progress; the dashboard's gets every one", () => {
  const bus = createEventBus();
  const sseClients = new Set();
  const page = window("/api/events?tab=t1");
  const dashboard = window("/api/events");
  for (const w of [page, dashboard]) attachEventsStream(/** @type {any} */ (w.req), /** @type {any} */ (w.res), { events: bus, sseClients, VERSION: "t" });
  for (const ev of events()) bus.publish("record", ev);
  bus.publish("op", { type: "op", name: "x" });
  assert.deepEqual(page.heard(), ["start", "first-byte", "finish", "op"]);
  assert.deepEqual(dashboard.heard(), ["start", "first-byte", "progress", "progress", "finish", "op"]);
  for (const w of [page, dashboard]) w.req.emit("close");
  assert.equal(sseClients.size, 0);
  // Closed, the page's stream hears nothing more: its filtered subscription went with the rest.
  bus.publish("record", { type: "finish", record });
  assert.deepEqual(page.heard(), ["start", "first-byte", "finish", "op"]);
});

test("with only harness pages open, no progress line is made; any other record's line is made once for every window", () => {
  const bus = createEventBus();
  const sseClients = new Set();
  const pages = [window("/api/events?tab=a"), window("/api/events?tab=b")];
  for (const w of pages) attachEventsStream(/** @type {any} */ (w.req), /** @type {any} */ (w.res), { events: bus, sseClients, VERSION: "t" });
  const [progress, finish] = [{ type: "progress", record }, { type: "finish", record }];
  assert.deepEqual(serialisations([progress, finish], () => (bus.publish("record", progress), bus.publish("record", finish))), [0, 1]);
  // Two dashboards beside them: the progress's line made once for both, and a finish still once for the four.
  const dashboards = [window("/api/events"), window("/api/events")];
  for (const w of dashboards) attachEventsStream(/** @type {any} */ (w.req), /** @type {any} */ (w.res), { events: bus, sseClients, VERSION: "t" });
  const [p2, f2] = [{ type: "progress", record }, { type: "finish", record }];
  const real = JSON.stringify;
  let progressLines = 0;
  JSON.stringify = /** @type {any} */ (function (/** @type {any} */ v, /** @type {any[]} */ ...rest) {
    if (v?.type === "progress") progressLines++;
    return real.call(JSON, v, ...rest);
  });
  let counted;
  try {
    counted = serialisations([f2], () => (bus.publish("record", p2), bus.publish("record", f2)));
  } finally {
    JSON.stringify = real;
  }
  assert.deepEqual([progressLines, ...counted], [1, 1]);
  for (const w of pages) assert.deepEqual(w.heard(), ["finish", "finish"]);
  for (const w of dashboards) assert.deepEqual(w.heard(), ["progress", "finish"]);
  for (const w of [...pages, ...dashboards]) w.req.emit("close");
});

test("the dashboard's progress leaves out the turn's priorChanges, its start, first byte and finish keep them, and the bus's other listeners hear the record whole", () => {
  const bus = createEventBus();
  const w = window("/api/events");
  attachEventsStream(/** @type {any} */ (w.req), /** @type {any} */ (w.res), { events: bus, sseClients: new Set(), VERSION: "t" });
  /** @type {any[]} */
  const inProcess = [];
  const off = bus.subscribe("record", (/** @type {any} */ p) => void inProcess.push(p));
  const rec = { id: "r2", model: "m", status: "pending", liveOutChars: 4400, changes: ["memory: 2 claims"], priorChanges: ["permission: run `ls`", "permission: read a.txt"] };
  for (const type of ["start", "first-byte", "progress", "finish"]) bus.publish("record", { type, record: rec, ...(type === "progress" ? { quietMs: 700 } : {}) });
  const sent = w.wrote.slice(1).map((l) => JSON.parse(l.slice("data: ".length)));
  const { priorChanges, ...rest } = rec;
  assert.deepEqual(sent[2], { type: "progress", record: rest, quietMs: 700 }, "every other field as it was, the quiet time too");
  for (const i of [0, 1, 3]) assert.deepEqual(sent[i].record, rec);
  assert.deepEqual(inProcess.map((p) => p.record.priorChanges), [priorChanges, priorChanges, priorChanges, priorChanges]);
  assert.equal(inProcess[2].record, rec, "the record itself, untouched");
  off();
  w.req.emit("close");
});

test("a stream whose tab is empty is the dashboard's: it keeps the progress", () => {
  const bus = createEventBus();
  const w = window("/api/events?tab=");
  attachEventsStream(/** @type {any} */ (w.req), /** @type {any} */ (w.res), { events: bus, sseClients: new Set(), VERSION: "t" });
  bus.publish("record", { type: "progress", record });
  assert.deepEqual(w.heard(), ["progress"]);
  w.req.emit("close");
});
