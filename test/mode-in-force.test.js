// @ts-check
// HarnessV3-AtHome AH-F1 (2026-10-04): a turn's permission mode was fixed when its request began, so a switch made
// while the turn worked, or while a permission waited, reached only the next message. The owner switched to Full
// access with a question open and nothing moved; the next thing they typed was read as a decline. Now the loop asks
// the session's settings at each call: in a turn that runs, in one that resumes, and in its sub-agents. A mode the
// request names itself (a client's header, an explorer's read-only) stays fixed for that request. The switch answers
// a waiting permission with a message marked as a switch: the waiting call is judged again under the mode now in
// force — it runs, is refused, or asks again. A plain yes under read-only is refused: read-only stands over every
// answer, as the gate already says.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { MODES, switchAnswer, switchWords } from "../src/ui/harness/composer/mode.js";
import { postTurn, setInboundKey } from "../src/ui/harness/lib/api.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const said = (/** @type {string} */ t) => reply([{ type: "text", text: t }]);
const textOf = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
/** The tool results in the request's newest message. @param {any[]} msgs */
const lastResults = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
};
const isSub = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "").includes(PROMPT.subagentRole);

describe("the loop reads the mode at each call", () => {
  // The LoopSink contract in full.
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });

  // (fails before: yes — the rule's run was said and counted before the loop found the tool not offered, so the record read
  // "ran on the rule" for a call it answered as unavailable; found while P2 step 5 reordered the call's admission)
  test("a call of a tool the session does not offer is answered unavailable, and nothing says it ran: no rule's run is said or counted", async () => {
    let n = 0;
    const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "install it" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }).filter((t) => t.name !== "bash"),
      modeNow: () => "edit",
      rules: [{ tool: "bash", pattern: "*", verdict: "allow" }],
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async () => answer(++n === 1 ? [toolUse("b1", "bash", { command: "npm install" })] : [{ type: "text", text: "Done." }]),
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    assert.equal(out.status, "done");
    assert.ok(out.notes.includes("agent: bash was called but is not offered in this session"), out.notes.join("\n"));
    assert.ok(!out.notes.some((x) => x.includes(" ran ")), out.notes.join("\n"));
    assert.equal(out.totals.ruleRuns, 0);
  });

  // (fails before: yes — the loop took one mode for the turn, so the second command ran under the mode the turn began with)
  test("a mode that changes between two calls of one reply: the first runs under Full access, the second is refused under read-only", async () => {
    /** @type {import("../src/app/agent/prompt.js").PermissionMode} */
    let mode = "auto";
    /** @type {string[]} */
    const ran = [];
    let n = 0;
    /** @type {any[]} */
    let results = [];
    const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => mode,
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        n++;
        if (n === 1) return answer([toolUse("b1", "bash", { command: "echo one > one.txt" }), toolUse("b2", "bash", { command: "echo two > two.txt" })]);
        results = lastResults(body.messages);
        return answer([{ type: "text", text: "Done." }]);
      },
      costOf: () => 0,
      // The developer switches to read-only while the first command runs.
      runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        mode = "read-only";
        return `${name} ran`;
      },
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    assert.equal(out.status, "done");
    assert.deepEqual(ran, ["echo one > one.txt"], "only the first command ran");
    assert.equal(results.length, 2);
    assert.match(String(results[1].content), /^Not run: this session is read-only/);
    assert.ok(out.notes.includes("agent: the permission mode is read-only now (it was auto)"), out.notes.join("\n"));
  });

  // (fails before: yes — the bug hunt of 10-30, PERM-5: a pre-tool hook's rewrite was judged by the deny rules alone, so
  // a read-only session ran the command a hook made of one that only read)
  test("a call a pre-tool hook rewrote is judged again under the mode: read-only refuses a rewrite that writes, and runs one that still only reads", async () => {
    /** @type {string[]} */
    const ran = [];
    /** @type {any[][]} */
    const answers = [];
    let n = 0;
    const rewrite = (/** @type {string} */ command) => ({ on: "pre-tool", tool: "bash", command: "fix-commands", ms: 1, exit: 0, verdict: "allow", note: "", args: { command }, timedOut: false });
    const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "look around" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "read-only",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        n++;
        if (n > 1) answers.push(lastResults(body.messages));
        return n <= 2 ? answer([toolUse(`b${n}`, "bash", { command: "ls" })]) : answer([{ type: "text", text: "Done." }]);
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        return `${name} ran`;
      },
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      hooks: /** @type {any} */ ({
        pre: async (/** @type {string} */ _tool, /** @type {any} */ _input, /** @type {number} */ round) => [rewrite(round === 1 ? "echo x > out.txt" : "ls -la")],
        post: async () => [],
        turnEnd: async () => [],
        sessionStart: async () => [],
        readBackBeforeDone: false,
      }),
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    assert.equal(out.status, "done");
    assert.deepEqual(ran, ["ls -la"], "the rewrite that writes never ran; the one that only reads did");
    assert.equal(answers[0][0].is_error, true);
    assert.match(String(answers[0][0].content), /^Not run: a pre-tool hook rewrote the call, and this session is read-only/);
    assert.equal(answers[1][0].content, "bash ran");
    assert.ok(out.notes.includes("agent: bash refused (read-only mode) after a pre-tool hook rewrote it"), out.notes.join("\n"));
  });

  /**
   * One turn whose model calls `ls`, which a pre-tool hook rewrites to `command`: what ran, the hook's runs, the asks and
   * the turn's end. `asker`: a worker's, whose answer is `yes`.
   * @param {{ mode: import("../src/app/agent/prompt.js").PermissionMode, command: string, rules?: import("../src/app/agent/rules.js").Rule[], asker?: boolean }} o
   */
  const rewrittenTurn = async ({ mode, command, rules = [], asker = false }) => {
    /** @type {string[]} */
    const ran = [];
    /** @type {any[]} */
    const asks = [];
    /** @type {any[]} */
    const asked = [];
    let hooked = 0;
    let n = 0;
    const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "look around" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => mode,
      rules,
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async () => answer(++n === 1 ? [toolUse("b1", "bash", { command: "ls" })] : [{ type: "text", text: "Done." }]),
      costOf: () => 0,
      runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        return `${name} ran`;
      },
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      hooks: /** @type {any} */ ({
        pre: async () => {
          hooked++;
          return [{ on: "pre-tool", tool: "bash", command: "fix-commands", ms: 1, exit: 0, verdict: "allow", note: "", args: { command }, timedOut: false }];
        },
        post: async () => [],
        turnEnd: async () => [],
        sessionStart: async () => [],
        readBackBeforeDone: false,
      }),
      ...(asker ? { asker: async (/** @type {any} */ q) => (asked.push(q), { text: "yes", allow: true }) } : {}),
      tree: null,
      onEvent: (/** @type {any} */ e) => void (e.type === "ask" && asks.push(e)),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    return { out, ran, asks, asked, hooked };
  };

  // (fails before: yes — the bug hunt of 10-30, PERM-5's ask half: the gate judged `ls` as the model made it, so the
  // command a hook made of it ran in Edit mode, and under an ask rule, without anyone being asked)
  test("a call a pre-tool hook rewrote is asked about where the rewrite asks: the mode's ask and an ask rule pause on the command as rewritten, and nothing runs first", async () => {
    const edit = await rewrittenTurn({ mode: "edit", command: "echo x > out.txt" });
    assert.equal(edit.out.status, "paused");
    assert.deepEqual(edit.ran, [], "nothing ran before the developer's answer");
    assert.deepEqual(edit.asks.map((e) => [e.kind, e.tool, e.command]), [["permission", "bash", "echo x > out.txt"]], "asked about the command as rewritten");
    assert.equal(edit.out.pause?.pending.input.command, "echo x > out.txt", "the paused call is the rewrite, which the answer runs");
    const rule = await rewrittenTurn({ mode: "auto", command: "rm -rf build", rules: [{ tool: "bash", pattern: "rm *", verdict: "ask" }] });
    assert.equal(rule.out.status, "paused");
    assert.deepEqual(rule.ran, []);
    assert.deepEqual(rule.asks.map((e) => e.command), ["rm -rf build"]);
    // A rewrite that asks nothing more than the call did runs as it did.
    const reads = await rewrittenTurn({ mode: "edit", command: "ls -la" });
    assert.deepEqual([reads.out.status, reads.ran, reads.asks.length], ["done", ["ls -la"], 0]);
  });

  // (fails before: yes — the same, for a worker that waits in place for its answer)
  test("a worker's call a pre-tool hook rewrote waits for the answer on the command as rewritten, which runs on a yes — its hooks run once", async () => {
    const w = await rewrittenTurn({ mode: "edit", command: "echo x > out.txt", asker: true });
    assert.equal(w.out.status, "done");
    assert.deepEqual(w.asked.map((q) => [q.tool, q.command]), [["bash", "echo x > out.txt"]]);
    assert.deepEqual(w.ran, ["echo x > out.txt"]);
    assert.equal(w.hooked, 1, "the hook ran once, before the gate, not again once the answer came");
  });
});

