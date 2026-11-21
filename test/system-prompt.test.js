// @ts-check
// HarnessV3-SystemPrompt: the loop's prompt (PROMPT_VERSION 10; 11 since HarnessV3-Tools) — its sections, the sub-agent's variant, where the
// session's Environment sits — and the Environment held still through real loop turns: captured on the session's first
// turn, the same bytes on the next, and the same again after a restart (the chain keeps it). The capture itself is in
// environment.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, TEST_ENVIRONMENT } from "./helpers/app.js";
import { systemPromptFor, PROMPT, PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { loopSystem } from "../src/app/agent/system.js";
import { CONFIG_SCHEMA, FILAMENT_TRAILER } from "../src/core/schema.js";
import { SUBAGENT_OFF } from "../src/app/agent/tools.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { environmentText } from "../src/app/agent/environment.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { CODER_GRAPH_TEXT, CODER_TRAILER_TEXT, TRAILER_BLOCK, agentContext } from "../src/app/agent-context.js";
import { GUIDE_WEIGH, guideBlock } from "../src/core/watchers.js";
import { guideWords } from "../src/core/routines.js";
import { CONTEXT_HEAD, UPDATE_HEAD, contextState, contextUpdate, openedWith } from "../src/adapters/agents/context.js";
import { bindUi } from "../src/ui/runtime.js";
import { prompts, settings } from "../src/ui/pages/settings.js";
import { createApi } from "../src/ui/lib/api.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

describe("the prompt's sections", () => {
  const ENV = "# Environment\nCaptured when this session started: …";
  test("the version: 10 gave the prompt its sections and the Environment, 11 the tools at Claude Code's level, 12 a team's lead and its workers, 13 the lead's watch, messages and corrections and the developer's answer to a worker, 14 how a lead's orders reach the work, 15 the task graph's section, 16 its sub-agents' tasks and their report, 17 a lead's graph, its workers' and its reviewers' report lines, 18 a failed graph task sent back to its last worker, 19 a saved agent's card, 23 a sub-agent the developer launched waits for their answer, 24 a lead that reads along with its workers, 25 its answer to a worker that waits for the developer's, 26 a team that briefs, checks and answers as a real team does, 27 a lead that looks when something is new, workers that ask it and plans it reviews, 28 a coding agent's third read of a worker it leads, its brief and reports whole, 29 a team that works as engineers with a senior lead: a lead that plans the whole work first, and every worker that may ask it, 30 a lead that reads what its workers say and do, never what they think, 31 a lead that may launch a brief as two or three attempts at once, 32 a model that takes no tools told why it has none (HarnessV4_Tasks E4), 33 a task's check Filament runs itself (HarnessV3-TaskGraph-v2 V2-1), 39 a saved agent that starts apart and the context window, 40 a crew's models as an order (U13-D12)", () => {
    assert.equal(PROMPT_VERSION, 129);
  });

  // (fails before: the prompt was one run of sentences — nothing on how to work, git safety, secrets, injected text)
  test("the main agent's: role and folder, how to work, the tools, care, talking, the window, the report — the Environment last", () => {
    const p = systemPromptFor({ root: "R", delegateRead: false, environment: ENV });
    const order = [PROMPT.role, "Working folder: R", PROMPT.headWork, PROMPT.ambiguity, PROMPT.headTools, PROMPT.hands, PROMPT.permission, PROMPT.craft, PROMPT.headCare, PROMPT.careLook, PROMPT.careAsk, PROMPT.care, PROMPT.headTalk, PROMPT.talk, PROMPT.steering, PROMPT.headContext, PROMPT.context, PROMPT.report, ENV];
    let at = -1;
    for (const part of order) {
      const i = p.indexOf(part);
      assert.ok(i > at, `"${part.slice(0, 40)}" comes after what precedes it (at ${i}, previous ${at})`);
      at = i;
    }
    assert.ok(p.endsWith(ENV), "the Environment closes the prompt, so every static section leads the cached prefix");
    assert.ok(!p.includes(PROMPT.subagentAmbiguity) && !p.includes(PROMPT.subagentCareAsk));
    assert.ok(p.includes("\n\n# How you work\n"), "sections are set apart by a blank line");
    assert.equal(systemPromptFor({ root: "R", delegateRead: false }).includes("# Environment"), false, "no capture, no section");
  });

  test("a sub-agent's: nobody to ask or talk to — its own ambiguity and care lines, its report, the same Environment", () => {
    const s = systemPromptFor({ root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, environment: ENV });
    assert.ok(s.startsWith(PROMPT.subagentRole));
    for (const part of [PROMPT.work, PROMPT.subagentAmbiguity, PROMPT.craft, PROMPT.subagentCareAsk, PROMPT.care, PROMPT.context, PROMPT.subagentReport]) assert.ok(s.includes(part), part.slice(0, 50));
    for (const part of [PROMPT.ambiguity, PROMPT.careAsk, PROMPT.headTalk, PROMPT.steering, PROMPT.report, PROMPT.plan, PROMPT.ask]) assert.ok(!s.includes(part), `not for a sub-agent: ${part.slice(0, 50)}`);
    assert.ok(s.endsWith(ENV));
    assert.ok(!s.includes(PROMPT.subagentReadOnly), "Builder may change files");
    assert.ok(systemPromptFor({ root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, readOnly: true }).includes(PROMPT.subagentReadOnly));
  });

  // (fails before: yes — version 121, after the watchers of 11-11: a watcher the person let guide writes to the chat it
  // watches, between its agent's ticks or as a turn, and the line named the developer's message alone)
  test("the steering line names a watcher's guidance beside the developer's message: none of theirs, weighed as Filament's words with it say — for the chat's own agent and a team's lead, whom a watcher guides", () => {
    assert.equal(PROMPT.steering, "A message from the developer may arrive between ticks, relayed by Filament; acknowledge it in your next reply before acting on it. Guidance from a watcher the developer switched on to review this chat may arrive the same way, or as a message of Filament's that starts a turn: it is no message of the developer's, and Filament's words with it say how to weigh it.");
    // The words it points to, which say whose it is and how to weigh it: the line adds no rule to them.
    const note = guideBlock("Supervisor", ["Run the skipped test."]);
    assert.ok(note.startsWith("Guidance from “Supervisor”, a watcher the person switched on to review this chat, relayed by Filament (1 message). ") && note.endsWith(`\n${GUIDE_WEIGH}`), note);
    const turn = guideWords(/** @type {any} */ ({ id: "r1", title: "Supervisor" }), { project: "Shop", byName: "Review", text: "Run the skipped test." });
    assert.match(turn, /^\[Filament: guidance from the watcher “Supervisor” \(r1\) of Shop's Space, which the person switched on to review this chat\. It was written by Review's agent, never by the person\. Weigh it as a reviewer's advice: /);
    // Guidance goes into the chat's own turn (the server's `chatSteer`), never into a sub-agent's or a worker's run.
    const lead = systemPromptFor({ root: "R", delegateRead: false, lead: { name: "Architect", persona: "" } });
    assert.ok(systemPromptFor({ root: "R", delegateRead: false }).includes(`\n${PROMPT.steering}\n`) && lead.includes(`\n${PROMPT.steering}\n`));
    const worker = systemPromptFor({ root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, worker: { team: "Architect", words: "" } });
    assert.ok(worker.includes(PROMPT.workerSteering) && !worker.includes(PROMPT.steering) && ![worker, PROMPT.workerReadAlong, PROMPT.taskReadAlong].some((s) => /[Gg]uidance/.test(String(s))), "a worker's line stays its lead's and the developer's");
  });

  // (fails before: yes — every sub-agent read that nobody can approve a call for it)
  test("a sub-agent the developer launched, where their page can answer: its permission line says a call waits for them; nothing else differs", () => {
    const plain = systemPromptFor({ root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, environment: ENV });
    const attended = systemPromptFor({ root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, attended: true, environment: ENV });
    assert.ok(plain.includes(PROMPT.subagentPermission) && !plain.includes(PROMPT.attendedPermission));
    assert.ok(attended.includes(PROMPT.attendedPermission) && !attended.includes(PROMPT.subagentPermission));
    assert.equal(attended.replace(PROMPT.attendedPermission, PROMPT.subagentPermission), plain);
    assert.match(PROMPT.attendedPermission, /waits for their answer/);
    // The main agent's own prompt, a lead's and a worker's never read it.
    for (const other of [
      systemPromptFor({ root: "R", delegateRead: false, attended: true }),
      systemPromptFor({ root: "R", delegateRead: false, attended: true, lead: { name: "Architect", persona: "" } }),
      systemPromptFor({ root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, attended: true, worker: { team: "Architect" } }),
    ])
      assert.ok(!other.includes(PROMPT.attendedPermission));
  });

  test("the overlay replaces the role and the report only", () => {
    const o = systemPromptFor({ root: "R", delegateRead: false, overlay: "You are Ada.", environment: ENV });
    assert.ok(o.startsWith("You are Ada.\nWorking folder: R"));
    assert.ok(!o.includes(PROMPT.role) && !o.includes(PROMPT.report));
    for (const part of [PROMPT.work, PROMPT.craft, PROMPT.care, PROMPT.talk, ENV]) assert.ok(o.includes(part), "the sections stay under an overlay");
  });
});

describe("Filament's co-author line on a commit (version 108, sessions.commitTrailer)", () => {
  const TRAILER = "end it with the trailer Co-authored-by: Filament <noreply@filamentdev.com>.";
  const V107 = "Asked to commit, stage only this task's files and write the message in the repository's own style.";
  /** The care section's git line of a prompt. @param {string} p */
  const gitLine = (p) => p.split("\n").find((l) => l.startsWith("- Git: ")) || "";
  const SEATS = /** @type {Record<string, any>} */ ({
    agent: { root: "R", delegateRead: false },
    subagent: { root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true },
    lead: { root: "R", delegateRead: false, lead: { name: "Architect", persona: "" } },
    worker: { root: "R", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, worker: { team: "Architect" } },
  });

  // (fails before: yes — the git line had one sentence on a commit, and nothing said Filament's line)
  test("two fixed sentences: on, every seat's git line ends with the trailer; off, version 107's; nothing else moves", () => {
    assert.ok(PROMPT.care.includes(V107), "off: the sentence as version 107 had it");
    for (const [seat, args] of Object.entries(SEATS)) {
      const on = systemPromptFor({ ...args, trailer: true });
      const off = systemPromptFor({ ...args, trailer: false });
      assert.ok(gitLine(on).endsWith(`Asked to commit, stage only this task's files, write the message in the repository's own style and ${TRAILER}`), `${seat}: ${gitLine(on)}`);
      assert.ok(gitLine(off).endsWith(V107) && !off.includes("Co-authored-by"), seat);
      assert.equal(on.replace(PROMPT.careTrailer, PROMPT.care), off, `${seat}: the sentence alone differs`);
      assert.equal(systemPromptFor({ ...args, trailer: true }), on, `${seat}: the same bytes every time`);
    }
  });

  // (fails before: yes — the loop's prompt never read the setting)
  test("the loop reads the setting for every chat: on unless switched off, a sub-agent's too", () => {
    const sys = (/** @type {any} */ cfg, /** @type {any} */ host = null) => loopSystem({ cfg, doc: null, root: "R", host }).prompt;
    for (const cfg of [{ agentLoop: {} }, { agentLoop: {}, sessions: {} }, { agentLoop: {}, sessions: { commitTrailer: true } }]) assert.ok(gitLine(sys(cfg)).endsWith(TRAILER), JSON.stringify(cfg));
    const off = { agentLoop: {}, sessions: { commitTrailer: false } };
    assert.ok(gitLine(sys(off)).endsWith(V107));
    assert.ok(gitLine(sys({ agentLoop: {} }, { readOnly: false })).endsWith(TRAILER), "a sub-agent's prompt says it too");
    assert.ok(gitLine(sys(off, { readOnly: false })).endsWith(V107));
    assert.equal(/** @type {any} */ (CONFIG_SCHEMA.sessions).commitTrailer.default, true, "on as it ships");
  });

  // (fails before: yes — the owner's of 11-10: a coding agent's context said nothing of Filament's line, and Codex,
  // Cursor, Gemini and Qoder wrote their own or none)
  test("a coding agent: a standing block asks Filament's line in place of its own while on, the same line the loop asks; gone words when it goes off", () => {
    const body = () => ({ messages: [{ role: "user", content: "hi" }] });
    const on = agentContext({ format: "anthropic", body: body(), graph: false, trailer: true });
    const block = on.standing.find((b) => b.id === TRAILER_BLOCK);
    assert.ok(block, JSON.stringify(on.standing.map((b) => b.id)));
    assert.equal(block.text, `<filament-context kind="commits">\nWhen you commit, end the message with the trailer ${FILAMENT_TRAILER}, and add no co-author line of your own.\n</filament-context>`);
    assert.equal(block.text, CODER_TRAILER_TEXT);
    assert.equal(block.tool, undefined, "it stands whatever tools the session has");
    assert.ok(PROMPT.careTrailer.includes(FILAMENT_TRAILER), "the loop's sentence and the agent's block ask the same line");
    assert.equal(FILAMENT_TRAILER, "Co-authored-by: Filament <noreply@filamentdev.com>");
    assert.equal(agentContext({ format: "anthropic", body: body(), graph: false }).standing.some((b) => b.id === TRAILER_BLOCK), false, "off, or not asked: none");
    const state = contextState();
    openedWith(state, on.standing);
    const update = contextUpdate(state, agentContext({ format: "anthropic", body: body(), graph: false, trailer: false }).standing);
    assert.deepEqual(update?.removed, [TRAILER_BLOCK]);
    assert.ok(update?.text.includes("Filament's co-author line is no longer asked: write commit messages in the repository's own style."), update?.text);
  });
});

describe("the Environment through real loop turns", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {string} */
  let root;
  /** @type {string[]} */
  const dirs = [];
  before(async () => {
    // The folder as the filesystem knows it, as a turn names it (turn.js `realFolder`): macOS's temporary folder lies
    // under /var, a link to /private/var.
    root = realpathSync(mkdtempSync(join(tmpdir(), "filament-sysprompt-")));
    dirs.push(root);
    up = await fakeUpstream(() => anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "Done." }], usage: { input_tokens: 30, output_tokens: 7 } }));
  });
  after(async () => {
    await up.close();
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
  });
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 3, output: 15, contextTokens: 200000 } } }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
  };
  /** The system text of the newest model call. */
  const sentSystem = () => {
    const call = up.received.filter((c) => c.kind === "anthropic").at(-1);
    const sys = call?.body?.system;
    return Array.isArray(sys) ? sys.map((/** @type {any} */ b) => b.text).join("\n") : String(sys || "");
  };
  const envOf = (/** @type {string} */ sys) => sys.slice(sys.indexOf("# Environment"));
  /** @param {any} shim @param {string} id @param {string} content */
  const turn = async (shim, id, content) => {
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return sentSystem();
  };

  // (fails before: no Environment, and nothing that could hold one still from turn to turn)
  test("captured on the first turn, the same bytes on the next, and after a restart from the chain — never captured again", async () => {
    let captures = 0;
    /** A capture whose clock moves on every call: any second capture would show in the bytes. @param {string} r */
    const moving = async (r) => {
      captures++;
      const f = await TEST_ENVIRONMENT(r);
      return { ...f, clock: { ...f.clock, time: `09:${String(captures).padStart(2, "0")}` } };
    };
    const shim = await startApp({ memory: true, keep: true, configure, environment: moving });
    dirs.push(shim.dataDir);
    let id = "";
    let first = "";
    try {
      const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", autoTitle: true } });
      assert.equal(created.status, 200, await created.clone().text());
      id = (await created.json()).id;
      const sys1 = await turn(shim, id, "first task");
      assert.ok(sys1.includes("# Environment"), "the first turn carries the section");
      first = envOf(sys1);
      assert.match(first, /Captured when this session started: Monday 2026-01-05, 09:\d\d/);
      assert.match(first, /- Model: brain-model, through Filament; context window 200,000 tokens/, "the turn's model and window are named");
      assert.match(first, new RegExp(`- Working folder: ${root.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")} — not a git repository`));
      const used = captures;
      const sys2 = await turn(shim, id, "second task");
      assert.equal(envOf(sys2), first, "the second turn sends the same bytes");
      assert.equal(captures, used, "and captured nothing new");
    } finally {
      await shim.stop();
    }
    const failing = async () => {
      captures++;
      throw new Error("a restarted process must not need to capture");
    };
    const again = await startApp({ memory: true, dataDir: shim.dataDir, configure, environment: failing });
    try {
      const before = captures;
      const sys3 = await turn(again, id, "third task, after a restart");
      assert.equal(envOf(sys3), first, "the chain's stored capture: the same bytes after a restart");
      assert.equal(captures, before, "the stored capture was used, not a new one");
    } finally {
      await again.stop();
    }
  });

  test("the server's own capture, as a real turn sends it: the shell the hands run, Filament's listener, the folder", async () => {
    const shim = await startApp({ memory: true, configure, environment: null });
    dirs.push(shim.dataDir);
    try {
      const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", autoTitle: true } });
      assert.equal(created.status, 200, await created.clone().text());
      const section = envOf(await turn(shim, (await created.json()).id, "where am I?"));
      assert.ok(section.includes(`- Shell: the bash tool runs ${{ "git-bash": "Git Bash", cmd: "cmd.exe", bash: "/bin/bash", sh: "/bin/sh" }[SHELL.kind]}`), section);
      assert.ok(section.includes(` on 127.0.0.1:${shim.port}. Never stop or restart it`), "the listener the server really bound");
      assert.ok(section.includes(`- Working folder: ${root}`));
    } finally {
      await shim.stop();
    }
  });

  // (fails before: yes — a real turn's git line said nothing of Filament's line, and no field of the page could turn it)
  test("a real turn's git line ends with Filament's co-author line; switched off on Settings › Agent loop, the next turn's is version 107's", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", autoTitle: true } });
      assert.equal(created.status, 200, await created.clone().text());
      const id = (await created.json()).id;
      const on = await turn(shim, id, "commit this");
      assert.ok(on.includes(PROMPT.careTrailer) && on.includes("write the message in the repository's own style and end it with the trailer Co-authored-by: Filament <noreply@filamentdev.com>."));
      const flip = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "sessions.commitTrailer": false } } });
      assert.equal(flip.status, 200, await flip.clone().text());
      const off = await turn(shim, id, "and this one");
      assert.ok(off.includes(PROMPT.care) && !off.includes("Co-authored-by"), "off: version 107's sentence");
    } finally {
      await shim.stop();
    }
  });

  // (fails before: yes — the Prompts page previewed version 107's sentence for every seat while every turn sent the trailer)
  test("Settings → Prompts previews each seat's git line as its turns send it: with Filament's line, and without it once switched off", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      /** @param {any} d */
      const seats = (d) => ({ prompt: d.loop.prompt, builder: d.subagents.workers.builder, reviewer: d.subagents.workers.reviewer, lead: d.teams.lead, ...d.teams.workers });
      const on = await (await shim.api("/api/prompts")).json();
      for (const [seat, text] of Object.entries(seats(on))) assert.ok(String(text).includes(PROMPT.careTrailer), `${seat}: Filament's line`);
      const flip = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "sessions.commitTrailer": false } } });
      assert.equal(flip.status, 200, await flip.clone().text());
      const off = await (await shim.api("/api/prompts")).json();
      for (const [seat, text] of Object.entries(seats(off))) assert.ok(String(text).includes(PROMPT.care) && !String(text).includes("Co-authored-by"), `${seat}: version 107's sentence`);
    } finally {
      await shim.stop();
    }
  });

  test("the New Task board weighs the section the first turn sends, and names it in a few words", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      const r = await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: root, model: "brain-model", text: "hello" } });
      const d = await r.json();
      assert.equal(r.status, 200, JSON.stringify(d));
      assert.deepEqual(d.environment, { system: "Test OS 1", shell: SHELL.name, zone: "Europe/London", git: null });
      const bare = await startApp({ memory: true, configure, environment: async () => { throw new Error("no capture"); } });
      dirs.push(bare.dataDir);
      try {
        const r2 = await bare.api("/api/sessions/draft-start", { method: "POST", body: { cwd: root, model: "brain-model", text: "hello" } });
        const d2 = await r2.json();
        assert.equal(d2.environment, null, "a capture that fails leaves the section out, as the loop does");
        const prompt = (/** @type {any} */ x) => x.parts.find((/** @type {any} */ p) => p.id === "prompt").tokens;
        assert.ok(prompt(d) > prompt(d2), `the section is weighed in the prompt part (${prompt(d2)} → ${prompt(d)})`);
      } finally {
        await bare.stop();
      }
    } finally {
      await shim.stop();
    }
  });

  test("Settings → Prompts shows the section for the first root, in the main agent's and the sub-agents' prompts", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      const d = await (await shim.api("/api/prompts")).json();
      // A preview, not a session: the machine and the folder, without a session's model and window lines.
      const section = environmentText(await TEST_ENVIRONMENT(root));
      for (const [name, text] of Object.entries({ prompt: d.loop.prompt, builder: d.subagents.workers.builder, reviewer: d.subagents.workers.reviewer })) {
        assert.ok(String(text).endsWith(`\n\n${section}`), `${name} ends with the Environment of ${root}`);
      }
      // (fails before: yes — the wire order said the history went "shaped per the session's strategy", a view no
      // session has: every request sends its finished turns whole from the newest compaction on)
      assert.equal(d.anatomy.wire[2], "the conversation history: the finished turns whole from the newest compaction on");
      const bare = await startApp({ memory: true, configure, environment: async () => { throw new Error("no capture"); } });
      dirs.push(bare.dataDir);
      try {
        const d2 = await (await bare.api("/api/prompts")).json();
        assert.ok(!String(d2.loop.prompt).includes("# Environment"), "a capture that fails previews no section, as the loop sends none");
      } finally {
        await bare.stop();
      }
    } finally {
      await shim.stop();
    }
  });

  // (fails before: yes — the page showed no team's prompt: a lead's and its workers' bytes were nowhere to read)
  test("Settings → Prompts shows a team's: its lead's prompt and tools, and each worker's prompt by role, with the same section", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      const { teams } = await (await shim.api("/api/prompts")).json();
      const section = environmentText(await TEST_ENVIRONMENT(root));
      assert.ok(String(teams.lead).startsWith(`${PROMPT.leadRole}\n`) && teams.lead.includes("# Your team: «the team»\n«the team's persona»"), teams.lead);
      assert.deepEqual(teams.leadTools, [...HAND_TOOLS.map((t) => t.name), "lsp", "ask", "plan", "agent", "worker", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space"]);
      assert.deepEqual(Object.keys(teams.workers), ["scout", "builder", "tester", "reviewer"]);
      assert.deepEqual(teams.roleMay, { scout: "read", builder: "edit", tester: "edit", reviewer: "read" });
      // Each seat speaks with its card's words: the Scout Reviewer's, the Tester Builder's.
      const cardOf = /** @type {Record<string, string>} */ ({ scout: "reviewer", builder: "builder", tester: "builder", reviewer: "reviewer" });
      for (const [role, text] of Object.entries(teams.workers)) {
        assert.ok(text.startsWith(`${PROMPT.workerRole}\n${SHIPPED_CARDS[cardOf[role]].thinks}\nTeam «the team» asks of you: «the team's own line for this worker»`), text);
        assert.ok(text.endsWith(`\n\n${section}`), `the ${role}'s prompt ends with the Environment of ${root}`);
      }
      assert.ok(teams.lead.endsWith(`\n\n${section}`));
    } finally {
      await shim.stop();
    }
  });

  // (fails before: yes — HarnessV4_Tasks C18: the route had no word of a coding agent's session, whose system prompt
  // is its maker's: what Filament writes for one was nowhere to read, and the page named a sub-agent's withheld tools
  // from memory, one short)
  test("Settings → Prompts says what a coding agent's session is given: the words around its context, its part, its tools", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      const { coder, subagents } = await (await shim.api("/api/prompts")).json();
      assert.deepEqual([coder.head, coder.update, coder.graph], [CONTEXT_HEAD, UPDATE_HEAD, CODER_GRAPH_TEXT]);
      assert.equal(
        coder.server,
        "Filament is the harness the person works with you through. While the person has memory on, its memory tools search and keep what the person and earlier sessions learned, and what you learn goes there, not into a memory of your client's own. Its `tasks` keeps this session's task graph. Its file and shell tools run through the person's chat client, with its permission prompts, or on their machine; their paths are absolute. The project folder is «the session's working folder».",
      );
      const head = `<filament-context kind="role">\nThese are Filament's instructions for this session, not background.\n`;
      // A coding agent's own sub-agent runs in Builder's place, with Builder's words.
      assert.ok(coder.subagent.startsWith(`${head}${PROMPT.subagentRole}\n${SHIPPED_CARDS.builder.thinks}\n${PROMPT.subagentPermission}\n`), coder.subagent);
      assert.ok(coder.worker.startsWith(`${head}${PROMPT.workerRole}\n${SHIPPED_CARDS.builder.thinks}\nTeam «the team» asks of you: «the team's own line for this worker»\n${PROMPT.workerPermission}\n`), coder.worker);
      assert.ok(coder.lead.startsWith(`${head}${PROMPT.leadRole}\n${PROMPT.headTeam} «the team»\n«the team's persona»\n`), coder.lead);
      for (const part of [coder.subagent, coder.worker, coder.lead]) assert.ok(part.endsWith("\n</filament-context>") && !part.includes(PROMPT.hands), "the agent's part, without the words that teach the loop's model its hands");
      assert.deepEqual(coder.tools, { graph: "tasks", report: "report", lead: ["agent", "worker", "wait", "envelope"], hands: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"] });
      assert.deepEqual(subagents.off, [...SUBAGENT_OFF]);
      assert.deepEqual(subagents.off, ["ask", "plan", "agent", "wait"]);
    } finally {
      await shim.stop();
    }
  });

  // (fails before: yes — HarnessV4_Tasks C18, the page as drawn: the whole prompt sat closed under its one editable
  // sentence, which no version changed; a sub-agent was said to lack "ask, plan and agent" (it lacks wait too) and a
  // fork to be refused "ask, plan or agent" (six tools are); the task graph's tools were in no note; and no block or
  // sentence said a coding agent runs on its own prompt)
  test("the Prompts page as drawn: the whole prompt open under its version and sections, the tools as the server names them, a coding agent's block", async () => {
    const shim = await startApp({ memory: true, configure });
    dirs.push(shim.dataDir);
    try {
      const payload = await (await shim.api("/api/prompts")).json();
      bindUi({
        h: fakeH,
        state: { config: {}, dirty: false },
        api: async () => payload,
        intro: (/** @type {string} */ _id, /** @type {any[]} */ ...kids) => fakeH("div", { class: "intro" }, ...kids),
        markDirty: () => {},
      });
      const page = prompts();
      await new Promise((r) => setImmediate(r));
      /** Every details block under a node, with its summary's words. @param {any} n @returns {{ el: any, summary: string }[]} */
      const blocks = (n) => (n && typeof n === "object" ? [...(n.tag === "details" ? [{ el: n, summary: textOf(n.kids.find((/** @type {any} */ k) => k?.tag === "summary")) }] : []), ...(n.kids || []).flatMap(blocks)] : []);
      const all = blocks(page);
      const block = (/** @type {string} */ starts) => {
        const hit = all.filter((d) => d.summary.startsWith(starts));
        assert.equal(hit.length, 1, `one block "${starts}" among: ${all.map((d) => d.summary.slice(0, 50)).join(" / ")}`);
        return hit[0];
      };
      const words = textOf(page);

      const whole = block("Assembled prompt, version");
      assert.equal(whole.summary, `Assembled prompt, version ${PROMPT_VERSION} — what the next turn carries · How you work · Your tools · Care with actions · Talking with the developer · Your context window · Environment`);
      assert.equal(whole.el.attrs.open, "", "the whole prompt is open as the page opens");
      assert.ok(textOf(whole.el).includes(payload.loop.prompt));

      assert.ok(words.includes("It is offered the loop's tools without ask, plan, agent and wait: "), "a sub-agent's withheld tools, all four — its envelope writes the agent that launched it (the owner's of 11-04)");
      // A fork's browser runs, in tabs of its own (HarnessV4_AgentTools_Plan AT-D6): it is no refusal of a fork's; nor is
      // its envelope, which writes the main agent.
      // The craft tool is skill_craft since the owner's tool plan of 11-08 (CRAFT_NAME).
      block("what a fork hears when it calls ask, plan, tasks, agent, wait, worker, team, thread, flow, skill_craft or come_back");
      assert.ok(words.includes(" rides right after |plan| for the session's own agent — a team's lead too — and a sub-agent that runs one of the task graph's tasks is offered |report| to end with."), "the task graph's two tools are in the per-session notes");
      assert.ok(words.includes("A session a coding agent answers — Claude Code, Codex, Antigravity, Cursor — runs on that agent's own system prompt and tools"), "the page's opening says whose request the slots are");
      assert.ok(textOf(block("a team — its lead's prompt and its workers'").el).includes("In a session a coding agent answers, that agent leads"));

      const coder = block("a coding agent — what Filament gives its session");
      assert.deepEqual(
        blocks(coder.el).slice(1).map((d) => [d.summary, textOf(d.el.kids.find((/** @type {any} */ k) => k?.tag === "pre"))]),
        [
          ["ahead of the context, where it is said in full", payload.coder.head],
          ["ahead of a change to it", payload.coder.update],
          ["the MCP server's own words, as the agent connects", payload.coder.server],
          ["the task graph's words", payload.coder.graph],
          ["its part as a sub-agent", payload.coder.subagent],
          ["its part as a team's worker — a builder's; another role's has that role's line, as the team's block shows", payload.coder.worker],
          ["its part as a team's lead", payload.coder.lead],
        ],
      );
      const said = textOf(coder.el);
      assert.ok(said.includes("None of ①, ② or ③ is sent to one, and no edit on this page reaches one."));
      assert.ok(said.includes("|tasks| for the task graph, |report| on a run of one of the graph's tasks, and |agent, worker, wait, envelope| for a team's lead."), said.slice(0, 1800));
      assert.ok(said.includes("|Read, Write, Edit, Bash, Glob, Grep|."));
    } finally {
      await shim.stop();
    }
  });
});

