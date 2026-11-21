// @ts-check
// Memory's model (the memory plan's m1, the owner's of 11-07): the one set in Settings › Memory › Model is first for
// every memory call; not set, the chat's compaction model, else the chat's own — a sub-agent's chat learns on the chat
// that launched it, the curator on its project's newest chat —, else the most recently active chat's, else none, said
// why.
// A coding agent's model stands as the same model through a provider's route, never the agent itself. Never the
// cheapest by itself. Memory's calls run at low effort unless the person sets one. The curator's own model went: its
// switch stays, and a config that turned it off is carried there.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chooseMemoryModel, plainModelOf, memoryEffort, whyNoModelWords, MEMORY_EFFORT } from "../src/services/memory/model-choice.js";
import { normalizeConfig } from "../src/services/config/store.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { world } from "./fixtures/memory-world.mjs";

/** A keyed provider. @param {string} id @param {any} [extra] */
const up = (id, extra = {}) => ({ id, name: id, type: "openai-compatible", baseUrl: `https://${id}.example.test/v1`, apiKey: "k", ...extra });
/** A route. @param {string} match @param {string} upstream @param {string} [upstreamModel] */
const route = (match, upstream, upstreamModel = match) => ({ match, upstream, upstreamModel, enabled: true });
/** A coding agent's upstream: Claude Code, say. */
const AGENT = { id: "cc", name: "cc", type: "acp", acp: { command: "claude" } };
/** What memory can call: the names in `served`, as named. @param {string[]} served */
const plainOf = (served) => (/** @type {string} */ n) => (served.includes(n) ? n : "");

