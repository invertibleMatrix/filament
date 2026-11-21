// @ts-check
// HarnessV4_Artifacts_Plan E18 step 8: Claude desktop's own artifacts, in a chat imported from Claude Code (AFC-51,
// AFC-150 to AFC-155). Claude desktop's Code tab publishes with its own tool, `Artifact` — the same word as Filament's
// `artifact` but for its case — and keeps the page on claude.ai. Its calls read as what they did there, the page's
// claude.ai link a link; nothing is fetched or copied; a chat gone on in the harness tells the model of them in words.
// Filament's own tool reads as it did. Everything is made up, in a temp folder.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { importClaudeCode } from "../src/services/memory/import/claude-code.js";
import { cardOf, kindOfName, toolsOfTurn } from "../src/core/tool-vocab.js";
import { adaptTurn } from "../src/core/turn-adapter.js";
import { archivedRows, archivedStubs, claudeArtifactLink } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";

const dir = mkdtempSync(join(tmpdir(), "filament-artifact-imports-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const T0 = Date.parse("2026-10-01T09:00:00Z");
const MIN = 60_000;
const PAGE = "https://claude.ai/artifact/An4fQS8zRUMz3ZKFrmpxrF";
const OTHER = "https://claude.ai/artifact/Zz9yXw8v";
const FILE = "C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\proj\\scratchpad\\phone-guide.html";
/** Claude desktop's words for a publish, as its result's text holds them: the page's address on the first line. */
const PUBLISHED = `Published ${FILE} at ${PAGE} (Version 1, version id 1791382969-5c8d) Icon: "phone".\n\nLive subscription: arming in the background.\n\nTo update: publish the same file path here (keeps this URL).`;
/** A quickstart's result names addresses of its own: none is the call's page. */
const GUIDE = `Quickstart for a document. Start from the Docs type: https://claude.ai/artifact/DocType01 — publish with its type_url.`;

/** A Claude Code chat file, a line at a time. @param {string} sid */
function chatFile(sid) {
  let n = 0;
  const line = (/** @type {number} */ i, /** @type {any} */ o) => JSON.stringify({ parentUuid: null, isSidechain: false, userType: "external", cwd: join(dir, "proj"), sessionId: sid, version: "2.1.0", uuid: `u-${++n}`, timestamp: new Date(T0 + i * MIN).toISOString(), ...o }) + "\n";
  const ask = (/** @type {number} */ i, /** @type {any} */ content) => line(i, { type: "user", message: { role: "user", content } });
  const reply = (/** @type {number} */ i, /** @type {any[]} */ content) => line(i, { type: "assistant", requestId: `r${i}`, message: { id: `m${i}`, type: "message", role: "assistant", model: "claude-sonnet-4-5", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } });
  const call = (/** @type {string} */ id, /** @type {any} */ input) => ({ type: "tool_use", id, name: "Artifact", input });
  const result = (/** @type {number} */ i, /** @type {string} */ id, /** @type {string} */ text, isError = false) => ask(i, [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], ...(isError ? { is_error: true } : {}) }]);
  return { ask, reply, call, result };
}

