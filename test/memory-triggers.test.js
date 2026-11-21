// @ts-check
// Memory at the moment of action (HarnessV3-Memory M5-1..M5-3): the shapes of a tool call, the pitfalls a claim's words
// name, the triggers kept for them (schema v14), and when one fires — on a proxy client's tool-result leg here, in the
// harness loop in agent-pitfalls.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callShapes, pitfallsOf, triggerTool, commandOf, targetOf, callCarries } from "../src/services/memory/triggers.js";
import { world } from "./fixtures/memory-world.mjs";

const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const MD14 = "no, don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test.";
/** MD14 as the person's rule: what the agent keeps of it, or the person's @mem rule (the memory plan's d3). */
const MD14_RULE = "don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test";

// ---- M5-1: the shape of a call ----
test("a call's shapes: each simple command after what sets up its run; any other tool's is its name", () => {
  assert.deepEqual(callShapes("bash", "cd x && env -u A npm test -- --grep y"), ["cd", "npm test"]);
  assert.deepEqual(callShapes("bash", "FOO=1 npm run build"), ["npm run"]);
  assert.deepEqual(callShapes("Bash", { command: "npm test 2>&1 | tail -5; git status" }), ["npm test", "tail", "git status"], "a redirect's & splits nothing");
  assert.deepEqual(callShapes("PowerShell", { command: "$env:FOO = '1'; npm.cmd test" }), ["npm test"], "a variable's statement has no shape; npm.cmd is npm");
  assert.deepEqual(callShapes("shell", { command: ["bash", "-lc", "sudo -u x apt-get install y && (cd a; make)"] }), ["apt-get install", "cd", "make"], "an argv's script; a wrapper's option takes its value");
  assert.deepEqual(callShapes("bash", 'echo "a && b; c" && node index.js'), ["echo", "node index.js"], "quotes split nothing");
  assert.deepEqual(callShapes("bash", "ls & npm start &"), ["ls", "npm start"]);
  assert.deepEqual(callShapes("bash", "npm test && npm test -- --watch"), ["npm test"], "one shape once");
  assert.deepEqual(callShapes("bash", ""), []);
  assert.deepEqual(callShapes("mcp__github__create_issue", { title: "x" }), ["github__create_issue"]);
  assert.deepEqual(callShapes("Read", { file_path: "x" }), ["read"]);
  for (const t of ["bash", "Bash", "powershell", "run_shell_command", "execute_command", "shell"]) assert.equal(triggerTool(t), "bash", t);
  assert.equal(commandOf(["powershell", "-Command", "npm test"]), "npm test");
  // What a runner runs (M5-D31), and whether a call carries a trigger's words.
  assert.deepEqual(
    ["npm run build", "npm run --silent Build", "npm run -- x", "uv run pytest -q", "pnpm dlx create-vite", "python3 -m http.server", "py -m pip install x", "npm test", "git push origin"].map((c) => targetOf(c.split(" "))),
    ["build", "build", "", "pytest", "create-vite", "-m http.server", "-m pip", "", ""],
  );
  const carries = (/** @type {string} */ command, /** @type {string} */ shape, /** @type {string} */ args) => callCarries("Bash", { command }, shape, args);
  assert.equal(carries("git fetch && git push origin main --force", "git push", "--force"), true);
  assert.equal(carries("git push --force-with-lease", "git push", "--force"), false, "a word is whole");
  assert.equal(carries("git push origin main", "git push", ""), true, "no words: every call of the shape");
  assert.equal(carries("rm -rf 'node_modules'", "rm", "-rf node_modules"), true, "quotes and order aside");
  assert.equal(carries("rm -rf dist", "rm", "-rf node_modules"), false, "every word");
  assert.equal(carries("npm install --force", "npm", "--force"), true, "a trigger on a head alone");
  assert.equal(carries("echo --force && git push", "git push", "--force"), false, "in the command of the shape");
  assert.equal(carries("git push origin main && git fetch --force", "git push", "--force"), false, "another command's words are not this one's");
  assert.equal(callCarries("Read", { file_path: "x" }, "read", "x"), false);
});

