// @ts-check
// Your skills in Filament (HarnessV4_Skills_Plan S1-6): what Library › Skills lists, each a folder with its SKILL.md,
// kept by name in `skills/skills.json` of Filament's data folder. One found on this computer — Claude Code's, Codex's,
// Cursor's — or in a folder you name is read where it stands, so its own app's changes reach it; one from a git
// address is cloned into `skills/git/<id>` and updated when you say; one Filament makes (its library, the crafter, Add
// to skill) lives in `skills/made/<name>`; those Filament ships are in its own `src/skills`. Adding one turns nothing
// on: `skills.on` at a place does (app/skill-places.js), and `into` hands a chat's settings the files of those on.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseSkillFile } from "./agent/skills.js";
import { removeTree } from "./plugins.js";
import { SKILL_NAME_RE } from "../services/session-settings.js";
import { git as runGit } from "../adapters/git/snapshot.js";
import { DEVICE } from "../adapters/tools/read-only-commands.js";
import { resolvedPath } from "../adapters/tools/fs-fence.js";
import { clip } from "../core/text.js";

/**
 * A skill as Filament keeps it: its name, how it is kept — read where it stands (`linked`), cloned from a git address
 * (`git`), made here (`made`) — where it came from (`claude-code`, `codex`, `cursor`, `folder`, `git`, `made`), its
 * folder, when it was added, and for a git one its clone, address, branch and commit.
 * @typedef {{ name: string, kind: "linked" | "git" | "made", from: string, path: string, at: number,
 *   repo?: string, url?: string, ref?: string, sha?: string }} SkillRecord
 */

/**
 * A skill as the page shows it: a record's words, or one Filament ships (`shipped`, from `filament`), with its SKILL.md's
 * description and whether its folder is still there.
 * @typedef {{ name: string, kind: SkillRecord["kind"] | "shipped", from: string, fromWords: string, path: string,
 *   description: string, there: boolean, at: number, url?: string, ref?: string, sha?: string }} SkillView
 */

/** The most skills Filament keeps; the most a look for skills under one folder finds. */
const STORE_MAX = 500;
const FOUND_MAX = 500;
/** How deep a look for SKILL.md goes under a folder: Claude Code's synced skills are three down. */
const FOUND_DEPTH = 3;
/** How deep a cloned repository is looked through. */
const GIT_DEPTH = 4;
/** How long a clone or an update may take. */
const GIT_MS = 180_000;
/** The most a file read for the page gives, and the most files a skill's list names. */
const FILE_BYTES = 1_000_000;
const FILES_MAX = 2_000;

/** Where a skill came from, in words. */
const FROM_WORDS = Object.freeze({ "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", folder: "a folder", git: "git", made: "made in Filament", filament: "Filament" });

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** A path as compared: whole, and without case on Windows. @param {string} p */
const pathKey = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
/** Whether `path` is `folder` or inside it. @param {string} folder @param {string} path */
const inside = (folder, path) => {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};
/** Whether a name is on disk, a link that leads nowhere too. @param {string} p */
const onDisk = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
/**
 * Whether `path`, already inside `folder` by its words, stays inside it as the filesystem resolves it: the deepest part
 * of it that is on disk, links and junctions followed, lies in the folder's own real path. A link in the folder that
 * leads out of it, or nowhere, is not inside. A folder that is not on disk holds no link: its words are its answer.
 * @param {string} folder @param {string} path
 */
const reallyInside = (folder, path) => {
  let base;
  try {
    base = realpathSync(folder);
  } catch {
    return true;
  }
  let probe = path;
  while (!onDisk(probe) && dirname(probe) !== probe) probe = dirname(probe);
  try {
    return inside(base, realpathSync(probe));
  } catch {
    return false;
  }
};
/**
 * The folder in a skill's that is Filament's own record of it — its library's manifest and index (skill-library.js),
 * the chat that crafts it (crafter-chats.js), its lines from memory (skill-from-memory.js) —, by the names Windows
 * opens it by too: in any case, with trailing dots or spaces, or as a stream of the folder.
 */
const OWN_RECORD = /^\.library[. ]*(?::.*)?$/i;
/**
 * Whether a path inside a skill's folder is in that folder of Filament's own: by its first name, and where the
 * filesystem resolves it (fs-fence.js `resolvedPath`), so a short name of the folder (`LIBRAR~1`) is it too.
 * @param {string} dir  the skill's folder @param {string} abs
 */
