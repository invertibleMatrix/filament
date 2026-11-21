// @ts-check
// Skills (HarnessV2 §5.6, HarnessV4_Skills_Plan): `SKILL.md` files — front matter `name`, `description`, `triggers` —
// kept in Library › Skills (app/skill-store.js) and on at a place (`skills.on`), beside the plugins' on there. The
// catalogue rides every agent's instructions in a fixed budget however many are on (`skillLines`, the owner's word of
// 10-27: "no context should be bloated for an agent no matter how many skills there are"), each line with the skill's
// triggers, which the model reads to choose the skill a request needs — no word of the person's loads one (the memory
// upgrade's a4); a skill whose name is typed as $<name> (or /<name>) rides whole for that turn, so the model has the
// procedure in front of it exactly when it is called; the skill tool finds one by words — among those on, and the
// Library's off here, which a load turns on for the chat (the owner's of 11-06) —, loads one, and reads the files of its
// folder — and a skill's library (step 2), its books' parts ranked by the words asked. A skill's text is read when it is
// loaded, not to list it.
import { readFileSync, readdirSync, statSync, existsSync, realpathSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, join, basename, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { agentHomeVar, agentKey, agentLaunchEnv } from "../../core/catalogues.js";
import { booksIn, findInLibrary, pagesWords } from "../skill-library.js";

export const SKILL_BODY_CAP = 16_000;
/** The most skills one chat reads: past them a problem is said. Not a limit of the prompt, whose list costs SKILLS_LIST_BUDGET. */
export const SKILLS_MAX = 1_000;
/** The most characters the list of your skills takes in an agent's instructions, however many are on. */
export const SKILLS_LIST_BUDGET = 1_500;
/** The most skills a find across them names: on here, and in the Library but off here. */
export const SKILL_FIND_ON = 10;
export const SKILL_FIND_OFF = 5;
/** An unknown name is answered with every name while there are at most these; past them, with how to find one. */
const NAMES_SAID = 30;
/** The first bytes of a SKILL.md read for its front matter; the rest is read when the skill is loaded. */
const HEAD_BYTES = 8_192;
/** A page of a skill's file read with the skill tool (HarnessV4_Skills_Plan S1-5): at most these lines, these characters. */
export const SKILL_READ_LINES = 400;
export const SKILL_READ_CHARS = 40_000;
/** The most entries a list of a skill's folder names, and the most lines a find gives. */
export const SKILL_LIST_MAX = 200;
export const SKILL_FIND_HITS = 40;
/** A find reads at most these files, each up to this size. */
const FIND_FILES_MAX = 2_000;
const FIND_FILE_BYTES = 2_000_000;
/** The largest file a read pages through. */
const READ_FILE_BYTES = 20_000_000;

/**
 * `plugin`: the plugin it came with, by name ("" for your own); `kind`: a command is a plugin's procedure you may also
 * type as `/<plugin>:<name>`.
 * @typedef {{ name: string, description: string, triggers: string[], path: string, folder: string, body: string, chars: number, plugin: string, kind: "skill" | "command" }} Skill
 */

/**
 * A front matter value without its quotes: a double-quoted one's escaped quote and backslash read, a single-quoted
 * one's doubled quote one.
 * @param {string} value
 */
const unquoted = (value) => {
  if (/^".*"$/s.test(value)) return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (/^'.*'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

/**
 * Split a SKILL.md into its front matter and body. The front matter is the simple form: `key: value` lines, a list
 * either inline (`[a, b]` or `a, b`) or as `- item` lines under the key, and a value written as YAML's block \u2014 `>`
 * folds its indented lines into one, a blank line a break; `|` keeps them.
 * @param {string} text
 * @returns {{ meta: Record<string, string | string[]>, body: string }}
 */
export function parseSkillFile(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src.trim() };
  /** @type {Record<string, string | string[]>} */
  const meta = {};
  let listKey = null;
  /** A block value being read: its key, whether it folds, its lines. @type {{ key: string, folds: boolean, lines: string[] } | null} */
  let block = null;
  const endBlock = () => {
    if (!block) return;
    const lines = block.lines.map((l) => l.trim());
    meta[block.key] = block.folds ? lines.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ").replace(/\n+/g, "\n").trim() : lines.join("\n").trim();
    block = null;
  };
  for (const raw of m[1].split(/\r?\n/)) {
    if (block && (!raw.trim() || /^\s/.test(raw))) {
      block.lines.push(raw);
      continue;
    }
    endBlock();
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      /** @type {string[]} */ (meta[listKey]).push(item[1].trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (!value) {
      meta[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    const blockAt = /^([>|])[+-]?\d*$/.exec(value);
    if (blockAt) {
      block = { key, folds: blockAt[1] === ">", lines: [] };
      continue;
    }
    if (/^\[.*\]$/.test(value)) meta[key] = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else meta[key] = unquoted(value);
  }
  endBlock();
  return { meta, body: src.slice(m[0].length).trim() };
}

/**
 * A plugin's skill or command, as the plugins on put it on the document (HarnessV4_SpacesPlugins_Plan B3, PL-D5):
 * `<plugin>:<name>`, its file — a skill's SKILL.md, a command's Markdown file — and the folder it is in.
 * @typedef {{ plugin: string, kind: "skill" | "command", path: string }} PluginSkill
 */

/**
 * A plugin on here that brings skills or commands, as the plugins on put it on the document (`skills.pluginsOn`): its
 * name, title and words, and the names its connectors have here. The prompt lists it in one line, and the skill tool
 * loads the rest when the agent needs it — so a plugin on costs a line, however much it holds (the owner's words of
 * 10-26: "everything should be loaded on demand even if enabled").
 * @typedef {{ name: string, title: string, description: string, servers: string[] }} PluginOn
 */

/**
 * A plugin's line in the prompt and its index for the skill tool: what it is, its skills and commands read here, and its
 * connectors.
 * @typedef {PluginOn & { skills: Skill[] }} PluginSet
 */

/**
 * One of your skills on at a chat's place, as app/skill-store.js puts it on the document (`skills.yours`): its name in
 * Library › Skills and its SKILL.md.
 * @typedef {{ name: string, path: string }} YourSkill
 */

/**
 * One of your skills in Library › Skills that is off here, as app/skill-store.js puts it on the document
 * (`skills.library`): its name, SKILL.md and description. The skill tool's find names it, marked off; it is not loaded.
 * @typedef {{ name: string, path: string, description: string }} LibrarySkill
 */

/** A file's first `n` bytes as text, and whether that was all of it. @param {string} path @param {number} n */
function headOf(path, n) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return { text: buf.subarray(0, got).toString("utf8"), whole: got < n };
  } finally {
    closeSync(fd);
  }
}

/**
 * Each skill's file as read for its line, by where it was read and the name it was read under, with the size and time
 * the file had then. Every agent turn of every chat lists the skills on at its place: a file whose size and time stand
 * is not opened again, and one the developer edited is read anew on the next turn. The oldest go past `READ_KEPT`.
 * @type {Map<string, { size: number, mtimeMs: number, skill: Skill }>}
 */
const readKept = new Map();
const READ_KEPT = 2 * SKILLS_MAX;

/**
 * A skill's file read for its line — its front matter, from the file's first bytes; its text is read the first time
 * it is asked for, when the skill is loaded. "missing" where there is no file, "unreadable" where it can't be read. A
 * file as it was when last read gives that reading (`readKept`).
 * @param {string} path @param {string} folder @param {string} [plugin] @param {"skill" | "command"} [kind] @param {string} [given]
 * @returns {Skill | "missing" | "unreadable"}
 */
function readSkill(path, folder, plugin = "", kind = "skill", given = "") {
  const key = [path, folder, plugin, kind, given].join("\0");
  /** @type {{ text: string, whole: boolean }} */
  let head;
  /** @type {import("node:fs").Stats} */
  let st;
  try {
    st = statSync(path);
    if (!st.isFile()) return "missing";
    const had = readKept.get(key);
    if (had && had.size === st.size && had.mtimeMs === st.mtimeMs) return had.skill;
    head = headOf(path, HEAD_BYTES);
    // Front matter longer than the first bytes: the whole file read for it.
    const start = head.text.replace(/^﻿/, "");
    if (!head.whole && /^---\r?\n/.test(start) && !/^---\r?\n[\s\S]*?\r?\n---/.test(start)) head = { text: readFileSync(path, "utf8"), whole: true };
  } catch {
    return "unreadable";
  }
  const { meta } = parseSkillFile(head.text);
  /** @type {string | null} */
  let body = null;
  const text = () => {
    if (body === null)
      try {
        body = parseSkillFile(head.whole ? head.text : readFileSync(path, "utf8")).body;
      } catch {
        body = "";
      }
    return body;
  };
  // Yours go by the name Library › Skills gives them; a command's own name is its file's; a plugin's skill its front
  // matter's, else its folder's.
  const own = String(given || (Array.isArray(meta.name) ? meta.name[0] : meta.name) || (/SKILL\.md$/i.test(path) ? basename(resolve(path, "..")) : basename(path).replace(/\.md$/i, "")) || "skill").trim();
  const name = (plugin ? `${plugin}:${own.replace(/^.*:/, "")}` : own).slice(0, 64);
  const description = String(Array.isArray(meta.description) ? meta.description.join(" ") : meta.description || "").trim().slice(0, 300);
  const triggers = plugin ? [] : (Array.isArray(meta.triggers) ? meta.triggers : typeof meta.triggers === "string" ? meta.triggers.split(",") : []).map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 3).slice(0, 32);
  /** @type {Skill} */
  const skill = {
    name,
    description,
    triggers,
    path,
    folder,
    get body() {
      return text();
    },
    get chars() {
      return text().length;
    },
    plugin,
    kind,
  };
  readKept.delete(key);
  readKept.set(key, { size: st.size, mtimeMs: st.mtimeMs, skill });
  if (readKept.size > READ_KEPT) readKept.delete(/** @type {string} */ (readKept.keys().next().value));
  return skill;
}

/**
 * Every skill on here: yours (`skills.yours`), in the order the place names them, then the skills and commands of the
 * plugins on (`skills.plugins`, B3), each named `<plugin>:<name>`, and those plugins (`plugins`), each with its skills
 * read here; and the Library's skills off here (`library`, from `skills.library`), for the skill tool's find. One on
 * here that is gone (`skills.gone`) or can't be read is a problem said in words, not an error.
 * @param {any} doc  the effective settings document, with what the skills and plugins on bring
 * @returns {{ skills: Skill[], problems: string[], plugins: PluginSet[], library: LibrarySkill[] }}
 */
export function loadSkills(doc) {
  /** @type {Skill[]} */
  const skills = [];
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  /**
   * One skill's file read and kept, or a problem said.
   * @param {string} path @param {string} folder @param {string} [plugin] @param {"skill" | "command"} [kind] @param {string} [given]
   */
  const take = (path, folder, plugin = "", kind = "skill", given = "") => {
    if (skills.length >= SKILLS_MAX) {
      problems.push(`more than ${SKILLS_MAX} skills; the rest are not offered`);
      return false;
    }
    const s = readSkill(path, folder, plugin, kind, given);
    if (s === "missing") return true;
    if (s === "unreadable") {
      problems.push(`skill not readable: ${path}`);
      return true;
    }
    if (seen.has(s.name.toLowerCase())) {
      problems.push(`two skills named "${s.name}"; the later one (${path}) is not offered`);
      return true;
    }
    seen.add(s.name.toLowerCase());
    skills.push(s);
    return true;
  };
  /** @type {YourSkill[]} */
  const yours = Array.isArray(doc?.skills?.yours) ? doc.skills.yours : [];
  for (const y of yours) {
    if (!y || typeof y.path !== "string" || typeof y.name !== "string") continue;
    if (!take(y.path, resolve(y.path, ".."), "", "skill", y.name)) break;
  }
  for (const name of Array.isArray(doc?.skills?.gone) ? doc.skills.gone : []) problems.push(`the skill ${name} is on here but is not in Library › Skills, or its folder is gone`);
  /** @type {PluginSkill[]} */
  const fromPlugins = Array.isArray(doc?.skills?.plugins) ? doc.skills.plugins : [];
  for (const p of fromPlugins) {
    if (!p || typeof p.path !== "string" || typeof p.plugin !== "string") continue;
    if (!take(p.path, resolve(p.path, ".."), p.plugin, p.kind === "command" ? "command" : "skill")) break;
  }
  /** @type {PluginOn[]} */
  const on = (Array.isArray(doc?.skills?.pluginsOn) ? doc.skills.pluginsOn : []).filter((/** @type {any} */ p) => p && typeof p.name === "string");
  /** @type {PluginSet[]} */
  const plugins = [];
  for (const name of new Set(skills.map((s) => s.plugin).filter(Boolean))) {
    const p = on.find((x) => x.name === name);
    plugins.push({ name, title: String(p?.title || name), description: String(p?.description || "").trim(), servers: Array.isArray(p?.servers) ? p.servers.map(String) : [], skills: skills.filter((s) => s.plugin === name) });
  }
  /** @type {LibrarySkill[]} */
  const library = (Array.isArray(doc?.skills?.library) ? doc.skills.library : [])
    .filter((/** @type {any} */ l) => l && typeof l.name === "string" && typeof l.path === "string" && !seen.has(l.name.toLowerCase()))
    .map((/** @type {any} */ l) => ({ name: l.name, path: l.path, description: String(l.description || "").trim().slice(0, 300) }));
  return { skills, problems, plugins, library };
}

/**
 * The skills set with the Library's skills off here that the developer's newest message calls by name, `$<name>` or
 * `/<name>`, read for this turn alone — for a turn offered no skill tool, whose agent can load none itself
 * (`calledNotes`); one offered it loads any of the Library's by name (`skillAnswer`).
 * @template {{ skills: Skill[], library?: LibrarySkill[] }} T
 * @param {T} set @param {string} message @returns {T}
 */
export function withCalled(set, message) {
  const text = String(message || "");
  const library = set.library || [];
  if (!library.length || !/[/$]/.test(text)) return set;
  const called = library.filter((l) => calledIn(text, l.name));
  if (!called.length) return set;
  const read = called.flatMap((l) => {
    const s = readSkill(l.path, resolve(l.path, ".."), "", "skill", l.name);
    return typeof s === "string" ? [] : [s];
  });
  return { ...set, skills: [...set.skills, ...read], library: library.filter((l) => !called.includes(l)) };
}

/**
 * A skill the person called as $<name> or /<name>, whole, on their message, where the turn offers no skill tool to load
 * it with — kept with it for every later turn (agent/turn-said.js); never in the system prompt, whose bytes would move
 * for that turn alone and write the whole chat to the provider's cache twice (the owner's of 11-07). `off`: a skill of
 * their Library off in this chat, for this turn alone. @param {Skill} s @param {{ off?: boolean }} [o]
 */
export const calledWords = (s, { off = false } = {}) =>
  `<filament-context kind="skill">\nThe person called $${s.name}${off ? ", a skill of their Library that is off in this chat: here it is whole, for this turn alone" : ": here it is whole"}. Its folder: ${resolve(s.path, "..")}\n\n${capped(s)}\n</filament-context>`;

/**
 * What the developer's newest message calls, each whole as it rides that message (`calledWords`), for a turn offered no
 * skill tool: the skills on here it names as $<name> or /<name>, and those of the Library off here it names, for that
 * turn alone (`withCalled`). A turn offered the tool sends none: the $<name> is the agent's to load (the owner's of
 * 11-07: a skill that names others, sent whole, would carry none of theirs).
 * @param {{ skills: Skill[], library?: LibrarySkill[] }} set @param {string} message @returns {{ skill: Skill, text: string }[]}
 */
export function calledNotes(set, message) {
  const here = withCalled(set, message);
  return triggeredSkills(here.skills, message).map((skill) => ({ skill, text: calledWords(skill, { off: !set.skills.includes(skill) }) }));
}

/**
 * Whether a message calls a skill's name as `$<name>` — the message box lists the skills behind `$` (the owner's of
 * 10-28) — written as the skill is named, so `$HOME` and `$PATH` call no skill named home or path (the Hunter's of
 * 10-28); or as `/<name>`, in any case (`triggeredSkills`). @param {string} text @param {string} name
 */
const calledIn = (text, name) => {
  const at = `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s|[,;!?)]|[.:](?:\\s|$))`;
  return new RegExp(`(?:^|\\s)\\$${at}`).test(text) || new RegExp(`(?:^|\\s)/${at}`, "i").test(text);
};

/**
 * A plugin's skill by the name it is called by (the Hunter's of 10-28: the `$` list named it by its folder): its front
 * matter's, else its folder's, after the plugin's — as the skills an agent is given name it (`readSkill`).
 * @param {string} path  its SKILL.md @param {string} plugin
 */
export function pluginSkillName(path, plugin) {
  const s = readSkill(path, resolve(path, ".."), plugin, "skill");
  return typeof s === "string" ? `${plugin}:${basename(resolve(path, ".."))}` : s.name;
}

/** Whether `path` is `folder` or inside it, in the platform's terms (Windows compares without case). @param {string} folder @param {string} path */
const isInside = (folder, path) => {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

/**
 * The folders a coding agent reads skills from by itself (HarnessV4_Skills_Plan S1-3), which its own skill tool loads:
 * Claude Code's (its account's folder, else `~/.claude`, and the project's `.claude`), Codex's (its account's folder,
 * else `~/.codex`, and `.agents` in the home and the project) and Cursor's (`.cursor`, in the home and the project).
 * Filament's list leaves the skills of these out, so none is offered twice. None for another agent.
 * @param {{ type?: string, acp?: { command?: string, env?: Record<string, unknown>, home?: string } } | null | undefined} upstream
 * @param {string} cwd  the folder the agent works in
 * @returns {string[]}
 */
export function agentSkillFolders(upstream, cwd) {
  if (!upstream) return [];
  const agent = agentKey(upstream);
  const home = homedir();
  const homeVar = agentHomeVar(upstream);
  const own = homeVar ? String(agentLaunchEnv(upstream)[homeVar] || process.env[homeVar] || "").trim() : "";
  const at = (/** @type {string} */ base, /** @type {string[]} */ ...parts) => (base ? [resolve(base, ...parts)] : []);
  if (agent === "claude-code") return [...at(own || join(home, ".claude"), "skills"), ...at(cwd, ".claude", "skills")];
  if (agent === "codex") return [...at(own || join(home, ".codex"), "skills"), ...at(home, ".agents", "skills"), ...at(cwd, ".agents", "skills")];
  if (agent === "cursor") return [...at(home, ".cursor", "skills"), ...at(cwd, ".cursor", "skills")];
  return [];
}

/**
 * The skills Filament offers a coding agent (S1-3): the chat's, less those in the folders the agent reads by itself; a
 * plugin keeps the skills left, and goes when none is.
 * @param {{ skills: Skill[], problems: string[], plugins: PluginSet[], library?: LibrarySkill[] }} set @param {readonly string[]} folders
 * @returns {{ skills: Skill[], problems: string[], plugins: PluginSet[], library: LibrarySkill[] }}
 */
export function skillsForAgent(set, folders) {
  const library = set.library || [];
  if (!folders.length) return { ...set, library };
  const skills = set.skills.filter((s) => !folders.some((f) => isInside(f, s.path)));
  const plugins = set.plugins.map((p) => ({ ...p, skills: p.skills.filter((s) => skills.includes(s)) })).filter((p) => p.skills.length);
  return { skills, problems: set.problems, plugins, library: library.filter((l) => !folders.some((f) => isInside(f, l.path))) };
}

/**
 * The skills the developer's newest message calls: the skill's own name typed as `$<name>` or `/<name>`. A word of the
 * request is not a call — not a bare name (a skill named "ui" does not ride on "fix the UI"), and not one of a skill's
 * triggers: those ride on its line (`skillLines`), and the model chooses by them (the memory upgrade's a4: no code
 * keys on the person's words). A call is a word of its own: the message's start or a space before it; after it the
 * end, a space, `, ; ! ? )`, or a `.` or `:` that ends the sentence — so a path (`./ui`, `/ui/harness.html`, `H:/ui`,
 * `/app.js`) calls nothing, and a dotted name is called whole, never by its stem (Hunter's find).
 * @param {Skill[]} skills @param {string} message
 */
export function triggeredSkills(skills, message) {
  const raw = String(message || "");
  if (!raw.trim()) return [];
  return skills.filter((s) => calledIn(raw, s.name));
}

/**
 * The names of the skills a message tags as $<name> or /<name>, on here or the Library's off here — the agent's to load
 * with the skill tool (the owner's of 11-07); said on the turn's record. @param {{ skills: Skill[], library?: LibrarySkill[] }} set
 * @param {string} message @returns {string[]}
 */
export function taggedSkills(set, message) {
  const raw = String(message || "");
  if (!/[/$]/.test(raw)) return [];
  return [...set.skills, ...(set.library || [])].filter((s) => calledIn(raw, s.name)).map((s) => s.name);
}

/**
 * The plugins the skills came with, as `loadSkills` read them, else as the skills name them.
 * @param {Skill[]} skills @param {PluginSet[] | null | undefined} given @returns {PluginSet[]}
 */
const pluginSetsOf = (skills, given) =>
  given || [...new Set(skills.map((s) => s.plugin).filter(Boolean))].map((name) => ({ name, title: name, description: "", servers: [], skills: skills.filter((s) => s.plugin === name) }));

/** A plugin's words, to their first sentence and cut short, for its one line. @param {string} d */
const firstSentence = (d) => {
  const one = String(d || "").replace(/\s+/g, " ").trim();
  const cut = /^(.{20,}?[.!?])\s/.exec(one);
  const s = cut ? cut[1] : one;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

/**
 * A skill's line in a list: its name, the first sentence of what it is for, and its triggers — what the model reads to
 * choose it, since none of them loads it (`triggeredSkills`) —, those cut short so one skill's many keep the budget
 * for the rest. @param {Skill} s
 */
const skillLine = (s) => {
  const words = firstSentence(s.description);
  const t = s.triggers.join(", ");
  return `- ${s.name}${words ? ` — ${words}` : ""}${t ? ` (triggers: ${t.length > 120 ? `${t.slice(0, 117)}…` : t})` : ""}`;
};

/**
 * A plugin's one line in the prompt: "- linear — Issues and projects. (3 skills, 1 command; connector linear)". The
 * plugin sheet weighs it before the plugin is installed.
 * @param {string} name @param {string} description @param {{ skills: number, commands: number, servers: readonly string[] }} holds
 */
export function pluginLine(name, description, { skills, commands, servers }) {
  const n = (/** @type {number} */ k, /** @type {string} */ one) => (k ? `${k} ${one}${k === 1 ? "" : "s"}` : "");
  const has = [n(skills, "skill"), n(commands, "command")].filter(Boolean).join(", ");
  const conn = servers.length ? `connector${servers.length === 1 ? "" : "s"} ${servers.join(", ")}` : "";
  const words = firstSentence(description);
  return `- ${name}${words ? ` — ${words}` : ""} (${[has, conn].filter(Boolean).join("; ")})`;
}

/**
 * Your skills on here as an agent's instructions list them, in SKILLS_LIST_BUDGET characters however many there are
 * (the owner's word of 10-27): by name, A to Z, each with the first sentence of what it is for and its triggers while
 * they fit (`skillLine`), then the rest by name alone, then how many more — which the skill tool's find reaches by
 * words. The loop's # Skills and a coding agent's skills block read the same lines. `tool`: the skill tool is offered.
 * @param {readonly Skill[]} skills @param {{ tool?: boolean }} [o] @returns {string[]}
 */
export function skillLines(skills, { tool = true } = {}) {
  const own = skills.filter((s) => !s.plugin).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  // Room kept for the line that says how many more.
  const room = SKILLS_LIST_BUDGET - 90;
  const lines = [];
  let used = 0;
  let i = 0;
  for (; i < own.length; i++) {
    const line = skillLine(own[i]);
    if (used + line.length + 1 > room) break;
    lines.push(line);
    used += line.length + 1;
  }
  /** @type {string[]} */
  const names = [];
  for (used += 8; i < own.length; i++) {
    if (used + own[i].name.length + 2 > room) break;
    names.push(own[i].name);
    used += own[i].name.length + 2;
  }
  if (names.length) lines.push(`- And: ${names.join(", ")}`);
  const more = own.length - i;
  if (more) lines.push(tool ? `- …and ${more} more: the skill tool's find, with your words and no name, searches them all.` : `- …and ${more} more, not listed here.`);
  return lines;
}

/**
 * The prompt sections for the skills: your own skills' catalogue, in a fixed budget (`skillLines`); and the plugins on,
 * one line each — what one holds is loaded with the skill tool when the agent needs it, so a plugin on adds a line, not
 * its every skill. A skill the message names as $<name> is the agent's to load with the skill tool; where none is
 * offered — a model that takes no tools — it rides that message whole (`calledWords`), never here. `tool`: the skill
 * tool is offered.
 * @param {Skill[]} skills @param {{ tool?: boolean, plugins?: PluginSet[] | null }} [o]
 * @returns {string[]}
 */
export function skillsSections(skills, { tool = true, plugins = null } = {}) {
  if (!skills.length) return [];
  const out = [];
  const own = skills.filter((s) => !s.plugin);
  if (own.length) {
    const how = tool
      ? "When a request matches one's description or triggers, load it with the skill tool before you start that work; a $<name> in the developer's message names one to load, listed here or not."
      : "One the developer's message calls as $<name> comes whole with that message.";
    out.push(`# Skills\nYour procedures and know-how. ${how}\n${skillLines(own, { tool }).join("\n")}`);
  }
  const sets = pluginSetsOf(skills, plugins);
  if (sets.length) {
    const lines = sets.map((p) => pluginLine(p.name, p.description, { skills: p.skills.filter((s) => s.kind === "skill").length, commands: p.skills.filter((s) => s.kind === "command").length, servers: p.servers }));
    const how = tool
      ? "Plugins on here, one line each; what one holds is not loaded until you need it. When a request fits one, load it with the skill tool by its name: its skills and commands come back with what each is for, each then loaded by its full name (<plugin>:<name>), and its connectors are named."
      : "Plugins on here, one line each. A skill or command of one that the developer's message calls as /<name> comes whole with that message.";
    out.push(`# Plugins\n${how}\n${lines.join("\n")}`);
  }
  return out;
}

/** A skill's text, cut at SKILL_BODY_CAP with how much was left out. @param {Skill} s */
const capped = (s) => (s.body.length > SKILL_BODY_CAP ? `${s.body.slice(0, SKILL_BODY_CAP)}\n…[Filament: skill cut at ${SKILL_BODY_CAP.toLocaleString()} of ${s.body.length.toLocaleString()} characters]` : s.body);

/** The tool the model loads a skill with (HarnessV4_SpacesPlugins_Plan B4, PL-D8). */
export const SKILL_TOOL_NAME = "skill";

/** What the skill tool does besides loading a skill (HarnessV4_Skills_Plan S1-5): in its folder, list, read and find. */
export const SKILL_ACTIONS = Object.freeze(["load", "list", "read", "find"]);

/**
 * The skill tool (B4): the model loads a skill the catalogue lists when a request matches its description, as Claude's
 * and Codex's models do — its text comes back as a tool result, so the cached prefix never moves. Core, by the rule
 * that every tool is core or on demand: one small definition, offered wherever the Library or the plugins on hold a
 * skill. With no name it finds skills by words, or lists them all — the prompt lists them in a fixed budget (the
 * owner's word of 10-27). Its other actions reach the files of a skill's folder (S1-5) — for a plugin's folder an agent
 * in a sandbox can't reach, a chat without hands, and models that find a file sooner than they look for one.
 */
export const SKILL_TOOL = Object.freeze({
  name: SKILL_TOOL_NAME,
  description:
    "Load a skill (a procedure with its know-how) from Filament's Library before you start the work its description matches, and follow it: its procedure comes back whole, with its folder. A $<name> in the person's message names a skill: load it by that name unless its text is already in this conversation (any skill of the Library loads, listed for you or not), and load the skills it names in turn where its work needs them. A plugin loads by its name: its skills and commands, each then loaded by its full name. The other actions are said at action.",
  input_schema: Object.freeze({
    type: "object",
    properties: Object.freeze({
      name: Object.freeze({ type: "string", description: "The skill's name, or a plugin's. Leave it out to find or list across every skill." }),
      action: Object.freeze({ type: "string", enum: SKILL_ACTIONS, description: "load (the default): the skill's procedure. list: the files of its folder; with no name, every skill. read: one of its files, a page at a time. find: with a name, the parts of its library that best match your words (with book, chapter and page) and the lines of its files that hold them all; with no name, the skills that best match your words, those your instructions do not list too." }),
      path: Object.freeze({ type: "string", description: "read: the file, as list names it (relative to the skill's folder). list and find: a subfolder or file to keep to." }),
      from: Object.freeze({ type: "integer", minimum: 1, description: "read: the line to start at; a page that stops early says where the next starts." }),
      words: Object.freeze({ type: "string", description: "find: your words, in any case." }),
    }),
    additionalProperties: false,
  }),
});

/**
 * The skills whose name, description or triggers hold the words, best first: those on here, then the Library's off
 * here, marked (the owner's word of 10-27: an agent looks for a skill and loads it on demand).
 * @param {Skill[]} skills @param {LibrarySkill[]} library @param {unknown} given
 * @returns {{ ok: true, text: string, found: { words: string, on: number, off: number } } | { ok: false, text: string }}
 */
function findSkills(skills, library, given) {
  const words = String(given ?? "").toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 2).slice(0, 12);
  if (!words.length) return { ok: false, text: "find needs words: what the skill is for." };
  /** @param {{ name: string, description: string, triggers?: string[] }} s */
  const score = (s) => {
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    const trig = (s.triggers || []).join(" ");
    return words.reduce((n, w) => n + (name.includes(w) ? 3 : 0) + (trig.includes(w) ? 2 : 0) + (desc.includes(w) ? 1 : 0), 0);
  };
  /** @template {{ name: string }} T @param {T[]} list @param {number} most */
  const best = (list, most) =>
    list
      .map((s) => ({ s, n: score(/** @type {any} */ (s)) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.s.name.localeCompare(b.s.name))
      .slice(0, most)
      .map((x) => x.s);
  const on = best(skills, SKILL_FIND_ON);
  const off = best(library, SKILL_FIND_OFF);
  const quoted = words.map((w) => `"${w}"`).join(" or ");
  if (!on.length && !off.length) return { ok: true, found: { words: words.join(" "), on: 0, off: 0 }, text: `No skill's name or description holds ${quoted}.` };
  const line = (/** @type {{ name: string, description: string }} */ s) => `- ${s.name}${s.description ? ` — ${s.description}` : ""}`;
  const text = [
    on.length ? `The skills that best match ${quoted}, best first — load one by its name:\n${on.map(line).join("\n")}` : `No skill on here holds ${quoted}.`,
    off.length ? `In your Library, not on in this chat — load one by its name all the same:\n${off.map(line).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return { ok: true, found: { words: words.join(" "), on: on.length, off: off.length }, text };
}

/**
 * Every skill on here, one line each, the plugins' by their plugin — and how many more the Library holds off here.
 * @param {Skill[]} skills @param {LibrarySkill[]} library @param {PluginSet[] | null} plugins
 * @returns {{ ok: true, text: string, found: { words: string, on: number, off: number } }}
 */
function listSkills(skills, library, plugins) {
  const own = [...skills.filter((s) => !s.plugin)].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const shown = own.slice(0, SKILL_LIST_MAX);
  const sets = pluginSetsOf(skills, plugins);
  const text = [
    own.length ? `The skills on here — load one by its name:\n${shown.map(skillLine).join("\n")}${own.length > shown.length ? `\n…and ${own.length - shown.length} more: find them by words.` : ""}` : "No skill of yours is on here.",
    sets.length ? `Plugins on here — load one by its name for its skills: ${sets.map((p) => p.name).join(", ")}.` : "",
    library.length ? `Your Library holds ${library.length} more, off in this chat: find names them by words.` : "",
  ].filter(Boolean).join("\n\n");
  return { ok: true, found: { words: "", on: shown.length, off: 0 }, text };
}

/**
 * A skill loaded (B4): its name, the folder its files are in — the scripts and references it names, for the model's
 * own tools or this tool's other actions — and its text, cut at SKILL_BODY_CAP. A plugin's name loads its index: what
 * it is, each skill and command with what it is for, and its connectors, reached through the mcp tool. An unknown name
 * is answered with the names there are, or, past NAMES_SAID, with how to find one. A skill of the Library off here
 * (`library`) is read at the call and answered as one on here is (the owner's of 11-07: a skill on is listed in the
 * prompt, any other is loaded on demand — a $<name> in the person's message, or one a skill names): loading it turns
 * nothing on. `list`, `read` and `find` (S1-5) look in the skill's folder (`looked`); with no name, find and list go
 * across every skill (`found`).
 * @param {Skill[]} skills @param {any} input @param {PluginSet[] | null} [plugins] @param {LibrarySkill[]} [library]
 * @returns {{ ok: true, text: string, skill: Skill } | { ok: true, text: string, plugin: PluginSet } | { ok: true, text: string, looked: { skill: Skill, action: string } } | { ok: true, text: string, found: { words: string, on: number, off: number } } | { ok: false, text: string }}
 */
export function skillAnswer(skills, input, plugins = null, library = []) {
  const want = String(input?.name ?? "").trim().toLowerCase().replace(/^\//, "");
  const action = String(input?.action ?? "").trim().toLowerCase() || "load";
  if (!SKILL_ACTIONS.includes(action)) return { ok: false, text: `There is no action "${String(input?.action).slice(0, 32)}": load, list, read or find.` };
  if (!want) {
    if (action === "find") return findSkills(skills, library, input?.words);
    if (action === "list") return listSkills(skills, library, plugins);
    return { ok: false, text: action === "read" ? "read needs the skill's name, and the file as its list names it." : "Name the skill to load, or find one by your words: action find, words, and no name." };
  }
  const s = skills.find((x) => x.name.toLowerCase() === want);
  if (s && action !== "load") return lookIn(s, action, input);
  if (s) {
    const dir = resolve(s.path, "..");
    const books = booksIn(dir);
    const parts = books.reduce((n, b) => n + b.parts.length, 0);
    const library = books.length ? `\nIts library: ${books.length} book${books.length === 1 ? "" : "s"} in ${parts} part${parts === 1 ? "" : "s"} — references/INDEX.md lists them; find ranks them by your words, read gives a part.` : "";
    return { ok: true, skill: s, text: `Skill: ${s.name}${s.description ? ` — ${s.description}` : ""}\nIts folder: ${dir} — the files it names are there: read them with your own tools, or list, read and find in them with this tool.${library}\n\n${capped(s)}` };
  }
  const sets = pluginSetsOf(skills, plugins);
  const p = sets.find((x) => x.name.toLowerCase() === want);
  if (p && action !== "load") return { ok: false, text: `${p.name} is a plugin: ${action} in the folder of one of its skills, by its full name (${p.skills[0]?.name || `${p.name}:<skill>`}).` };
  if (p) return { ok: true, plugin: p, text: pluginIndex(p) };
  const off = library.find((x) => x.name.toLowerCase() === want);
  if (off) {
    const read = readSkill(off.path, resolve(off.path, ".."), "", "skill", off.name);
    return typeof read === "string" ? { ok: false, text: `${off.name} could not be read: ${read}` } : skillAnswer([read], input);
  }
  const own = skills.filter((x) => !x.plugin);
  const names =
    own.length + sets.length > NAMES_SAID
      ? "Find one by your words: action find, words, and no name."
      : [own.length ? `The skills are: ${own.map((x) => x.name).join(", ")}.` : "", sets.length ? `The plugins are: ${sets.map((x) => x.name).join(", ")}; load one by its name to see its skills.` : "", library.length ? "Find the Library's others by your words: action find, words, and no name." : ""].filter(Boolean).join(" ");
  return { ok: false, text: `There is no skill or plugin "${String(input?.name ?? "").slice(0, 64)}". ${names || "No skill is listed here."}` };
}

/** A size in words: 512 B, 3.2 KB, 1.4 MB. @param {number} n */
const sizeWords = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/** A path as the tool names it: relative to the skill's folder, with forward slashes. @param {string} dir @param {string} abs */
const named = (dir, abs) => relative(dir, abs).split(sep).join("/") || ".";
/** A folder's entries a list or a find goes through: none hidden, no installed packages. @param {string} name */
const walked = (name) => !name.startsWith(".") && name !== "node_modules" && name !== "__pycache__";

/** Whether a file's first bytes hold a NUL, which no text file does. @param {string} file */
function isBinary(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

/**
 * Where a path given the tool lands in a skill's folder, or why it is refused: outside the folder, by its words or
 * by a link out of it, and a path that is not there.
 * @param {string} dir @param {unknown} path
 * @returns {{ ok: true, abs: string } | { ok: false, text: string }}
 */
function within(dir, path) {
  const given = String(path ?? "").trim();
  const abs = resolve(dir, given || ".");
  const out = { ok: /** @type {const} */ (false), text: `"${given.slice(0, 120)}" is outside the skill's folder: only its own files are read with this tool.` };
  if (!isInside(dir, abs)) return out;
  if (!existsSync(abs)) return { ok: false, text: `The skill's folder has no "${given.slice(0, 120)}": list shows what it holds.` };
  try {
    if (!isInside(realpathSync(dir), realpathSync(abs))) return out;
  } catch {
    return { ok: false, text: `"${given.slice(0, 120)}" could not be read.` };
  }
  return { ok: true, abs };
}

/**
 * The files under a folder, breadth first, hidden ones and installed packages left out, up to `max`.
 * @param {string} start @param {number} max @returns {{ files: { abs: string, size: number, dir: boolean }[], more: boolean }}
 */
function walk(start, max) {
  /** @type {{ abs: string, size: number, dir: boolean }[]} */
  const files = [];
  const queue = [start];
  let more = false;
  while (queue.length) {
    const at = /** @type {string} */ (queue.shift());
    let entries = [];
    try {
      entries = readdirSync(at, { withFileTypes: true }).filter((e) => walked(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = join(at, e.name);
      if (files.length >= max) {
        more = true;
        break;
      }
      if (e.isDirectory()) {
        files.push({ abs, size: 0, dir: true });
        queue.push(abs);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = statSync(abs).size;
        } catch {}
        files.push({ abs, size, dir: false });
      }
    }
    if (more) break;
  }
  return { files, more };
}

/**
 * The skill tool's look into a skill's folder (S1-5): `list` its files, `read` one a page at a time, `find` the lines
 * that hold every word given — fenced to the folder, a link out of it refused, a file that isn't text said so.
 * @param {Skill} s @param {string} action @param {any} input
 * @returns {{ ok: true, text: string, looked: { skill: Skill, action: string } } | { ok: false, text: string }}
 */
function lookIn(s, action, input) {
  const dir = resolve(s.path, "..");
  const looked = { skill: s, action };
  const at = within(dir, input?.path);
  if (!at.ok) return at;
  const isDir = statSync(at.abs).isDirectory();
  if (action === "list") {
    if (!isDir) return { ok: true, looked, text: `${named(dir, at.abs)} — ${sizeWords(statSync(at.abs).size)}` };
    const { files, more } = walk(at.abs, SKILL_LIST_MAX);
    const lines = files.map((f) => `- ${named(dir, f.abs)}${f.dir ? "/" : ` (${sizeWords(f.size)})`}`);
    return { ok: true, looked, text: [`The folder of ${s.name}${at.abs === dir ? "" : `, ${named(dir, at.abs)}/`}: ${dir}`, ...(lines.length ? lines : ["(empty)"]), ...(more ? [`…and more: list a subfolder with path to see the rest.`] : [])].join("\n") };
  }
  if (action === "read") {
    if (isDir) return { ok: false, text: `${named(dir, at.abs)} is a folder: list it, then read one of its files.` };
    if (isBinary(at.abs)) return { ok: false, text: `${named(dir, at.abs)} is not text (${sizeWords(statSync(at.abs).size)}): read it with a tool that opens its kind of file.` };
    if (statSync(at.abs).size > READ_FILE_BYTES) return { ok: false, text: `${named(dir, at.abs)} is ${sizeWords(statSync(at.abs).size)}, more than this tool pages (${sizeWords(READ_FILE_BYTES)}): find in it instead, or read it with your own tools.` };
    const all = readFileSync(at.abs, "utf8").replace(/^﻿/, "").split(/\r?\n/);
    const first = Math.max(1, Math.floor(Number(input?.from) || 1));
    if (first > all.length) return { ok: false, text: `${named(dir, at.abs)} has ${all.length} lines; from ${first} is past its end.` };
    /** @type {string[]} */
    const page = [];
    let chars = 0;
    for (let i = first - 1; i < all.length && page.length < SKILL_READ_LINES; i++) {
      const line = all[i].length > SKILL_READ_CHARS ? `${all[i].slice(0, SKILL_READ_CHARS)}…[line cut]` : all[i];
      if (page.length && chars + line.length + 1 > SKILL_READ_CHARS) break;
      page.push(line);
      chars += line.length + 1;
    }
    const last = first + page.length - 1;
    const next = last < all.length ? `\n[${all.length - last} more lines: read again with from ${last + 1}]` : "";
    return { ok: true, looked, text: `${named(dir, at.abs)} — lines ${first}–${last} of ${all.length}, from the folder of ${s.name}\n\n${page.join("\n")}${next}` };
  }
  const words = String(input?.words ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
  if (!words.length) return { ok: false, text: "find needs words: the ones a line must hold." };
  // A library's parts ranked by the words (step 2), then the lines of the other files that hold them all.
  const lib = findInLibrary(dir, words.join(" "), { under: at.abs === dir ? "" : named(dir, at.abs) });
  const partFiles = lib ? new Set(booksIn(dir).flatMap((b) => b.parts.map((p) => p.file))) : null;
  const files =isDir ? walk(at.abs, FIND_FILES_MAX).files.filter((f) => !f.dir) : [{ abs: at.abs, size: statSync(at.abs).size, dir: false }];
  /** @type {string[]} */
  const hits = [];
  let more = false;
  /** The files too big to search, named at the end. @type {string[]} */
  const big = [];
  for (const f of files) {
    if (partFiles?.has(named(dir, f.abs))) continue;
    if (f.size > FIND_FILE_BYTES) {
      big.push(named(dir, f.abs));
      continue;
    }
    let text;
    try {
      if (isBinary(f.abs)) continue;
      text = readFileSync(f.abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      if (hits.length >= SKILL_FIND_HITS) {
        more = true;
        break;
      }
      const t = lines[i].trim();
      hits.push(`${named(dir, f.abs)}:${i + 1}: ${t.length > 200 ? `${t.slice(0, 197)}…` : t}`);
    }
    if (more) break;
  }
  const skipped = big.length ? [`Not searched, over ${sizeWords(FIND_FILE_BYTES)}: ${big.slice(0, 5).join(", ")}${big.length > 5 ? ` and ${big.length - 5} more` : ""}.`] : [];
  const quoted = words.map((w) => `"${w}"`);
  /** @type {string[]} */
  const ranked = !lib
    ? []
    : lib.hits.length
      ? [
          `${s.name}'s library (${lib.books} book${lib.books === 1 ? "" : "s"}, ${lib.parts} parts): the parts that best match your words, best first — read one with action read, its path and from:`,
          ...lib.hits.map((x) => `- ${x.file}:${x.line} — ${x.book} › ${x.title}${x.page ? ` · page ${x.page}` : x.pages ? ` · ${pagesWords(x.pages)}` : ""}\n  ${x.passage.replace(/\n/g, "\n  ")}`),
        ]
      : [`No part of ${s.name}'s library holds ${quoted.join(" or ")}.`];
  const lines = hits.length
    ? [`The lines of ${s.name}'s ${lib ? "other " : ""}files that hold ${quoted.join(" and ")} — read one with action read, its path and from:`, ...hits, ...(more ? [`…and more: add words, or keep to a file or subfolder with path.`] : [])]
    : lib
      ? []
      : [`No line of ${s.name}'s files holds ${quoted.join(" and ")}.`];
  return { ok: true, looked, text: [...ranked, ...(ranked.length && lines.length ? [""] : []), ...lines, ...skipped].join("\n") };
}

/** A plugin loaded: what it is, its skills and commands with what each is for, its connectors. @param {PluginSet} p */
function pluginIndex(p) {
  const line = (/** @type {Skill} */ s) => `- ${s.name}${s.description ? ` — ${s.description}` : ""}`;
  const skills = p.skills.filter((s) => s.kind === "skill");
  const commands = p.skills.filter((s) => s.kind === "command");
  return [
    `Plugin: ${p.name}${p.title && p.title.toLowerCase() !== p.name.toLowerCase() ? ` (${p.title})` : ""}${p.description ? ` — ${p.description}` : ""}`,
    skills.length ? `\nIts skills — load the one whose description fits with this tool, by its full name, before you start that work:\n${skills.map(line).join("\n")}` : "",
    commands.length ? `\nIts commands — procedures the developer may also type as /<name>; load one the same way:\n${commands.map(line).join("\n")}` : "",
    p.servers.length ? `\nIts connector${p.servers.length === 1 ? "" : "s"}, MCP server${p.servers.length === 1 ? "" : "s"} of this session: ${p.servers.join(", ")}. The mcp tool lists ${p.servers.length === 1 ? "its" : "their"} tools (find, with server), loads one and calls it.` : "",
  ].filter(Boolean).join("\n");
}
