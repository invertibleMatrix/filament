// @ts-check
// A chat opened from the left bar opens on its Chat tab, whatever tab it was left on (the owner's words of 10-29: "if i
// open the Agents tab and click on other session and then click back it shows the agents tab again … every click
// should open the chat tab"). An address that names a view — a link, Back and Forward — still opens on that view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// (fails before: yes — the page's wiring runs with its own document, so it is read from its source)
test("a left-bar click opens the chat on its Chat tab, an address on the view it names", () => {
  const src = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const bar = src.slice(src.indexOf("const sidebar = createSidebar(shell.sidebarHost, {"));
  // A row whose chat is open, a session row whose chat is not.
  assert.match(bar, /onSelectChat: \(id\) => \{ selectChat\(id, \{ view: "chat" \}\); leaveScreen\(\); \},/);
  // (Its unread mark goes with the open, `markRead`: chat-open-path.)
  assert.match(bar, /onOpen: \(s\) => \{\n\s*openSession\(s, \{ push: true, view: "chat" \}\);\n\s*leaveScreen\(\);\n\s*\},/);
  // The view asked for is the one it opens on, for a chat already open as for one opened now.
  assert.match(src, /function selectChat\(id, opts = \{\}\) \{\n(?:\s*\/\/[^\n]*\n)?\s*deskGuest\?\.close\(\);\n\s*state\.currentId = id;\n\s*const chat = chatOf\(id\);\n\s*if \(!chat\) return;\n\s*if \(opts\.view\) chat\.viewTab = opts\.view;/);
  assert.match(src, /if \(open\) \{\n\s*pushNextAddress = !!opts\.push;\n\s*selectChat\(open\.id, \{ view: opts\.view \}\);/);
  assert.match(src, /viewTab: opts\.view \|\| was\?\.viewTab \|\| "chat",/);
  // An address keeps the view it names: the route sets it, and a thread a row of Now names opens in Agents.
  assert.match(src, /if \(open\) \{\n\s*open\.viewTab = route\.view;\n\s*selectChat\(open\.id\);/);
  assert.match(bar, /onOpenThread: \(s, id\) => \{\n\s*openSession\(s, \{ push: true \}\);\n\s*views\.show\("side"\);/);
});
