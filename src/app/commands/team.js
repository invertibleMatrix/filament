// @ts-check
// `/team` (HarnessV3-AtHome P2): which team answers a harness chat's turns. Alone it lists the teams and says which
// one leads here; `/team <name>` hands the chat's turns to that team from the next message on (engine.mode and
// engine.team, written in one write through the one writer); `/team off` gives the chat back. A team's lead runs on the chat's model, and its members on the chat's Workers — its Agents on the
// side's models while it sets none (HarnessV4_Tasks E23-D6) — or the model the lead or their card names. The lead's
// orders run at once.
import { answerWith, commandChain, openCommandRecord } from "./answer.js";
import { engineProblemFor } from "../engine.js";
import { sessionEngineOf } from "../../services/session-settings.js";
import { sentence } from "../../core/text.js";
import { poolLine, poolOf } from "../../core/pool.js";
import { foldedTeam, foldedTeamWords } from "../../core/folded-teams.js";
import { TEAMS_OFF, teamsOn } from "../../core/teams-on.js";

/** What a Brief picked for a team's crew (U13-D8): its run's alone, so no other team's, nor your agent's, keeps it. */
const PICK_KNOBS = ["engine.teamWorkers", "engine.teamEffort"];
/** What `/team off` unsets. */
const OFF_KNOBS = ["engine.mode", "engine.team", ...PICK_KNOBS];
/** What a team that changes no file is held to in the chat it leads (engine.js), said by its card and its answer alike. */
const READS_ONLY = "It changes no file: its lead and its workers only read here, whatever this chat's permission mode says.";
/**
 * What a `/team` answer's card leads with (core/cards.js `lead`): what changed for the person, in the words the band
 * over the chat and the Brief say it. The page draws the card in the text's place, the settings' rows under this.
 */
const LEADS = Object.freeze({
  /** @param {string} name @param {boolean} readOnly  a team that changes no file: the chat it leads is held to reading */
  charge: (name, readOnly) =>
    `${name} is in charge of this chat: its lead takes your agent's place and answers from your next message. ${readOnly ? `${READS_ONLY} ` : ""}Back to your agent, on the band at the chat's top, hands the chat back.`,
  /** @param {string} name @param {string} why */
  cannot: (name, why) => `${name} cannot run this chat yet: ${why} — until it can, your agent answers.`,
  back: "Your agent has this chat again: it answers from your next message, and the whole conversation stays.",
});
/** A settings change's card with its lead. @param {any} card @param {string} lead */
const led = (card, lead) => (card ? { ...card, lead } : card);

/**
 * The whole `/team` surface as one reply: the list, a team chosen, `off` and `help`. `named` is the name the chat's
 * request carries and what parse made of it: a team cannot lead on a name that reaches a coding agent.
 * @param {any} memory @param {import("../../services/teams.js").TeamStore} teams @param {any} cfg
 * @param {string | null} chainId  the session the command hands to a team (answer.js `commandChain`)
 * @param {{ arg: string }} cmd @param {{ named?: { model: string, agent: { model: string } | null } }} [o]
 * @returns {{ text: string, chainId: string | null, card?: any }}
 */
