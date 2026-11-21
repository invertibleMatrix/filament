// @ts-check
// The skills a coding agent is owed after it compacted its own context (c-skills): those it had loaded with Filament's
// skill tool, whose text the compaction may have taken, until the block that names them reached it. They are kept with
// the chat, in its meta (`skillsBack`), beside what its agent heard of what is still open (still-open.js `openHeard`,
// whose `lost` says a compaction is still unsaid): a restart between the compaction and the block keeps both. Each
// agent session has its own — the chat's own agent's, and each sub-agent's run on a coding agent by the sub-agent's id
// —, so a sub-agent that compacts neither hears the chat's agent's skills nor writes over them. Whoever sees the
// compaction writes them: the turn it fell in (acp-turn.js `compactedAfter`), or the compaction asked of the agent
// outside a turn (sessions/compactor.js `own`).
import { newestSkills } from "../sessions/reattach.js";

/** A skill by its name, and the turn it was loaded in where that is known. @typedef {{ name: string, turn?: number }} SkillBack */

/** Whose skills they are where the chat's own agent compacted; a sub-agent's run is named by its id. */
export const CHATS_AGENT = "agent";
/**
 * The most sub-agents a chat keeps skills for at once, the one written longest ago let go first: a run that compacted
 * and never took another step would else leave its entry with the chat for good.
 */
export const SKILLS_BACK_RUNS = 8;

/**
 * @param {{ archive?: () => { metaOf: (chainId: string, keys: readonly string[]) => Record<string, any> | null, mergeMeta: (chainId: string, patch: Record<string, any>) => any } | null | undefined }} [o]
 *   `archive`: where the chat's meta is, read at each call — with none, nothing is kept and nothing is owed.
 */
export function createSkillsBack({ archive = () => null } = {}) {
  /** Every session's skills the chat keeps, as written. @param {string} chain @returns {Record<string, SkillBack[]>} */
  const all = (chain) => {
    const kept = chain ? archive()?.metaOf(chain, ["skillsBack"])?.skillsBack : null;
    /** @type {Record<string, SkillBack[]>} */
    const out = {};
    if (!kept || typeof kept !== "object") return out;
    for (const [who, list] of Object.entries(kept)) {
      const skills = (Array.isArray(list) ? list : []).filter((k) => k && typeof k.name === "string" && k.name).map((k) => ({ name: String(k.name), ...(Number(k.turn) > 0 ? { turn: Number(k.turn) } : {}) }));
      if (skills.length) out[who] = skills;
    }
    return out;
  };
  /** One session's skills, written last of the chat's; none, and its entry goes. @param {string} chain @param {string} who @param {readonly SkillBack[]} skills */
  const keep = (chain, who, skills) => {
    const { [who]: _, ...rest } = all(chain);
    const next = skills.length ? { ...rest, [who]: [...skills] } : rest;
    const runs = Object.keys(next).filter((w) => w !== CHATS_AGENT);
    for (const gone of runs.slice(0, Math.max(0, runs.length - SKILLS_BACK_RUNS))) delete next[gone];
    archive()?.mergeMeta(chain, { skillsBack: Object.keys(next).length ? next : undefined });
  };
  return {
    /** The skills a session is owed, the newest first. @param {string} chain @param {string} [who] @returns {SkillBack[]} */
    of: (chain, who = CHATS_AGENT) => all(chain)[who] || [],
    /**
     * The session compacted: it is owed what it was owed still — a compaction before this one, whose block never went —
     * and what it had loaded since (`loaded`, oldest first), each skill once.
     * @param {string} chain @param {string} who @param {readonly SkillBack[]} loaded
     */
    compacted(chain, who, loaded) {
      // With none loaded since, what it is owed still stands as it is kept.
      if (!chain || !loaded.length) return;
      keep(chain, who, newestSkills([...[...(all(chain)[who] || [])].reverse(), ...loaded]));
    },
    /** The session loaded a skill again: its text is in its context once more. @param {string} chain @param {string} who @param {string} name */
    loaded(chain, who, name) {
      const owed = chain ? all(chain)[who] : null;
      if (!owed) return;
      const rest = owed.filter((k) => k.name.toLowerCase() !== name.toLowerCase());
      if (rest.length !== owed.length) keep(chain, who, rest);
    },
    /** The block that names them reached the session, or nothing will say them any more: none is owed. @param {string} chain @param {string} [who] */
    heard(chain, who = CHATS_AGENT) {
      if (chain && all(chain)[who]) keep(chain, who, []);
    },
  };
}

/** @typedef {ReturnType<typeof createSkillsBack>} SkillsBack */
