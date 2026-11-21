// @ts-check
// The admin API's teams area (HarnessV3-AtHome P2): the teams a session's engine can name — those that ship,
// set in place (HarnessV4_ShippedAgents_Plan SA3: a field given null put back, `reset: true` all), and yours
// (services/teams.js), each a lead card in charge and the worker cards it hands work to — and how many agents run on
// each model at once across Filament (team_v2_plan TV2-D8, D9: `agentLoop.subagents.slots`, core/slots.js; no list of
// models of Filament's own since the owner's word of 11-05: a chat's own, else its main agent's model); and, for the
// one page (HarnessV4_Tasks U13-D9, D12), the teams a
// chat's main agent may start by itself (`agentLoop.subagents.teams`). A save, a Duplicate, an edit, a delete and a list's write are `config`
// operations, like the dashboard's other saves. A session that names a team deleted here keeps the
// name, and is told on its next turn that no team answers to it.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { TEAM_LIMITS, checksUnasked, teamKey, writesMore } from "../../services/teams.js";
import { agentTeamsOf, namesMore, ownDefaults } from "../../services/session-settings.js";
import { pressRefused } from "../guards.js";
import { SLOTS_MOST, slotKey, slotOf, slotsOf, slotsProblem, withSlot } from "../../core/slots.js";

/** What a new team's body is, or a Duplicate's. */
const NEW_BODY = "a JSON object is required: { name, lead, members: [{ tag, name?, line?, model?, effort? }] }, or { from, name? } to Duplicate a team";
/** What an edit's body is. */
const EDIT_BODY = "a JSON object is required: { name?, lead?, members?, models?, leadModels?, readOnly?, fired?, check? }, the fields to change — models and leadModels each names, or { model, effort } rows; of a shipped team, each given null is put back as it ships, and { reset: true } puts back all";
/** What the agent's teams' write takes. */
const AGENT_TEAMS_BODY = "a JSON object is required: { teams }, the keys of the teams a chat's main agent may start by itself — [] for none";
/** What a model's slots' write takes. */
const SLOTS_BODY = `a JSON object is required: { upstream, model, n } — a source's id and the model's name as it receives it — or { name, n }, a model as Filament lists it; n from 1 to ${SLOTS_MOST}, or null for no limit`;

/**
 * The store's refusals name their status (400, 403, 404) and are answered with their words — a press refused marked
 * so (`press`), as the gate answers one —; anything else is the shared guard's 500.
 * @param {(r: any, a: any) => any} fn
 */