describe("Claude desktop's artifact tool: its calls read as what they did on claude.ai (AFC-150 to AFC-152, AFC-154)", () => {
  // (fails before: yes — `Artifact` was read as Filament's own `artifact`: every call said "Artifact" and named nothing)
  test("each action its title; the page by its file's name, its files or its address; a made-up action named as itself", () => {
    const card = (/** @type {any} */ input) => cardOf("Artifact", input);
    assert.equal(kindOfName("Artifact"), "claude-artifact");
    assert.deepEqual(card({ file_path: FILE, icon: "phone", description: "How the phone works." }), { kind: "claude-artifact", title: "Publish on claude.ai", subject: "phone-guide.html" });
    assert.deepEqual(card({ action: "publish", url: PAGE, file_path: "/home/dev/site/index.html" }), { kind: "claude-artifact", title: "Publish on claude.ai", subject: "index.html" });
    assert.deepEqual(card({ action: "quickstart", intent: "document" }), { kind: "claude-artifact", title: "Read the artifact guide on claude.ai", subject: "document" });
    assert.deepEqual(card({ action: "list", scope: "mine" }), { kind: "claude-artifact", title: "List artifacts on claude.ai", subject: "mine" });
    assert.deepEqual(card({ action: "read", url: OTHER }), { kind: "claude-artifact", title: "Read an artifact on claude.ai", subject: OTHER });
    assert.deepEqual(card({ action: "delete", url: OTHER }), { kind: "claude-artifact", title: "Delete an artifact on claude.ai", subject: OTHER });
    assert.deepEqual(card({ action: "publish", url: PAGE, asset: true, file_paths: ["a.png", "b.png"] }), { kind: "claude-artifact", title: "Upload to an artifact on claude.ai", subject: "2 files" });
    assert.deepEqual(card({ action: "constructor" }), { kind: "claude-artifact", title: "Artifact on claude.ai", subject: "constructor" });
  });

  // (fails before: yes — a data action, or one the model made up, read as "Artifact"; "constructor" read as a function)
  test("Filament's own `artifact`, the word in lower case, reads as it did; its data actions say what they do", () => {
    assert.equal(kindOfName("artifact"), "artifact");
    assert.deepEqual(cardOf("artifact", { action: "publish", title: "Expense tracker", html: "<p>x</p>" }), { kind: "artifact", title: "Publish", subject: "Expense tracker" });
    assert.deepEqual(cardOf("artifact", { action: "read_db", id: "expense-tracker-k3f9", collection: "expenses" }), { kind: "artifact", title: "Read an artifact's data", subject: "expense-tracker-k3f9" });
    assert.deepEqual(cardOf("artifact", { action: "write_db", id: "expense-tracker-k3f9", collection: "expenses", set: [] }), { kind: "artifact", title: "Change an artifact's data", subject: "expense-tracker-k3f9" });
    assert.deepEqual(cardOf("artifact", { action: "constructor" }), { kind: "artifact", title: "Artifact", subject: "" });
  });
});

