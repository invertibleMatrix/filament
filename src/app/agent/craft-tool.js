// @ts-check
// The crafter's `skill_craft` tool (the owner's word of 10-27: "the crafter should just open a new interactive session where
// i could see the whole transcript how crafter is working so that i could steer it if needed … nothing should run
// behind the scene"). A crafter chat is a chat like any other — its agent, its model and every tool it has, the web and
// the browser too — opened by `/craft <words>` or a made skill's Craft it in a chat…; this tool is what it has beside
// them, there and nowhere else: `make` names the skill the chat crafts (a skill made in Filament, on nowhere until the
// person turns it on), `books` adds files or folders on this computer to its library (split by chapter with their pages
// and indexed), `find` and `read` look in it, `write` puts a file in its folder, and `look` shows it as it stands. Every
// step is a call the person reads in the transcript. A SKILL.md written keeps the lines the person added from memory
// (skill-from-memory.js), and the answer says so. One tool for both engines: the loop offers it, and a coding agent
// reaches it over Filament's MCP server (agent-tools.js).
import { isAbsolute, join, resolve } from "node:path";
import { SKILL_NAME_RE } from "../../services/session-settings.js";
import { skillAnswer } from "./skills.js";
import { fromMemoryOf, keepFromMemory } from "../skill-from-memory.js";

export const CRAFT_NAME = "skill_craft";
/** What the tool does, in the order its description gives them. */
export const CRAFT_ACTIONS = Object.freeze(["make", "look", "books", "find", "read", "write"]);
/** A call where the chat crafts no skill. */
export const CRAFT_OFF = "Not run: only a crafter chat crafts a skill — /craft opens one.";
/** How much of a SKILL.md `look` shows. */
const LOOK_CHARS = 12_000;

export const CRAFT_TOOL = Object.freeze({
  name: CRAFT_NAME,
  description:
    "Craft the skill this chat is for: the guide an AI agent loads when a request needs it. " +
    '"make" names it once, with what it is for (a skill made in Filament; on nowhere until the person turns it on). ' +
    '"books" adds files or folders on this computer (PDF, Markdown, text) to its library: split by chapter with their pages, indexed. ' +
    '"find" ranks the library\'s parts by your words and gives the passage with its book and page; "read" gives a file of the skill\'s folder a page at a time. ' +
    '"write" puts a file in its folder: SKILL.md, or references/<topic>.md for what you gathered elsewhere (the web, the chat it came from). ' +
    '"look" shows it as it stands. Lines the person added from memory stay in SKILL.md whatever you write.',
  input_schema: Object.freeze({
    type: "object",
    required: ["action"],
    properties: Object.freeze({
      action: Object.freeze({ type: "string", enum: [...CRAFT_ACTIONS] }),
      name: Object.freeze({ type: "string", description: "make: the skill's name: letters, digits, . _ and -, 64 at most." }),
      description: Object.freeze({ type: "string", description: "make: what it is for, in one line; agents read only this until they load it." }),
      paths: Object.freeze({ type: "array", items: Object.freeze({ type: "string" }), description: "books: files or folders on this computer." }),
      words: Object.freeze({ type: "string", description: "find: your words." }),
      path: Object.freeze({ type: "string", description: "read, write: a file of the skill's folder, as look names it (SKILL.md, references/…)." }),
      from: Object.freeze({ type: "integer", minimum: 1, description: "read: the line to start at." }),
      text: Object.freeze({ type: "string", description: "write: the file's whole text." }),
    }),
    additionalProperties: false,
  }),
});

/**
 * The crafter chats as the agents' tools reach them, wired once by the server: the skill a chat crafts (null before
 * `make`; the chat is no crafter's where `of` gives null), and the skill store's and the library's work on it.
 * @typedef {{ of: (chain: string) => { skill: string | null } | null,
 *   make: (chain: string, name: string, description: string) => { name: string, dir: string },
 *   dirOf: (name: string) => string, text: (name: string) => string, write: (name: string, path: string, text: string) => void,
 *   books: (dir: string, name: string, paths: string[]) => Promise<{ added: import("../skill-library.js").Book[], skipped: { name: string, why: string }[], books: import("../skill-library.js").Book[] }>,
 *   booksOf: (dir: string) => import("../skill-library.js").Book[], files: (name: string) => { path: string, size: number, dir: boolean }[],
 *   cwdOf?: (chain: string) => string | null }} CraftDeps  `cwdOf`: the chat's working folder, which a book's path given
 *   short is read from, as the agent's other tools read it (the drive of 10-27).
 */

/**
 * Where a call of a chat stands, or null where the chat crafts no skill.
 * @param {CraftDeps | null | undefined} deps @param {string | null | undefined} chain
 */
export function craftAtOf(deps, chain) {
  if (!deps || !chain || !deps.of(chain)) return null;
  return { chain, deps };
}

/** @param {string} error @returns {{ ok: false, error: string }} */
const no = (error) => ({ ok: false, error });

