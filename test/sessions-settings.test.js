// HarnessV2 P2: the Session Settings document — three layers, provenance, hash, patches.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOBS, BUILT_PHASE, RESULTS_BY_FORM, LOOP_TOOL_NAMES, flatten, unflatten, validateLayer, resolveSettings, settingsHash,
  applyPatch, globalLayer, resolveChainSettings, ruleProblem, hookProblem, mcpServerProblem,
} from "../src/services/session-settings.js";

test("every knob has a phase, a doc and a default that passes its own check", () => {
  for (const [path, k] of Object.entries(KNOBS)) {
    assert.ok(k.phase >= 2 && k.phase <= 6, `${path} phase`);
    assert.ok(k.doc.length > 8, `${path} doc`);
    const { errors } = validateLayer(unflatten({ [path]: k.default }));
    assert.deepEqual(errors, [], `${path}'s default is valid`);
  }
  assert.equal(BUILT_PHASE, 5);
});

test("flatten/unflatten round-trip; json and list knobs stay leaves", () => {
  const doc = { context: { results: "status", compaction: { thresholdPercent: 70 } }, loop: { tools: { bash: false } }, hooks: [{ on: "turn-end", command: "x" }] };
  const flat = flatten(doc);
  // On an object with no prototype (the security review of f-fence): no key is read that the document never held.
  assert.deepEqual(flat, Object.assign(Object.create(null), { "context.results": "status", "context.compaction.thresholdPercent": 70, "loop.tools": { bash: false }, hooks: [{ on: "turn-end", command: "x" }] }));
  assert.deepEqual(unflatten(flat), doc);
});

// (fails before: yes — flatten read `__proto__` as a knob and set its result's prototype to what it held, which no check
// saw and applyPatch wrote: an MCP server, from anyone's patch; `toString` passed as a knob)
test("a settings document's `__proto__`, `constructor` or `prototype` opens no prototype and names no setting: flatten passes them by, a patch's MCP server under one is never written", () => {
  const mcp = [{ name: "x", command: "cmd.exe", args: ["/c", "echo", "ran"] }];
  const patch = JSON.parse(`{"__proto__": {"plugins.mcp": ${JSON.stringify(mcp)}}, "model": {"constructor": {"prototype": {"name": "m"}}}}`);
  const flat = flatten(patch);
  assert.equal(Object.getPrototypeOf(flat), null, "the paths stand on no prototype");
  assert.equal(flat["plugins.mcp"], undefined, "no MCP server read through one");
  assert.deepEqual(Object.keys(flat), []);
  assert.deepEqual(validateLayer(patch).errors, []);
  const r = applyPatch({}, { patch }, { at: "session" });
  assert.deepEqual([r.errors, r.changes, flatten(r.layer)["plugins.mcp"]], [[], [], undefined], "a person's own patch writes nothing of it");
  // A stored layer holding one gives nothing from it, and the resolved document runs no server.
  assert.deepEqual(resolveSettings({ session: patch }).flat["plugins.mcp"], KNOBS["plugins.mcp"].default);
  // A name every object answers is no knob.
  assert.deepEqual(validateLayer({ toString: 1, hasOwnProperty: 2 }).errors, ['unknown setting "toString"', 'unknown setting "hasOwnProperty"']);
  assert.deepEqual(applyPatch({}, { unset: ["valueOf"] }).errors, ['unknown setting "valueOf"']);
  // Unflattened, a path through one walks into no prototype every object shares.
  try {
    assert.deepEqual(unflatten({ "constructor.prototype.polluted": 1, "__proto__.polluted": 1, "toString.polluted": 1 }), { toString: { polluted: 1 } });
    assert.equal(/** @type {any} */ ({}).polluted, undefined, "Object.prototype is untouched");
    assert.equal(/** @type {any} */ (Object.prototype.toString).polluted, undefined);
  } finally {
    delete (/** @type {any} */ (Object.prototype).polluted);
    delete (/** @type {any} */ (Object.prototype.toString).polluted);
  }
});

test("validateLayer refuses unknown keys by name and wrong types in words", () => {
  const { errors } = validateLayer({ context: { results: "sideways", nope: 1 }, loop: { permissions: 7 }, model: { maxTokens: 0 } });
  assert.ok(errors.some((e) => e.includes('unknown setting "context.nope"')), errors.join("; "));
  assert.ok(errors.some((e) => e.includes('"context.results" must be one of')));
  assert.ok(errors.some((e) => e.includes('"loop.permissions" must be one of')));
  assert.ok(errors.some((e) => e.includes('"model.maxTokens" must be at least 1')));
  assert.deepEqual(validateLayer({ memory: { loads: "x" } }).errors, ['"memory.loads" must be a list'], "a non-list is refused in words, never a crash");
  assert.deepEqual(validateLayer({ model: { effort: null }, context: { compaction: { model: null } } }).errors, [], "nullable knobs take null");
});