describe("a chat imported from Claude Code that published with Claude desktop's tool (AFC-51, AFC-150 to AFC-155)", () => {
  const SID = "eeeeeeee-0000-4000-8000-000000000001";
  const root = join(dir, "cc");
  mkdirSync(join(root, "H--proj"), { recursive: true });
  const f = chatFile(SID);
  writeFileSync(
    join(root, "H--proj", `${SID}.jsonl`),
    f.ask(1, "make a page that explains the in-game phone") +
      f.reply(2, [f.call("q1", { action: "quickstart", intent: "document" })]) +
      f.result(3, "q1", GUIDE) +
      f.reply(4, [f.call("p1", { file_path: FILE, icon: "phone", description: "How the phone works." })]) +
      f.result(5, "p1", PUBLISHED) +
      f.reply(6, [f.call("r1", { action: "read", url: OTHER })]) +
      f.result(7, "r1", "<!doctype html><title>Older page</title>") +
      f.reply(8, [f.call("o1", { action: "open", url: "https://example.com/artifact/abc" })]) +
      f.result(9, "o1", "Opened.") +
      f.reply(10, [f.call("p2", { action: "publish", url: OTHER, file_path: FILE })]) +
      f.result(11, "p2", `Not published: the artifact ${OTHER} changed since you read it.`, true) +
      f.reply(12, [{ type: "text", text: `It is at ${PAGE}.` }]),
  );
  const a = new Archive({ file: join(dir, "a.db") });
  after(() => a.close());
  /** The imported turn's work, as Filament keeps it. */
  const workOf = async () => {
    const r = await importClaudeCode({ archive: a, root });
    assert.deepEqual(r.errors, []);
    const chain = /** @type {any} */ (a.chainsWithKeyPrefix(`cc:${SID}`).find((c) => c.key === `cc:${SID}`));
    const [turn] = a.getTurns(chain.id);
    return { turn: a.getTurn(turn.id), work: a.getTurn(turn.id).work.map((/** @type {string} */ hash) => a.getMessage(hash)?.message) };
  };

  // (fails before: yes — each call drew as Filament's tool of no action: "Artifact", the address plain text in its body)
  test("each call a row of its own; the publish links its page on claude.ai, the read the page it named; no other link", async () => {
    const { turn, work } = await workOf();
    const tools = toolsOfTurn(work, "anthropic");
    assert.deepEqual(tools.map((t) => [t.id, t.card.kind, t.card.title]), [
      ["q1", "claude-artifact", "Read the artifact guide on claude.ai"],
      ["p1", "claude-artifact", "Publish on claude.ai"],
      ["r1", "claude-artifact", "Read an artifact on claude.ai"],
      ["o1", "claude-artifact", "Open an artifact on claude.ai"],
      ["p2", "claude-artifact", "Publish on claude.ai"],
    ]);
    const stubs = archivedStubs(tools);
    // The quickstart's guide names a claude.ai address, which is not its page; one on another site is no link; a
    // publish that failed was told no address, and the one it was given is its link.
    assert.deepEqual(stubs.map(claudeArtifactLink), [null, PAGE, OTHER, null, OTHER]);
    const doc = stubDocument();
    try {
      const rows = archivedRows(tools);
      assert.equal(rows.length, 5, "no call joins another's row");
      const said = rows.map((row) => [row.querySelector(".tool-kind")?.textContent, row.querySelector(".tool-primary")?.textContent, row.querySelector(".tool-status") ? "failed" : ""]);
      assert.deepEqual(said, [
        ["Read the artifact guide on claude.ai", "document", ""],
        ["Publish on claude.ai", "phone-guide.htmlclaude.ai/artifact/An4fQS8zRUMz3ZKFrmpxrF", ""],
        ["Read an artifact on claude.ai", "claude.ai/artifact/Zz9yXw8v", ""],
        ["Open an artifact on claude.ai", "https://example.com/artifact/abc", ""],
        ["Publish on claude.ai", "phone-guide.htmlclaude.ai/artifact/Zz9yXw8v", "failed"],
      ]);
      const link = /** @type {any} */ (rows[1].querySelector("a.tool-link"));
      assert.deepEqual([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")], [PAGE, "_blank", "noopener noreferrer"]);
      assert.equal(rows[3].querySelector("a"), null, "another site's address is words");
      // Opened, exactly what arrived: what the call sent and what it was told; nothing drawn of the page.
      const body = rows[1].querySelector(".term-card")?.textContent || "";
      assert.ok(body.includes("Parameters") && body.includes("phone-guide.html") && body.includes("Result") && body.includes("Live subscription"), body);
      assert.equal(rows[1].querySelector("iframe, img"), null);
      assert.equal(turn.meta.visuals, undefined, "nothing kept as a picture either");
    } finally {
      doc.restore();
    }
  });

  // (fails before: no — a name no tool here declares never passed; this pins it for the new kind)
  test("gone on in the harness: the turn reaches the model in words, as any tool Filament lacks; Filament's own is no match (AFC-155)", async () => {
    const { turn, work } = await workOf();
    const tools = [{ name: "artifact", schema: { type: "object", properties: { action: { type: "string" } } } }];
    const adapted = adaptTurn({ user: { role: "user", content: "make a page" }, work, final: { role: "assistant", content: [{ type: "text", text: "Done." }] } }, { format: "openai", tools, from: "anthropic" });
    assert.equal(adapted.mode, "folded");
    assert.match(String(adapted.reason), /Artifact/);
    const sent = JSON.stringify(adapted.messages);
    assert.ok(sent.includes("⚙ Artifact") && !sent.includes('"tool_calls"'), sent);
    assert.ok(turn.work.length > 0);
  });
});
