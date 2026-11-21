// @ts-check
// HarnessV4_Tasks E15 step 2: /api/agents over the live app — the five leads that ship and yours; a save, a copy, an
// edit and a delete, each in the op log and said on the feed; every refusal in the store's words with its status; and
// agents.json in the data folder, read back by the next start. Step 3: a deleted agent leaves the list of whom a
// session's main agent may ask (agents-may-ask.test.js has the list's own routes).
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";

const THINKS = "You think as someone who wants to break in: where would you start?";

describe("/api/agents", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body) => {
    const r = await shim.api(`/api${path}`, { method, ...(body === undefined ? {} : { body }) });
    return { status: r.status, json: await r.json() };
  };

  before(async () => {
    up = await fakeUpstream(async (c) => anthropicReply("MODEL ANSWER", { model: String(c.body?.model || "") }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: yes — /api/agents did not exist)
  test("the shipped agents, yours, and what a card's fields may be; a save, a copy, an edit and a delete, each in the op log and on the feed", async () => {
    const first = await call("GET", "/agents");
    assert.equal(first.status, 200);
    // (fails before: yes — OA1: a card had a kind, the API listed the two, and PM, Designer and Engineer read only;
    // "Teams, improved and kept" of 11-03: twenty cards, Product's, Builder's and Reviewer's work spread over nine more)
    assert.deepEqual(first.json.shipped.map((/** @type {any} */ c) => [c.tag, c.name, c.may, c.partOf, c.model]), [
      ["product", "Product", "edit", null, null],
      // (fails before: yes — HarnessV4_ShippedAgents_Plan SA5: End user read only)
      ["enduser", "End user", "copy", null, null],
      // The plan's p6: the four build teams' Leads are one, Builders'.
      ["buildlead", "Builders", "read", "builders", null],
      // The plan's p6: the Bug Hunter's and the Verifier's Leads are one, BugHunters'.
      ["huntlead", "BugHunters", "read", "bughunters", null],
      ["builder", "Builder", "edit", null, null],
      ["reviewer", "Reviewer", "read", null, null],
    ]);
    assert.deepEqual(
      [first.json.saved, "kinds" in first.json, first.json.may, first.json.views, first.json.changes, first.json.limits],
      [[], false, ["read", "copy", "edit"], ["none", "folded", "window"], ["turn", "uncommitted"], { tag: 24, name: 40, goodFor: 160, thinks: 4000, models: 6 }],
    );
    assert.deepEqual([first.json.always, first.json.problems], [["builder", "reviewer"], {}], "the two the main agent always has; no card's model fails");

    /** @type {any[]} */
    const heard = [];
    const unhear = /** @type {any} */ (shim.app).events.subscribe("config", (/** @type {any} */ p) => p?.type === "agents-changed" && heard.push(p.tag));
    const made = await call("POST", "/agents", { tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: THINKS });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.deepEqual([made.json.ok, made.json.agent.tag, made.json.agent.sees, made.json.saved.map((/** @type {any} */ c) => c.tag)], [true, "security", { view: "none", running: false, changes: null }, ["security"]]);
    const copy = await call("POST", "/agents", { from: "product", tag: "pm2", model: "m-other" });
    assert.deepEqual([copy.status, copy.json.agent.name, copy.json.agent.from, copy.json.agent.model], [200, "Product", "product", "m-other"]);
    const edited = await call("PUT", "/agents/security", { goodFor: "Where it leaks", sees: { view: "folded", changes: "turn" } });
    assert.deepEqual([edited.status, edited.json.agent.goodFor, edited.json.agent.sees], [200, "Where it leaks", { view: "folded", running: false, changes: "turn" }]);
    const gone = await call("DELETE", "/agents/pm2");
    assert.deepEqual([gone.status, gone.json.removed, gone.json.saved.map((/** @type {any} */ c) => c.tag)], [200, "pm2", ["security"]]);
    unhear();
    assert.deepEqual(heard, ["security", "pm2", "security", "pm2"], "a save, a copy, an edit and a delete");

    const ops = (await (await shim.api("/api/ops?kinds=config&limit=50")).json()).ops.map((/** @type {any} */ o) => o.title);
    for (const title of ["agent `@security` created", "agent `@pm2` created (a copy of `@product`)", "agent `@security` edited", "agent `@pm2` deleted"]) assert.ok(ops.includes(title), `${title}\n${ops.join("\n")}`);

    const file = join(shim.dataDir, "agents.json");
    assert.ok(existsSync(file), "saved beside teams.json, in the data folder");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).agents), ["security"]);
  });

  // (fails before: yes — the list said nothing of who uses a card, and a card's model was checked at its launch alone)
  test("each card says who uses it — the teams it leads or is a member of, the starts that launch it — and a model that cannot run an agent is said before a launch", async () => {
    const { usedBy } = (await call("GET", "/agents")).json;
    assert.deepEqual(Object.keys(usedBy).sort(), ["builder", "buildlead", "huntlead", "reviewer"], "a lead written to give a view leads no team and is behind no start");
    // (fails before: yes — HarnessV4_Tasks E15 step 6, case 38: a team's lead was no card, so no card said it leads one)
    assert.deepEqual([usedBy.buildlead, usedBy.huntlead.teams], [{ teams: [{ key: "builders", name: "Builders", as: "lead", words: false }], starts: [] }, [{ key: "bughunters", name: "BugHunters", as: "lead", words: false }]]);
    const listed = (await call("GET", "/teams")).json;
    // BugHunters finds and checks with workers of its own (team_v2_plan §5.6, the plan's p6): the team that takes the
    // work over sits on their crew's cards — Builder and Reviewer, each seated twice ("Teams, improved and kept" of 11-03).
    const apart = ["bughunters"];
    const teams = [...listed.shipped, ...listed.saved].filter((/** @type {any} */ t) => !apart.includes(t.key)).map((/** @type {any} */ t) => t.name);
    assert.ok(teams.length >= 1, JSON.stringify(teams));
    assert.deepEqual(usedBy.builder.teams.map((/** @type {any} */ t) => t.name), teams, "builder: a member of every team that takes the work over");
    assert.deepEqual(usedBy.reviewer.teams.map((/** @type {any} */ t) => t.name), [...teams, "BugHunters"], "reviewer: of every team — BugHunters' Hunter and Checker are its seats");
    assert.deepEqual(
      ["huntlead"].map((tag) => usedBy[tag].teams.map((/** @type {any} */ t) => [t.name, t.as])),
      [[["BugHunters", "lead"]]],
    );
    assert.ok(usedBy.reviewer.teams.every((/** @type {any} */ t) => t.as === "member" && typeof t.words === "boolean" && typeof t.key === "string"));
    // (fails before: yes — a stamp that only fed the Library's groups, gone with them on the owner's word of 10-24: "I liked the previous design better where everything was just an Agent and Teams just
    // referenced those agents") A card says nothing of its seats: usedBy says which teams use it.
    assert.equal((await call("GET", "/agents")).json.shipped.some((/** @type {any} */ c) => "seated" in c), false);
    assert.deepEqual([usedBy.builder.starts, usedBy.reviewer.starts], [[{ id: "job", name: "Try it in a copy" }], [{ id: "ask", name: "Ask" }, { id: "review", name: "Review my last change" }, { id: "catchup", name: "Catch me up" }]]);
    // The editor asks as a model is picked; the list says it of every card that names one.
    assert.deepEqual((await call("GET", "/subagents/model-problem?model=m-1")).json, { model: "m-1", problem: null });
    const lost = (await call("GET", "/subagents/model-problem?model=nowhere-9")).json;
    assert.deepEqual([lost.model, typeof lost.problem, /nowhere-9|no route|route/i.test(String(lost.problem))], ["nowhere-9", "string", true], String(lost.problem));
    assert.deepEqual((await call("GET", "/subagents/model-problem")).json, { model: "", problem: null });
    const made = await call("POST", "/agents", { tag: "translator", name: "Translator", goodFor: "Puts strings into German", may: "copy", model: "nowhere-9" });
    assert.deepEqual([made.status, made.json.agent.partOf, made.json.agent.may, made.json.agent.thinks], [200, null, "copy", ""], "a model that fails now is said, never refused: it may run tomorrow");
    assert.deepEqual((await call("GET", "/agents")).json.problems, { translator: lost.problem });
    assert.equal((await call("DELETE", "/agents/translator")).status, 200);
  });

  // (fails before: yes — a card named one model, a shipped card's could not be set, and a model that could not run was
  // said only of a card's one: the owner's 10-19 list)
  test("a shipped agent's models and what it sees are set in place, in the op log; the list says the model a card falls back to, and a card none of whose models can run", async () => {
    const set = await call("PUT", "/agents/reviewer", { models: ["nowhere-9", "m-1"], sees: { view: "window" } });
    try {
      assert.equal(set.status, 200, JSON.stringify(set.json));
      assert.deepEqual([set.json.agent.models, set.json.agent.set, set.json.shipped.find((/** @type {any} */ c) => c.tag === "reviewer").models], [["nowhere-9", "m-1"], ["models", "sees"], ["nowhere-9", "m-1"]]);
      const listed = (await call("GET", "/agents")).json;
      assert.deepEqual([listed.problems.reviewer, listed.fallbacks.reviewer?.model, listed.fallbacks.reviewer?.passed.map((/** @type {any} */ p) => p.model)], [undefined, "m-1", ["nowhere-9"]], "its first cannot run: it runs on its second meanwhile");
      const none = await call("PUT", "/agents/reviewer", { models: ["nowhere-9", "nowhere-8"] });
      assert.match(none.json.problems.reviewer, /^nowhere-9: .+; nowhere-8: .+/, "none of its models can run: each one's why");
      const ops = (await (await shim.api("/api/ops?kinds=config&limit=50")).json()).ops.map((/** @type {any} */ o) => o.title);
      assert.ok(ops.includes("shipped agent `@reviewer`: models and what it sees set in place"), ops.join("\n"));
    } finally {
      const back = await call("PUT", "/agents/reviewer", { models: [], sees: null });
      assert.deepEqual([back.status, back.json.agent.set, back.json.agent.models], [200, [], []]);
    }
  });

  // (fails before: yes — HarnessV4_ShippedAgents_Plan SA1, the owner's words of 10-23: "the ability to edit the pre
  // existing templates that come with the harness, change their permissions and tools … i mean everything")
  test("every field of a shipped agent is set in place, each put back by null and all by reset, the op log saying which; its tag stays and it is never deleted", async () => {
    try {
      const set = await call("PUT", "/agents/enduser", { may: "edit", thinks: "You use the app as a user would.", mayRun: ["npm start"] });
      assert.equal(set.status, 200, JSON.stringify(set.json));
      const a = set.json.agent;
      assert.deepEqual([a.shipped, a.may, a.thinks, a.mayRun, a.set, a.ships.may], [true, "edit", "You use the app as a user would.", ["npm start"], ["thinks", "may", "mayRun"], "copy"]);
      assert.equal((await call("GET", "/agents")).json.shipped.find((/** @type {any} */ c) => c.tag === "enduser").may, "edit", "the list carries it");
      const one = await call("PUT", "/agents/enduser", { thinks: null });
      assert.deepEqual([one.json.agent.set, one.json.agent.may], [["may", "mayRun"], "edit"], "one field put back, the rest kept");
      const all = await call("PUT", "/agents/enduser", { reset: true });
      assert.deepEqual([all.json.agent.set, all.json.agent.may, all.json.agent.mayRun], [[], "copy", []]);
      const ops = (await (await shim.api("/api/ops?kinds=config&limit=50")).json()).ops.map((/** @type {any} */ o) => o.title);
      for (const words of ["shipped agent `@enduser`: what it may do, how it thinks and commands it runs without asking set in place", "shipped agent `@enduser`: how it thinks put back as it ships", "shipped agent `@enduser`: every field put back as it ships"])
        assert.ok(ops.includes(words), `${words}\n${ops.join("\n")}`);
      const level = await call("PUT", "/agents/reviewer", { mayRun: ["npm test"] });
      assert.deepEqual([level.status, level.json.error], [400, "Reviewer only reads, so it runs no commands of its own: they run in its own copy of the project. Let it run in its own copy, or leave its commands out."], "checked as a whole, as yours are");
    } finally {
      assert.equal((await call("PUT", "/agents/enduser", { reset: true })).status, 200);
    }
  });

  // (fails before: yes — a deleted agent's tag stayed in the list of whom a session's main agent may ask, so a new
  // agent made under the same tag was asked without anyone's tick)
  test("a deleted agent leaves the list of whom the main agent may ask: the answer carries the list, and the op log says so", async () => {
    const auditor = { tag: "auditor", name: "Auditor", goodFor: "What a regulator would ask", thinks: THINKS };
    assert.equal((await call("POST", "/agents", auditor)).status, 200);
    assert.deepEqual((await call("PUT", "/subagents/ask", { tags: ["product", "auditor"] })).json.ask, ["product", "auditor"]);
    // (fails before: yes — the bug round of 10-23: a team's own Lead went on the list, to be asked by itself)
    const head = await call("PUT", "/subagents/ask", { tags: ["product", "huntlead"] });
    assert.equal(head.status, 400);
    assert.match(head.json.error, /is the `bughunters` team's own Lead: it runs only when that team does — let your agent start the team instead$/);
    try {
      const gone = await call("DELETE", "/agents/auditor");
      assert.deepEqual([gone.status, gone.json.removed, gone.json.ask], [200, "auditor", ["product"]]);
      const ops = (await (await shim.api("/api/ops?kinds=config&limit=50")).json()).ops.map((/** @type {any} */ o) => o.title);
      assert.ok(ops.includes("agent `@auditor` deleted; a session's main agent no longer asks it"), ops.join("\n"));
      assert.equal((await call("POST", "/agents", auditor)).status, 200);
      assert.deepEqual((await call("GET", "/agents")).json.ask, ["product"], "made anew under the same tag, it is nobody's to ask until it is ticked");
      const plain = await call("DELETE", "/agents/auditor");
      assert.deepEqual([plain.status, plain.json.ask], [200, ["product"]], "one that was not ticked leaves the list as it is");
    } finally {
      assert.equal((await call("PUT", "/subagents/ask", { tags: [] })).status, 200);
    }
  });

  // (fails before: yes — /api/agents did not exist)
  // (fails before: yes — HarnessV4_ShippedAgents_Plan SA1: a shipped agent's edit past its models and what it sees was a 403)
  test("refuses in words: a shipped agent's new tag and its delete, one nobody made, a taken tag, a body that is no agent, a browser's form post", async () => {
    const shippedEdit = await call("PUT", "/agents/product", { tag: "boss" });
    assert.deepEqual([shippedEdit.status, shippedEdit.json.error], [400, "An agent's tag does not change (`@product`): make a copy under the new tag."]);
    const shippedDelete = await call("DELETE", "/agents/reviewer");
    assert.deepEqual([shippedDelete.status, shippedDelete.json.error], [403, "`@reviewer` is a shipped agent: it cannot be deleted."]);
    assert.deepEqual([(await call("DELETE", "/agents/nobody")).status, (await call("PUT", "/agents/nobody", { name: "x" })).status], [404, 404]);
    const taken = await call("POST", "/agents", { tag: "product", name: "Mine", goodFor: "x y z", thinks: THINKS });
    assert.deepEqual([taken.status, taken.json.error], [400, "`@product` is taken by Product (shipped) — pick another tag."]);
    const list = await call("POST", "/agents", [1, 2]);
    assert.deepEqual([list.status, list.json.error], [400, "a JSON object is required: { tag, name, goodFor, thinks?, may? (read | copy | edit), models? [first choice first], sees?, mayRun? [commands], toolsOff? [tools it goes without] }, or { from, tag, … } to copy an agent"]);
    const edit = await call("PUT", "/agents/security", ["words"]);
    assert.deepEqual([edit.status, edit.json.error], [400, "a JSON object is required: { name?, goodFor?, thinks?, may?, models?, sees?, mayRun?, toolsOff? }, the fields to change — of a shipped agent, each given null is put back as it ships, and { reset: true } puts back all"]);
    const r = await fetch(`${shim.url}/api/agents`, { method: "POST", headers: { ...shim.headers, "content-type": "text/plain", origin: shim.url }, body: JSON.stringify({ tag: "sneaky", name: "Sneaky", goodFor: "x y z", thinks: THINKS }) });
    assert.equal(r.status, 415, "a browser's form post is no admin write");
    assert.equal((await call("GET", "/agents")).json.saved.some((/** @type {any} */ c) => c.tag === "sneaky"), false);
  });
});
