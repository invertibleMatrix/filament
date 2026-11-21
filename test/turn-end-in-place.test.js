// @ts-check
// A turn's end refreshes the panes in place (panes/pane-host.js `refresh`, app.js): the page drew every pane shown anew
// at each turn's end — Changes, Outputs, Run, Next request made again, new elements under a resting pointer, a press
// begun on one ending on another (the owner's of 11-01: "when i hover over my mouse over some interactive elements like
// buttons then those are just suppose to highlight only once they quite a lot of time they start blinking … and during
// that sometimes the clicks even don't pass through so i have to press more than once"; found in the drive of 11-02:
// the Changes pane's rows and its Read again made anew as the turn ended). Each pane that can refresh reads again what
// the turn moved, standing; one that cannot is drawn anew, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
const { createPaneHost } = await import("../src/ui/harness/panes/pane-host.js");

/** A pane that can refresh and one that cannot, in a tile host on the stub document, counting their draws. */
function hosted() {
  const { document, restore } = stubDocument();
  const saved = { local: g.localStorage, session: g.sessionStorage };
  /** @param {Map<string, string>} kept */
  const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
  g.localStorage = storage(new Map());
  g.sessionStorage = storage(new Map());
  const frame = /** @type {any} */ (document.createElement("aside"));
  document.body.append(frame);
  /** What each pane was asked: its draws and its refreshes. */
  const did = { changes: { render: 0, refresh: 0 }, plain: { render: 0 } };
  const host = createPaneHost(frame, {
    panes: [
      {
        id: "changes", label: "Changes", icon: "fileDiff",
        render: (/** @type {any} */ body) => {
          did.changes.render++;
          body.append(document.createElement("button"));
        },
        refresh: () => {
          did.changes.refresh++;
        },
      },
      {
        id: "plain", label: "Plain", icon: "file",
        render: (/** @type {any} */ body) => {
          did.plain.render++;
          body.append(document.createElement("button"));
        },
      },
    ],
    room: () => ({ row: 1600, win: 1920, height: 900 }),
    paint: () => {},
  });
  return {
    frame,
    host,
    did,
    done: () => {
      g.localStorage = saved.local;
      g.sessionStorage = saved.session;
      restore();
    },
  };
}

// (fails before: yes — the host had no refresh at once: a turn's end drew every pane shown anew)
test("a turn's end refreshes a pane in place where it can — its button stands — and draws one anew that cannot; the pulse waiting goes with it", (t) => {
  const p = hosted();
  try {
    p.host.setChat({ id: "c1", chainId: "c1", cwd: "/p" });
    p.host.openTab("changes");
    const button = p.frame.querySelector(".tile-body button") || p.frame.querySelectorAll("button").at(-1);
    assert.equal(p.did.changes.render, 1, "drawn once as it opened");
    p.host.refresh();
    assert.deepEqual(p.did.changes, { render: 1, refresh: 1 }, "refreshed, not drawn anew");
    assert.ok(button.isConnected, "its button stands");
    // The run's last pulse is waiting as the turn ends: the refresh at the end is the one, the pulse's goes.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      p.host.pulse();
      p.host.refresh();
      t.mock.timers.tick(1200);
    } finally {
      t.mock.timers.reset();
    }
    assert.deepEqual(p.did.changes, { render: 1, refresh: 2 }, "one refresh at the turn's end, none after");
    // A pane with no refresh of its own is drawn anew, as a draw does.
    p.host.openTab("plain");
    const drawn = p.did.plain.render;
    p.host.refresh();
    assert.equal(p.did.plain.render, drawn + 1, "drawn anew");
  } finally {
    p.done();
  }
});

// (fails before: yes — app.js drew the panes anew at a turn's end, `rail.draw()`)
test("the page refreshes the panes at a turn's end, never draws them anew", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const at = app.indexOf("The view follows the turn (D7)");
  assert.ok(at > 0, "the turn's end, where the view follows the turn");
  const end = app.slice(at, app.indexOf("if (turn.paused) transcript.pause(turn);", at));
  assert.match(end, /\n  rail\.refresh\(\);\n/);
  assert.doesNotMatch(end, /rail\.draw\(\)/);
});
