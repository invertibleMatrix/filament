// @ts-check
// The admin API's saved agents (HarnessV4_Tasks E15 step 2): the cards a tag, an agent's tool or `/subagent as=` can
// name — the ones that ship, read-only, and yours (services/agent-cards.js). A save, a copy, an edit and a delete
// are `config` operations, like a team's. A card deleted or changed here leaves what already ran under it as it
// was: a launch carries its card's name and words from its start. Step 3 adds whom a session's main agent may ask by
// itself: one list of tags in the config (`agentLoop.subagents.ask`), the default of every session that has not chosen
// its own, read with the cards and written whole. A deleted card leaves that list with it: a new agent under the same
// tag is then nobody's to ask until it is ticked. Step 4 adds the workers, and with the cards what the page says of
// each: who uses it (`usedBy`: the teams it leads or is a member of, the starts that launch it) and why its model cannot run an
// agent now (`problems`); a model is checked the same way as the editor picks it. Step 7's agents that started by
// themselves went on the owner's word of 11-05. A card names its models as a list, first choice first (the owner's 10-19 list): `problems` says why one cannot run
// an agent now where none of its models can, and `fallbacks` the model it runs on meanwhile where its first cannot. A
// shipped card takes an edit of every field but its tag, set in place (HarnessV4_ShippedAgents_Plan SA1): a field given
// null is put back as it ships, `reset: true` puts back all; it is never deleted.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { CARD_CHANGES, CARD_LIMITS, CARD_MAY, CARD_TOOLS, CARD_VIEWS, OWN_WORKERS } from "../../services/agent-cards.js";
import { SUBAGENT_STARTS } from "../../services/subagent-starts.js";
import { namesMore } from "../../services/session-settings.js";
import { pressRefused } from "../guards.js";
import { lendsWords, poolProblem } from "../../core/pool.js";
import { agentsPage } from "../../core/teams-on.js";

/** What a new agent's body is, or a copy's. */
const NEW_BODY = "a JSON object is required: { tag, name, goodFor, thinks?, may? (read | copy | edit), models? [first choice first], sees?, mayRun? [commands], toolsOff? [tools it goes without] }, or { from, tag, … } to copy an agent";
/** What an edit's body is. */
const EDIT_BODY = "a JSON object is required: { name?, goodFor?, thinks?, may?, models?, sees?, mayRun?, toolsOff? }, the fields to change — of a shipped agent, each given null is put back as it ships, and { reset: true } puts back all";
/** A shipped card's fields, as the op log says what was set on one. */
const FIELD_WORDS = Object.freeze({ name: "name", goodFor: "good for", thinks: "how it thinks", may: "what it may do", model: "models", models: "models", sees: "what it sees", mayRun: "commands it runs without asking", toolsOff: "its tools" });
/** The words of a list: "a", "a and b", "a, b and c". @param {string[]} list */
const listed = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list.join(""));
/**
 * What an edit of a shipped card did, as the op log says it: every field put back, the fields set, the fields put back.
 * @param {Record<string, unknown>} b
 */
const shippedWords = (b) => {
  if (b.reset === true && Object.keys(b).length === 1) return "every field put back as it ships";
  const words = (/** @type {string} */ k) => /** @type {Record<string, string>} */ (FIELD_WORDS)[k] || k;
  const given = Object.keys(b).filter((k) => k !== "reset" && k !== "tag");
  const set = given.filter((k) => b[k] !== null).map(words);
  const back = given.filter((k) => b[k] === null).map(words);
  return [b.reset === true ? "every field put back as it ships" : "", set.length ? `${listed(set)} set in place` : "", back.length ? `${listed(back)} put back as it ships` : ""].filter(Boolean).join("; ") || "nothing changed";
};
/** What the list of who may be asked is written with. */
const ASK_BODY = "a JSON object is required: { tags: [\"pm\", …] } — the saved agents a session's main agent may ask, by tag; [] for nobody";

/**
 * The store's refusals name their status (400, 403, 404) and are answered with their words; anything else is the
 * shared guard's 500.
 * @param {(r: any, a: any) => any} fn
 */
const guard = (fn) =>
  guardWith(async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 && !r.res.headersSent) return sendJson(r.res, e.status, { error: e.message });
      throw e;
    }
  });

