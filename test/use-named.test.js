// @ts-check
// HarnessV4_OneAgent_Plan OA2 (L27, L48): an agent or a team named with an `@` past a message's start starts nothing at
// Send — the main agent gets the message with Filament's line telling it to use them, through Filament's agent and team
// tools, when the work is ready for them ("there should be a process mid way instead of it immediately going to tagged
// agent"). The line over the box says "For your agent to use"; the turn says whom it named and its main agent did not
// use; an `@word` past the start that names nobody is held once (OA-D11). A message that starts with tags stays the
// agents' own (test/agents-ask-ui.test.js); the Sub Agents tab still starts one at once (test/agents-api.test.js).
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { useLine } from "../src/core/messages.js";
import { addressed, askDraft, teamAddressed, teamUsesIn, unknownTagsPast, usesIn } from "../src/ui/harness/lib/agent-cards.js";
import { createAskLine, useLineWords } from "../src/ui/harness/composer/ask-line.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { createSlashPanel } from "../src/ui/harness/composer/slash.js";
import { deliveredWords, markNamed, unusedEl, useEl, userRow } from "../src/ui/harness/conversation/turn.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { OWN_CARDS, saveOwnCards } from "./helpers/flow-cards.js";

const store = createAgentCardStore({ dataDir: null });
// The person's own cards named here, beside the ones that ship (helpers/flow-cards.js).
saveOwnCards(store);
const cards = () => store.list().filter((c) => !c.partOf);
/** @param {string} tag @returns {any} */
const card = (tag) => store.find(tag);
/** @param {string} text */
const tagsIn = (text) => usesIn(text, cards()).map((c) => c.tag);
const MESSAGE = "Fix the parser, and @skeptic check my plan first.";
const SKEPTIC = { tag: "skeptic", name: "Skeptic" };
const HUNTER = { key: "bughunters", name: "BugHunters" };
const TEAMS = [HUNTER, { key: "builders", name: "Builders" }, { key: "skeptic", name: "A team that took an agent's tag" }];
/** @param {string} text */
const teamsIn = (text) => teamUsesIn(text, cards(), TEAMS).map((t) => t.key);
/** What the line knows of a session. @param {any} [o] @returns {import("../src/ui/harness/composer/ask-line.js").AskFacts} */
const facts = (o = {}) => ({ defaultModel: "zai/glm-5.3", tokens: { none: 0, folded: 38_000, window: 90_000 }, running: false, runningTokens: 0, limit: { max: 4, running: 0 }, refusedPictures: () => false, families: [], ...o });
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