describe("the mode in force, end to end on a native session", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-mode-in-force-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
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
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  /** @param {any} [settings] */
  const create = async (settings = undefined) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", ...(settings ? { settings } : {}) } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content @param {any} [extra] */
  const turn = async (id, content, extra = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const json = await r.json();
    return { text: textOf(json.content), rec: await shim.record(r.headers.get("x-filament-request-id")) };
  };
  /** The switch: the session's own mode, written as the page writes it. @param {string} id @param {string} mode */
  const switchTo = async (id, mode) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: mode } } } });
    assert.equal(r.status, 200, await r.text());
  };
  const file = (/** @type {string} */ name) => join(root, name);

  // (fails before: yes — the turn kept the mode it began with: the command asked)
  test("a switch made while a turn runs reaches its next call", async () => {
    const id = await create();
    let round = 0;
    brain = async () => {
      round++;
      if (round === 1) {
        await switchTo(id, "auto");
        return reply([toolUse("b1", "bash", { command: "echo mid > mid.txt" })], "tool_use");
      }
      return said("Written.");
    };
    up.reset();
    const r = await turn(id, "write mid.txt");
    assert.equal(r.text, "Written.");
    assert.equal(r.rec.agent.status, "done");
    assert.ok(existsSync(file("mid.txt")), "the command ran under Full access");
    assert.ok(r.rec.changes.includes("agent: the permission mode is auto now (it was edit)"), r.rec.changes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: nothing held a mode the turn names fixed while the session's
  // own mode moved)
  test("a mode the turn names itself stays fixed for that turn: a switch made while it runs does not reach it", async () => {
    const id = await create();
    let round = 0;
    brain = async () => {
      round++;
      if (round === 1) {
        await switchTo(id, "auto");
        return reply([toolUse("b1", "bash", { command: "echo named > named.txt" })], "tool_use");
      }
      return said("Written.");
    };
    up.reset();
    const r = await turn(id, "write named.txt", { permissions: "edit" });
    assert.match(r.text, /May I run this command\?/, "the command asked, under the mode the turn named");
    assert.equal(r.rec.agent.status, "paused");
    assert.ok(!existsSync(file("named.txt")), "nothing ran under the session's Full access");
  });

  // (fails before: yes — the inspector named the mode the last turn began under, and a switch since left it stale)
  test("the inspector names the mode in force: the session's own, a switch included", async () => {
    const id = await create();
    brain = () => said("Hello.");
    up.reset();
    await turn(id, "hello");
    const inForce = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).inForce.permissions;
    assert.equal(await inForce(), "edit");
    await switchTo(id, "auto");
    assert.equal(await inForce(), "auto");
  });

  // (fails before: yes — the resume kept the mode the question was asked under: the next command asked again)
  test("a resumed turn runs under the mode in force, not the one its question was asked under", async () => {
    const id = await create();
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("b1", "bash", { command: "echo one > r1.txt" })], "tool_use");
      if (round === 2) return reply([toolUse("b2", "bash", { command: "echo two > r2.txt" })], "tool_use");
      return said("Both written.");
    };
    up.reset();
    const asked = await turn(id, "write two files");
    assert.match(asked.text, /May I run this command\?/);
    await switchTo(id, "auto");
    const r = await turn(id, "yes", { allow: true });
    assert.equal(r.text, "Both written.");
    assert.equal(r.rec.agent.status, "done");
    assert.ok(existsSync(file("r1.txt")) && existsSync(file("r2.txt")));
  });

  describe("the switch answers a waiting permission", () => {
    // (fails before: yes — the switch's message was read as a decline: "Not run: the developer declined — "Switched to Full access"")
    test("to Full access: the waiting command runs", async () => {
      const id = await create();
      let round = 0;
      /** @type {any[]} */
      let results = [];
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("b1", "bash", { command: "echo full > s1.txt" })], "tool_use");
        results = lastResults(call.body.messages);
        return said("Done after the switch.");
      };
      up.reset();
      assert.match((await turn(id, "write s1.txt")).text, /May I run this command\?/);
      await switchTo(id, "auto");
      const r = await turn(id, "Switched to Full access", { modeSwitch: true });
      assert.equal(r.text, "Done after the switch.");
      assert.ok(existsSync(file("s1.txt")), "it ran");
      assert.equal(results.length, 1);
      assert.notEqual(results[0].is_error, true, String(results[0].content));
      assert.ok(r.rec.changes.includes("agent: the developer switched the mode to auto while bash waited — judged again under it"), r.rec.changes.join("\n"));
    });

    // (fails before: yes — read as a decline in the switch's words, not refused by the mode)
    test("to read-only: the waiting command is refused in the gate's words", async () => {
      const id = await create();
      let round = 0;
      /** @type {any[]} */
      let results = [];
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("b1", "bash", { command: "echo ro > s2.txt" })], "tool_use");
        results = lastResults(call.body.messages);
        return said("Understood, read-only.");
      };
      up.reset();
      assert.match((await turn(id, "write s2.txt")).text, /May I run this command\?/);
      await switchTo(id, "read-only");
      const r = await turn(id, "Switched to Read-only", { modeSwitch: true });
      assert.equal(r.text, "Understood, read-only.");
      assert.ok(!existsSync(file("s2.txt")), "nothing ran");
      assert.equal(results[0].is_error, true);
      assert.match(String(results[0].content), /^Not run: this session is read-only/);
      assert.ok(r.rec.changes.includes("agent: bash refused (read-only mode)"), r.rec.changes.join("\n"));
    });

    // (fails before: yes — the waiting write was declined)
    test("from Ask to Edit: the waiting write runs", async () => {
      const id = await create({ loop: { permissions: "ask" } });
      let round = 0;
      brain = () => {
        round++;
        if (round === 1) return reply([toolUse("w1", "write", { path: "s3.txt", content: "edited\n" })], "tool_use");
        return said("Wrote it.");
      };
      up.reset();
      assert.match((await turn(id, "write s3.txt")).text, /May I write s3\.txt\?/);
      await switchTo(id, "edit");
      const r = await turn(id, "Switched to Edit automatically", { modeSwitch: true });
      assert.equal(r.text, "Wrote it.");
      assert.equal(readFileSync(file("s3.txt"), "utf8"), "edited\n");
    });

    // (fails before: yes — the waiting command was declined instead of asked again)
    test("from Ask to Edit with a command that changes something: it asks again, and a yes then runs it", async () => {
      const id = await create({ loop: { permissions: "ask" } });
      let round = 0;
      brain = () => {
        round++;
        if (round === 1) return reply([toolUse("b1", "bash", { command: "echo again > s4.txt" })], "tool_use");
        return said("Ran it.");
      };
      up.reset();
      assert.match((await turn(id, "write s4.txt")).text, /May I run this command\?/);
      await switchTo(id, "edit");
      const again = await turn(id, "Switched to Edit automatically", { modeSwitch: true });
      assert.match(again.text, /May I run this command\? `echo again > s4\.txt`/);
      assert.equal(again.rec.agent.status, "paused");
      assert.equal(round, 1, "no model call: the question stands");
      assert.ok(!existsSync(file("s4.txt")));
      const r = await turn(id, "yes", { allow: true });
      assert.equal(r.text, "Ran it.");
      assert.ok(existsSync(file("s4.txt")));
    });
  });

  // (fails before: yes — the yes ran the command under the mode the question was asked in)
  test("a yes given after the session went read-only is refused, and says why", async () => {
    const id = await create();
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("b1", "bash", { command: "echo yes > y1.txt" })], "tool_use");
      results = lastResults(call.body.messages);
      return said("Not written, read-only.");
    };
    up.reset();
    assert.match((await turn(id, "write y1.txt")).text, /May I run this command\?/);
    await switchTo(id, "read-only");
    const r = await turn(id, "yes", { allow: true });
    assert.equal(r.text, "Not written, read-only.");
    assert.ok(!existsSync(file("y1.txt")), "nothing ran");
    assert.equal(results[0].is_error, true);
    assert.match(String(results[0].content), /^Not run: the developer said yes, but this session is read-only now/);
    assert.ok(r.rec.changes.includes("agent: the developer allowed bash, but this session is read-only now"), r.rec.changes.join("\n"));
  });

  // (fails before: yes — the sub-agent's request named the turn's mode, so its command was refused: "nobody can answer inside a sub-agent")
  test("a sub-agent follows the switch made while it runs", async () => {
    const id = await create({ subagents: { worktree: false } });
    /** @type {any[]} */
    let subResults = [];
    brain = async (call) => {
      const answered = lastResults(call.body.messages).length > 0;
      if (isSub(call)) {
        if (!answered) {
          await switchTo(id, "auto");
          return reply([toolUse("sb1", "bash", { command: "echo sub > sub.txt" })], "tool_use");
        }
        subResults = lastResults(call.body.messages);
        return said("SUB DONE");
      }
      if (!answered) return reply([toolUse("a1", "agent", { run_in_background: false, description: "Writer", prompt: "Write sub.txt.", subagent_type: "builder" })], "tool_use");
      return said("MAIN DONE");
    };
    up.reset();
    const r = await turn(id, "have a sub-agent write sub.txt");
    assert.equal(r.text, "MAIN DONE");
    assert.notEqual(subResults[0]?.is_error, true, String(subResults[0]?.content));
    assert.ok(existsSync(file("sub.txt")), "the sub-agent's command ran under Full access");
  });

  // (fails before: yes — postTurn sent no modeSwitch, and the service named the document's mode on every turn)
  test("the page's send: switchAnswer names the switch, postTurn marks it, and the waiting call is judged again", async () => {
    const id = await create();
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("b1", "bash", { command: "echo page > p1.txt" })], "tool_use");
      return said("Page switch honoured.");
    };
    up.reset();
    assert.match((await turn(id, "write p1.txt")).text, /May I run this command\?/);
    await switchTo(id, "auto");
    const text = switchAnswer({ paused: { kind: "permission", question: "May I run this command?" } }, "auto");
    assert.equal(text, "Switched to Full access");
    const realFetch = globalThis.fetch;
    globalThis.fetch = /** @type {any} */ ((/** @type {any} */ u, /** @type {any} */ init) => realFetch(typeof u === "string" && u.startsWith("/") ? shim.url + u : u, init));
    setInboundKey(shim.key);
    try {
      const r = await postTurn({ chainId: id, content: String(text), modeSwitch: true, signal: new AbortController().signal, onHeaders: () => {}, onEvent: () => {} });
      assert.equal(r.status, 200, r.reply.error || "");
      assert.equal(r.reply.blocks.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join(""), "Page switch honoured.");
    } finally {
      globalThis.fetch = realFetch;
      setInboundKey("");
    }
    assert.ok(existsSync(file("p1.txt")));
  });
});