// ---- M5-2: the pitfalls a claim's words name ----
test("the pitfalls a claim's words name: the command under a negation, and the right way when it runs the same command", () => {
  const one = (/** @type {string} */ text) => pitfallsOf(text).map((t) => [t.shape, t.args, t.unless]);
  assert.deepEqual(pitfallsOf(`Correction from the user: ${MD14}`), [{ tool: "bash", shape: "npm test", args: "", unless: "env -u CLAUDECODE" }], "MD-14");
  assert.deepEqual(one("never run git push --force on main"), [["git push", "--force", null]], "the words that make the call the mistaken one (M5-D31)");
  assert.deepEqual(one("no, never run git push --force; use git push --force-with-lease instead."), [["git push", "--force", "--force-with-lease"]]);
  assert.deepEqual(one("use pnpm, not npm"), [["npm", "", null]], "a way that runs another command is no unless");
  assert.deepEqual(one("use pnpm instead of npm"), [["npm", "", null]]);
  assert.deepEqual(one("don't run the tests with npm test, run npm test -- --runInBand instead"), [["npm test", "", "-- --runInBand"]], "what the way adds after it");
  assert.deepEqual(one("don't just run cargo build; use cargo build --release"), [["cargo build", "", "--release"]]);
  assert.deepEqual(one("never run `./deploy.sh` from a laptop"), [["deploy.sh", "", null]], "a backticked command, whatever it is");
  assert.deepEqual(one("never run `git push origin main` from here"), [["git push", "origin main", null]], "backticked, every word is the command's");
  assert.deepEqual(one("never run psql against prod; seed with scripts/seed.js instead"), [["psql", "", null]], "in plain words, a word of the sentence is not the command's");
  assert.deepEqual(one("don't run rm -rf node_modules here"), [["rm", "-rf node_modules", null]]);
  assert.deepEqual(one("stop using yarn"), [["yarn", "", null]]);
  assert.deepEqual(one("we decided not to use docker for local dev"), [["docker", "", null]]);
  assert.deepEqual(one("don't use make here"), [["make", "", null]], "a word of prose is no subcommand");
  assert.deepEqual(one("never run python -m pytest bare; use PYTHONPATH=. python -m pytest"), [["python", "-m pytest", "PYTHONPATH=."]], "what a runner runs; a path's dot ends no sentence");
  assert.deepEqual(one("always run the tests with NODE_ENV=test npm test"), [["npm test", "", "NODE_ENV=test"]], "a way with a setup arms its command (M5-D7)");
  // A wrapper Filament does not know is setup too, when a known command follows it (M5-D32); a way under a negation is the mistake.
  assert.deepEqual(one("never run the migrations with npm run migrate directly; always run them as dotenv -e .env.test npm run migrate."), [["npm run", "migrate", "dotenv -e .env.test"]]);
  assert.deepEqual(one("always run the migrations as dotenv -e .env.test npm run migrate"), [["npm run", "migrate", "dotenv -e .env.test"]]);
  assert.deepEqual(one("always run it as aws-vault exec prod -- terraform apply"), [["terraform apply", "", "aws-vault exec prod --"]]);
  assert.deepEqual(one("don't use jest directly; run it with npx jest"), [["jest", "", "npx"]]);
  assert.deepEqual(one("Don't run terraform bare; use aws-vault exec prod -- terraform"), [["terraform", "", "aws-vault exec prod --"]], "a word of prose ends the command it follows");
  assert.deepEqual(one("never run cargo alone"), [["cargo", "", null]]);
  assert.deepEqual(one("never run pytest bare; run it as `source .venv/bin/activate && pytest`"), [["pytest", "", "source .venv/bin/activate"]], "the commands a way runs before it");
  assert.deepEqual(one("Never run `git push --force`; don't run `git push --tags` either."), [["git push", "--force", null], ["git push", "--tags", null]], "two mistakes of one shape");
  assert.deepEqual(one("Never run npm test bare: run env -u CLAUDECODE npm test instead."), [["npm test", "", "env -u CLAUDECODE"]], "a way said before instead");
  assert.deepEqual(one("Don't run npm test bare. Run env -u CLAUDECODE npm test instead."), [["npm test", "", "env -u CLAUDECODE"]], "a sentence's period ends the mistake, not the way after it");
  assert.deepEqual(one("Don't run npm test bare. Run DOTENV_CONFIG_PATH=.env.test npm test instead."), [["npm test", "", "DOTENV_CONFIG_PATH=.env.test"]], "a period inside a word ends nothing");
  // The way after a colon or in the next sentence, as an owner says it (M6-7): with no unless, the reminder fired on the
  // right way too and could never be followed.
  assert.deepEqual(one("Don't run npm test bare: use env -u CLAUDECODE npm test, or the runner hangs on the CLAUDECODE variable."), [["npm test", "", "env -u CLAUDECODE"]], "a way after a colon");
  assert.deepEqual(one("Don't run npm test bare. Use env -u CLAUDECODE npm test."), [["npm test", "", "env -u CLAUDECODE"]], "a way in the next sentence");
  for (const quiet of ["don't use the open source version", "this is not related to git", "the api does not run on port 80", "Never commit generated files", "always use pnpm", "remember that src/config.js exports loadConfig", "run npm test before every commit", "always run the linter with eslint --fix", "always use our deploy tool to start the server", "always use git commit -m", "Always use dark mode code samples in screenshots", "Never commit the lockfile. Use git status to see what changed.", "Note: use npm ci in CI"])
    assert.deepEqual(pitfallsOf(quiet), [], quiet);
});