describe("the console's Settings page: its inbound keys and Observability's token calibration", () => {
  /**
   * The page drawn on the fake DOM, on the Observability tab with one factor learned, over the console's own admin
   * client, its calls recorded as they go on the wire. `rotateRefused`: the words a rotate the server could not make
   * answers with (500); `unreadable`: what this secret.key cannot open, as GET /api/state names it.
   * @param {{ dirty?: boolean, rotateRefused?: string, unreadable?: string[] }} [o]
   */
  const draw = ({ dirty = false, rotateRefused = "", unreadable = [] } = {}) => {
    /** @type {{ path: string, method: string, body: any }[]} */
    const sent = [];
    /** @type {string[]} */
    const toasts = [];
    /** @type {(string | undefined)[]} */
    const kinds = [];
    /** @type {boolean[]} */
    const reloads = [];
    const state = {
      config: { server: {}, observability: {}, agentLoop: {}, alerts: {} },
      saved: { observability: {} },
      unreadable,
      dirty,
      schema: { config: { server: {}, observability: {}, agentLoop: {}, alerts: {} } },
      keys: ["sk-filament-current-key-0001"],
      logReach: false,
      settingsUi: { tab: "observability" },
      tokenCalib: [{ key: "zai::glm-5.3", f: 1.12, n: 4, at: 0 }],
    };
    const api = createApi({
      base: "",
      fetchImpl: async (url, init) => {
        sent.push({ path: url, method: String(init?.method || "GET"), body: init?.body });
        if (url === "/keys/rotate" && rotateRefused) return { ok: false, status: 500, statusText: "Internal Server Error", json: async () => ({ error: rotateRefused }) };
        return { ok: true, json: async () => (url === "/keys/rotate" ? { key: "sk-filament-brand-new-key-9999" } : { ok: true }) };
      },
    });
    bindUi({
      h: fakeH,
      state,
      api,
      toast: (/** @type {string} */ m, /** @type {string | undefined} */ kind) => void (toasts.push(m), kinds.push(kind)),
      render: () => {},
      markDirty: () => {},
      loadAll: async () => (reloads.push(state.dirty), true),
      schemaForm: () => fakeH("div", {}),
      secretLine: (/** @type {string} */ k) => fakeH("code", {}, k),
      memWhen: () => "",
      memAgo: () => "",
    });
    const page = settings();
    /** A button's press, waited for. @param {string} words */
    const press = (words) => buttonsOf(page).find((b) => textOf(b) === words)?.attrs.onclick();
    return { sent, toasts, kinds, reloads, press, page, state };
  };

  // (fails before: yes — the bug hunt of 10-30, UIST-4: Forget's body was JSON-encoded twice, so the server read a string with no key in it and answered 404 for every row)
  test("Forget sends the row's key in its body, where the route reads it", async () => {
    const p = draw();
    await p.press("Forget");
    const call = p.sent.find((c) => c.method === "DELETE");
    assert.equal(call?.path, "/token-calib");
    // The route takes `(await r.json()) || {}` and forgets under its `key`.
    assert.equal((JSON.parse(String(call?.body)) || {}).key, "zai::glm-5.3");
    assert.deepEqual(p.toasts, ["Forgot zai::glm-5.3"]);
  });

  // (fails before: yes — the bug hunt of 10-30, UIST-2: Rotate key read the saved configuration over unsaved edits without asking, and its toast held the new key whole)
  test("Rotate key asks first where edits are unsaved, and no toast holds the key", async () => {
    const g = /** @type {any} */ (globalThis);
    const hadConfirm = "confirm" in g;
    const prevConfirm = g.confirm;
    /** @type {string[]} */
    const asked = [];
    let answer = false;
    g.confirm = (/** @type {string} */ m) => (asked.push(m), answer);
    try {
      const rotated = (/** @type {{ sent: any[] }} */ p) => p.sent.filter((c) => c.path === "/keys/rotate").length;
      const edited = draw({ dirty: true });
      await edited.press("Rotate key");
      assert.equal(asked.length, 1, "asked before anything is done");
      assert.match(asked[0], /unsaved changes/);
      assert.deepEqual([rotated(edited), edited.reloads.length], [0, 0], "a no: no new key, and the draft stays");
      answer = true;
      await edited.press("Rotate key");
      assert.deepEqual([rotated(edited), edited.reloads.length], [1, 1], "a yes: the new key, and the saved configuration read again");
      const clean = draw();
      await clean.press("Rotate key");
      assert.equal(asked.length, 2, "nothing unsaved: no question");
      assert.equal(rotated(clean), 1);
      assert.deepEqual(clean.toasts, ["A new key is first in the list: copy it from there"]);
      for (const t of [...edited.toasts, ...clean.toasts]) assert.ok(!t.includes("sk-filament-brand-new-key-9999"), `a toast holds the key: ${t}`);
    } finally {
      if (hadConfirm) g.confirm = prevConfirm;
      else delete g.confirm;
    }
  });

  // (fails before: yes — the bug hunt of 10-30: a rotate the server refused threw out of the button's press, and the person
  // was told nothing)
  test("a Rotate key that fails says why in words, and leaves the keys and the page as they were", async () => {
    const p = draw({ rotateRefused: "the configuration could not be saved (EISDIR), so the keys are as they were" });
    const thrown = await Promise.resolve(p.press("Rotate key")).then(() => null, (/** @type {any} */ e) => e);
    assert.equal(thrown, null, "the press throws nothing");
    assert.deepEqual([p.toasts, p.kinds], [["No new key: the configuration could not be saved (EISDIR), so the keys are as they were"], ["err"]]);
    assert.deepEqual(p.reloads, [], "the page is not read again");
    assert.deepEqual(p.state.keys, ["sk-filament-current-key-0001"]);
  });

  // (fails before: yes — the bug hunt of 10-30, #4: Settings said nothing of a secret this secret.key cannot open)
  test("Settings names each secret this secret.key cannot read, and how it opens again", () => {
    const said = textOf(draw({ unreadable: ["server.adminToken", "inboundKeys[0]"] }).page);
    assert.match(said, /Secrets Filament cannot read\|These secrets are kept as stored, sealed with a secret\.key this Filament does not have\. Put that secret\.key back beside config\.json and restart Filament, and they open again\. A value typed in place of one replaces it, and its Remove forgets it; a save of anything else keeps them\./);
    assert.match(said, /\|server\.adminToken\|inboundKeys\[0\]\|/);
    assert.ok(!textOf(draw().page).includes("cannot read"), "nothing unreadable: nothing said");
  });
});