test("resolveSettings: session ?? project ?? global ?? default, with the source named", () => {
  const r = resolveSettings({
    global: { loop: { permissions: "ask" }, context: { results: "status" } },
    project: { instructions: { files: ["AGENTS.md"] } },
    session: { context: { results: "keep" } },
  });
  assert.equal(r.effective.context.results, "keep"); assert.equal(r.sources["context.results"], "session");
  assert.deepEqual(r.effective.instructions.files, ["AGENTS.md"]); assert.equal(r.sources["instructions.files"], "project");
  assert.equal(r.effective.loop.permissions, "ask"); assert.equal(r.sources["loop.permissions"], "global");
  assert.equal(r.effective.model.maxTokens, null, "null = the model's stated maximum output, else the 128,000 floor"); assert.equal(r.sources["model.maxTokens"], "default");
  assert.equal(resolveSettings({}).effective.context.results, "keep", "results go as they came back unless a policy is chosen");
  assert.equal("strategy" in r.effective.context, false, "no choice of how earlier turns go: every turn whole until a compaction");
  assert.equal(r.live["context.results"], true); assert.equal(r.live["loop.resultCapChars"], true, "phase 4 knobs are live"); assert.equal(r.live["subagents.pool"], true, "phase 5 knobs are live now"); assert.ok(Object.values(r.live).every(Boolean), "every declared knob is built");
  assert.equal(r.live["loop.tools"], true, "phase 3 knobs are live"); assert.equal(r.live["memory.briefing"], true);
  assert.deepEqual(r.layers.session, { context: { results: "keep" } });
  assert.match(r.hash, /^[0-9a-f]{16}$/);
});

// (fails before: yes — a stored layer was read whole: a value its knob refuses outranked the layer below, and the
// project row's own display flag, and a mode knob stored beside it, reached every session of the project;
// HarnessV3-AtHome AH-C1)
test("a stored layer is read knob by knob: a value its knob refuses, a key that names no knob, and a knob the layer may not hold are skipped, so the layer below decides", () => {
  const r = resolveSettings({
    global: { context: { results: "status", view: { stubChars: 200 } } },
    project: { context: { results: "pointer" }, display: { archived: true }, instructions: { files: ["AGENTS.md"] } },
    session: { context: { view: { stubChars: "wide" }, nope: 1 }, memory: { enabled: false } },
  });
  assert.equal(r.effective.context.view.stubChars, 200); assert.equal(r.sources["context.view.stubChars"], "global");
  assert.equal(r.effective.context.results, "status"); assert.equal(r.sources["context.results"], "global", "a project layer holds repo facts only");
  assert.equal(r.effective.display.archived, false); assert.equal(r.sources["display.archived"], "default", "the project's own flag is no session's");
  assert.deepEqual(r.effective.instructions.files, ["AGENTS.md"], "the project's repo facts apply");
  assert.equal(r.effective.memory.enabled, false, "the session's valid knobs apply");
  assert.equal(r.effective.context.nope, undefined);
  assert.deepEqual(r.layers.session, { memory: { enabled: false } }, "the layers are reported as read");
});

test("the hash changes with a live knob, not with display; identical documents hash identically", () => {
  const base = resolveSettings({ session: { context: { results: "status" } } });
  assert.equal(resolveSettings({ session: { context: { results: "status" } } }).hash, base.hash);
  assert.notEqual(resolveSettings({ session: { context: { results: "pointer" } } }).hash, base.hash);
  assert.equal(resolveSettings({ session: { context: { results: "status" }, display: { title: "x", pinned: true } } }).hash, base.hash, "display never moves the hash");
  assert.notEqual(resolveSettings({ session: { context: { results: "status" }, subagents: { pool: [{ model: "", seats: 3 }] } } }).hash, base.hash, "a phase 5 knob moves it now");
  assert.notEqual(resolveSettings({ session: { context: { results: "status" }, loop: { resultCapChars: 5000 } } }).hash, base.hash, "a phase 4 knob moves it now");
  assert.notEqual(resolveSettings({ session: { context: { results: "status" }, loop: { tools: { bash: false } } } }).hash, base.hash, "a phase 3 knob moves the hash");
  assert.notEqual(resolveSettings({ session: { context: { results: "status" }, memory: { briefing: false } } }).hash, base.hash);
  assert.equal(settingsHash(base.flat), base.hash);
  // (fails before: yes — the review of fe6b8d579: a knob added at its default of null moved every chat's hash, and each
  // chat drew a "Settings changed" row with no change after the update)
  const { "subagents.parallelize": _added, ...before } = base.flat;
  assert.equal(settingsHash(before), base.hash, "a knob added at null moves no hash");
  assert.notEqual(resolveSettings({ session: { context: { results: "status" }, subagents: { parallelize: true } } }).hash, base.hash, "set, it moves it");
  assert.notEqual(resolveSettings({ session: { context: { results: "status" }, subagents: { parallelize: false } } }).hash, base.hash, "set off too");
});

