// The floating pane fitted to the window (src/ui/harness/lib/layout.js, panes/pane-host.js, shell.js; proposal_ux §3.5):
// docked, the panes' columns go by the room the chat leaves (test/pane-tiles.test.js); floating, the pane keeps the width
// the person chose, narrowed so the chat keeps 480 px beside it — the chat's parts step aside for it, so its width is
// the chat's; it hides on a window resize only when even its least leaves the chat short, and any ask shows it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fitPane, convBeside, roomHides, FLOAT_INSET, PANE_MIN_CONV, PANE_MIN } from "../src/ui/harness/lib/layout.js";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/harness/${p}`, import.meta.url), "utf8");

describe("the floating pane fitted to the window", () => {
  // (fails before: yes — the shell read a floating pane as taking no width: chosen at 553 px in a 1500 px window, it
  // kept 553 px when the window narrowed, and at 960 px the conversation kept 182 px, its header under the pane)
  test("its width: the chosen one, narrowed so the chat keeps 480 px, never under 280 nor over the chosen", () => {
    assert.equal(fitPane(553, 1230), 553, "room enough: the chosen width");
    assert.equal(fitPane(553, 910), 414);
    assert.equal(convBeside(414, 910), PANE_MIN_CONV, "narrowed to leave the chat its 480 px");
    assert.equal(fitPane(553, 690), PANE_MIN, "never under the pane's least");
    assert.ok(convBeside(PANE_MIN, 690) < PANE_MIN_CONV, "which leaves the chat short: a resize hides it");
    assert.equal(fitPane(300, 2000), 300, "never wider than chosen");
    assert.equal(FLOAT_INSET, 16, "its 8 px from the frame's edge, and the 8 px the chat's parts keep from it");
  });

  // (fails before: yes — the policy skipped a floating pane, an open showed the remembered width whatever the window,
  // a drag's width was the only one: the window could not narrow it, and the sidebar's rule read the frame before the
  // pane's new width was painted — drive 8, docked at 1180: the sidebar collapsed beside a pane fitted to leave 480 px)
  test("the panes fitted on a resize and on an open, hidden on a resize when even their least leaves the chat short; the sidebar goes by what they leave", () => {
    const host = src("panes/pane-host.js");
    assert.match(host, /width = fitPane\(chosen, row\);\n\s*if \(why\) autoOff = roomHides\(why === "ask", width, row\);/);
    assert.match(host, /relayout: \(\) => relayout\("resize"\),/, "a window resize");
    assert.match(src("app.js"), /\nshell\.onRoom\(\(\) => rail\.relayout\(\)\);\n/);
    const shell = src("shell.js");
    assert.match(shell, /const applyAutoPolicy = \(\) => \{\n\s*for \(const f of roomers\) f\(\);\n\s*const row = splitRow\.clientWidth;\n\s*const conv = panes\.shown && !panes\.float \? row - panes\.width : row;\n\s*const sideWouldLeave = autoCollapsed \? conv - sidebarW - 4 \+ COLLAPSED_W : conv;/, "the panes fitted first; the sidebar goes by the chat they leave");
    assert.match(shell, /if \(autoCollapsed !== was\) for \(const f of roomers\) f\(\);/, "and fitted again to the row the sidebar's fold made");
    assert.doesNotMatch(shell, /convFrame\.clientWidth/);
    // A drag is the person choosing: the floating pane's width, or the docked panes' for as many columns as show.
    assert.match(host, /if \(look\.float\) floatW = w;\n\s*else L\.widths\[String\(Math\.max\(1, shown\.length\)\)\] = w;/);
    assert.match(host, /const chosen = floatW \?\? Math\.max\(PANE_MIN, Math\.min\(maxFloat\(\), Math\.round\(row \* 0\.45\)\)\);\n\s*if \(wanted && floatW === null\) \{/, "the first time it floats, a width from the window, kept once it shows");
  });

  // (fails before: yes — with the pane hidden by the window's room, its toggle took two clicks to show it, and opening
  // a tab — the Terminal on Ctrl+J, a file from a chip — showed nothing)
  test("panes the window's room hid show on one press of their toggle, and on a tab opened", () => {
    assert.equal(roomHides(true, PANE_MIN, 690), false, "asked for: shown, however short the room");
    assert.equal(roomHides(false, PANE_MIN, 690), true, "put back, or a resize, in a room too short: hidden");
    assert.equal(roomHides(false, 414, 910), false, "room enough: shown");
    const app = src("app.js");
    assert.match(app, /function togglePane\(\) \{\n\s*rail\.setOpen\(!rail\.shown\);\n\}/, "by what is on screen, not by what was left on");
    const host = src("panes/pane-host.js");
    assert.match(host, /get shown\(\) \{ return look\.on; \},/);
    assert.match(host, /function openTab\(id, o = \{\}\) \{[\s\S]{0,500}?relayout\(o\.asked === false \? "back" : "ask"\);/, "a tab says how it was asked for, as the panes do");
    assert.match(host, /function setOpen\(on, o = \{\}\) \{[\s\S]{0,300}?relayout\(on \? \(o\.asked === false \? "back" : "ask"\) : undefined\);/);
    // (fails before: yes — HarnessV4_Tasks E15 step 2: every tab opened was an ask, so an agent's conversation opened
    // by the page itself pushed a narrow window's chat aside)
    assert.match(app, /const showBeside = \(id\) => \{\n\s*rail\.openTab\(threadTabId\(id\), \{ asked: false \}\);\n\s*return rail\.whereIs\(threadTabId\(id\)\) === "front";\n\};/, "an agent's thread takes the panes only where the window has room");
    // Every sub-agent runs as a card (step 4): the one that takes the pane is the one asked by its tag.
    // (fails before: yes — HarnessV4_Tasks E15 step 5, AG-104: in a window too narrow, and for any agent not asked by
    // its tag, the conversation opened in a sheet over the page)
    assert.match(app, /if \(subagentStore\.row\(id\)\?\.asked && showBeside\(id\)\) \{[\s\S]{0,120}?return;\n\s*\}\n\s*views\.side\.open\(id, \{ followUp \}\);\n\};/, "asked for in a window too narrow, it opens as its thread in the Side tab");
    assert.doesNotMatch(app + src("subagent-viewer.js"), /openSubagentViewer|sav-sheet/, "no sheet opens over the page");
    // (fails before: yes — found by hand on HarnessV4_Tasks E15 step 2, the plan's case 32: in a narrow window a send
    // opened the sheet over the chat)
    const ask = app.slice(app.indexOf("async function askAgents("), app.indexOf("// The dock's decisions"));
    assert.ok(ask.includes("if (out.subagents[0]) showBeside(out.subagents[0].id);") && !ask.includes("openSubagent("), "a send shows the agent beside the chat or not at all: the sheet is the card's Open's");
  });

  // (fails before: yes — HarnessV4_Tasks U4, found in HarnessV3-Views' drives: a full-frame screen (Settings, the
  // Context page, a control room) closed the pane and opened it again on the way back, and every open was an ask — so
  // a pane the window's room had hidden came back shown, over a conversation too narrow for it; HarnessV4_Artifacts_Plan
  // E18 step 2's drive: the window narrowed to 420 px under an artifact's full view, and Back put the pane back shown
  // over a conversation left 70 px wide)
  test("a full-frame screen covers the frame and leaves the panes as they were: a window narrowed meanwhile is fitted as any resize", () => {
    const shell = src("shell.js");
    // In the desktop app's own title bar the header is the window's bar, out of the frame (titlebar.test.js).
    assert.match(shell, /const mainFrame = h\("section", \{ class: "main-frame" \}, titleBar \? null : header\.el, splitRow\);/);
    assert.match(shell, /setScreen: \(on\) => \{\n\s*mainFrame\.classList\.toggle\("screen-on", on\);\n(?:\s*\/\/[^\n]*\n)?\s*root\.classList\.toggle\("screen-up", on\);\n\s*header\.el\.inert = on;\n\s*splitRow\.inert = on;\n(?:\s*\/\/[^\n]*\n)?\s*if \(crumbSlot\) crumbSlot\.inert = crumbOff\(\);\n\s*\},/, "what it covers keeps no focus: keys go to the screen — the chat's crumb too, where the sidebar holds it");
    // The crumb is off under a screen, or while another machine's chat stands over the column.
    assert.match(shell, /function crumbOff\(\) \{\n\s*return root\.classList\.contains\("screen-up"\) \|\| root\.classList\.contains\("guest-up"\);/);
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\n\.main-frame\.screen-on > :is\(\.c-bar, \.split-row\), \.main-frame\.screen-on > \.split-row > \.pane-frame \{ visibility: hidden; \}/, "what it covers waits unseen, laid out as it was");
    // (fails before: yes — Phase 1's pictures: the floating pane's own rule made it visible, over Settings)
    assert.ok(css.indexOf(".main-frame.screen-on > :is(") > css.indexOf(".app-shell.pane-float.pane-float-open .pane-frame {"), "the floating pane too: the rule comes after the one that shows it");
    const app = src("app.js");
    assert.match(app, /\n {2}shell\.setScreen\(isScreen\(route\.kind\)\);\n/);
    assert.doesNotMatch(app, /railWas|rail\.setOpen\(false\)/, "the panes are not closed and opened again on the way");
  });

  // (fails before: yes — the owner's of 11-08: a drag begun on the line the edge draws over its handle sized nothing,
  // and only a second try a pixel off it did; in Chromium, elementFromPoint 2-3 px into the edge was .panes-edge itself)
  test("the panes' edge: its line takes no press, so a drag begun on it reaches the handle under it", () => {
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    const line = /\n\.panes-edge::after \{([^}]*)\}/.exec(css);
    assert.ok(line, "the edge's line");
    assert.match(line[1], /pointer-events: none;/);
  });
});