const inOwnRecord = (dir, abs) => OWN_RECORD.test(relative(dir, abs).split(/[\\/]/)[0]) || inside(resolvedPath(join(dir, ".library")), resolvedPath(abs));
/** A part of a path Windows keeps for a device (`CON`, `nul.md`), or null: a file so named is no file to its apps. @param {string} rel */
const deviceIn = (rel) => (process.platform === "win32" ? rel.split(/[\\/]/).find((part) => DEVICE.test(part.split(".")[0].trimEnd())) ?? null : null);
/** A clone's folder under `skills/git` as `addGit` names one — a repository's name made safe (`slugOf`) and six hex digits —: one plain name, never a path. */
const REPO_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** A name made from words Filament's names refuse: lower case, a dash for the rest. @param {string} raw */
const slugOf = (raw) =>
  String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 64) || "skill";

/** A folder's entries; none where it is not one. @param {string} dir */
const entriesOf = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};
/** Whether a folder holds a SKILL.md. @param {string} dir */
const holdsSkill = (dir) => {
  try {
    return statSync(join(dir, "SKILL.md")).isFile();
  } catch {
    return false;
  }
};

/**
 * The skill folders under a folder, itself first: a folder that holds a SKILL.md is one and is not looked into; hidden
 * folders (Claude Code's `.trash`, Codex's `.system`) and installed packages are left out.
 * @param {string} root @param {number} depth @param {number} [max]
 * @returns {string[]}
 */
export function skillFoldersUnder(root, depth, max = FOUND_MAX) {
  /** @type {string[]} */
  const out = [];
  /** @type {[string, number][]} */
  const queue = [[root, 0]];
  while (queue.length && out.length < max) {
    const [dir, d] = /** @type {[string, number]} */ (queue.shift());
    if (holdsSkill(dir)) {
      out.push(dir);
      continue;
    }
    if (d >= depth) continue;
    for (const e of entriesOf(dir).sort((a, b) => a.name.localeCompare(b.name)))
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") queue.push([join(dir, e.name), d + 1]);
  }
  return out;
}

/**
 * A skill folder's head: its name — its SKILL.md's, else its folder's, made one Filament takes — and its description.
 * @param {string} dir @returns {{ name: string, description: string, body: string }}
 */
export function skillHead(dir) {
  let text = "";
  try {
    text = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    return { name: slugOf(basename(dir)), description: "", body: "" };
  }
  const { meta, body } = parseSkillFile(text);
  const raw = String((Array.isArray(meta.name) ? meta.name[0] : meta.name) || basename(dir)).trim();
  const description = clip(Array.isArray(meta.description) ? meta.description.join(" ") : meta.description, 300);
  return { name: SKILL_NAME_RE.test(raw) ? raw : slugOf(raw), description, body };
}

/**
 * The folders each coding agent keeps its skills in by itself, for "Found on this computer": Claude Code's (its
 * CLAUDE_CONFIG_DIR, else `~/.claude`), Codex's (CODEX_HOME, else `~/.codex`, and `~/.agents`), Cursor's; with a
 * project's folder, its own of each too.
 * @param {{ home: string, env: Record<string, string | undefined>, cwd?: string }} o
 * @returns {{ agent: "claude-code" | "codex" | "cursor", label: string, folders: string[] }[]}
 */
export function agentFoldersOf({ home, env, cwd = "" }) {
  const claude = String(env.CLAUDE_CONFIG_DIR || "").trim() || join(home, ".claude");
  const codex = String(env.CODEX_HOME || "").trim() || join(home, ".codex");
  const own = (/** @type {string[]} */ ...parts) => (cwd ? [join(cwd, ...parts)] : []);
  return [
    { agent: "claude-code", label: "Claude Code", folders: [join(claude, "skills"), ...own(".claude", "skills")] },
    { agent: "codex", label: "Codex", folders: [join(codex, "skills"), join(home, ".agents", "skills"), ...own(".agents", "skills")] },
    { agent: "cursor", label: "Cursor", folders: [join(home, ".cursor", "skills"), ...own(".cursor", "skills")] },
  ];
}

/**
 * @param {{ dataDir: string, shippedDir?: string | null, git?: typeof runGit, now?: () => number,
 *   log?: (level: string, msg: string) => void, home?: string, env?: Record<string, string | undefined> }} deps
 */