/** A body that is a JSON object, else null. @param {any} r */
const objectBody = async (r) => {
  const b = await r.json();
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function agentCardRoutes(a) {
  const { ops, events, config } = a;
  /** @type {import("../../services/agent-cards.js").AgentCardStore} */
  const cards = a.agentCards;
  /** Why a model cannot run a sub-agent now, or null (the launch's own rule). @type {(name: string) => string | null} */
  const modelProblem = a.subagentModelProblem;
  /**
   * Who uses each card, by tag (cards nobody uses are left out): the teams it leads or is a member of — `words` says
   * the team adds a line of its own for that member — and the starts that launch it.
   */
  const usedBy = () => {
    /** @type {Record<string, { teams: { key: string, name: string, as: "lead" | "member", words: boolean }[], starts: { id: string, name: string }[] }>} */
    const out = {};
    /** @param {string} tag */
    const of = (tag) => (out[tag] ??= { teams: [], starts: [] });
    for (const c of cards.list()) for (const u of a.teams.usedBy(c.tag)) of(c.tag).teams.push({ key: u.key, name: u.name, as: u.as, words: !!u.line.trim() });
    for (const s of Object.values(SUBAGENT_STARTS)) of(s.worker).starts.push({ id: s.id, name: s.name });
    return out;
  };
  /**
   * Each card none of whose models can run an agent now, by tag, with why — of a list, each one's — and, apart, each
   * card whose first model cannot while another of its list can: the one a launch takes meanwhile, and those it passes.
   */
  const modelsNow = () => {
    /** @type {Record<string, string>} */
    const problems = {};
    /** @type {Record<string, { model: string, passed: { model: string, why: string }[] }>} */
    const fallbacks = {};
    for (const c of cards.list()) {
      const list = c.models || [];
      const whys = list.map((m) => ({ model: m, why: modelProblem(m) }));
      const at = whys.findIndex((w) => !w.why);
      if (list.length && at < 0) problems[c.tag] = list.length === 1 ? String(whys[0].why) : whys.map((w) => `${w.model}: ${w.why}`).join("; ");
      else if (at > 0) fallbacks[c.tag] = { model: list[at], passed: whys.slice(0, at).map((w) => ({ model: w.model, why: String(w.why) })) };
    }
    return { problems, fallbacks };
  };
  /** A route's tag, as the page encodes it: a plugin's agent's holds a `:` (B3). @param {any} r */
  const tagOf = (r) => {
    try {
      return decodeURIComponent(String(r.params.tag || ""));
    } catch {
      return String(r.params.tag || "");
    }
  };
  /** Your agents, as every write's answer carries them. */
  const saved = () => cards.list().filter((c) => !c.shipped && !c.plugin);
  /** The agents the plugins installed bring (HarnessV4_SpacesPlugins_Plan B3): read from their files, Make a copy to change one. */
  const brought = () => cards.list().filter((c) => !!c.plugin);
  // A card's save is no config change, so the feed says it here: a page that lists the agents reads them again.
  /** @param {string} tag */
  const told = (tag) => events.publish("config", { type: "agents-changed", tag });
  /** Whom a session's main agent may ask unless the session chose its own list: the config's, as it is written. */
  const ask = () => (Array.isArray(config.get().agentLoop?.subagents?.ask) ? config.get().agentLoop.subagents.ask.map(String) : []);
  /** @param {string[]} tags */
  const writeAsk = (tags) => {
    const next = structuredClone(config.get());
    next.agentLoop = { ...next.agentLoop, subagents: { ...next.agentLoop?.subagents, ask: tags } };
    config.set(next);
    config.save();
  };
  return [
    [
      "GET",
      "/agents",
      guard((r) =>
        // Yours the file keeps that cannot be used now, with why: the page names them, and deletes one on your word.
        sendJson(r.res, 200, { shipped: cards.list().filter((c) => c.shipped), saved: saved(), held: cards.held(), plugins: brought(), ask: ask(), always: OWN_WORKERS, usedBy: usedBy(), ...modelsNow(), may: CARD_MAY, views: CARD_VIEWS, changes: CARD_CHANGES, tools: CARD_TOOLS, limits: CARD_LIMITS }),
      ),
    ],
    [
      // The pool's editor reads its rows as a launch would (HarnessV4_Tasks E15 step 8): what each lends now and why
      // fewer, its limit, how many agents run on it in the session, why it cannot run, and its price per million
      // tokens. The rows are the body's — an edit not saved yet — so nothing is written. `session`: the chat whose
      // running agents count, none for a new task; `main`: the main agent's model, which a row that names none is;
      // `list`: "workers" for the workers' list (HarnessV4_Tasks E23-D6), whose agents count apart — else the side's.
      "POST",
      "/subagents/seats",
      guard(async (r) => {
        const b = await objectBody(r);
        const problem = poolProblem(b?.pool);
        if (problem) return sendJson(r.res, 400, { error: `"pool" ${problem}` });
        /** @type {import("../../core/pool.js").Seat[]} */
        const seats = a.subagents.pool(String(b.session || ""), String(b.main || "").trim() || null, b.pool, b.list === "workers" ? "workers" : "side");
        return sendJson(r.res, 200, {
          // A row with no limit lends Infinity: null as JSON says it.
          seats: seats.map((s) => ({ ...s, lends: lendsWords(s), price: s.model ? a.subagentModelFacts(s.model).price : null })),
        });
      }),
    ],
    [
      // The editor's check of a model as it is picked: why a card on it could not run now, or null. Its own path, as
      // the list's below: under /agents it would be the address of an agent.
      "GET",
      "/subagents/model-problem",
      guard((r) => {
        const model = String(r.url.searchParams.get("model") || "").trim().replace(/^agent\//, "");
        return sendJson(r.res, 200, { model, problem: model ? modelProblem(model) : null });
      }),
    ],
    [
      // Whom a session's main agent may ask by itself (agentLoop.subagents.ask), written whole: a tick on a card adds
      // its tag, an untick removes it. Each tag names a card; one that names none is refused. Its own path: under
      // /agents it would be the address of an agent tagged `ask`.
      "PUT",
      "/subagents/ask",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b || !Array.isArray(b.tags) || b.tags.some((/** @type {unknown} */ t) => typeof t !== "string")) return sendJson(r.res, 400, { error: ASK_BODY });
        const tags = [...new Set(b.tags.map((/** @type {string} */ t) => t.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
        const unknown = tags.filter((t) => !cards.find(t));
        if (unknown.length) return sendJson(r.res, 400, { error: `there is no agent ${unknown.map((t) => `\`@${t}\``).join(", ")} — ${agentsPage(config.get())} lists them` });
        // A team's own Lead runs only when its team does (OA-D4): never asked by itself (the bug round of 10-23).
        const head = tags.map((t) => cards.find(t)).find((c) => c?.partOf);
        if (head) return sendJson(r.res, 400, { error: `${head.name} is the \`${head.partOf}\` team's own Lead: it runs only when that team does — let your agent start the team instead` });
        // One more named is a press (press.js; r-doors, 11-12): a saved agent runs the commands its card names unasked, and
        // until now the person alone started it. The same list again, a tag taken out and nobody need no key.
        const unpressed = pressRefused(r.req);
        if (unpressed && namesMore(tags, ask())) return sendJson(r.res, 403, { error: unpressed, press: true });
        writeAsk(tags);
        ops.record("config", tags.length ? `a session's main agent may ask ${tags.map((t) => `\`@${t}\``).join(", ")}` : "a session's main agent may ask nobody by itself", { sub: "subagents-ask", detail: { tags } });
        told("");
        return sendJson(r.res, 200, { ok: true, ask: tags });
      }),
    ],
    [
      // A new agent, or a copy of one (`from`): the source's fields under a tag of its own.
      "POST",
      "/agents",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: NEW_BODY });
        const card = cards.create(b);
        ops.record("config", `agent \`@${card.tag}\` created${card.from ? ` (a copy of \`@${card.from}\`)` : ""}`, { sub: "agent-save", detail: { tag: card.tag, from: card.from || null } });
        told(card.tag);
        return sendJson(r.res, 200, { ok: true, agent: card, saved: saved(), held: cards.held(), ...modelsNow() });
      }),
    ],
    [
      "PUT",
      "/agents/:tag",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: EDIT_BODY });
        const card = cards.update(tagOf(r), b);
        ops.record("config", card.shipped ? `shipped agent \`@${card.tag}\`: ${shippedWords(b)}` : `agent \`@${card.tag}\` edited`, { sub: "agent-save", detail: { tag: card.tag, fields: Object.keys(b), ...(card.shipped ? { shipped: true } : {}) } });
        told(card.tag);
        return sendJson(r.res, 200, { ok: true, agent: card, ...(card.shipped ? { shipped: cards.list().filter((c) => c.shipped) } : {}), saved: saved(), ...modelsNow() });
      }),
    ],
    [
      "DELETE",
      "/agents/:tag",
      guard((r) => {
        const card = cards.remove(tagOf(r));
        // One kept as saved is no agent anyone asks: under a shipped card's tag, the list's tag is that card's.
        const kept = "kept" in card;
        const asked = !kept && ask().includes(card.tag);
        if (asked) writeAsk(ask().filter((t) => t !== card.tag));
        ops.record("config", `agent \`@${card.tag}\` deleted${kept ? " (kept as saved, not usable)" : ""}${asked ? "; a session's main agent no longer asks it" : ""}`, { sub: "agent-delete", detail: { tag: card.tag } });
        told(card.tag);
        return sendJson(r.res, 200, { ok: true, removed: card.tag, saved: saved(), held: cards.held(), ask: ask(), ...modelsNow() });
      }),
    ],
  ];
}
