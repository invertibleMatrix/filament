// @ts-check
// A file a coding agent names as Git Bash spells it — `/h/proj/a.js`, WSL's `/mnt/h/proj/a.js` — is on the drive it
// names (r-hands, 11-12; app/agent-run.js `hostPath`, read by core/call-place.js `driveSpelled` as a command's folders
// are). On Windows `resolve` reads such a path from the current drive's root (`C:\h\proj\a.js`): the file the agent
// wrote in its chat's folder was outside it in Changes, with no diff, none of its round's own for Rewind to put back,
// and no write of its chat's to the keeper of a chat's own times, so the chat's own file watcher was woken by it.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { createAgentRun } from "../src/app/agent-run.js";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";

// (fails before: yes — `hostPath` is not a function)
test("a drive's spelling is that drive on Windows, unless a folder of its name is there; every other path, and every path elsewhere, is as it was said", async () => {
  const { hostPath } = await import("../src/app/agent-run.js");
  const none = { platform: "win32", isDir: () => false };
  assert.equal(hostPath("/h/proj/a.js", none), "H:\\proj\\a.js");
  assert.equal(hostPath("/H/proj/a b.js", none), "H:\\proj\\a b.js");
  assert.equal(hostPath("/mnt/c/Users/me/notes.md", none), "C:\\Users\\me\\notes.md");
  assert.deepEqual([hostPath("/h", none), hostPath("/h/", none)], ["H:\\", "H:\\"]);
  for (const p of ["C:\\proj\\a.js", "c:/proj/a.js", "src/a.js", "./a.js", "/home/me/a.js", "/tmp/x", "/mnt/data/x", "/cygdrive/h/x", "//server/share/x", "\\\\server\\share\\x", ""]) assert.equal(hostPath(p, none), p, p);
  // A folder named as the spelling starts, on the current drive: the path is in it, as `resolve` reads it.
  /** @type {string[]} */
  const asked = [];
  const there = { platform: "win32", isDir: (/** @type {string} */ p) => (asked.push(p), true) };
  assert.deepEqual([hostPath("/h/proj/a.js", there), hostPath("/mnt/h/proj/a.js", there)], ["/h/proj/a.js", "/mnt/h/proj/a.js"]);
  assert.deepEqual(asked.map((p) => p.replace(/^[a-z]:/i, "")), ["\\h", "\\mnt\\h"], "the folder asked for is the spelling's first, from the current drive's root");
  // Elsewhere `/h/proj` is a path like any other, and nothing is asked.
  const elsewhere = { platform: "linux", isDir: () => assert.fail("no folder is looked for") };
  assert.equal(hostPath("/h/proj/a.js", elsewhere), "/h/proj/a.js");
});

// (fails before: yes — `driveSpelled` is not a function: the spelling was read inside `asHost` alone)
test("the one reader of the spelling: the drive's path and the folder the spelling starts with", async () => {
  const { driveSpelled } = await import("../src/core/call-place.js");
  assert.deepEqual(driveSpelled("/h/proj/a.js"), { path: "H:/proj/a.js", folder: "/h" });
  assert.deepEqual(driveSpelled("/mnt/c"), { path: "C:/", folder: "/mnt/c" });
  assert.deepEqual(["/home/x", "/mnt/data", "C:/x", "h/x", "/cygdrive/h/x", ""].map((p) => driveSpelled(p)), [null, null, null, null, null, null]);
});

/** A drive path as Git Bash spells it: `C:\Users\me` as `/c/Users/me`. @param {string} p */
const gitBash = (p) => `/${p[0].toLowerCase()}${p.slice(2).replaceAll("\\", "/")}`;
/** And as WSL does: `/mnt/c/Users/me`. @param {string} p */
const wsl = (p) => `/mnt${gitBash(p)}`;
/** Whether the current drive holds a folder a spelling of `root`'s drive starts with: then that spelling is its own. */
const shadowed = (/** @type {string} */ root) => [gitBash(root), wsl(root)].some((p) => existsSync(win32.resolve(p.split("/").slice(0, p.startsWith("/mnt/") ? 3 : 2).join("/"))));

