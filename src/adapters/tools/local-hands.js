// Filament's own hands: file and terminal services for an agent that delegates them (Qoder) when the
// chat client has no matching tools of its own. Same machine, same user as the agent would use itself; the
// upstream's permission policy decides what is allowed. Output is capped and truncated from the start, as the
// ACP specification asks.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, parse } from "node:path";
import { spawn } from "node:child_process";
import { SHELL, cmdLine, startCommand, terminalSpawn, withEnv } from "./shell.js";
import { runHand, safeEnv } from "./hands.js";
import { killTree } from "./kill-tree.js";

export class LocalHands {
  /** @param {{ log?: (level: string, msg: string) => void, shell?: import("./shell.js").Shell }} [o]  `shell`: the one a command line runs in, the `bash` tool's */
  constructor({ log = () => {}, shell = SHELL } = {}) {
    this.log = log;
    this.shell = shell;
  }

  async readTextFile({ path, line = null, limit = null }) {
    if (!path) throw Object.assign(new Error("path is required"), { code: -32602 });
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      throw Object.assign(new Error(`cannot read ${path}: ${e.code || e.message}`), { code: -32002 });
    }
    // Split on "\n" ONLY, so each line keeps its own trailing "\r" and the join reproduces the file's real line
    // endings. Splitting on /\r?\n/ here silently converted a CRLF file to LF on any read that passed an offset or a
    // limit — and an agent that then built an Edit from what it read got "old_string was not found", because the
    // Edit path reads the file raw and compares against the bytes actually on disk. Reading a whole file already
    // preserved CRLF, so the two disagreed with each other about the same file.
    if (line != null || limit != null) {
      const lines = text.split("\n");
      const start = Math.max(0, (Number(line) || 1) - 1);
      const n = limit != null ? Math.max(0, Number(limit) || 0) : lines.length;
      text = lines.slice(start, start + n).join("\n");
    }
    return { content: text };
  }

  async writeTextFile({ path, content }) {
    if (!path) throw Object.assign(new Error("path is required"), { code: -32602 });
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, String(content ?? ""), "utf8");
    } catch (e) {
      throw Object.assign(new Error(`cannot write ${path}: ${e.code || e.message}`), { code: -32000 });
    }
    return null;
  }

  /**
   * An edit to the file at `path` (absolute), made by the loop's edit hand: the text found as the file has it, CRLF or
   * a BOM included, and kept so, and a file that is not UTF-8 refused untouched. The MCP server's Edit and the Cursor
   * SDK's read and wrote the raw text, so an edit with LF lines missed a CRLF file, and a file in another encoding was
   * rewritten everywhere (fable51's list). `edits` in either spelling the hand reads; the result is the hand's words.
   * @param {{ path: string, edits: any[] }} a
   */
  async editTextFile({ path, edits }) {
    if (!path) throw Object.assign(new Error("path is required"), { code: -32602 });
    return runHand("edit", { path, edits }, { root: parse(path).root, fenced: false });
  }

  // Starts the command and returns at once; `term` is filled in as output arrives and when the process exits. With
  // arguments it is a program and its arguments, as ACP's `terminal/create` sends them: each arrives whole
  // (`terminalSpawn`, the bug report's H16) — joined into a shell's line, one holding `&` ran a second command. Alone it
  // is a command line, which the shell of the `bash` tool runs (`SHELL`, started as the loop's own hand starts it): the
  // chat's switch reads the line as that shell's (app/agent-permits.js `readsOnly`), and run by cmd.exe on Windows, to
  // which a single quote is no quote, `cat 'a&echo x>made'` read as one file to print wrote a file (the re-read of
  // 11-11). Where that shell is cmd.exe (no Git Bash here) it gets the line inside the pair of quotes /s strips, so
  // its own stay (shell.js `cmdLine`). Its environment is the bash hand's (hands.js `safeEnv`), on every road: the command is one a model
  // chose, so it gets none of the keys and tokens Filament was started with, and the chat's switch reads it with that
  // same environment. The agent's own variables come over it, and replace their namesakes in any case (`withEnv`): on
  // Windows `PATH` and `Path` are one name.
  runTerminal({ command, args = [], env = [], cwd = null, outputByteLimit = null }, term) {
    const line = String(command ?? "");
    const argv = (Array.isArray(args) ? args : []).map(String);
    const limit = Number(outputByteLimit) > 0 ? Number(outputByteLimit) : 1_000_000;
    const vars = Object.fromEntries((Array.isArray(env) ? env : []).filter((e) => e?.name).map((e) => [e.name, String(e.value ?? "")]));
    const envObj = withEnv(safeEnv(), vars);
    let child;
    try {
      const how = argv.length
        ? terminalSpawn(line, argv, { cwd: cwd || process.cwd(), env: envObj })
        : this.shell.kind === "cmd"
          ? { file: process.env.ComSpec || "cmd.exe", args: cmdLine(line), verbatim: true }
          : null;
      if (how) {
        child = spawn(how.file, how.args, {
          cwd: cwd || undefined,
          env: envObj,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          windowsVerbatimArguments: how.verbatim,
        });
      } else {
        const started = startCommand(this.shell, line, { cwd: cwd || process.cwd(), env: envObj });
        child = started.proc;
        term.stop = started.stop;
      }
    } catch (e) {
      term.output = `Filament: could not start the command: ${e.message}`;
      term.exit = { exitCode: 1, signal: null };
      return Promise.resolve();
    }
    term.child = child;
    term.truncated = false;
    // What the command printed, its last `limit` characters: the chunks as they came and their running length, whole
    // chunks let go from the front past the limit and the first of the rest cut. `output` joins them when read, and
    // keeps the join until more comes. Added to one string and cut at every chunk past the limit, each chunk of a
    // chatty command copied the whole megabyte.
    /** @type {string[]} */
    let chunks = [];
    let size = 0;
    Object.defineProperty(term, "output", {
      configurable: true,
      enumerable: true,
      get: () => {
        if (chunks.length > 1) chunks = [chunks.join("")];
        return chunks[0] ?? "";
      },
      set: (v) => {
        chunks = [String(v)];
        size = chunks[0].length;
      },
    });
    const push = (d) => {
      const s = String(d);
      chunks.push(s);
      size += s.length;
      if (size <= limit) return;
      while (size - chunks[0].length >= limit) size -= /** @type {string} */ (chunks.shift()).length;
      if (size > limit) {
        chunks[0] = chunks[0].slice(size - limit);
        size = limit;
      }
      term.truncated = true;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    return new Promise((resolve) => {
      child.on("error", (e) => {
        push(`\nFilament: ${e.message}`);
        term.exit = { exitCode: 1, signal: null };
        resolve();
      });
      child.on("close", (code, signal) => {
        term.exit = { exitCode: code ?? null, signal: signal || null };
        resolve();
      });
    });
  }

  // The shell goes with what it started (kill-tree.js; a line's shell by its own stop, which finds Git Bash's forks
  // too); the terminal's exit is its close, read where it was spawned.
  kill(term) {
    if (!term.child || term.exit != null) return;
    if (term.stop) return void term.stop().catch(() => {});
    void killTree(term.child, { warn: (what) => this.log("warn", `terminal ${term.child.pid}: taskkill ${what}; killing its shell directly`) });
  }
}