describe("whom a message names for the main agent to use", () => {
  test("a saved agent's tag past the message's start, each once, in the message's order, in any case; a sentence's stop after it", () => {
    assert.deepEqual(tagsIn("Fix the parser, and @skeptic check my plan. @PM too, and @skeptic again."), ["skeptic", "pm"]);
    assert.deepEqual(tagsIn("is this right (@designer)?"), ["designer"]);
    assert.deepEqual(tagsIn("first line\n@skeptic: is it sound?"), ["skeptic"]);
  });

  // (fails before: yes — the copies hunt of 10-23: the line promised Explainer, and the registry never told the agent;
  // then the owner's word of 11-05: Explainer and Watcher ship no more)
  test("Explainer and Watcher name nobody: held as any tag no card holds", () => {
    assert.deepEqual(tagsIn("fix it, then @explainer and @watcher, and @skeptic"), ["skeptic"]);
    assert.deepEqual(unknownTagsPast("fix it, then @explainer", cards(), TEAMS), ["explainer"], "held as nobody's");
  });

  // Case 12: `@x` inside code or a path is never a tag.
  test("never in a message that is the agents' own, a command, a tag no card holds, an address, a path or code", () => {
    assert.deepEqual(tagsIn("@pm should we? ask @skeptic too"), [], "a message that starts with tags is theirs");
    assert.deepEqual(tagsIn("/btw what would @skeptic say"), [], "a command");
    assert.deepEqual(tagsIn("ask @nobody about it"), []);
    assert.deepEqual(tagsIn("mail ops@pm.dev about it"), [], "an address");
    assert.deepEqual(tagsIn("read @pm/notes.md and @skeptic.md"), [], "paths");
    assert.deepEqual(tagsIn("the decorator `@designer` and\n```\n@pm\n```\nnothing"), [], "code");
    assert.deepEqual(tagsIn(""), []);
  });

  test("a team's key past the message's start, each once, in order — the team's, where an agent's tag holds the same word", () => {
    assert.deepEqual(teamsIn("Ship it, and @bughunters look over the lexer. @Builders then, and @bughunters again."), ["bughunters", "builders"]);
    assert.deepEqual(teamsIn("and @skeptic too"), ["skeptic"], "a team's key is the team's");
    assert.deepEqual(usesIn("and @skeptic too", cards(), TEAMS), [], "and not the agent's of the same tag");
    assert.deepEqual(tagsIn("and @skeptic too"), ["skeptic"], "with no team of that key, the agent's");
    assert.deepEqual(teamUsesIn("then @10x-engineer builds it", cards(), [{ key: "10x-engineer", name: "10x Engineer" }]).map((t) => t.key), ["10x-engineer"], "a key that starts with a digit");
    for (const text of ["@pm should we? and @bughunters", "/btw @bughunters", "mail ops@bughunters.dev", "read @bughunters/notes.md", "the `@bughunters` key", ""]) assert.deepEqual(teamsIn(text), [], text);
  });

  // (fails before: yes — L8, the fourth bug of 10-21: an unknown `@tag` mid-message was the message's words, unwarned)
  test("the @words past the start that name no agent and no team: each once, as typed — none in code, a path, an address or a command", () => {
    assert.deepEqual(unknownTagsPast("fix the login, then @QA verify it, and @skeptic, and @qa again", cards(), TEAMS), ["QA"]);
    assert.deepEqual(unknownTagsPast("and @bughunters and @pm", cards(), TEAMS), [], "a team's key and an agent's tag name someone");
    for (const text of ["@qa should we?", "/btw @qa", "mail ops@qa.dev", "read @qa/notes.md", "the `@qa` key", "@pm and @qa", ""]) assert.deepEqual(unknownTagsPast(text, cards(), TEAMS), [], text);
  });

  // Case 9: `@team-key …` at the start opens its Brief, unchanged.
  test("a draft that opens with a team's key is the team's, its ask the rest; a card of the same tag set aside", () => {
    const t = teamAddressed("@BugHunters, look over the lexer", TEAMS);
    assert.deepEqual([t?.team.key, t?.ask], ["bughunters", "look over the lexer"]);
    assert.equal(teamAddressed("  @skeptic is it sound?", TEAMS)?.team.key, "skeptic");
    for (const text of ["@bughunterss look", "@bughunters/notes.md", "look @bughunters", "/btw @bughunters", "@pm @bughunters look", ""]) assert.equal(teamAddressed(text, TEAMS), null, text);
    const pm = addressed("@pm @bughunters look", cards(), TEAMS);
    assert.deepEqual([pm.to.map((c) => c.tag), pm.question], [["pm"], "@bughunters look"], "a team's key ends the leading tags: what follows is the question");
  });

  test("Ask an agent: an @ at the draft's start, or after the tags that already address agents, so it stays theirs", () => {
    assert.deepEqual(askDraft("  fix the parser", false), { value: "@ fix the parser", caret: 1 });
    assert.deepEqual(askDraft("@pm should a fifth launch queue?", true), { value: "@pm @ should a fifth launch queue?", caret: 5 });
  });
});