/** A book in one line: its name, its parts and pages, how it was split. @param {import("../skill-library.js").Book} b */
const bookLine = (b) => `- ${b.name}: ${b.parts.length} part${b.parts.length === 1 ? "" : "s"}${b.pages ? `, ${b.pages} pages` : ""}, split by ${b.split}${b.noText.length ? `; ${b.noText.length} page${b.noText.length === 1 ? "" : "s"} with no text (scans or figures: not read)` : ""}`;

/**
 * One call of the tool, its answer in words, or its refusal.
 * @param {any} input @param {{ chain: string, deps: CraftDeps }} at
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function craftCall(input, at) {
  const { chain, deps } = at;
  const action = String(input?.action ?? "").trim().toLowerCase();
  if (!CRAFT_ACTIONS.includes(action)) return no(`${CRAFT_NAME} takes an action: ${CRAFT_ACTIONS.join(", ")}${action ? `; ${action.slice(0, 40)} is none of them` : ""}.`);
  const skill = deps.of(chain)?.skill || null;
  try {
    if (action === "make") {
      if (skill) return no(`This chat crafts ${skill} already: look, books, find, read and write work on it.`);
      const name = String(input?.name ?? "").trim();
      if (!SKILL_NAME_RE.test(name)) return no("make needs the skill's name: letters, digits, . _ and -, a letter or digit first, 64 at most.");
      const made = deps.make(chain, name, String(input?.description ?? "").trim());
      return { ok: true, text: `Made ${made.name}, in ${made.dir}. It is on nowhere until the person turns it on (Library › Skills). Add its books, gather what else it needs, and write its SKILL.md.` };
    }
    if (!skill) return no('No skill yet: make it first ({"action":"make","name":"…","description":"…"}).');
    const dir = deps.dirOf(skill);
    if (action === "look") {
      const text = deps.text(skill);
      const files = deps.files(skill).filter((f) => !f.dir).map((f) => `- ${f.path} (${f.size} B)`);
      const books = deps.booksOf(dir).map(bookLine);
      const mem = fromMemoryOf(dir).filter((r) => r.lines.every((l) => text.includes(l.trim())));
      return {
        ok: true,
        text: [
          `Skill: ${skill}, in ${dir}`,
          books.length ? `Its library:\n${books.join("\n")}` : "Its library: no books yet.",
          `Its files:\n${files.join("\n") || "(none)"}`,
          mem.length ? `Lines the person added from memory, kept in SKILL.md whatever you write:\n${mem.map((r) => `${r.section}: ${r.lines.join(" / ")}`).join("\n")}` : "",
          `SKILL.md:\n${text.length > LOOK_CHARS ? `${text.slice(0, LOOK_CHARS)}\n…[cut: read it with "read" for the rest]` : text}`,
        ].filter(Boolean).join("\n\n"),
      };
    }
    if (action === "books") {
      const paths = Array.isArray(input?.paths) ? input.paths.filter((/** @type {unknown} */ p) => typeof p === "string" && p.trim()) : [];
      if (!paths.length) return no("books needs paths: files or folders on this computer.");
      const base = deps.cwdOf?.(chain) || null;
      const got = await deps.books(dir, skill, paths.map((/** @type {string} */ p) => (base && !isAbsolute(p.trim()) ? resolve(base, p.trim()) : p)));
      const parts = [
        got.added.length ? `Added:\n${got.added.map(bookLine).join("\n")}` : "Nothing added.",
        got.skipped.length ? `Not added:\n${got.skipped.map((s) => `- ${s.name}: ${s.why}`).join("\n")}` : "",
        got.added.length ? "references/INDEX.md lists the parts; find ranks them by your words." : "",
      ];
      return { ok: true, text: parts.filter(Boolean).join("\n") };
    }
    if (action === "write") {
      const path = String(input?.path ?? "").trim().replace(/\\/g, "/");
      if (!path || typeof input?.text !== "string") return no("write needs path and text: the file and its whole text.");
      if (path.startsWith(".library/") || path === ".library") return no("Its library is Filament's to write: add books with books.");
      let text = input.text;
      let kept = 0;
      if (path.toLowerCase() === "skill.md") {
        const got = keepFromMemory(dir, deps.text(skill), text);
        text = got.text;
        kept = got.kept;
      }
      deps.write(skill, path, text);
      const lines = text.split(/\r?\n/).length;
      return { ok: true, text: `Wrote ${path} in ${skill} (${lines} line${lines === 1 ? "" : "s"}).${kept ? ` ${kept} block${kept === 1 ? "" : "s"} of lines the person added from memory ${kept === 1 ? "was" : "were"} not in it: Filament put ${kept === 1 ? "it" : "them"} back under ${kept === 1 ? "its section" : "their sections"}.` : ""}` };
    }
    // find and read: the skill tool's own, on this skill's folder.
    const s = { name: skill, description: "", triggers: [], path: join(dir, "SKILL.md"), folder: dir, body: deps.text(skill), chars: 0, plugin: "", kind: /** @type {const} */ ("skill") };
    const got = skillAnswer([s], { name: skill, action, path: input?.path, from: input?.from, words: input?.words });
    return got.ok ? { ok: true, text: got.text } : no(got.text);
  } catch (/** @type {any} */ e) {
    if (Number.isInteger(e?.status)) return no(`Not done: ${e.message}`);
    throw e;
  }
}