describe("switchAnswer: what the page sends when the switch moves while a permission waits", () => {
  // (fails before: yes — there was no answer: the switch only wrote the setting)
  test("a permission waits and the new mode is not Ask: the switch's words, in the mode's own label", () => {
    const waiting = { paused: { kind: "permission", question: "May I run this command?" } };
    for (const m of MODES) assert.equal(switchAnswer(waiting, m.id), m.id === "ask" ? null : `Switched to ${m.label}`, m.id);
  });
  // (fails before: yes — a team's workers' waiting calls had no words for the switch: the session's pause alone
  // took them)
  test("switchWords: the switch's words for any mode but Ask, whatever waits", () => {
    for (const m of MODES) assert.equal(switchWords(m.id), m.id === "ask" ? null : `Switched to ${m.label}`, m.id);
    assert.deepEqual([switchWords("yolo"), switchWords(null), switchWords(undefined)], [null, null, null]);
  });
  // (fails before: no — a guard on the answer's edges: no answer stands for nothing to answer)
  test("nothing waits on a permission, or the mode is unknown: no answer", () => {
    assert.equal(switchAnswer({ paused: { kind: "question", question: "Which one?" } }, "auto"), null, "a question is the developer's to answer in words");
    assert.equal(switchAnswer({ status: "done" }, "auto"), null);
    assert.equal(switchAnswer(null, "auto"), null);
    assert.equal(switchAnswer({ paused: { kind: "permission" } }, "yolo"), null);
    assert.equal(switchAnswer({ paused: { kind: "permission" } }, null), null);
  });
  // (fails before: yes — the page's switch wrote the setting and nothing else)
  test("the page sends it after the switch's write succeeds, marked as a switch", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.ok(/switchAnswer\(/.test(app), "the page asks switchAnswer");
    assert.ok(/modeSwitch: true/.test(app), "and marks the send as a switch");
  });
});
