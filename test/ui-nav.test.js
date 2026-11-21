// @ts-check
// Hash router and jump-list tables. A bookmark that lands on the wrong hub tab looks like lost data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseHash,
  formatHash,
  palettePages,
  TRAFFIC_TABS,
  MEM_TABS,
  DEST_TABS,
  PAGES,
} from "../src/ui/nav.js";
import { CHROME } from "../src/ui/copy.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roundTrip = (raw) => {
  const patch = parseHash(raw);
  assert.ok(patch, `parseHash(${JSON.stringify(raw)})`);
  const hash = formatHash({
    tab: patch.tab,
    homePane: patch.homePane,
    section: patch.section,
    memSel: patch.memSel,
    reqFilter: patch.reqFilter,
  });
  assert.equal(hash, `#${raw}`, `formatHash must emit #${raw}`);
  const again = parseHash(hash.slice(1));
  assert.deepEqual(again?.tab, patch.tab);
};

describe("ui/nav hash", () => {
  test("hub bookmarks round-trip, including the ones applyHash used to drop", () => {
    for (const raw of [
      "destinations",
      "destinations:routes",
      "destinations:models",
      "destinations:new-virtual",
      "memory",
      "memory:memories",
      "memory:sessions",
      "memory:sessions:abc-1",
      "memory:activity",
      "memory:projects",
      "memory:usage",
      "memory:settings",
      "memory:settings:backups",
      "lab",
      "lab:dryrun",
      "settings:rules",
      "settings:templates",
      "settings:prompts",
      "overview:health",
      "requests",
      "requests:all",
      "requests:usage",
      "docs:commands",
    ])
      roundTrip(raw);
  });

  test("Destinations opens on Upstreams: the sidebar, the bare hash, the first tab; old Upstreams links still land there", () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "index.html"), "utf8");
    assert.match(html, /<button data-nav="destinations" data-tab="upstreams">/, "the sidebar's Destinations button");
    assert.equal(DEST_TABS[0][0], "upstreams", "Upstreams is the first tab");
    assert.equal(parseHash("destinations")?.tab, "upstreams");
    assert.equal(parseHash("destinations:upstreams")?.tab, "upstreams", "a bookmark or link made before the change");
    assert.equal(parseHash("destinations:no-such-tab")?.tab, "upstreams");
    assert.equal(parseHash("destinations:routes")?.tab, "routes");
    assert.equal(parseHash("destinations:edit-3")?.tab, "routes", "a route's edit link still opens Routes");
    assert.equal(formatHash({ tab: "upstreams" }), "#destinations");
  });

  // Changed on purpose by HarnessV3-Launch LD-D10: Traffic's default is Requests, not All.
  test("an unknown Traffic sub-tab falls through to Requests rather than a blank page", () => {
    const p = parseHash("requests:no-such-tab");
    assert.equal(p?.tab, "requests");
    assert.equal(p?.reqFilter?.tab, "requests");
  });

  test("the palette names every hub tab and every Traffic view", () => {
    const ids = new Set(palettePages().map((c) => c.id));
    for (const id of TRAFFIC_TABS) assert.ok(ids.has(`requests:${id}`), `palette missing Traffic → ${id}`);
    for (const [id] of MEM_TABS) {
      const hashId =
        id === "memory" ? "memory" : `memory:${id === "memsettings" ? "settings" : id === "memusage" ? "usage" : id}`;
      assert.ok(ids.has(hashId), `palette missing ${hashId}`);
    }
    for (const [id] of DEST_TABS) assert.ok(ids.has(id), `palette missing ${id}`);
    for (const k of Object.keys(PAGES)) assert.ok(PAGES[k][0] && PAGES[k][1], `${k} needs a title and a subtitle`);
  });
});

describe("ui/copy chrome", () => {
  test("index.html's chrome labels match CHROME so a no-JS load and boot cannot drift", () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "index.html"), "utf8");
    assert.ok(html.includes(CHROME.connecting));
    assert.ok(html.includes(CHROME.unsaved));
    assert.ok(html.includes(`>${CHROME.discard}<`));
    assert.ok(html.includes(CHROME.save));
    assert.ok(html.includes(CHROME.appearance));
    assert.ok(html.includes(CHROME.collapseNav));
  });
});
