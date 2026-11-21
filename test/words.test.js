// @ts-check
// proposal_ux §8 phase 9 (N1): the same words everywhere. The names several parts of the harness page say — New chat,
// Search, Chats, Find in chat, Previous and Next chat, Copy chat path, Past chats — are written once, in
// `src/ui/harness/lib/words.js`, and every page reads them from there; and a conversation is a chat on every page:
// "task" stays the task graph's, the Space board's, a worker's and a coding agent's background task. This reads every string the page's
// own modules and the shared parts it draws hold (comments and regular expressions are not words a person sees).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { jsStrings } from "./helpers/js-strings.js";
import { WORDS } from "../src/ui/harness/lib/words.js";

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");

/** Every module under `dir`, the vendored ones left out. @param {string} dir @param {string[]} [out] @returns {string[]} */
const modules = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) modules(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
};
const name = (/** @type {string} */ p) => relative(UI, p).replaceAll("\\", "/");

/** The harness page's own modules, and the shared parts it draws. */
const FILES = [...modules(join(UI, "harness")), ...modules(join(UI, "lib"))].sort();
const TABLE = "harness/lib/words.js";

// (fails before: yes — "New chat" was written in four files, "Chats" in three, "Search" in two)
test("the shared names are written in the words table alone; the pages read them from it", () => {
  /** @type {Set<string>} */
  const names = new Set(Object.values(WORDS));
  /** @type {string[]} */
  const found = [];
  for (const f of FILES) {
    if (name(f) === TABLE) continue;
    for (const s of jsStrings(readFileSync(f, "utf8"))) if (names.has(s.text)) found.push(`${name(f)}:${s.line}: ${s.text}`);
  }
  assert.deepEqual(found, []);
  for (const page of ["harness/app.js", "harness/sidebar.js", "harness/header.js", "harness/command-center.js", "harness/composer/composer.js", "harness/composer/slash.js", "harness/settings/archived.js"]) {
    assert.match(readFileSync(join(UI, page), "utf8"), /import \{ WORDS \} from "(\.\/|\.\.\/)lib\/words\.js";/, `${page} reads the table`);
  }
  assert.ok(Object.isFrozen(WORDS), "the table is read, never written");
});

/** A conversation called a task, or the old "sessions" of the box's `#`. */
const OLD = /\b([Tt]his|[Oo]ld|[Ll]ater) tasks?\b|\b[Nn]ew task\b|\btask's (first|own)\b|^Tasks?$|\bTask (completed|error)\b|\b(When|open) a task\b|\b[Pp]ast sessions\b|\b(recent|files,) sessions\b/;
/**
 * Where a task is the task graph's, a project's Space's board's, or an agent's own: the graph's own files, the board's,
 * a tool card's "Task", the brief's row.
 */
const TASKS_OWN = new Set(["harness/views/task-graph.js", "harness/space/board.js"]);
const OWN_STRINGS = new Set([
  "harness/conversation/tools/render.js: Task",
  "harness/lib/agent-cards.js: Task",
  // The Space's board under its head, Tasks, with New task… (HarnessV4_Space_Plan S1)
  "harness/space/space.js: Tasks",
  "harness/space/space.js: New task…",
]);

// (fails before: yes — the notifications' "Task completed", Settings' "When a task finishes" and "Auto-archive old
// tasks", the Start's "runs this task" and "Memory for this task", the box's "Past sessions", a fork's "new task")
test("no string of the harness page calls a chat a task", () => {
  /** @type {string[]} */
  const found = [];
  for (const f of FILES) {
    if (TASKS_OWN.has(name(f))) continue;
    for (const s of jsStrings(readFileSync(f, "utf8"))) {
      if (OLD.test(s.text) && !OWN_STRINGS.has(`${name(f)}: ${s.text}`)) found.push(`${name(f)}:${s.line}: ${s.text}`);
    }
  }
  assert.deepEqual(found, []);
});

test("the Start names the chat it starts", async () => {
  const { engineWords } = await import("../src/ui/harness/conversation/start-board.js");
  assert.equal(engineWords({ kind: "loop" }), "Filament's agent loop runs this chat — this is its first request");
});