const guard = (fn) =>
  guardWith(async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 && !r.res.headersSent) return sendJson(r.res, e.status, { error: e.message, ...(e.press ? { press: true } : {}) });
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
export function teamRoutes(a) {
  const { config, ops, events } = a;
  /** @type {import("../../services/teams.js").TeamStore} */
  const teams = a.teams;
  /** Your teams, as every write's answer carries them. */
  const saved = () => teams.list().filter((t) => !t.shipped);
  /**
   * The teams every chat's main agent may start by itself (U13-D9), as a fire and a chat's status read them: the
   * config's list, each name a team's key and one that is no team dropped, else BugHunters — where none is set, and
   * where no team it names is left. The read's answer carries them, and so does every team write's:
   * a team made, renamed or deleted can change which team a name on the list is.
   */
  const agentTeams = () => agentTeamsOf(config.get().agentLoop, (k) => teams.find(k)?.key ?? null);
  /**
   * Whether a team, as a write would keep it, is one a chat's main agent may start by itself: on the config's list
   * (`agentTeams`: BugHunters where it names none) or on your defaults', each name read as a team's key or its name —
   * this team's as the write leaves them, so one made under a name the list holds already is on it from its first
   * moment. A chat's or a project's own list is not read here: the person wrote it for that chat.
   * @param {{ key: string, name: string }} t
   */
  const agentStarts = (t) => {
    const cfg = config.get();
    const own = ownDefaults(cfg)["subagents.teams"];
    const known = (/** @type {string} */ name) => (teamKey(name) === t.key || teamKey(name) === teamKey(t.name) ? t.key : teams.find(name)?.key ?? null);
    return [cfg.agentLoop, ...(Array.isArray(own) ? [{ subagents: { teams: own } }] : [])].some((doc) => agentTeamsOf(doc, known).includes(t.key));
  };
  /**
   * A team's write weighed for its caller (services/teams.js `Weigher`; s-rows, 11-12): a press where the team is one
   * the main agent may start by itself (`agentStarts`) and the write has it change files, or seat a card, as the one
   * kept did not (`writesMore`) — BugHunters reads only as it ships, and any caller made it build. One that was not
   * the agent's to start until this write — a team that builds, renamed to a name the list holds — is weighed as a new
   * one is: against none. This computer's caller without the desktop app's key presses nothing (guards.js
   * `pressRefused`).
   * @param {any} r @returns {import("../../services/teams.js").Weigher}
   */
  const refuses = (r) => (was, now) => {
    const unpressed = pressRefused(r.req);
    return unpressed && agentStarts(now) && writesMore(was && agentStarts(was) ? was : null, now) ? unpressed : null;
  };
  /** One field of agentLoop.subagents written, and saved. @param {string} key @param {unknown} value */
  const writeSub = (key, value) => {
    const next = structuredClone(config.get());
    next.agentLoop = { ...next.agentLoop, subagents: { ...next.agentLoop?.subagents, [key]: value } };
    config.set(next);
    config.save();
    return next;
  };
  // A team's save is no config change, so the feed says it here: every session's settings answer lists the teams by
  // name, and a page showing one reads it again (another tab's Team view kept the old name until its next read).
  /** @param {string} key */
  const told = (key) => events.publish("config", { type: "teams-changed", key });
  /** A source's name as the Upstreams page shows it. @param {any} cfg @param {string} id */
  const sourceName = (cfg, id) => String((cfg.upstreams || []).find((/** @type {any} */ u) => u.id === id)?.name || id);
  /** A chat's name, as the left bar says it. @param {string} chainId */
  const chatName = (chainId) => {
    const c = a.memory?.archive?.getChain(chainId);
    return String(c?.title || c?.preview || "a chat").slice(0, 80);
  };
  /**
   * How many agents run on each model at once (team_v2_plan §5.7): a row for every model at a source that has a number
   * set, that a team names, that an agent runs on now or that its provider holds lower — its number, what it lends now
   * and why less, who holds its slots and who waits for one.
   */
  const slotsView = async () => {
    const cfg = config.get();
    const set = slotsOf(cfg.agentLoop?.subagents?.slots);
    const use = a.subagents.slotUse();
    /** @type {Map<string, { upstream: string, model: string, name: string }>} */
    const rows = new Map();
    /** @param {string} upstream @param {string} model @param {string} name */
    const add = (upstream, model, name) => {
      const k = slotKey(upstream, model);
      if (!rows.has(k)) rows.set(k, { upstream, model, name });
    };
    /** @param {string} name @returns {string | null} the key of the row it lands on */
    const named = (name) => {
      const at = name ? a.subagentModelFacts(name)?.at : null;
      if (at) add(at.upstream, at.model, name);
      return at ? slotKey(at.upstream, at.model) : null;
    };
    for (const r of set) add(r.upstream, r.model, r.model);
    for (const t of teams.list()) for (const r of (await a.subagents.teamRows(t)) || []) named(r.model);
    for (const list of use.values()) for (const u of list) named(u.model);
    // Each model a provider holds lower now, as it learned it: its row under its provider says so.
    for (const [id, h] of Object.entries(a.health?.snapshot?.() || {})) for (const c of /** @type {any} */ (h)?.ceilings || []) add(id, c.model, c.model);
    return {
      // No row: no limit (the owner's word of 11-05); a cap with none crosses as null.
      default: null,
      most: SLOTS_MOST,
      rows: [...rows.entries()].map(([k, r]) => {
        const held = use.get(k) || [];
        // A 429's alone: a requests limit its headers state is a minute's, no agents' (the review of 11-05).
        const seen = a.health?.learnedCeiling?.(r.upstream, r.model) || null;
        const s = slotOf(set, r, { seen, running: held.filter((u) => !u.waiting).length });
        /** @type {Map<string, { chainId: string, chat: string, team: string | null, running: number, waiting: number }>} */
        const whom = new Map();
        for (const u of held) {
          const w = whom.get(`${u.chainId}\0${u.team || ""}`) || { chainId: u.chainId, chat: chatName(u.chainId), team: u.team, running: 0, waiting: 0 };
          if (u.waiting) w.waiting++;
          else w.running++;
          whom.set(`${u.chainId}\0${u.team || ""}`, w);
        }
        return { upstream: r.upstream, source: sourceName(cfg, r.upstream), model: r.model, name: r.name, set: s.set, cap: Number.isFinite(s.cap) ? s.cap : null, lowered: s.lowered, running: s.running, waiting: held.filter((u) => u.waiting).length, whom: [...whom.values()] };
      }),
    };
  };
  /** Yours the file keeps that cannot be used now, each with why and what its editor opens on (`team`). */
  const held = () => teams.held().map((h) => ({ ...h, team: teams.heldTeam(h.key) }));
  return [
    [
      "GET",
      "/teams",
      guard((r) =>
        sendJson(r.res, 200, {
          shipped: teams.list().filter((t) => t.shipped),
          saved: saved(),
          // Yours the file keeps that cannot be used now, with why: the Teams page names them, edits one or deletes it on
          // your word.
          held: held(),
          limits: TEAM_LIMITS,
          agentTeams: agentTeams(),
        }),
      ),
    ],
    [
      // A new team, or a Duplicate of one (`from`): the source's lead and members under a new name.
      "POST",
      "/teams",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: NEW_BODY });
        // A check named is a press (`checksUnasked`; r-doors, 11-12), and so is a team that builds made under a name
        // the main agent may start by itself (`refuses`).
        const unpressed = pressRefused(r.req);
        if (unpressed && checksUnasked(b)) return sendJson(r.res, 403, { error: unpressed, press: true });
        const team = teams.create(b, { refuse: refuses(r) });
        ops.record("config", `team \`${team.key}\` created${team.from ? ` (a Duplicate of \`${team.from}\`)` : ""}`, { sub: "team-save", detail: { key: team.key, from: team.from || null } });
        told(team.key);
        return sendJson(r.res, 200, { ok: true, team, saved: saved(), agentTeams: agentTeams() });
      }),
    ],
    [
      "PUT",
      "/teams/:key",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: EDIT_BODY });
        // A check named is a press (`checksUnasked`), and so is a team the main agent may start by itself made to
        // change files, or seated with a card it had not (`refuses`): weighed on the team the write would keep.
        const unpressed = pressRefused(r.req);
        if (unpressed && checksUnasked(b)) return sendJson(r.res, 403, { error: unpressed, press: true });
        const team = teams.update(r.params.key, b, { refuse: refuses(r) });
        // A shipped team's edit says what went back as it ships (SA3).
        const back = Object.keys(b).filter((k) => k !== "reset" && b[k] === null);
        const how = team.shipped ? [b.reset === true ? "every field put back as it ships" : "", back.length ? `${back.join(", ")} put back as it ships` : ""].filter(Boolean).join("; ") : "";
        ops.record("config", `${team.shipped ? "shipped " : ""}team \`${team.key}\` edited${how ? `: ${how}` : ""}`, { sub: "team-save", detail: { key: team.key, fields: Object.keys(b), ...(team.shipped ? { shipped: true } : {}) } });
        told(team.key);
        return sendJson(r.res, 200, { ok: true, team, saved: saved(), held: held(), agentTeams: agentTeams() });
      }),
    ],
    [
      "DELETE",
      "/teams/:key",
      guard((r) => {
        const team = teams.remove(r.params.key);
        ops.record("config", `team \`${team.key}\` deleted`, { sub: "team-delete", detail: { key: team.key } });
        told(team.key);
        return sendJson(r.res, 200, { ok: true, removed: team.key, saved: saved(), held: held(), agentTeams: agentTeams() });
      }),
    ],
    [
      // How many agents run on each model at once across Filament (team_v2_plan TV2-D8, D9), and who holds them now.
      "GET",
      "/subagents/slots",
      guard(async (r) => sendJson(r.res, 200, await slotsView())),
    ],
    [
      // One model's number at one source set, or taken away (`n` null: no limit). A model named as Filament lists it
      // (`name`) is read where it lands. A worker waiting for a slot may start at once.
      "PUT",
      "/subagents/slots",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b || !Object.hasOwn(b, "n")) return sendJson(r.res, 400, { error: SLOTS_BODY });
        const n = b.n;
        if (n !== null && (!Number.isInteger(n) || n < 1 || n > SLOTS_MOST)) return sendJson(r.res, 400, { error: `"n" must be a whole number from 1 to ${SLOTS_MOST}, or null for no limit` });
        const at = typeof b.name === "string" && b.name.trim()
          ? a.subagentModelFacts(b.name.trim())?.at || null
          : typeof b.upstream === "string" && b.upstream.trim() && typeof b.model === "string" && b.model.trim()
            ? { upstream: b.upstream.trim(), model: b.model.trim() }
            : null;
        if (!at) return sendJson(r.res, 400, { error: typeof b.name === "string" ? `"${b.name}" reaches no model: no route leads anywhere for it` : SLOTS_BODY });
        const next = structuredClone(config.get());
        const slots = withSlot(slotsOf(next.agentLoop?.subagents?.slots), at.upstream, at.model, n);
        // A list its check would refuse is never kept: read back as none, it would take every model's limit away.
        const bad = slotsProblem(slots);
        if (bad) return sendJson(r.res, 400, { error: bad.startsWith("holds at most") ? `Not kept: a list of limits ${bad} — take a model's limit away first` : `Not kept: the list of limits ${bad}` });
        next.agentLoop = { ...next.agentLoop, subagents: { ...next.agentLoop?.subagents, slots } };
        config.set(next);
        config.save();
        ops.record("config", `${at.model} at ${sourceName(next, at.upstream)} ${n == null ? "runs agents with no limit" : `runs ${n} agent${n === 1 ? "" : "s"} at once`}`, { sub: "subagents-slots", detail: { upstream: at.upstream, model: at.model, n } });
        a.subagents.pumpSlots();
        return sendJson(r.res, 200, { ok: true, ...(await slotsView()) });
      }),
    ],
    [
      // The teams every chat's main agent may start by itself (U13-D9: "Your agent may use it" on a pod), written whole.
      // Each key names a team; one that names none is refused.
      "PUT",
      "/subagents/teams",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b || !Array.isArray(b.teams) || b.teams.some((/** @type {unknown} */ k) => typeof k !== "string")) return sendJson(r.res, 400, { error: AGENT_TEAMS_BODY });
        const keys = [...new Set(b.teams.map((/** @type {string} */ k) => k.trim().toLowerCase()).filter(Boolean))];
        const unknown = keys.filter((k) => !teams.list().some((t) => t.key === k));
        if (unknown.length) return sendJson(r.res, 400, { error: `no team answers to ${unknown.map((k) => `\`${k}\``).join(", ")}` });
        // One more named is a press (press.js; r-doors, 11-12): a team that builds changes files, and until now the person
        // alone sent it. Against the teams the agent may start now (`agentTeams`: BugHunters where the config names none).
        const unpressed = pressRefused(r.req);
        if (unpressed && namesMore(keys, agentTeams())) return sendJson(r.res, 403, { error: unpressed, press: true });
        writeSub("teams", keys);
        ops.record("config", keys.length ? `a chat's main agent may start ${keys.map((k) => `\`${k}\``).join(", ")} by itself` : "a chat's main agent may start no team by itself", { sub: "subagents-teams", detail: { teams: keys } });
        told("");
        return sendJson(r.res, 200, { ok: true, agentTeams: keys });
      }),
    ],
  ];
}