describe("a coding agent on Windows that names its files as Git Bash and WSL spell them", { skip: !WIN && "a drive's spelling is Windows'" }, () => {
  const root = WIN ? realpathSync.native(mkdtempSync(join(tmpdir(), "filament-run-paths-"))) : "";
  after(async () => {
    if (root) await removeDirs(root);
  });
  const skip = !/^[a-z]:\\/i.test(root) ? "the temp folder is on no drive" : shadowed(root) ? "the current drive holds a folder named as the drive is spelled" : false;
  const file = join(root, "src", "a.js");
  const other = join(root, "docs", "b.md");

  /** A translator over a recording sink, a tree that keeps what each round handed it, and the pictures kept. @param {Record<string, any>} [o] */
  const make = (o = {}) => {
    /** @type {any[]} */
    const events = [];
    /** @type {{ round: number, own: string[] }[]} */
    const asked = [];
    /** @type {any[]} */
    const kept = [];
    /** @type {import("../src/app/turn-tree.js").TurnTree} */
    const tree = {
      begin: async () => {},
      before: async () => {},
      take: async (r, t = {}) => {
        asked.push({ round: r, own: t.own || [] });
        return { rows: [], snapshots: [], errors: [] };
      },
      next: () => ({}),
      waiting: () => null,
    };
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, root, tree, keepImages: (pictures) => (kept.push(pictures), { images: [], notKept: null }), ...o });
    return { run, events, asked, kept, of: (/** @type {string} */ type) => events.filter((e) => e.type === type) };
  };

  // (fails before: yes — each named the current drive's `\c\Users\…`: `edits` a file outside the folder, the card's
  // subject and the call's file the spelling as said, the round's own files the spelling itself)
  test("a file in the chat's folder is in it: what the call says it writes, its card, its end, and the round's own files", { skip }, async () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Editing.", messageId: "m1" });
    t.run.take({ type: "raw", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: gitBash(file), old_string: "a", new_string: "b" } }] } } });
    t.run.take({ type: "tool", id: "e1", toolName: "Edit", title: "Edit", kind: "edit", status: "pending", locations: [{ path: gitBash(file) }] });
    t.run.take({ type: "tool", id: "e1", status: "completed", file: gitBash(file) });
    t.run.take({ type: "tool", id: "w1", title: "Write b.md", kind: "edit", status: "in_progress", locations: [{ path: wsl(other) }] });
    t.run.take({ type: "tool", id: "w1", status: "completed" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.edits, e.card.subject]), [["e1", [file], "src/a.js"], ["w1", [other], "docs/b.md"]]);
    assert.equal(t.of("tool-end").find((e) => e.id === "e1").file, "src/a.js");
    assert.deepEqual(t.asked, [{ round: 1, own: [file, other] }]);
  });

  // (fails before: yes — a picture's path was handed on as said, to be read from the current drive)
  test("a picture the agent looked at by such a path is read from its drive; a file outside the folder is still outside, on its drive", { skip }, () => {
    const t = make();
    const shot = join(root, "shot.png");
    t.run.take({ type: "tool", id: "v1", toolName: "read", title: "Read shot.png", kind: "read", status: "pending", rawInput: { file_path: gitBash(shot) } });
    t.run.take({ type: "tool", id: "v1", status: "completed", content: [{ type: "image", path: gitBash(shot) }] });
    assert.deepEqual(t.kept, [[{ path: shot }]]);
    const outside = join(root, "..", "filament-elsewhere.txt");
    t.run.take({ type: "tool", id: "o1", title: "Write elsewhere", kind: "edit", status: "in_progress", locations: [{ path: gitBash(outside) }] });
    assert.deepEqual(t.of("tool-start").find((e) => e.id === "o1").edits, [outside]);
  });
});