test("a claim filed by the person, a remember or the learner is armed from its words; a thread is not; a delete takes its triggers", async () => {
  await world({}, async (w) => {
    const { sit, prep } = await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const projectId = sit.project.id;
    const corrected = w.svc.archive.items.standing(projectId).find((/** @type {any} */ it) => it.text === MD14_RULE);
    assert.deepEqual(w.svc.archive.triggers.of(corrected.id).map((/** @type {any} */ t) => [t.shape, t.unless]), [["npm test", "env -u CLAUDECODE"]]);
    const said = (await w.svc.brain.remember("never run git push --force on main", { kind: "rule", projectId, by: "person" })).itemId;
    assert.deepEqual(w.svc.archive.triggers.of(said).map((/** @type {any} */ t) => t.shape), ["git push"]);
    const learned = await w.svc.brain.fileLearned({ projectId, chainId: "l1", kind: "convention", text: "stop using yarn here, use pnpm instead", importance: 0.7 });
    assert.deepEqual(w.svc.archive.triggers.of(learned.id).map((/** @type {any} */ t) => t.shape), ["yarn"]);
    const thread = await w.svc.brain.fileLearned({ projectId, chainId: "l2", kind: "thread", text: "don't run npm publish until the release notes are done", importance: 0.7 });
    assert.deepEqual(w.svc.archive.triggers.of(thread.id), []);
    w.svc.archive.deleteChain(prep.chain);
    assert.deepEqual(w.svc.archive.triggers.of(corrected.id), [], "an owner's delete takes the claim's whole record");
    assert.equal(w.svc.archive.db.prepare("SELECT COUNT(*) AS n FROM item_triggers WHERE item_id = ?").get(corrected.id).n, 0);
  });
});