export function createSkillStore({ dataDir, shippedDir = null, git = runGit, now = Date.now, log = () => {}, home = homedir(), env = process.env }) {
  const ownDir = join(dataDir, "skills");
  const listFile = join(ownDir, "skills.json");
  const gitRoot = join(ownDir, "git");
  const madeRoot = join(ownDir, "made");

  /** The records a read left out, by name and clone: the list is read at every look, and each is said once. @type {Set<string>} */
  const leftOut = new Set();
  /**
   * Your skills, as the list holds them. A cloned one's `repo` is its clone's folder under `skills/git`, updated and
   * removed by that name: one that is not a name `addGit` makes (`REPO_NAME`) is not listed, so no code past this read
   * holds a clone that is a path, and is said once in the log.
   * @returns {SkillRecord[]}
   */
  const all = () => {
    /** @type {any[]} */
    let listed;
    try {
      const doc = JSON.parse(readFileSync(listFile, "utf8"));
      listed = Array.isArray(doc?.skills) ? doc.skills.filter((/** @type {any} */ s) => s && typeof s.name === "string" && typeof s.path === "string") : [];
    } catch {
      return [];
    }
    return listed.filter((s) => {
      if (s.kind !== "git" || s.repo == null || (typeof s.repo === "string" && REPO_NAME.test(s.repo))) return true;
      const shown = JSON.stringify(`${s.name.slice(0, 64)} in ${String(s.repo).slice(0, 64)}`);
      if (!leftOut.has(shown) && leftOut.size < 1000) {
        leftOut.add(shown);
        log("warn", `skills: skills.json lists a cloned skill whose clone's folder is no name Filament makes (${shown}). It is left out, and nothing is updated or removed by that name: add it again from its git address to have it.`);
      }
      return false;
    });
  };
  /** @param {SkillRecord[]} list */
  const writeAll = (list) => {
    mkdirSync(ownDir, { recursive: true });
    const tmp = `${listFile}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, skills: list }, null, 2));
    renameSync(tmp, listFile);
  };

  /** The skills Filament ships: each folder of its own with a SKILL.md. @returns {SkillView[]} */
  const shipped = () =>
    shippedDir
      ? skillFoldersUnder(shippedDir, 1).filter((d) => d !== shippedDir).map((dir) => {
          const head = skillHead(dir);
          return { name: head.name, kind: /** @type {const} */ ("shipped"), from: "filament", fromWords: FROM_WORDS.filament, path: dir, description: head.description, there: true, at: 0 };
        })
      : [];

  /** @param {SkillRecord} r @returns {SkillView} */
  const view = (r) => {
    const there = holdsSkill(r.path);
    return {
      name: r.name,
      kind: r.kind,
      from: r.from,
      fromWords: /** @type {Record<string, string>} */ (FROM_WORDS)[r.from] || r.from,
      path: r.path,
      description: there ? skillHead(r.path).description : "",
      there,
      at: r.at,
      ...(r.kind === "git" ? { url: r.url || "", ref: r.ref || "", sha: (r.sha || "").slice(0, 12) } : {}),
    };
  };

  /** Every skill by its name without case: yours, then those Filament ships under a name none of yours has. */
  const everyView = () => {
    const mine = all().map(view);
    const names = new Set(mine.map((s) => s.name.toLowerCase()));
    return [...mine, ...shipped().filter((s) => !names.has(s.name.toLowerCase()))];
  };
  /** One skill, yours or shipped, by its name. @param {string} name */
  const one = (name) => {
    const want = String(name || "").toLowerCase();
    const s = everyView().find((x) => x.name.toLowerCase() === want);
    if (!s) throw refused(404, `There is no skill named ${String(name).slice(0, 64)} in your skills.`);
    return s;
  };
  /** A record of yours by its name. @param {string} name */
  const record = (name) => {
    const want = String(name || "").toLowerCase();
    return all().find((x) => x.name.toLowerCase() === want) || null;
  };

  /**
   * Where a found folder came from, by the agent whose folders hold it — a project's own (its `.claude/skills`) where
   * `cwd` is the project's folder, as found lists them (Hunter's find). @param {string} dir @param {string} [cwd]
   */
  const fromOf = (dir, cwd = "") => agentFoldersOf({ home, env, cwd }).find((a) => a.folders.some((f) => inside(f, dir)))?.agent || "folder";

  /**
   * Skill folders added as records, each named by its SKILL.md; one already kept (by its folder) or whose name is
   * taken is skipped with why.
   * @param {string[]} dirs @param {(dir: string) => Omit<SkillRecord, "name" | "path" | "at">} kindOf
   */
  function addFolders(dirs, kindOf) {
    const list = all();
    const taken = new Map(everyView().map((s) => [s.name.toLowerCase(), s]));
    const kept = new Set(list.map((r) => pathKey(r.path)));
    /** @type {SkillRecord[]} */
    const added = [];
    /** @type {{ path: string, name: string, why: string }[]} */
    const skipped = [];
    for (const dir of dirs) {
      const { name } = skillHead(dir);
      const was = taken.get(name.toLowerCase());
      if (kept.has(pathKey(dir))) skipped.push({ path: dir, name, why: "already in your skills" });
      else if (was) skipped.push({ path: dir, name, why: `you have a skill named ${was.name} already, from ${was.fromWords}` });
      else if (list.length + added.length >= STORE_MAX) skipped.push({ path: dir, name, why: `Filament keeps at most ${STORE_MAX} skills` });
      else {
        const r = /** @type {SkillRecord} */ ({ name, path: resolve(dir), at: now(), ...kindOf(dir) });
        added.push(r);
        taken.set(name.toLowerCase(), view(r));
        kept.add(pathKey(dir));
      }
    }
    if (added.length) writeAll([...list, ...added]);
    return { added: added.map(view), skipped };
  }

  /** A git step's own words where it failed. @param {{ code: number, err: string, out: string, error: string | null }} r */
  const gitWords = (r) => (r.error || r.err.split(/\r?\n/).filter(Boolean).at(-1) || `git ended with ${r.code}`).slice(0, 240);
  const gitEnv = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

  const api = {
    /** Every skill, yours then Filament's own. */
    list() {
      return everyView();
    },

    /** Whether a skill of that name is kept here. @param {string} name */
    has(name) {
      const want = String(name || "").toLowerCase();
      return everyView().some((s) => s.name.toLowerCase() === want);
    },

    /**
     * The skills on this computer the coding agents keep by themselves, per agent: each with its folder, its
     * description, whether it is in your skills already (`added`) and the name of yours it would clash with; and the
     * folders that hold them, the home folder written ~ (`where`).
     * @param {{ cwd?: string }} [o]  a project's folder, whose own skill folders are looked in too
     */
    found({ cwd = "" } = {}) {
      const kept = new Map(all().map((r) => [pathKey(r.path), r.name]));
      const taken = new Map(everyView().map((s) => [s.name.toLowerCase(), s.name]));
      return agentFoldersOf({ home, env, cwd }).map((a) => {
        /** @type {Set<string>} */
        const seen = new Set();
        const skills = [];
        for (const folder of a.folders)
          for (const dir of skillFoldersUnder(folder, FOUND_DEPTH)) {
            if (dir === folder || seen.has(pathKey(dir))) continue;
            seen.add(pathKey(dir));
            const head = skillHead(dir);
            const added = kept.get(pathKey(dir)) || null;
            const clash = added ? null : taken.get(head.name.toLowerCase()) || null;
            skills.push({ name: head.name, description: head.description, path: dir, folder, added: !!added, clash });
          }
        const tilde = (/** @type {string} */ f) => (pathKey(f).startsWith(pathKey(home) + sep) ? `~${f.slice(resolve(home).length)}` : f);
        const where = [...new Set(skills.map((s) => s.folder))].map(tilde);
        return { agent: a.agent, label: a.label, folders: a.folders.filter((f) => existsSync(f)), where, skills };
      });
    },

    /**
     * Folders added as skills, read where they stand: a folder with a SKILL.md is one skill; another, each skill folder
     * under it. Where each came from is the agent whose folders hold it — `cwd`'s own too, a project's —, else "a folder".
     * @param {{ paths: unknown, cwd?: string }} o
     */
    addPaths({ paths, cwd = "" }) {
      const given = (Array.isArray(paths) ? paths : [paths]).filter((p) => typeof p === "string" && p.trim()).map((p) => resolve(String(p).trim()));
      if (!given.length) throw refused(400, "say the folders: paths");
      /** @type {string[]} */
      const dirs = [];
      /** @type {{ path: string, name: string, why: string }[]} */
      const missing = [];
      for (const p of given) {
        let isDir = false;
        try {
          isDir = statSync(p).isDirectory();
        } catch {}
        if (!isDir) {
          missing.push({ path: p, name: "", why: "not a folder on this computer" });
          continue;
        }
        const under = skillFoldersUnder(p, FOUND_DEPTH);
        if (!under.length) missing.push({ path: p, name: "", why: "no SKILL.md in it or the folders under it" });
        dirs.push(...under);
      }
      const r = addFolders(dirs, (dir) => ({ kind: "linked", from: fromOf(dir, cwd) }));
      return { added: r.added, skipped: [...missing, ...r.skipped] };
    },

    /**
     * The skills of a git repository: cloned at its newest commit (or the branch named) into Filament's folder, each
     * skill folder in it added. One that holds no skill is refused, its clone gone.
     * @param {{ url: unknown, ref?: unknown }} o
     */
    async addGit({ url, ref }) {
      const raw = String(url ?? "").trim();
      const address = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ? `https://github.com/${raw.replace(/\.git$/, "")}.git` : raw;
      if (!/^(https?:\/\/|ssh:\/\/|git@[^:]+:)/.test(address)) throw refused(400, "say the repository: an https or ssh address, or owner/repo on GitHub");
      const branch = String(ref ?? "").trim();
      if (branch && !/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) throw refused(400, "the branch is a name: letters, digits, . _ / and -");
      const id = `${slugOf(basename(address).replace(/\.git$/, "")).slice(0, 40)}-${randomBytes(3).toString("hex")}`;
      const dir = join(gitRoot, id);
      mkdirSync(gitRoot, { recursive: true });
      const c = await git(["clone", "-q", "--depth", "1", "-c", "core.autocrlf=false", ...(branch ? ["--branch", branch] : []), "--", address, dir], { cwd: gitRoot, env: gitEnv, timeoutMs: GIT_MS });
      if (c.code !== 0) {
        removeTree(dir);
        throw refused(502, `It could not be cloned: ${gitWords(c)}`);
      }
      const head = await git(["rev-parse", "HEAD"], { cwd: dir, env: gitEnv });
      const dirs = skillFoldersUnder(dir, GIT_DEPTH);
      if (!dirs.length) {
        removeTree(dir);
        throw refused(422, "It holds no SKILL.md: there is no skill in it.");
      }
      const r = addFolders(dirs, () => ({ kind: "git", from: "git", repo: id, url: address, ref: branch, sha: head.out.trim() }));
      if (!r.added.length) removeTree(dir);
      return r;
    },

    /**
     * A git skill's repository fetched again at its branch's newest commit: every skill of it moves together, and one
     * new in it is added — on nowhere, as any added skill — rather than left on disk unkept (Hunter's find). → its
     * commit before and now, the skills it holds, and those it added.
     * @param {string} name
     */
    async update(name) {
      const r = record(name);
      if (!r) throw refused(404, `There is no skill named ${String(name).slice(0, 64)} in your skills.`);
      if (r.kind !== "git" || !r.repo) throw refused(409, `${r.name} is read where it stands: it is up to date already.`);
      const dir = join(gitRoot, r.repo);
      // Its branch follows `--end-of-options`: a name the record holds is never read as one of git's options.
      const f = await git(["fetch", "-q", "--depth", "1", "--end-of-options", "origin", r.ref || "HEAD"], { cwd: dir, env: gitEnv, timeoutMs: GIT_MS });
      if (f.code !== 0) throw refused(502, `It could not be fetched: ${gitWords(f)}`);
      const s = await git(["reset", "-q", "--hard", "FETCH_HEAD"], { cwd: dir, env: gitEnv });
      if (s.code !== 0) throw refused(502, `It could not be updated: ${gitWords(s)}`);
      const commit = (await git(["rev-parse", "HEAD"], { cwd: dir, env: gitEnv })).out.trim();
      writeAll(all().map((x) => (x.kind === "git" && x.repo === r.repo ? { ...x, sha: commit } : x)));
      const fresh = addFolders(skillFoldersUnder(dir, GIT_DEPTH), () => ({ kind: "git", from: "git", repo: r.repo, url: r.url, ref: r.ref, sha: commit }));
      return {
        before: (r.sha || "").slice(0, 12),
        now: commit.slice(0, 12),
        changed: commit !== r.sha,
        skills: all().filter((x) => x.repo === r.repo).map(view),
        added: fresh.added,
      };
    },

    /**
     * A skill made in Filament's folder: its SKILL.md with its name and description, to be written on its page, by the
     * crafter or from memory.
     * @param {{ name: unknown, description?: unknown }} o
     */
    make({ name, description = "" }) {
      const n = String(name ?? "").trim();
      if (!SKILL_NAME_RE.test(n)) throw refused(400, "a skill's name is letters, digits, . _ and -, a letter or digit first, 64 at most");
      if (api.has(n)) throw refused(409, `You have a skill named ${n} already.`);
      // Refused before its folder is made: past the cap, a folder made and then not kept would block its name (Hunter's find).
      if (all().length >= STORE_MAX) throw refused(409, `Filament keeps at most ${STORE_MAX} skills: remove one first.`);
      const words = clip(description, 300);
      const dir = join(madeRoot, n);
      if (existsSync(dir)) throw refused(409, `Filament's folder holds a skill folder named ${n} already: ${dir}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${n}\ndescription: ${words}\n---\n\n# ${n}\n`);
      const r = addFolders([dir], () => ({ kind: "made", from: "made" }));
      return r.added[0];
    },

    /**
     * A skill taken out of your skills. One made here or cloned goes with its files (a clone once none of its skills
     * is left); one read where it stands leaves its folder as it is. One Filament ships is turned off, never removed.
     * @param {string} name
     */
    remove(name) {
      const r = record(name);
      if (!r) {
        if (shipped().some((s) => s.name.toLowerCase() === String(name).toLowerCase())) throw refused(409, `${name} comes with Filament: turn it off where it is on instead.`);
        throw refused(404, `There is no skill named ${String(name).slice(0, 64)} in your skills.`);
      }
      const rest = all().filter((x) => x.name.toLowerCase() !== r.name.toLowerCase());
      writeAll(rest);
      let files = false;
      // A made skill's folder is one inside `skills/made`, never that folder itself: it holds every made skill. And the
      // folder it is in lies inside it as the filesystem resolves it (`reallyInside`): through a link among its parents a
      // remove would reach outside, where a link that is the folder itself goes as a link, what it leads to left.
      const ours = r.kind !== "made" || (inside(madeRoot, r.path) && pathKey(r.path) !== pathKey(madeRoot) && reallyInside(madeRoot, dirname(r.path)));
      if (r.kind === "made" && ours) files = removeTree(r.path);
      if (r.kind === "git" && r.repo && !rest.some((x) => x.repo === r.repo)) files = removeTree(join(gitRoot, r.repo));
      if (!ours) log("warn", `skills: ${r.name}'s folder is not one of skills/made's own as the filesystem resolves it: it is left on disk`);
      else if (!files && r.kind !== "linked") log("warn", `skills: ${r.name}'s files were not removed yet (a program holds one)`);
      return { removed: r.name, files };
    },

    /**
     * One skill whole, for its page: its view, its SKILL.md and the files of its folder.
     * @param {string} name
     */
    get(name) {
      const s = one(name);
      let text = "";
      // Longer than the page reads: its start, and `cut` says so, so the page never saves that start as the whole.
      let cut = false;
      try {
        const whole = readFileSync(join(s.path, "SKILL.md"), "utf8");
        cut = whole.length > FILE_BYTES;
        text = whole.slice(0, FILE_BYTES);
      } catch {}
      /** @type {{ path: string, size: number, dir: boolean }[]} */
      const files = [];
      let more = false;
      /** @param {string} dir */
      const walk = (dir) => {
        for (const e of entriesOf(dir).sort((a, b) => a.name.localeCompare(b.name))) {
          if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
          if (files.length >= FILES_MAX) {
            more = true;
            return;
          }
          const abs = join(dir, e.name);
          const rel = relative(s.path, abs).split(sep).join("/");
          if (e.isDirectory()) {
            files.push({ path: rel, size: 0, dir: true });
            walk(abs);
          } else if (e.isFile()) {
            let size = 0;
            try {
              size = statSync(abs).size;
            } catch {}
            files.push({ path: rel, size, dir: false });
          }
        }
      };
      if (s.there) walk(s.path);
      return { ...s, text, cut, files, more };
    },

    /**
     * A file of a skill's folder as text, for its page: fenced to the folder — by its words and as the filesystem
     * resolves it, so a link in the folder reads nothing outside it — one that is not text or is too big said.
     * @param {string} name @param {unknown} path
     */
    readFile(name, path) {
      const s = one(name);
      const abs = resolve(s.path, String(path ?? ""));
      if (!inside(s.path, abs) || abs === resolve(s.path)) throw refused(400, "only a file of the skill's own folder is read");
      if (!reallyInside(s.path, abs)) throw refused(400, "only a file of the skill's own folder is read: a link in it leads out of it");
      let size = 0;
      try {
        const st = statSync(abs);
        if (!st.isFile()) throw new Error("not a file");
        size = st.size;
      } catch {
        throw refused(404, "The skill's folder has no such file.");
      }
      if (size > FILE_BYTES) throw refused(413, `It is ${Math.round(size / 1024)} KB, more than the page shows.`);
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8192).includes(0)) throw refused(415, "It is not text.");
      return { path: relative(s.path, abs).split(sep).join("/"), text: buf.toString("utf8"), size };
    },

    /**
     * A file written into a skill made here — its SKILL.md, a reference — fenced to its folder as `readFile` fences a
     * read, and never under a name Windows keeps for a device. Only a skill made in Filament is written: another app's
     * is its own. Nothing is written into `.library`, Filament's own record of the skill (`inOwnRecord`): what is read
     * from there is trusted as Filament's — a book's folder to remove, the chat that crafts it —, so only the code that
     * keeps it writes it.
     * @param {string} name @param {string} path @param {string} text
     */
    writeFile(name, path, text) {
      const r = record(name);
      if (!r) one(name); // no skill of that name: a 404 in its words, as its page's
      if (!r || r.kind !== "made") throw refused(409, "Only a skill made in Filament is written here.");
      const abs = resolve(r.path, String(path ?? ""));
      if (!inside(r.path, abs) || abs === resolve(r.path)) throw refused(400, "only a file of the skill's own folder is written");
      if (!reallyInside(r.path, abs)) throw refused(400, "only a file of the skill's own folder is written: a link in it leads out of it");
      if (inOwnRecord(r.path, abs)) throw refused(400, "only Filament writes a skill's .library folder, its own record of the skill's books: add or take out a book on the skill's page instead");
      const device = deviceIn(relative(r.path, abs));
      if (device) throw refused(400, `${device} is a name Windows keeps for a device: name the file otherwise`);
      mkdirSync(resolve(abs, ".."), { recursive: true });
      const tmp = `${abs}.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(tmp, String(text ?? ""));
      renameSync(tmp, abs);
      return { path: relative(r.path, abs).split(sep).join("/") };
    },

    /** A made skill's folder, for its library. @param {string} name */
    madeFolder(name) {
      const r = record(name);
      if (!r) one(name);
      if (!r || r.kind !== "made") throw refused(409, "Only a skill made in Filament has a library here.");
      return r.path;
    },

    /**
     * A chat's settings with the files of the skills on there (`skills.on`, merged): `skills.yours` names each by its
     * name and SKILL.md, and `skills.gone` the names on there that are no longer in your skills or whose folder is gone;
     * `skills.library`, the Library's others, off there, by name, SKILL.md and description — the skill tool's find
     * names them, and the person's /<name> loads one once (agent/skills.js). The document given is left as it was.
     * @param {any} doc
     */
    into(doc) {
      const on = Array.isArray(doc?.skills?.on) ? doc.skills.on : [];
      const views = everyView().filter((s) => s.there);
      if (!on.length && !views.length) return doc;
      const every = new Map(views.map((s) => [s.name.toLowerCase(), s]));
      /** @type {{ name: string, path: string }[]} */
      const yours = [];
      /** @type {string[]} */
      const gone = [];
      for (const e of on) {
        const s = typeof e?.name === "string" ? every.get(e.name.toLowerCase()) : undefined;
        if (s) yours.push({ name: s.name, path: join(s.path, "SKILL.md") });
        else if (typeof e?.name === "string") gone.push(e.name);
      }
      const taken = new Set(yours.map((y) => y.name.toLowerCase()));
      const library = views.filter((s) => !taken.has(s.name.toLowerCase())).map((s) => ({ name: s.name, path: join(s.path, "SKILL.md"), description: s.description }));
      return { ...doc, skills: { ...doc?.skills, yours, ...(gone.length ? { gone } : {}), ...(library.length ? { library } : {}) } };
    },
  };
  return api;
}