describe("chooseMemoryModel", () => {
  // (fails before: yes — there was no chain: with none named, memory took the cheapest priced model the routes answer)
  test("the model set in Settings › Memory is first, as named; off is none; empty or auto falls to the chain", () => {
    const o = { compaction: "c", chat: "h", fallback: "d", plain: plainOf(["c", "h", "d"]) };
    assert.deepEqual(chooseMemoryModel({ ...o, set: "mine" }), { model: "mine", from: "memory" }, "the person's pick stands, served or not");
    assert.deepEqual(chooseMemoryModel({ ...o, set: "off" }), { model: "", from: "off" });
    assert.deepEqual(chooseMemoryModel({ ...o, set: "" }), { model: "c", from: "compaction" });
    assert.deepEqual(chooseMemoryModel({ ...o, set: "auto" }), { model: "c", from: "compaction" }, "an older config's auto is not set");
  });

  test("not set: the compaction model, else the chat's, else the one new chats start on — each only where memory can call it", () => {
    assert.deepEqual(chooseMemoryModel({ compaction: "c", chat: "h", fallback: "d", plain: plainOf(["h", "d"]) }), { model: "h", from: "chat" });
    assert.deepEqual(chooseMemoryModel({ compaction: "", chat: "h", fallback: "d", plain: plainOf(["d"]) }), { model: "d", from: "default" });
    assert.deepEqual(chooseMemoryModel({ compaction: "c", chat: "h", fallback: "d", plain: plainOf([]) }), { model: "", from: "none" });
    assert.deepEqual(chooseMemoryModel({ plain: plainOf(["anything"]) }), { model: "", from: "none" }, "nothing named, nothing guessed");
  });

  test("why there is none, in words; nothing where there is one", () => {
    assert.match(whyNoModelWords("off"), /^memory's model is off \(Settings › Memory › Model\)$/);
    assert.match(whyNoModelWords("none"), /^no model to call: set one in Settings › Memory › Model/);
    assert.equal(whyNoModelWords("chat"), "");
  });
});

describe("plainModelOf: what memory can call", () => {
  const cfg = {
    upstreams: [up("prov"), AGENT],
    routes: [route("glm-5.3", "prov"), route("sonnet-5", "prov"), route("cc/*", "cc", "{1}")],
  };
  test("a provider's route stands as named; a name no route takes is none", () => {
    assert.equal(plainModelOf(cfg, "glm-5.3"), "glm-5.3");
    assert.equal(plainModelOf(cfg, "nobody-serves-this"), "");
    assert.equal(plainModelOf(cfg, ""), "");
  });
  // (fails before: yes — a coding agent's model was taken as memory's, an agent with hands of its own on its plan)
  test("a coding agent's model stands as the model its route sends, where a provider serves that; else none", () => {
    assert.equal(plainModelOf(cfg, "cc/sonnet-5"), "sonnet-5", "the same model, through the provider");
    assert.equal(plainModelOf(cfg, "cc/opus-5"), "", "no provider serves it: passed over, never the agent itself");
  });
  // (fails before: yes — the review of m1: a chat's requests named "glm-5.3-high", and memory's calls went at high, the
  // suffix beating memory's low effort; "glm-5.3-fast" went on the fast tier; an exact route took neither name)
  test("a chat's effort or fast suffix is left off: memory's call goes at memory's own effort", () => {
    const ruled = { ...cfg, rules: defaultsOf(RULES) };
    assert.equal(plainModelOf(ruled, "glm-5.3-high"), "glm-5.3");
    assert.equal(plainModelOf(ruled, "glm-5.3-fast"), "glm-5.3");
    assert.equal(plainModelOf(ruled, "cc/sonnet-5-max"), "sonnet-5");
  });
  test("a model whose provider is switched off is none", () => {
    const off = { upstreams: [up("prov", { enabled: false }), up("live"), AGENT], routes: [route("glm-5.3", "prov"), route("sonnet-5", "prov"), route("cc/*", "cc", "{1}")] };
    assert.equal(plainModelOf(off, "glm-5.3"), "");
    assert.equal(plainModelOf(off, "cc/sonnet-5"), "", "the agent's model through a provider switched off");
  });
});

test("memory's effort: low unless the person set one; the model's own sends none", () => {
  assert.equal(MEMORY_EFFORT, "low");
  assert.equal(memoryEffort(""), "low");
  assert.equal(memoryEffort(undefined), "low");
  assert.equal(memoryEffort("high"), "high");
  assert.equal(memoryEffort("model"), null);
});

test("a config whose curator model was off carries it to the curator's switch; its model key goes", () => {
  const off = normalizeConfig({ memory: { models: { summarizer: "glm-5.3", curator: "off" } } });
  assert.deepEqual([off.memory.curator.usesModel, off.memory.models.summarizer, "curator" in off.memory.models], [false, "glm-5.3", false]);
  const named = normalizeConfig({ memory: { models: { curator: "judge-1" } } });
  assert.equal(named.memory.curator.usesModel, true, "a curator model of its own: it curates on memory's now");
  const said = normalizeConfig({ memory: { models: { curator: "off" }, curator: { usesModel: true } } });
  assert.equal(said.memory.curator.usesModel, true, "the switch's own word stands");
  assert.deepEqual(Object.keys(normalizeConfig({}).memory.models).sort(), ["effort", "summarizer"]);
});

describe("the service", () => {
  /** A world whose routes serve these models from one provider. @param {string[]} names @param {any} [o] */
  const served = (names, o = {}) => (/** @type {any} */ w) => {
    w.cfg.upstreams = [up("prov", o.prov || {}), AGENT, ...(o.more || [])];
    w.cfg.routes = [...names.map((n) => route(n, "prov")), route("cc/*", "cc", "{1}")];
  };
  /** Point a chat at a model, as its requests would. @param {any} w @param {string} chain @param {string} model */
  const onModel = (w, chain, model) => w.svc.archive.db.prepare("UPDATE chains SET model = ? WHERE id = ?").run(model, chain);

  test("a model set in Settings › Memory is first for every call: the learner, the curator, a chat's", async () => {
    await world({ models: { summarizer: "mine-1" } }, async (w) => {
      served(["claude-x"])(w);
      const { prep, sit } = await w.session("a").send("the api listens on port 3000");
      assert.deepEqual(w.svc.modelFor({ chainId: prep.chain }), { model: "mine-1", from: "memory" });
      assert.equal(w.svc.learner.model(prep.chain), "mine-1");
      assert.equal(w.svc.curatorModel(sit.project.id), "mine-1");
      assert.deepEqual(w.svc.models(), { summarizer: "mine-1", effort: "", curatorUsesModel: true, now: "mine-1", from: "memory", whyNone: null });
    });
  });

  test("off: memory learns nothing, and says why", async () => {
    await world({ models: { summarizer: "off" } }, async (w) => {
      served(["claude-x"])(w);
      const { prep } = await w.session("a").send("the api listens on port 3000");
      assert.deepEqual(w.svc.modelFor({ chainId: prep.chain }), { model: "", from: "off" });
      assert.equal(w.svc.learner.model(prep.chain), "");
      assert.equal(w.svc.learner.whyNoModel(prep.chain), "no learning model: memory's model is off (Settings › Memory › Model)");
      assert.equal(w.svc.curatorModel(), "");
    });
  });

  // (fails before: yes — not set, every chat learned on the one model the server picked by price)
  test("not set: the chat's compaction model, else its own; a sub-agent's chat on the chat that launched it; the curator on its project's newest chat", async () => {
    await world({}, async (w) => {
      served(["claude-x", "glm-5.3", "grok-4.6", "kimi-3"])(w);
      const a = await w.session("a").send("the api listens on port 3000");
      assert.deepEqual(w.svc.modelFor({ chainId: a.prep.chain }), { model: "claude-x", from: "chat" }, "the chat's own model");
      w.svc.archive.setChainSettings(a.prep.chain, { context: { compaction: { model: "glm-5.3" } } });
      assert.deepEqual(w.svc.modelFor({ chainId: a.prep.chain }), { model: "glm-5.3", from: "compaction" }, "its compaction model first");
      w.svc.archive.setChainSettings(a.prep.chain, null);
      onModel(w, a.prep.chain, "grok-4.6");
      // A sub-agent's chat, on a model of its own: what it teaches is learned on the chat that launched it.
      const b = await w.session("b").send("look into the port");
      onModel(w, b.prep.chain, "kimi-3");
      w.svc.archive.setChainKind(b.prep.chain, "subagent");
      w.svc.archive.setParent(b.prep.chain, a.prep.chain);
      assert.deepEqual(w.svc.modelFor({ chainId: b.prep.chain }), { model: "grok-4.6", from: "chat" });
      assert.equal(w.svc.learner.model(b.prep.chain), "grok-4.6");
      // The curator: the project's most recently active chat — never a sub-agent's.
      const c = await w.session("c").send("and the docs?");
      onModel(w, c.prep.chain, "kimi-3");
      w.svc.archive.db.prepare("UPDATE chains SET last_at = ? WHERE id = ?").run(Date.now() + 60_000, c.prep.chain);
      assert.equal(w.svc.curatorModel(a.sit.project.id), "kimi-3");
      w.svc.archive.db.prepare("UPDATE chains SET last_at = ? WHERE id = ?").run(Date.now() + 120_000, b.prep.chain);
      assert.equal(w.svc.curatorModel(a.sit.project.id), "kimi-3", "a sub-agent's chat is not the project's newest");
    });
  });

  // (fails before: yes — the review of m1: a harness chat at High sent memory's calls as "brain-model-high", at high)
  test("a harness chat's model as memory takes it: without the effort or tier its turns put on it", async () => {
    await world({}, async (w) => {
      served(["brain-model"])(w);
      w.cfg.rules = defaultsOf(RULES);
      const chat = w.svc.archive.chainForKey("n:effort-chat", { cwd: "C:\\evals", client: "harness", model: "brain-model", meta: { native: true } });
      w.svc.archive.setChainSettings(chat.id, { model: { name: "brain-model", effort: "high" } });
      assert.equal(w.svc.chatModelOf(chat.id), "brain-model-high", "the chat's turns go at high");
      assert.deepEqual(w.svc.modelFor({ chainId: chat.id }), { model: "brain-model", from: "chat" });
      w.svc.archive.setChainSettings(chat.id, { model: { name: "brain-model", fast: true } });
      assert.deepEqual(w.svc.modelFor({ chainId: chat.id }), { model: "brain-model", from: "chat" }, "nor its fast tier");
    });
  });

  // (fails before: yes — the review of m1: the recall rewrite named no chat, so it ran on the newest chat's model anywhere,
  // perhaps another project's provider, never this chat's compaction or own model)
  test("the recall rewrite is the chat's: memory's call names the chat it is for", async () => {
    /** @type {any[]} */
    const calls = [];
    const callModel = async (/** @type {any} */ a) => (calls.push(a), JSON.stringify({ queries: ["pipeline upload"] }));
    await world({ callModel }, async (w) => {
      w.cfg.memory.autopilot = { ...(w.cfg.memory.autopilot || {}), rewrite: true };
      const { prep } = await w.session("a").send("where does the deploy pipeline upload the bundle these days");
      const rewrite = calls.find((c) => c.purpose === "recall");
      assert.ok(rewrite, "the rewrite ran: nothing was found by the message's own words");
      assert.equal(rewrite.chainId, prep.chain);
    });
  });

  test("a coding agent's model stands as the same model through a provider's route, never the agent itself; none serving it falls through", async () => {
    await world({}, async (w) => {
      served(["sonnet-5", "glm-5.3"])(w);
      const a = await w.session("a").send("the api listens on port 3000");
      onModel(w, a.prep.chain, "cc/sonnet-5");
      assert.deepEqual(w.svc.modelFor({ chainId: a.prep.chain }), { model: "sonnet-5", from: "chat" });
      onModel(w, a.prep.chain, "cc/opus-5");
      assert.deepEqual(w.svc.modelFor({ chainId: a.prep.chain }), { model: "", from: "none" }, "no provider serves the agent's model, and no other chat");
      assert.match(String(w.svc.models().whyNone), /^no model to call: set one in Settings › Memory › Model/);
      const b = await w.session("b").send("and the docs?");
      onModel(w, b.prep.chain, "glm-5.3");
      w.svc.archive.db.prepare("UPDATE chains SET last_at = ? WHERE id = ?").run(Date.now() + 60_000, b.prep.chain);
      assert.deepEqual(w.svc.modelFor({ chainId: a.prep.chain }), { model: "glm-5.3", from: "default" }, "the most recently active chat's model");
    });
  });

  // (fails before: yes — with nothing named, memory took the cheapest priced model, a provider the person never chose for it)
  test("never the cheapest by itself: with no chat named, the most recently active chat's model", async () => {
    await world({}, async (w) => {
      w.cfg.upstreams = [up("dear", { pricing: { big: { input: 10, output: 30 } } }), up("cheap", { pricing: { small: { input: 0.5, output: 1.5 } } })];
      w.cfg.routes = [route("dear/big", "dear", "big"), route("cheap/small", "cheap", "small")];
      assert.deepEqual(w.svc.modelFor({}), { model: "", from: "none" }, "no chat yet: none, never a pick by price");
      const a = await w.session("a").send("the api listens on port 3000");
      onModel(w, a.prep.chain, "dear/big");
      assert.deepEqual(w.svc.modelFor({}), { model: "dear/big", from: "default" });
      assert.equal(w.svc.curatorModel(null), "dear/big", "the global claims' curator too");
    });
  });

  // (fails before: yes — memory's calls went at the model's own effort, a big model's high on a filing job)
  test("memory's calls are sent at low effort, the person's level where set, none for the model's own", async () => {
    /** @type {any[]} */
    const bodies = [];
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
    try {
      await world({ models: { summarizer: "mine-1" } }, async (w) => {
        w.svc.selfBase = () => `http://127.0.0.1:${port}`;
        const ask = (/** @type {string} */ purpose) => w.svc.callModel({ system: "s", user: "u", purpose });
        await ask("learn");
        await ask("curate");
        w.cfg.memory.models.effort = "high";
        await ask("learn");
        w.cfg.memory.models.effort = "model";
        await ask("learn");
        w.cfg.memory.models.effort = "";
        await ask("compaction");
        assert.deepEqual(bodies.map((b) => [b.model, b.output_config?.effort ?? null]), [
          ["mine-1", "low"],
          ["mine-1", "low"],
          ["mine-1", "high"],
          ["mine-1", null],
          ["mine-1", null],
        ], "a compaction's summary is the chat's work, at the model's own");
      });
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });
});