// ---- M5-3: when a pitfall fires ----
test("a pitfall fires on its call: the user's word at once, a learned one once another session said it; the right way is not reminded", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const projectId = sit.project.id;
    const fire = (/** @type {string} */ chainId, /** @type {string} */ command, tool = "Bash") => w.svc.brain.pitfallsFor({ projectId, chainId, turnId: 7, tool, input: { command } });
    const [hit] = fire("b", "npm test");
    assert.match(hit?.line ?? "", /^\[memory i\d+ · user said\] don't run npm test directly .* env -u CLAUDECODE npm test$/);
    assert.deepEqual(fire("b", "cd C:\\evals && env -u CLAUDECODE npm test"), [], "the right way");
    assert.equal(fire("b", "npm test -- --grep slow").length, 1, "a trigger with a right way fires on every miss (M5-D3)");
    assert.equal(fire("b", "npm test", "powershell").length, 1, "whichever shell runs it");
    assert.deepEqual(fire("b", "npm install"), [], "another subcommand is another shape");
    const id = Number(hit.id.slice(1));
    assert.deepEqual(
      w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === "fired").map((/** @type {any} */ e) => [e.by, e.detail]),
      [
        ["filament", { chain: "b", turn: 7, shape: "npm test", unless: "env -u CLAUDECODE" }],
        ["filament", { chain: "b", turn: 7, shape: "npm test", unless: "env -u CLAUDECODE" }],
        ["filament", { chain: "b", turn: 7, shape: "npm test", unless: "env -u CLAUDECODE" }],
      ],
      "each firing is recorded",
    );
    // A learned pitfall waits for a second session (M5-D2); one with no right way fires once a session.
    await w.svc.brain.fileLearned({ projectId, chainId: "l1", kind: "convention", text: "stop using yarn in this repo", importance: 0.7 });
    assert.deepEqual(fire("b", "yarn install"), [], "unarmed: one session said it");
    await w.svc.brain.fileLearned({ projectId, chainId: "l2", kind: "convention", text: "stop using yarn in this repo", importance: 0.7 });
    const [yarn] = fire("b", "yarn install");
    assert.match(yarn?.line ?? "", /^\[memory i\d+ · inferred\] stop using yarn in this repo$/);
    assert.deepEqual(fire("b", "yarn add left-pad"), [], "once a session");
    assert.equal(fire("c", "yarn add left-pad").length, 1, "and again in the next");
    // Another project's pitfall is not this one's; a global one is everyone's; a retired one is nobody's.
    await w.svc.brain.remember("never run docker compose down -v", { kind: "rule", projectId: "elsewhere", by: "person" });
    assert.deepEqual(fire("b", "docker compose down"), []);
    await w.svc.brain.remember("never run docker system prune", { kind: "rule", projectId: null, by: "person" });
    assert.equal(fire("b", "docker system prune -a").length, 1);
    await w.svc.brain.forget(yarn.id, { by: "person" });
    assert.deepEqual(fire("d", "yarn install"), []);
    // A trigger keeps the words that make a call the mistaken one (M5-D31): a plain push is no forced one, and another
    // script is no migration.
    const push = (await w.svc.brain.remember("no, never run git push --force; use git push --force-with-lease instead.", { kind: "rule", projectId, by: "person" })).itemId;
    assert.deepEqual(fire("e", "git push origin main"), []);
    assert.deepEqual(fire("e", "git push --force-with-lease origin main"), [], "the right way");
    assert.equal(fire("e", "git fetch && git push origin main --force").length, 1, "its words anywhere after the shape");
    assert.deepEqual(
      w.svc.archive.items.events(push).filter((/** @type {any} */ e) => e.action === "fired").map((/** @type {any} */ e) => e.detail),
      [{ chain: "e", turn: 7, shape: "git push", args: "--force", unless: "--force-with-lease" }],
    );
    await w.svc.brain.remember("never run the migrations with npm run migrate directly; always run them as dotenv -e .env.test npm run migrate.", { kind: "rule", projectId, by: "person" });
    assert.deepEqual(fire("e", "npm run build"), [], "another script");
    assert.equal(fire("e", "npm run migrate -- --seed").length, 1);
    assert.deepEqual(fire("e", "dotenv -e .env.test npm run migrate"), [], "under a wrapper Filament does not know (M5-D32)");
  });
});