test("applyPatch sets, unsets (inherit again), reports changes with liveness, refuses bad patches whole", () => {
  const a = applyPatch({ context: { results: "status" } }, { patch: { context: { results: "keep" }, memory: { enabled: false } } });
  assert.deepEqual(a.errors, []);
  assert.deepEqual(a.layer, { context: { results: "keep" }, memory: { enabled: false } });
  assert.deepEqual(a.changes.map((c) => [c.path, c.from, c.to, c.live]), [["context.results", "status", "keep", true], ["memory.enabled", undefined, false, true]]);
  const b = applyPatch(a.layer, { unset: ["context.results"], patch: { subagents: { pool: [{ model: "", seats: 2 }] } } });
  assert.deepEqual(b.layer, { memory: { enabled: false }, subagents: { pool: [{ model: "", seats: 2 }] } });
  assert.equal(b.changes.find((c) => c.path === "subagents.pool")?.live, true);
  const c = applyPatch(a.layer, { patch: { context: { results: "status" }, bogus: 1 } });
  assert.equal(c.errors.length, 1); assert.deepEqual(c.layer, a.layer, "nothing applied when anything is wrong");
  assert.deepEqual(applyPatch(a.layer, { patch: { context: { results: "keep" } } }).changes, [], "same value is not a change");
});

test("globalLayer speaks the document's vocabulary from the config's", () => {
  const g = globalLayer({
    agentLoop: { permissions: "auto", learnedPermissions: { afterApprovals: 2 }, treeSnapshots: false, readerModel: "" },
    rules: { trim: { sequential: false, learn: true, model: "cheap" } },
    memory: { enabled: false, autopilot: { tools: false, turnTokens: 500, minScore: 0.3 }, capture: { learn: false }, privacy: { searchIndex: true }, models: { summarizer: "auto" } },
  });
  assert.equal(g["loop.permissions"], "auto");
  assert.equal(g["loop.readerModel"], null);
  assert.equal(g["loop.learnedPermissions.afterApprovals"], 2); assert.equal(g["loop.learnedPermissions.enabled"], undefined, "a positive threshold says nothing about enabled");
  assert.equal(globalLayer({ agentLoop: { learnedPermissions: { afterApprovals: 0 } } })["loop.learnedPermissions.enabled"], false, "0 approvals = learning off, in the document's words");
  // (fails before: yes — the owner's rules of 10-31 took /trim's own model: an old config naming it falls back to the
  // document's default)
  assert.equal(g["context.compaction.model"], undefined, "rules.trim.model says nothing now");
  assert.equal(g["memory.enabled"], false); assert.equal(g["memory.tools"], false); assert.equal(g["memory.turnTokens"], 500);
  assert.equal(g["memory.learn"], false); assert.equal(g["privacy.index"], true);
  assert.deepEqual(validateLayer(unflatten(g)).errors, [], "the global layer validates");
});