describe("Filament's line to the main agent", () => {
  // (fails before: yes — L27: a tag past the start asked the agent at Send, or started the team on the side)
  test("it says whom, that nothing has started, and which tool starts each — or that the tool is off", () => {
    assert.equal(useLine([SKEPTIC]), "[Filament: the developer wants you to use Skeptic (@skeptic) here, named with @ in this message. Nothing has started: launch the agent with Filament's agent tool (saved_agent \"skeptic\") when the work is ready for it, and say in your answer if you do not.]");
    assert.equal(useLine([HUNTER], { note: true }), "[Filament: the developer wants you to use the BugHunters team (@bughunters) here, named with @ in the message they just sent you. Nothing has started: send the team with Filament's team tool (action \"send\", team \"bughunters\") when the work is ready for it, and say in your answer if you do not.]");
    assert.equal(useLine([SKEPTIC, { tag: "pm", name: "PM" }, HUNTER]), "[Filament: the developer wants you to use Skeptic (@skeptic), PM (@pm) and the BugHunters team (@bughunters) here, named with @ in this message. Nothing has started: launch each agent with Filament's agent tool (saved_agent \"skeptic\" and \"pm\"); send the team with Filament's team tool (action \"send\", team \"bughunters\") when the work is ready for them, and say in your answer if you do not.]");
    assert.equal(useLine([SKEPTIC], { off: { agent: true } }), "[Filament: the developer wants you to use Skeptic (@skeptic) here, named with @ in this message. Nothing has started: Filament's agent tool is off in this chat, so you cannot launch that agent, and say so in your answer.]");
    assert.match(useLine([HUNTER], { off: { team: true } }), /Filament's team tool is off in this chat, so you cannot send that team, and say so in your answer\.\]$/);
  });

  test("the registry: each card once, in order; a tag no card holds, or a team's own Lead's, is the message's words", () => {
    const registry = createSubagentRegistry({ config: () => ({ agentLoop: {} }), log: () => {}, events: { publish: () => {} }, runs: null, context: /** @type {any} */ ({ card: (/** @type {string} */ tag) => store.find(tag) }) });
    assert.deepEqual(registry.usesOf(["@Skeptic", "skeptic", "nobody", "", null, "pm"]), [SKEPTIC, { tag: "pm", name: "PM" }]);
    assert.deepEqual(registry.usesOf("skeptic"), []);
    const head = store.list().find((c) => c.partOf);
    assert.ok(head, "a team's own Lead ships");
    assert.deepEqual(registry.usesOf([head.tag]), [], "a team's Lead is no agent to name (OA-D4)");
    // (fails before: yes — the bug round of 10-23) A tag no card holds is never named to use.
    assert.deepEqual(registry.usesOf(["explainer", "watcher", "skeptic"]), [SKEPTIC]);
    assert.deepEqual([...registry.usedSince("c1", 0)], [], "nobody used in a chat that launched none");
  });
});

describe("the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  // Case 1. (fails before: yes — the line said "Also to Skeptic · … its answer comes back to your agent")
  test("the line over the box: For your agent to use, and nothing starts at Send — agents and teams alike", () => {
    assert.deepEqual(useLineWords([card("skeptic")], []), { who: "Skeptic", facts: ["nothing starts at Send"] });
    assert.equal(useLineWords([card("skeptic"), card("pm")], [HUNTER]).who, "Skeptic, PM and the BugHunters team");
    const line = createAskLine({ cards, facts: () => facts(), onPick: () => {}, teams: () => TEAMS.slice(0, 2) });
    line.paint(MESSAGE, []);
    assert.equal(line.el.className, "ask-line is-use");
    assert.equal(line.el.textContent, "For your agent to use: Skeptic · nothing starts at Send");
    assert.deepEqual(line.read(MESSAGE, []).to, [], "the message is the main agent's");
    line.paint("Ship it: @skeptic check the plan, @bughunters the lexer", [{ kind: "image" }]);
    assert.equal(line.el.textContent, "For your agent to use: Skeptic and the BugHunters team · nothing starts at Send");
    line.paint("Fix the parser.", []);
    assert.ok(line.el.classList.contains("hidden"));
  });

  // (fails before: yes — the copies hunt of 10-23: where no Brief could open, a new chat's first message, the line named
  // no team the message named)
  test("the line names a team the message names where no Brief can open", () => {
    const line = createAskLine({ cards, facts: () => facts(), onPick: () => {}, teams: () => [], uses: () => TEAMS.slice(0, 2) });
    line.paint("Ship it, then @bughunters the lexer", []);
    assert.equal(line.el.textContent, "For your agent to use: the BugHunters team · nothing starts at Send");
    assert.equal(teamAddressed("@bughunters look", []), null, "and a draft that opens with it opens no Brief");
  });

  // Case 4. (fails before: yes — the hold was for a first word only)
  test("a word past the start held: No agent is called @qa — pick one, or Enter again sends it as written", () => {
    /** @type {[string, string][]} */
    const picked = [];
    const line = createAskLine({ cards, facts: () => facts(), onPick: (word, tag) => picked.push([word, tag]) });
    line.hold("fix it and @qa verify", "qa", { later: true });
    line.paint("fix it and @qa verify", []);
    assert.equal(line.el.className, "ask-line is-held");
    assert.match(String(line.el.textContent), /^No agent is called @qa — pick one, or press Enter again to send it as written@/);
    /** @type {any[]} */ (line.el.querySelectorAll(".ask-pick"))[0].dispatch("click");
    assert.equal(picked.length, 1);
    assert.equal(line.passes("fix it and @qa verify"), true);
  });

  // L28. (fails before: yes — the list's head said "Agents to ask too", its sections that answers come back)
  test("the @ list later in a message: its head says For your agent to use; a pick writes the tag or the key, and opens no Brief", async () => {
    /** @type {string[]} */
    const inserted = [];
    const panel = createSlashPanel({
      onInsert: (text) => inserted.push(text),
      getCards: () => [/** @type {any} */ ({ tag: "skeptic", name: "Skeptic", goodFor: "What was not tested" })],
      getTeams: () => [{ key: "bughunters", name: "BugHunters", line: "Finds bugs and checks claims" }],
    });
    await panel.open("@", "", { use: true });
    await settle();
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "For your agent to use");
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent), ["Agents", "Teams"]);
    assert.equal(panel.el.querySelectorAll(".slash-row").length, 2, "Skeptic and the team: no Explainer");
    /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"))[1].dispatch("click");
    assert.deepEqual(inserted, ["@bughunters "]);
    await panel.open("@", "", { agents: true, use: true });
    await settle();
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent).slice(0, 2), ["Agents", "Send a team"], "at the start, as before");
    panel.close();
  });

  // Cases 1 and 3. (fails before: yes — the row said "asked Skeptic too", and no turn said one went unused)
  test("the message's row says whom, for your agent; the turn says whom it did not use; the line that named them is no agent's message", () => {
    assert.equal(deliveredWords({ deliveries: 2, asking: 1, use: [SKEPTIC] }), "");
    assert.equal(deliveredWords({ deliveries: 3, use: [SKEPTIC] }), "with 2 messages from agents");
    assert.equal(useEl({ use: [SKEPTIC, HUNTER] })?.textContent, "for your agent: Skeptic and the BugHunters team");
    assert.equal(useEl({}), null);
    assert.equal(unusedEl({ unused: [SKEPTIC] })?.textContent, "FilamentYou named @skeptic; it was not used");
    assert.equal(unusedEl({ unused: [SKEPTIC, { tag: "pm", name: "PM" }, HUNTER] })?.textContent, "FilamentYou named @skeptic, @pm and @bughunters; they were not used");
    assert.equal(unusedEl({ unused: [] }), null);
  });

  // (fails before: yes — found by the OA2 drive: the bubble drew `@skeptic` as a file's chip)
  test("the bubble draws an @word that named an agent or a team as theirs — with the row, and in place once the head names whom", () => {
    const text = "fix it, then @skeptic and @bughunters, and read @notes.md";
    const chips = (/** @type {any} */ row) => /** @type {any[]} */ (row.querySelectorAll(".ref-chip")).map((c) => [c.getAttribute("data-ref"), c.classList.contains("is-named")]);
    const cb = { onCopy: () => {}, onEdit: () => {} };
    assert.deepEqual(chips(userRow({ userText: text, use: [SKEPTIC, HUNTER] }, cb)), [["@skeptic", true], ["@bughunters", true], ["@notes.md", false]]);
    const live = /** @type {any} */ (userRow({ userText: text }, cb));
    assert.deepEqual(chips(live).map(([, named]) => named), [false, false, false], "drawn before the head: as typed");
    markNamed(live, { use: [SKEPTIC] });
    assert.deepEqual(chips(live), [["@skeptic", true], ["@bughunters", false], ["@notes.md", false]]);
    assert.equal(/** @type {any[]} */ (live.querySelectorAll(".ref-chip.is-named"))[0].getAttribute("title"), "Skeptic, named with @ for your agent to use");
  });
});