test("a pitfall held back by its files, or one memory is no longer sure of, does not fire", () =>
  (async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-pitfall-"));
    try {
      mkdirSync(join(dir, "scripts"));
      writeFileSync(join(dir, "scripts", "seed.js"), "console.log('seed')\n");
      await world({ cwd: dir }, async (w) => {
        const { sit } = await w.session("a").send("hello");
        const projectId = sit.project.id;
        const fire = (/** @type {string} */ chainId, /** @type {string} */ command) => w.svc.brain.pitfallsFor({ projectId, chainId, tool: "bash", input: { command } });
        const seeded = (await w.svc.brain.remember("never run psql against prod; seed with scripts/seed.js instead", { kind: "rule", projectId, by: "person" })).itemId;
        assert.equal(fire("b", "psql -h prod").length, 1);
        rmSync(join(dir, "scripts", "seed.js"));
        assert.deepEqual(fire("c", "psql -h prod"), [], "its file is gone: held back, as recall holds it (M3-3)");
        writeFileSync(join(dir, "scripts", "seed.js"), "console.log('seed')\n");
        assert.equal(fire("d", "psql -h prod").length, 1, "back with its file");
        const learned = await w.svc.brain.fileLearned({ projectId, chainId: "l1", kind: "convention", text: "stop using yarn in this repo", importance: 0.7 });
        await w.svc.brain.fileLearned({ projectId, chainId: "l2", kind: "convention", text: "stop using yarn in this repo", importance: 0.7 });
        assert.equal(fire("e", "yarn install").length, 1);
        for (const chain of ["x", "y"]) w.svc.archive.items.note(learned.id, "suspected", { by: "person", detail: { chain } });
        assert.deepEqual(fire("f", "yarn install"), [], "two corrections pointed at it: under the confidence gate");
        assert.ok(seeded);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })());

test("on a proxy client's tool-result leg the pitfall rides on the result once, placed again byte for byte on a resend", async () => {
  await world({}, async (w) => {
    await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const H = { "user-agent": "codex_cli_rs/0.40.0", "x-session-id": "oa-pit" };
    const U = { role: "user", content: "run the tests" };
    const A1 = { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "npm test"] }) } }] };
    const T1 = { role: "tool", tool_call_id: "c1", content: "4 failing" };
    const body = (/** @type {any[]} */ messages) => ({ format: "openai", body: { model: "gpt-x", messages: [{ role: "system", content: "You are Codex.\nWorking directory: C:\\evals" }, ...structuredClone(messages)] }, headers: H, model: "gpt-x" });
    await w.svc.prepare(w.svc.situate(body([U])), { requestId: "oa-1" });
    const leg = body([U, A1, T1]);
    const p = await w.svc.prepare(w.svc.situate(leg), { requestId: "oa-2" });
    assert.equal(p.pitfalls, 1, p.notes.join(" | "));
    const sent = JSON.stringify(leg.body.messages.at(-1));
    assert.match(sent, /Memory on the tool call the model just made \(Filament\):\\n- \[memory i\d+ · user said\]/);
    assert.deepEqual(w.svc.archive.injections.forRequest("oa-2").map((/** @type {any} */ r) => r.kind), ["pitfall"]);
    const id = Number(/\[memory i(\d+)/.exec(sent)?.[1]);
    const fired = () => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === "fired").length;
    assert.equal(fired(), 1);
    // The next request resends the leg: the same block, byte for byte, and no second firing.
    const A2 = { role: "assistant", content: "Fixed." };
    const next = body([U, A1, T1, A2, { role: "user", content: "thanks" }]);
    await w.svc.prepare(w.svc.situate(next), { requestId: "oa-3" });
    assert.equal(JSON.stringify(next.body.messages[3]), sent);
    assert.equal(fired(), 1);
    // A quiet request (a loop's own round) gets nothing: the loop attaches its own (M5-D4).
    const quiet = { ...body([U, A1, T1]), headers: { ...H, "x-session-id": "oa-quiet", "x-filament-memory": "off" } };
    const q = await w.svc.prepare(w.svc.situate(quiet), { requestId: "oa-4" });
    assert.equal(q.pitfalls, undefined);
    assert.equal(fired(), 1);
  });
});