// (the owner's of 11-07: there are no presets) A chat a preset was applied to holds what it wrote in its own layer, so
// it keeps it: Review's read-only, as the chat's own.
test("a preset's settings, kept in a chat's own layer, still resolve as they did; the tool names and RESULTS_BY_FORM", () => {
  const review = resolveSettings({ session: { loop: { permissions: "read-only", tools: { bash: false, write: false, edit: false } } } });
  assert.equal(review.effective.loop.permissions, "read-only"); assert.deepEqual(review.effective.loop.tools, { bash: false, write: false, edit: false });
  assert.equal(review.sources["loop.permissions"], "session");
  assert.equal(RESULTS_BY_FORM["fold+2"], "keep");
  assert.deepEqual([...LOOP_TOOL_NAMES].slice(0, 9), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", "powershell", "grep"]);
  assert.deepEqual(KNOBS["loop.tools"].options, [...LOOP_TOOL_NAMES], "the inspector draws the tool switches from the schema's list, the later hands included");
  assert.deepEqual(validateLayer({ loop: { tools: { glob: false } } }).errors, [], "a later hand may be switched off ahead of time (no effect until it lands)");
});

test("resolveChainSettings reads the three layers off the archive; null for an unknown chain", () => {
  const archive = {
    chainHead: (id) => (id === "c1" ? { id: "c1", project_id: "p1", model: null, native: false } : id === "c2" ? { id: "c2", project_id: null, model: null, native: false } : null),
    projectSettings: (id) => (id === "p1" ? { instructions: { files: ["RULES.md"] } } : {}),
    chainSettings: (id) => (id === "c1" ? { context: { results: "keep" } } : {}),
  };
  const cfg = { agentLoop: { permissions: "ask", readerModel: "global-reader" } };
  const r = resolveChainSettings(archive, cfg, "c1");
  assert.equal(r.effective.context.results, "keep"); assert.equal(r.sources["context.results"], "session");
  assert.deepEqual(r.effective.instructions.files, ["RULES.md"]); assert.equal(r.sources["instructions.files"], "project");
  assert.equal(r.effective.loop.permissions, "ask"); assert.equal(r.sources["loop.permissions"], "global");
  assert.equal(r.effective.loop.readerModel, "global-reader"); assert.equal(r.sources["loop.readerModel"], "global");
  const r2 = resolveChainSettings(archive, cfg, "c2");
  assert.notEqual(r2.sources["instructions.files"], "project", "no project, no project layer");
  assert.equal(resolveChainSettings(archive, cfg, "nope"), null);
});

test("P5 list knobs are checked item by item: rules, hooks, MCP servers, the pool, the string lists — each wrong item named in words", () => {
  assert.equal(ruleProblem({ tool: "bash", pattern: "rm *", verdict: "deny" }), null);
  assert.equal(ruleProblem({ tool: "*", pattern: "*", verdict: "ask" }), null);
  assert.equal(ruleProblem({ tool: "mcp__files__list", pattern: "*", verdict: "allow" }), null);
  assert.match(ruleProblem({ tool: "bash", pattern: "", verdict: "deny" }), /pattern/);
  assert.equal(ruleProblem({ tool: "mcp__GitHub__get-file", pattern: "x", verdict: "deny" }), null, "an MCP tool keeps its case and dashes");
  assert.match(ruleProblem({ tool: "bash rm", pattern: "x", verdict: "deny" }), /tool name/);
  assert.match(ruleProblem({ tool: "-bash", pattern: "x", verdict: "deny" }), /tool name/);
  assert.match(ruleProblem({ tool: "bash", pattern: "x", verdict: "block" }), /verdict/);
  assert.match(ruleProblem("bash(rm *) deny"), /must be/);
  assert.equal(hookProblem({ on: "post-tool", tool: "edit", command: "node check.mjs", timeoutMs: 5000 }), null);
  assert.equal(hookProblem({ on: "turn-end", command: "npm test" }), null);
  assert.match(hookProblem({ on: "after-edit", command: "x" }), /needs on/);
  assert.match(hookProblem({ on: "turn-end", tool: "edit", command: "x" }), /pre-tool and post-tool/);
  assert.match(hookProblem({ on: "pre-tool", command: "x", timeoutMs: 10 }), /timeoutMs/);
  assert.match(hookProblem({ on: "pre-tool", command: "" }), /command/);
  assert.equal(mcpServerProblem({ name: "files", command: "node", args: ["server.mjs"], env: { A: "1" } }), null);
  assert.equal(mcpServerProblem({ name: "remote", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" } }), null);
  assert.match(mcpServerProblem({ name: "Files", command: "node" }), /name/);
  assert.match(mcpServerProblem({ name: "files" }), /command .* or an http/);
  assert.match(mcpServerProblem({ name: "files", command: "node", args: "server.mjs" }), /args/);
  const bad = validateLayer({
    loop: { rules: [{ tool: "bash", pattern: "rm *", verdict: "deny" }, { tool: "bash" }] },
    hooks: [{ on: "post-tool", command: "npm test" }, { on: "nope", command: "x" }],
    plugins: { mcp: [{ name: "ok", command: "node" }, { name: "bad url", url: "ftp://x" }] },
    privacy: { redact: ["sk-[a-z]+", "("], bashDeny: ["rm *", ""] },
    skills: { on: [{ name: "pdf" }, { name: "linear:triage" }] },
  });
  assert.equal(bad.errors.length, 6, bad.errors.join(" | "));
  // In the layer's own order, each knob's problems together.
  const expected = [
    ['"loop.rules[1]"', "needs a pattern"],
    ['"hooks[1]"', "needs on: pre-tool, post-tool"],
    ['"plugins.mcp[1]"', "needs a name"],
    ['"privacy.redact[1]"', "is not a regular expression"],
    ['"privacy.bashDeny"', "must be a list of non-empty strings"],
    ['"skills.on[1]"', "needs the skill's name"],
  ];
  for (const [i, [path, words]] of expected.entries()) assert.ok(bad.errors[i].startsWith(path) && bad.errors[i].includes(words), bad.errors[i]);
  assert.deepEqual(validateLayer({ loop: { rules: [{ tool: "bash", pattern: "rm *", verdict: "deny" }] }, hooks: [{ on: "post-tool", tool: "edit", command: "node check.mjs" }] }).errors, []);
});