describe("the box holds an @word past the start that names nobody (OA-D11)", () => {
  const g = /** @type {any} */ (globalThis);
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Map<string, string>} */
  let kept;
  beforeEach(() => {
    doc = stubDocument();
    kept = new Map();
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v), removeItem: (/** @type {string} */ k) => kept.delete(k) };
  });
  afterEach(() => {
    delete g.localStorage;
    doc.restore();
  });
  /** The composer on the stub document. @param {Record<string, any>} [more] */
  const box = (more = {}) => {
    const host = /** @type {any} */ (doc.document.createElement("div"));
    /** @type {string[]} */
    const sent = [];
    createComposer(host, {
      onSend: (text) => { sent.push(text); return true; },
      onStop: () => {},
      getChat: () => ({ chainId: "c1", turns: [] }),
      onAsk: () => true,
      agentCards: () => cards(),
      teams: () => [HUNTER],
      ...more,
    });
    const ta = host.querySelector(".composer-input");
    /** @param {string} text */
    const press = (text) => {
      ta.value = text;
      ta.dispatch("keydown", { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, preventDefault: () => {} });
    };
    return { host, sent, press, line: () => String(host.querySelector(".ask-line")?.textContent || "") };
  };

  // Case 4.
  test("held once with the nearest names; Enter again sends it as written", async () => {
    const b = box();
    b.press("fix the login, then @qa verify it");
    await settle();
    assert.deepEqual(b.sent, []);
    assert.match(b.line(), /^No agent is called @qa — pick one, or press Enter again to send it as written/);
    b.press("fix the login, then @qa verify it");
    await settle();
    assert.deepEqual(b.sent, ["fix the login, then @qa verify it"]);
  });

  test("an agent's tag, a team's key, a file of the project, Filament's own @mem, a path or code goes at once", async () => {
    const b = box({ isFile: async (/** @type {string} */ w) => w === "Makefile" });
    // One at a time: a file is looked up before the draft goes, and the draft must still stand when the answer comes.
    for (const text of ["fix it, then @skeptic check it", "fix it, then @bughunters look", "read @Makefile first", "fix it and @mem load s1", "read @src/app.js", "the `@qa` decorator"]) {
      b.press(text);
      await settle();
    }
    assert.deepEqual(b.sent, ["fix it, then @skeptic check it", "fix it, then @bughunters look", "read @Makefile first", "fix it and @mem load s1", "read @src/app.js", "the `@qa` decorator"]);
  });

  // (fails before: yes — the copies hunt of 10-23) A box where no Brief opens — no session yet — still names the team.
  test("a team named past the start shows on the line where no Brief can open", async () => {
    const b = box({ getChat: () => ({ chainId: null, turns: [] }) });
    const ta = b.host.querySelector(".composer-input");
    ta.value = "fix it, then @bughunters look";
    ta.dispatch("input");
    await settle();
    assert.equal(b.line(), "For your agent to use: the BugHunters team · nothing starts at Send");
  });
});