// (fails before: yes — proxy-twice: a Claude Code Filament launched, its model calls sent back through Filament's door by
// the person's own settings, got on its tool result the pitfall its turn had said already, fired a second time, memory's
// tools and briefing beside it)
test("a call that asks Filament to add nothing gets none of memory's work — no pitfall, no firing, no turn; the same leg unmarked gets it all", async () => {
  await world({}, async (w) => {
    await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const H = { ...CC_UA, "x-session-id": "cc-pit" };
    const U = { role: "user", content: "run the tests" };
    const A1 = { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "npm test" } }] };
    const T1 = { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "4 failing" }] };
    const leg = (/** @type {Record<string, string>} */ headers) => ({ format: "anthropic", body: { model: "claude-x", system: "You are Claude Code.\nWorking directory: C:\\evals", messages: structuredClone([U, A1, T1]) }, headers, model: "claude-x" });
    const marked = leg({ ...H, "x-filament-adds": "None " });
    assert.equal(w.svc.situate(marked), null, "memory stays out");
    assert.deepEqual(marked.body.messages, [U, A1, T1], "nothing written into it");
    // Unmarked, the same leg is a proxy client's: the pitfall rides and fires — the double the marker keeps out.
    const first = leg(H);
    first.body.messages = [U];
    await w.svc.prepare(w.svc.situate(first), { requestId: "cc-1" });
    const unmarked = leg(H);
    const p = await w.svc.prepare(w.svc.situate(unmarked), { requestId: "cc-2" });
    assert.equal(p.pitfalls, 1, p.notes.join(" | "));
    const id = Number(/\[memory i(\d+)/.exec(JSON.stringify(unmarked.body.messages.at(-1)))?.[1]);
    assert.equal(w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === "fired").length, 1, "fired by the unmarked leg alone");
  });
});

test("rules that act still ride with a pitfall: an opted-in rule with no trigger, matched by its words, after the pitfalls; a pitfall listed too rides once", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const projectId = sit.project.id;
    const act = w.svc.archive.items.add({ projectId, kind: "rule", text: "Every npm test run here prints a coverage table: read it before reporting.", status: "confirmed", origin: "person", importance: 0.9 });
    // The pitfall is listed to act as well, and its words match the call too: it rides once, as the pitfall.
    const said = w.svc.archive.items.standing(projectId).find((/** @type {any} */ it) => it.text === MD14_RULE);
    w.cfg.memory.rules = { act: [`i${act.id}`, `i${said.id}`] };
    const leg = {
      format: "anthropic",
      body: {
        model: "claude-x",
        system: "You are Claude Code.\n<env>\nWorking directory: C:\\evals\nIs a git repo: yes\n</env>",
        messages: [
          { role: "user", content: "run the tests in this repo" },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test -- --coverage" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "coverage table" }] },
        ],
      },
      headers: { ...CC_UA, "x-session-id": "acting" },
      model: "claude-x",
    };
    const p = await w.svc.prepare(w.svc.situate(leg), { requestId: "act-1" });
    assert.deepEqual([p.pitfalls, p.rules], [1, 1], p.notes.join(" | "));
    const text = JSON.stringify(leg.body.messages.at(-1)?.content);
    assert.ok(text.indexOf("Memory on the tool call") < text.indexOf("Rules from memory that apply"), text);
    delete w.cfg.memory.rules;
  });
});

test("a claim a call walks into by two of its triggers rides once, fired once", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const rule = w.svc.archive.items.add({ projectId, kind: "rule", text: "Run the checks here with env -u CLAUDECODE: npm test and npm run lint both read it.", status: "confirmed", origin: "person", importance: 0.9 });
    w.svc.archive.triggers.set(rule.id, "words", [
      { tool: "bash", shape: "npm test", unless: "env -u CLAUDECODE" },
      { tool: "bash", shape: "npm run", args: "lint", unless: "env -u CLAUDECODE" },
    ]);
    const hits = w.svc.brain.pitfallsFor({ projectId, chainId: "b", turnId: 2, tool: "Bash", input: { command: "npm test && npm run lint" } });
    assert.deepEqual(hits.map((/** @type {any} */ h) => h.id), [`i${rule.id}`]);
    assert.equal(w.svc.archive.items.events(rule.id).filter((/** @type {any} */ e) => e.action === "fired").length, 1);
  });
});
