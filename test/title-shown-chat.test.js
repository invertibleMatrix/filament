// @ts-check
// A turn that ends in a chat not on screen leaves the header's title alone (the crafter drive of 10-27: the crafter
// paused for a yes while its source chat was shown, and the header took the crafter's title over the source chat's).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");

// (fails before: yes — the turn's end called setTitle(chat) for whichever chat it ended in)
test("a turn's end sets the title only for the chat on screen", () => {
  const at = app.indexOf("leaves the header's title alone");
  assert.ok(at > 0, "the turn's end says why");
  const tail = app.slice(at, app.indexOf("await transcript.finish(live,", at));
  assert.match(tail, /\n\s+if \(chatOf\(state\.currentId\) === chat\) setTitle\(chat\);\n/);
  assert.equal((tail.match(/setTitle\(/g) || []).length, 1, "no other setTitle there");
});