export function teamCommandReply(memory, teams, cfg, chainId, { arg }, { named = { model: "", agent: null } } = {}) {
  const prefix = "/team";
  if (!chainId) return { text: `No archive, so this chat has no session to hand to a team. ${memory.archiveWhy()}`, chainId: null };
  const doc = memory.docFor(chainId);
  const eng = sessionEngineOf(doc.effective);
  const problem = engineProblemFor(eng, cfg, named, teams);
  const leading = eng.mode === "team" && !problem ? teams.find(eng.team) : null;
  // What answers when no team does: the harness's own agent.
  const solo = "your agent";
  // The chat's list in a line (U13-D14): the models a member runs on where neither its team nor its card names one, in
  // the order a member takes one — the chat's own alone, else its own model (the owner's word of 11-05).
  const workers = poolLine(poolOf(doc.flat["subagents.pool"]), { mainWords: "this chat's own model" });
  const whence = doc.sources["subagents.pool"] === "session" ? "this chat's list, subagents.pool" : "this chat lists none, subagents.pool";
  const words = String(arg || "").trim();
  const first = words.split(/\s+/)[0].toLowerCase();
  // While Settings › Experimental's Teams switch is off `/team` lists none and hands the chat to none; `off` still
  // gives a chat set to a team back, clearing what stays of its setting (core/teams-on.js).
  if (!teamsOn(cfg) && first !== "off")
    return { text: `${TEAMS_OFF}.${eng.mode === "team" ? ` This chat's settings name a team, which leads it again once teams are on: until then ${solo} answers it, and \`${prefix} off\` clears the setting.` : ""}`, chainId };

  if (!words || first === "list") {
    const lines = [
      `**Teams** — this chat's turns go to ${leading ? `team **${leading.name}**` : eng.mode === "team" && problem ? `${solo}: its team cannot lead — ${problem}` : solo}.`,
      ...teams.list().map((t) => `- \`${t.key}\` **${t.name}**${t.shipped ? " (shipped)" : ""}${leading?.key === t.key ? " **· leads this chat**" : ""} — ${t.line ? `${sentence(t.line)} ` : ""}${t.lead.name} leads ${t.members.map((m) => m.name).join(", ")}.`),
      `A team is a lead on this chat's model — it plans, briefs and checks — and the workers it hands the work to. Its workers run on ${workers} (${whence}), each on the first with room, unless the team, the lead or a worker's card names a model.`,
      `Use one: \`${prefix} <name>\` · give the chat back: \`${prefix} off\` · the forms: \`${prefix} help\``,
    ];
    return { text: lines.join("\n"), chainId };
  }
  if (first === "help" || first === "?")
    return {
      text: [
        `**${prefix}** — which team answers this chat's turns.`,
        `- \`${prefix}\` — the teams, and which one leads this chat.`,
        `- \`${prefix} <name>\` — that team answers this chat's turns from the next message on: its lead runs on the chat's model and plans, briefs and checks; its workers run on the team's own models, else the model the lead or their card names, else this chat's list (subagents.pool), else its model, and do the work. The lead's orders run at once, and an apply commits nothing; your messages reach it at its next round.`,
        `- \`${prefix} off\` — give the chat back to ${solo}.`,
        "Two teams ship with Filament — Builders, and BugHunters, which finds bugs and checks claims — and yours sit beside them. A compaction and Filament's own calls never go to the team.",
      ].join("\n"),
      chainId,
    };
  if (first === "off") {
    if (eng.mode !== "team") return { text: `No team answers this chat: its turns already go to ${solo}.`, chainId };
    const r = memory.patchSessionSettings(chainId, { unset: OFF_KNOBS }, { via: `${prefix} off`, card: true });
    if (r.errors?.length) return { text: `The command failed: ${r.errors.join("; ")}`, chainId };
    return {
      text: [
        `This chat's turns go to ${solo} again, from the next message on (unset: ${r.changes.map((/** @type {any} */ c) => c.path).join(", ")}).`,
        "The next request starts a fresh prompt cache, once.",
      ].join("\n"),
      chainId,
      card: led(r.card, LEADS.back),
    };
  }
  const team = teams.find(words);
  if (!team) {
    // A team Filament does not ship says which team does its work — Builders, or BugHunters — and the command that
    // picks it. Either way the answer names the teams there are, each by the key the command takes.
    const folded = foldedTeam(words);
    const there = teams.list().map((t) => `\`${t.key}\` (${t.name})`).join(", ");
    return { text: `There is no team called \`${words}\`${folded ? ` — ${foldedTeamWords(words)} (\`${prefix} ${folded.into}\`)` : ""}. ${there ? `The teams: ${there}; \`${prefix}\` says what each does.` : `\`${prefix}\` lists the teams.`}`, chainId };
  }
  // The team that leads already keeps what a Brief picked for its crew: only a change of team drops it (the review of 11-05).
  const already = { text: `Team **${team.name}** already answers this chat's turns; nothing was written.`, chainId };
  // One that cannot lead says why, and writes nothing either (the reviews of a072feeea and 8a278df79): the same team
  // again would drop the Brief's pick, and change nothing that keeps it from leading. The team set is found as the
  // engine finds it, by its key or its name (the review of f91f08190).
  const current = eng.mode === "team" && eng.team ? teams.find(eng.team) : null;
  if (current?.key === team.key)
    return problem ? { text: `Team **${team.name}** is this chat's team, but it cannot lead yet: ${problem} — until it can, this chat's turns go to ${solo}; nothing was written.`, chainId } : already;
  const r = memory.patchSessionSettings(chainId, { patch: { "engine.mode": "team", "engine.team": team.key }, unset: PICK_KNOBS }, { via: `${prefix} ${team.key}`, card: true });
  if (r.errors?.length) return { text: `The command failed: ${r.errors.join("; ")}`, chainId };
  if (!r.changes.length) return already;
  const now = engineProblemFor(sessionEngineOf(memory.docFor(chainId).effective), cfg, named, teams);
  // A member the team names a model for runs on it, and one whose card names a model on that, whatever the chat's Workers.
  const own = team.members.filter((m) => m.own?.model || m.model);
  const says = own.every((m) => !m.own?.model) ? (own.length === 1 ? "its card says" : "their cards say") : own.every((m) => m.own?.model) ? "the team says" : "the team and their cards say";
  return {
    text: [
      `Team **${team.name}** answers this chat's turns from the next message on: its lead runs on the chat's model, its workers on ${workers}${own.length ? ` — ${own.map((m) => `${m.name} on ${m.own?.model || m.model}`).join(", ")}, as ${says}` : ""}.`,
      // One that leads only reads here, whatever the mode (the card's words, `LEADS.charge`).
      ...(team.readOnly && !now ? [READS_ONLY] : []),
      ...(now ? [`It cannot lead yet: ${now} — until it can, this chat's turns go to ${solo}.`] : []),
      "The next request starts a fresh prompt cache, once.",
      `Give the chat back: \`${prefix} off\`.`,
    ].join("\n"),
    chainId,
    card: led(r.card, now ? LEADS.cannot(team.name, now) : LEADS.charge(team.name, team.readOnly)),
  };
}

/**
 * The stage's entry: answer the parsed command on a record of its own.
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ arg: string }} cmd
 */
export function answerTeamCommand(ctx, deps, cmd) {
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream });
  const r = teamCommandReply(deps.memory, /** @type {any} */ (deps.teams), deps.config(), commandChain(ctx, deps), cmd, { named: { model: ctx.body.model, agent: ctx.agent } });
  // The record names its session before it is written, so the log's line and the live feed carry it.
  if (r.chainId) rec.memory = { ...(rec.memory || {}), chain: r.chainId };
  answerWith(ctx, deps, rec, r.text, {
    changes: ["team command answered by Filament, upstream not called"],
    local: true,
    card: r.card,
  });
}
