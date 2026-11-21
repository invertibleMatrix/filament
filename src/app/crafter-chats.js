// @ts-check
// Crafter chats (the owner's word of 10-27: "the crafter should just open a new interactive session where i could see
// the whole transcript how crafter is working so that i could steer it if needed. crafter session will be like any
// other session with all the tools out there even web tools or browser tools … nothing should run behind the scene").
// `/craft <words>` in a harness chat, or a made skill's Craft it in a chat…, opens a new chat in the same folder with the
// same model: its first message — the person's words with Filament's crafter brief ahead of them — waits in its box for
// the person's Send, nothing sent before it (the owner's word of 10-27: "it should not send any message to the agent
// itself but instead paste the text in the compose and let me press the send so that i can change the model and stuff
// if needed"), and its agent has the `craft` tool (agent/craft-tool.js) beside every tool it has anyway. The chat's
// meta says it crafts — `craft.skill`, the skill it makes (null until its agent names it), and `craft.from`, the chat
// it was opened from, which the sessions list carries for the line over the box (ui conversation/crafter-line.js).
// Nothing crafts out of sight: every step is a call in that chat's transcript. A skill has one crafter chat
// (`.library/crafter.json` in its folder): asked again — its page's button, or a chat that crafts it already — that
// chat opens, never a second one writing the same SKILL.md. Its title says the skill once its agent names it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The most of the person's words a crafter chat's title takes. */
const TITLE_WORDS = 60;

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** Where a made skill keeps the chat that crafts it. @param {string} dir */
const crafterFile = (dir) => join(dir, ".library", "crafter.json");
/** The chat that crafts a made skill, as its folder keeps it, or null. @param {string} dir @returns {string | null} */
const crafterOf = (dir) => {
  try {
    const id = JSON.parse(readFileSync(crafterFile(dir), "utf8"))?.chat;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
};
/** @param {string} dir @param {string} chat */
const keepCrafter = (dir, chat) => {
  mkdirSync(join(dir, ".library"), { recursive: true });
  writeFileSync(crafterFile(dir), JSON.stringify({ chat }));
};

/**
 * The first message of a crafter chat: the person's words, and how a skill is crafted here.
 * @param {{ words: string, skill?: string | null, from?: { id: string, title: string } | null, books?: string[] }} o
 */
export function crafterBrief({ words, skill = null, from = null, books = [] }) {
  const asked = String(words || "").trim();
  return [
    "[Filament: this chat crafts a skill — the guide an AI agent loads when a request needs it, kept in Filament's Library for every agent. The person reads this chat and may steer it.]",
    asked ? `The person asked: ${asked}` : `The person asked to craft ${skill} from its books.`,
    skill
      ? `This chat crafts ${skill}, a skill made in Filament already${books.length ? `, with its books: ${books.join(", ")}` : ""}. Look at it first: skill_craft {"action":"look"}.`
      : 'Name the skill first: skill_craft {"action":"make","name":"…","description":"…"}, with a short name and one line on what it covers and when to use it; agents read only that line until they load it.',
    [
      "How to craft it:",
      "- Make and write it with Filament's skill_craft tool alone, not a skill-creator skill of your own nor your own skills folder: only what skill_craft writes is in Filament's Library, for every agent.",
      "- Files or folders on this computer go in its library: skill_craft books (PDF, Markdown, text; split by chapter with their pages, and indexed). Read them with skill_craft find and skill_craft read.",
      "- Before you read books, say their parts and pages and how you will read them; past about 100 pages, wait for the person's go. Keep your notes in references/notes.md with skill_craft write as you read, so nothing is lost if the chat compacts.",
      "- What the web holds: your web tools or the browser. Keep what the skill needs as references/<topic>.md with skill_craft write, with the address it came from.",
      from ? `- The chat this was asked in, "${from.title}" (${from.id}): read its turns with Filament's memory tools when the person points at it ("this chat", "what we worked out").` : "",
      "- Write SKILL.md with skill_craft write: its front matter's name and description; then When to use it; How to work (the method step by step, plainly, since small models read it); Rules (values, limits, must-nots, each with where it is); Mistakes to avoid; Where to look (a line a topic: the file and its pages). Keep it short: the detail stays in the library and references.",
      "- Ask the person when what to include is unclear, and before a long gathering.",
      "- End by saying what it holds, and that it is on nowhere until the person turns it on (Library › Skills, or a chat's Start board).",
    ]
      .filter(Boolean)
      .join("\n"),
  ].join("\n\n");
}

/** A crafter chat's title: the skill once named, else the person's first words. @param {string} words @param {string | null} skill */
export const crafterTitle = (words, skill) => {
  if (skill) return `Craft · ${skill}`;
  const w = String(words || "").replace(/\s+/g, " ").trim();
  return `Craft · ${w.length > TITLE_WORDS ? `${w.slice(0, TITLE_WORDS - 1)}…` : w || "a skill"}`;
};

/**
 * @param {{ store: () => ReturnType<typeof import("./skill-store.js").createSkillStore> | null,
 *   library: () => ReturnType<typeof import("./skill-library.js").createSkillLibrary> | null,
 *   archive: () => any, sessions: () => any,
 *   log?: (level: string, msg: string) => void }} o
 */
export function createCrafterChats({ store, library, archive, sessions, log = () => {} }) {
  const need = () => {
    const s = store();
    const l = library();
    if (!s || !l) throw refused(503, "skills are not wired in this Filament");
    return { s, l };
  };
  /** A chat's craft, from its meta. @param {string} chain @returns {{ skill: string | null, from: string | null } | null} */
  const craftOf = (chain) => {
    try {
      const c = archive()?.getChain?.(String(chain))?.meta?.craft;
      return c && typeof c === "object" ? { skill: typeof c.skill === "string" && c.skill ? c.skill : null, from: typeof c.from === "string" ? c.from : null } : null;
    } catch {
      return null;
    }
  };

  /** @type {import("./agent/craft-tool.js").CraftDeps} */
  const tool = {
    of: craftOf,
    make(chain, name, description) {
      const { s } = need();
      const made = s.make({ name, description });
      const a = archive();
      a?.mergeMeta?.(String(chain), { craft: { ...(craftOf(chain) || {}), skill: made.name } });
      a?.setTitle?.(String(chain), crafterTitle("", made.name));
      keepCrafter(s.madeFolder(made.name), String(chain));
      log("info", `skills: chat ${chain} crafts ${made.name}`);
      return { name: made.name, dir: s.madeFolder(made.name) };
    },
    dirOf: (name) => need().s.madeFolder(name),
    text: (name) => String(need().s.get(name)?.text || ""),
    write: (name, path, text) => {
      need().s.writeFile(name, path, text);
    },
    books: (dir, name, paths) => need().l.add(dir, name, { paths }),
    booksOf: (dir) => need().l.books(dir),
    files: (name) => need().s.get(name)?.files || [],
    cwdOf: (chain) => {
      const cwd = archive()?.getChain?.(String(chain))?.meta?.cwd;
      return typeof cwd === "string" && cwd ? cwd : null;
    },
  };

  return {
    tool,
    /**
     * A crafter chat opened: made in the folder and with the model given — or the chat it was asked in's — nothing sent.
     * `skill`: a made skill it crafts (its page's Craft it in a chat…). → the chat's id and title, and `draft`, its first
     * message for the page to put in its box; a skill's crafter chat that stands already comes back `reused`, no draft.
     * @param {{ words?: string, chain?: string | null, skill?: string | null, cwd?: string | null, model?: string | null }} o
     * @returns {{ id: string, title: string, skill: string | null, reused?: true, draft?: string }}
     */
    start({ words = "", chain = null, skill = null, cwd = null, model = null }) {
      const { s, l } = need();
      const asked = String(words || "").trim();
      const named = skill ? String(skill).trim() : null;
      if (!asked && !named) throw refused(400, "say what to craft: /craft <what the skill is for, and what to make it from>");
      const a = archive();
      const src = chain ? a?.getChain?.(String(chain)) : null;
      if (chain && !src) throw refused(404, "no such chat");
      const folder = String(cwd || src?.meta?.cwd || "").trim();
      if (!folder) throw refused(400, "say the folder the crafter chat works in");
      const as = String(model || (chain ? sessions()?.settingsOf?.(String(chain))?.effective?.model?.name : "") || "").trim() || null;
      let books = /** @type {string[]} */ ([]);
      let name = null;
      if (named) {
        const dir = s.madeFolder(named); // a skill made in Filament, or its refusal in words
        name = s.get(named).name;
        books = l.books(dir).map((b) => b.name);
        // Its crafter chat, where it has one: that chat opens, with what it had — never a second writing the same files.
        const had = crafterOf(dir);
        const row = had ? a?.getChain?.(had) : null;
        if (had && row) return { id: had, title: String(row.title || crafterTitle("", name)), skill: name, reused: true };
      }
      const chat = sessions().create({ cwd: folder, model: as, title: crafterTitle(asked, name) });
      a?.mergeMeta?.(chat.id, { craft: { skill: name, from: chain ? String(chain) : null } });
      if (name) keepCrafter(s.madeFolder(name), chat.id);
      const from = chain ? { id: String(chain), title: String(src?.title || "untitled") } : null;
      log("info", `skills: crafter chat ${chat.id} opened${name ? ` for ${name}` : ""}${chain ? ` from ${chain}` : ""}, its brief in its box`);
      return { id: chat.id, title: crafterTitle(asked, name), skill: name, draft: crafterBrief({ words: asked, skill: name, from, books }) };
    },
  };
}