describe("through the app", () => {
  /** @type {string} */ let folder;
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {() => void} */
  let release = () => {};
  /** @type {Promise<void>} */
  let gate = Promise.resolve();
  /** Who a request answers as: a saved agent's name; null for the main agent's. @param {any} c */
  const asWhom = (c) => (/You answer as ([^.]+)\./.exec(JSON.stringify(c.body?.system ?? "")) || [])[1] || null;
  /** The text blocks of a request's newest message. @param {any} c @returns {string[]} */
  const wordsIn = (c) => {
    const m = c.body?.messages?.at(-1);
    return typeof m?.content === "string" ? [m.content] : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text);
  };
  /** Everything a request's newest message says, its tool results with it. @param {any} c */
  const allIn = (c) => JSON.stringify(c.body?.messages?.at(-1)?.content ?? "");
  const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
  const newSession = async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    return String((await s.json()).id);
  };
  /** The main agent's requests since a mark. @param {number} mark */
  const mainSince = (mark) => up.received.slice(mark).filter((/** @type {any} */ c) => !asWhom(c) && !allIn(c).includes("<main-chat") && Array.isArray(c.body?.tools) && c.body.tools.length);
  const lastTurn = async (/** @type {string} */ id) => (await (await shim.api(at(id, "/transcript"))).json()).turns.at(-1);
  /** A turn, sent as the page sends it. @param {string} id @param {any} body */
  const send = async (id, body) => {
    const r = await shim.api(at(id, "/turns"), { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-use-"));
    writeFileSync(join(folder, "notes.txt"), "hello\n");
    up = await fakeUpstream(async (call) => {
      const model = String(call.body?.model || "");
      const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 50, output_tokens: 7 } });
      const who = asWhom(call);
      if (who) return blocks([{ type: "text", text: `${who} SAYS the fix holds.` }]);
      const said = allIn(call);
      // A team's lead, its first message the main chat's record: its hunt, at once.
      if (said.includes("<main-chat")) return blocks([{ type: "text", text: "HUNT DONE: lexer.js:4 reads past the end." }]);
      if (said.includes("toolu_hold")) {
        await gate;
        return blocks([{ type: "text", text: "HELD AND GONE ON" }]);
      }
      if (said.includes("tool_result")) return blocks([{ type: "text", text: "MAIN DONE" }]);
      const words = wordsIn(call).join("\n");
      if (/launch skeptic/.test(words)) return blocks([{ type: "tool_use", id: "toolu_sk", name: "agent", input: { run_in_background: false, saved_agent: "skeptic", description: "check the fix", prompt: "Check the parser fix." } }], "tool_use");
      if (/fire hunter/.test(words)) return blocks([{ type: "tool_use", id: "toolu_team", name: "team", input: { action: "send", team: "bughunters", ask: "Look over the lexer." } }], "tool_use");
      // Builders, by words that do not name it: a name in the message would let the agent fire it.
      if (/\(go m\)/.test(words)) return blocks([{ type: "tool_use", id: "toolu_team", name: "team", input: { action: "send", team: "builders", ask: "Build the lexer fix." } }], "tool_use");
      if (/\(how stand\)/.test(words)) return blocks([{ type: "tool_use", id: "toolu_status", name: "team", input: { action: "status" } }], "tool_use");
      if (/work then hold/.test(words)) return blocks([{ type: "tool_use", id: "toolu_hold", name: "read", input: { path: "notes.txt" } }], "tool_use");
      return blocks([{ type: "text", text: "MAIN HEARD" }]);
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
    for (const c of OWN_CARDS) assert.equal((await shim.api("/api/agents", { method: "POST", body: c })).status, 200, c.tag);
  });
  after(async () => {
    release();
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, folder]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  // Cases 1 and 3. (fails before: yes — Skeptic was asked the message at Send, and the turn waited for its answer)
  test("a message that names Skeptic: nothing starts, the main agent reads Filament's line ahead of the words, and the turn says Skeptic was not used", async () => {
    const id = await newSession();
    const mark = up.received.length;
    const r = await send(id, { content: MESSAGE, use: ["skeptic", "nobody"] });
    assert.deepEqual([r.headers.get("x-filament-use"), r.headers.get("x-filament-deliveries"), r.headers.get("x-filament-along")], ["1", "1", null]);
    assert.equal(up.received.slice(mark).filter((/** @type {any} */ c) => asWhom(c)).length, 0, "nobody else was asked");
    assert.deepEqual(wordsIn(mainSince(mark)[0]), [useLine([SKEPTIC], { off: { agent: false, team: false } }), MESSAGE]);
    const t = await lastTurn(id);
    assert.deepEqual([t.use, t.unused, t.deliveries, t.user.content.length], [[SKEPTIC], [SKEPTIC], 1, 2], "its row names whom, and whom it did not use; the page draws the typed words alone");
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    assert.deepEqual(subagents, []);
  });

  // Case 2. (fails before: yes — there was no line, and a turn never said whom it did not use)
  test("the main agent launches Skeptic with its agent tool: the turn names nobody unused", async () => {
    const id = await newSession();
    const mark = up.received.length;
    await send(id, { content: "Fix the parser, then @skeptic check it (launch skeptic).", use: ["skeptic"] });
    assert.equal(up.received.slice(mark).filter((/** @type {any} */ c) => asWhom(c) === "Skeptic").length, 1, "the main agent launched it");
    const t = await lastTurn(id);
    assert.deepEqual([t.use, t.unused], [[SKEPTIC], []]);
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    assert.deepEqual(subagents.map((/** @type {any} */ s) => [s.card.tag, s.origin, s.exchanges[0].by]), [["skeptic", "agent", "agent"]]);
  });

  test("a command, or a message that names no card, names nobody", async () => {
    const id = await newSession();
    const cmd = await send(id, { content: "/settings", use: ["skeptic"] });
    assert.equal(cmd.headers.get("x-filament-use"), null);
    const plain = await send(id, { content: "say hello", use: ["nobody"] });
    assert.deepEqual([plain.headers.get("x-filament-use"), plain.headers.get("x-filament-deliveries")], [null, null]);
    const t = await lastTurn(id);
    assert.deepEqual([t.use, t.unused], [undefined, undefined]);
  });

  /** The teams beside a chat, once there are `n`. @param {string} id @param {number} n */
  const besideOf = (id, n) =>
    until(async () => {
      const { teams } = await (await shim.api(at(id, "/beside"))).json();
      return (teams || []).length === n ? teams : null;
    }, "the teams beside the chat", { timeoutMs: 20_000 });

  // Case 5. (fails before: yes — the team started on the side at Send, fired by the developer)
  test("a message that names a team: nothing starts at Send; the main agent may fire it, and does — fired by the agent, used", async () => {
    const id = await newSession();
    const mark = up.received.length;
    const words = "Ship it, and @bughunters look over the lexer (fire hunter)";
    const r = await send(id, { content: words, useTeams: ["bughunters", "nobody"] });
    assert.deepEqual([r.headers.get("x-filament-use"), r.headers.get("x-filament-deliveries")], ["1", "1"]);
    const main = mainSince(mark);
    assert.deepEqual(wordsIn(main[0]), [useLine([HUNTER]), words]);
    assert.ok(main.map(allIn).some((s) => s.includes("BugHunters started beside this chat")), main.map(allIn).join("\n"));
    const teams = await besideOf(id, 1);
    assert.deepEqual(teams.map((/** @type {any} */ t) => [t.team.key, t.firedBy]), [["bughunters", "agent"]]);
    const t = await lastTurn(id);
    assert.deepEqual([t.use, t.unused], [[HUNTER], []]);
    // A team's own chat starts none — once its lead's turn is over.
    await until(async () => {
      const { teams: now } = await (await shim.api(at(id, "/beside"))).json();
      return now?.[0] && now[0].state !== "working" && now[0].state !== "asking" ? now : null;
    }, "the team's lead to end", { timeoutMs: 20_000 });
    const own = await send(teams[0].id, { content: "and @bughunters again", useTeams: ["bughunters"] });
    assert.equal(own.headers.get("x-filament-use"), null);
  });

  // (fails before: yes — OA2's "plain names = may; teams the same": a team the message names was not the agent's to fire)
  test("a team the chat does not let its agent fire, and the message does not name, is refused; one it names in plain words is its to fire", async () => {
    const id = await newSession();
    const mark = up.received.length;
    await send(id, { content: "Build it (go m)" });
    assert.ok(mainSince(mark).map(allIn).some((s) => s.includes("Not sent: the Builders team is not one this chat lets you send by yourself")), "refused, in words");
    assert.equal((await (await shim.api(at(id, "/beside"))).json()).teams.length, 0);
    // The tool's status says so as the fire reads it.
    const mark2 = up.received.length;
    // (the plan's p6) Builders, the one shipped team that builds.
    await send(id, { content: "Is the Builders team one to start? (how stand)" });
    const status = mainSince(mark2).map(allIn).find((s) => s.includes("Teams you can send")) || "";
    assert.match(status, /Teams you can send:\\n[^]*`builders` Builders/, status);
    assert.doesNotMatch(status, /Teams only the person sends/, "named in plain words, it joins the one the chat lets its agent fire: no team is left the person's alone");
    await send(id, { content: "Build it, and ask the Builders team to do it (go m)" });
    assert.deepEqual((await besideOf(id, 1)).map((/** @type {any} */ t) => t.firedBy), ["agent"]);
    assert.equal((await lastTurn(id)).unused, undefined, "named in plain words: no line about it");
  });

  // Case 6. (fails before: yes — a note's tag asked the agent at once)
  test("a note into a running turn that names Skeptic: the turn reads the line beside the note, nothing starts, and its end says Skeptic was not used", async () => {
    const id = await newSession();
    gate = new Promise((r) => (release = () => r()));
    const mark = up.received.length;
    const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
    try {
      await until(() => mainSince(mark).some((/** @type {any} */ c) => allIn(c).includes("toolu_hold")), "the turn's second round to be in flight");
      const { runs } = await (await shim.api("/api/runs?limit=50")).json();
      const live = runs.find((/** @type {any} */ x) => x.status === "running" && x.kind !== "subagent");
      assert.ok(live, JSON.stringify(runs.map((/** @type {any} */ x) => [x.id, x.kind, x.status])));
      const steer = await shim.api(`/api/runs/${encodeURIComponent(live.id)}/steer`, { method: "POST", body: { kind: "note", text: "and @skeptic, is it sound?", from: "harness", use: ["skeptic"] } });
      assert.equal(steer.status, 200, await steer.clone().text());
      const out = await steer.json();
      assert.deepEqual([out.use, out.along], [["Skeptic"], undefined]);
    } finally {
      release();
    }
    assert.equal((await turn).status, 200);
    assert.ok(mainSince(mark).map(allIn).join("\n").includes(JSON.stringify(useLine([SKEPTIC], { note: true })).slice(1, -1)), "the line beside the note");
    assert.equal(up.received.slice(mark).filter((/** @type {any} */ c) => asWhom(c)).length, 0, "nothing started");
    const t = await lastTurn(id);
    assert.deepEqual([t.use, t.unused], [undefined, [SKEPTIC]], "the note's named join the turn's");
  });
});
