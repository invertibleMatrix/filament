// @ts-check
// Nothing rewrites a chat's history between a question and its answer (the decision of 11-02): an undo of a compaction
// is refused in words while a question a turn paused on waits, as the compaction itself is. A rewind takes turns away
// from the newest, so one of the conversation takes the turn that asked away and its question with it — its park ends,
// and the loop takes the next message as a message of its own; Undo brings both back. A rewind of the files alone would
// put them back under the turn that asked, which goes on from them with the answer: refused in the same words.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The command a turn asks permission for in Edit. */
const CHECK = toolUse("c1", "bash", { command: `node -e "console.log('checked')"` });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** The calls a request's newest message answers. @param {any} call */
const answersTo = (call) => (Array.isArray(call.body?.messages?.at(-1)?.content) ? call.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** The words a rewind and an undo say while a question waits. */
const ASKING = { rewind: "a question waits for your answer: answer it first, then rewind", undo: "a question waits for your answer: answer it first, then undo" };

describe("a rewind or an undo while a question waits for the person's answer", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The flaky check's first try fails after its read; the next asks for its command. */
  let flaky = true;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-rewind-asking-"));
    run(root, ["init", "-q", "-b", "main"]);
    run(root, ["config", "core.autocrlf", "false"]);
    writeFileSync(join(root, "notes.txt"), "hello\n");
    run(root, ["add", "."]);
    run(root, ["commit", "-q", "-m", "init"]);
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return reply([{ type: "text", text: "A summary of the chat so far." }]);
      const done = answersTo(call);
      const last = textOf(call.body.messages.at(-1));
      if (done.includes("c1")) return reply([{ type: "text", text: "The check printed checked." }]);
      if (done.includes("w1")) return reply([CHECK], "tool_use");
      if (done.includes("r2")) return flaky ? ((flaky = false), { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the provider refused this one" } } }) : reply([CHECK], "tool_use");
      if (done.includes("r1")) return reply([{ type: "text", text: `The notes say hello. ${"Read with care, line by line. ".repeat(300)}` }]);
      if (/edit \S+ then check/.test(last)) return reply([toolUse("w1", "write", { path: /edit (\S+) then check/.exec(last)?.[1] || "", content: "fresh\n" })], "tool_use");
      if (/flaky check/.test(last)) return flaky ? reply([toolUse("r2", "read", { path: "notes.txt" })], "tool_use") : reply([CHECK], "tool_use");
      if (/read the notes/.test(last)) return reply([toolUse("r1", "read", { path: "notes.txt" })], "tool_use");
      return reply([{ type: "text", text: "Fresh words." }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  const chat = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    return { id, at: `/api/sessions/${encodeURIComponent(id)}` };
  };
  /** @param {string} at @param {string} content */
  const say = async (at, content) => {
    const r = await shim.api(`${at}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return textOf(await r.json());
  };
  /** @param {string} at */
  const transcript = async (at) => (await shim.api(`${at}/transcript`)).json();
  /** @param {string} at @param {any} body */
  const rewind = (at, body) => shim.api(`${at}/rewind`, { method: "POST", body });
  /** @param {string} [name] */
  const fresh = (name = "fresh.txt") => (existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null);

  // (fails before: yes — the files went back under the paused turn: the rewind of the files answered 200, taking
  // fresh.txt away while the turn that wrote it waited for its answer)
  test("the files alone are refused in words; the conversation takes the question with its turn, and Undo brings both back", async () => {
    const { at } = await chat();
    assert.equal(await say(at, "hello"), "Fresh words.");
    assert.match(await say(at, "edit fresh.txt then check"), /May I run this command\?/);
    assert.equal(fresh(), "fresh\n");
    const files = await rewind(at, { turn: 2, what: "files" });
    assert.deepEqual([files.status, (await files.json()).error], [409, ASKING.rewind]);
    assert.equal(fresh(), "fresh\n", "nothing went back");
    assert.equal((await transcript(at)).paused?.kind, "permission", "the question still waits");
    // The conversation: the turn that asked goes, and its question with it.
    const conv = await rewind(at, { turn: 2, what: "conversation" });
    assert.equal(conv.status, 200, await conv.clone().text());
    const gone = await transcript(at);
    assert.equal(gone.paused, null, "the question went with its turn");
    assert.deepEqual(gone.turns.filter((/** @type {any} */ t) => t.rewound).map((/** @type {any} */ t) => t.n), [2]);
    // Undo: the turn back, and its question waiting again; the answer goes on in it.
    const back = await shim.api(`${at}/rewind/undo`, { method: "POST", body: {} });
    assert.equal(back.status, 200, await back.clone().text());
    assert.equal((await transcript(at)).paused?.kind, "permission", "the question waits again");
    assert.equal(await say(at, "yes"), "The check printed checked.");
  });

  // The rewind's sheet says so up front (the decision of 11-02), from what the read of a rewind says.
  // (fails before: yes — the read said nothing of the question: asking undefined, so the sheet offered the files alone)
  test("the read of a rewind says a question waits, and the turn that asked it, which the conversation's rewind takes", async () => {
    const { at } = await chat();
    assert.equal(await say(at, "hello"), "Fresh words.");
    assert.match(await say(at, "edit third.txt then check"), /May I run this command\?/);
    const plan = await (await shim.api(`${at}/rewind?turn=1`)).json();
    assert.deepEqual([plan.asking, plan.conversation], [{ turn: 2 }, { from: 1, to: 2, turns: 2 }]);
    assert.equal(await say(at, "yes"), "The check printed checked.");
    assert.equal((await (await shim.api(`${at}/rewind?turn=1`)).json()).asking, undefined, "answered: nothing waits");
  });

  // (fails before: yes — the question stayed parked under the rewound turn: paused.kind "permission")
  test("a rewind took the question away: the next message is a message of its own", async () => {
    const { at } = await chat();
    assert.match(await say(at, "edit second.txt then check"), /May I run this command\?/);
    assert.equal(fresh("second.txt"), "fresh\n");
    const both = await rewind(at, { turn: 1, what: "both" });
    assert.equal(both.status, 200, await both.clone().text());
    assert.equal(fresh("second.txt"), null, "the files went back too");
    assert.equal((await transcript(at)).paused, null);
    assert.equal(await say(at, "yes"), "Fresh words.");
  });

  // (fails before: yes — the undo went through while the question waited: 200, the compaction the retried turn was
  // composed from taken back under its question)
  // The question's words come first, whatever else refuses the undo: the retry that asked ran on the compaction, which
  // is past undoing for that too (undo-after-retry.test.js).
  test("an undo of a compaction is refused in words while a question waits", async () => {
    const { at } = await chat();
    await say(at, "read the notes");
    // A turn that fails after its read, then a compaction, then the same message again: it goes on in the failed try's
    // row, which started before the compaction, and asks for its command.
    const failed = await shim.api(`${at}/turns`, { method: "POST", body: { content: "flaky check", stream: false } });
    await failed.text();
    const made = await shim.api(`${at}/compact`, { method: "POST", body: {} });
    assert.equal(made.status, 200, await made.clone().text());
    const cid = (await made.json()).boundary.id;
    assert.match(await say(at, "flaky check"), /May I run this command\?/);
    assert.equal((await transcript(at)).paused?.kind, "permission");
    const undo = await shim.api(`${at}/compactions/${cid}/undo`, { method: "POST", body: {} });
    assert.deepEqual([undo.status, (await undo.json()).error], [409, ASKING.undo]);
    assert.equal(await say(at, "yes"), "The check printed checked.");
  });
});
