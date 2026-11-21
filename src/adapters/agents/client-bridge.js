// The client-tool bridge: letting the client's own hands do the agent's work.
//
// A chat client such as Claude Code declares tools in every request (Read, Write, Edit, Bash, AskUserQuestion,
// TodoWrite …) and executes whatever tool calls the reply asks for, with its own cards, diff view and
// permission mode. ACP lets an agent delegate file reads, file writes, terminals and permission prompts to its
// client. This module recognises the client's tools, builds the tool calls Filament emits on the agent's behalf,
// and reads the results the client sends back. The pausing and resuming of the agent turn lives in acp.js.
import { randomBytes } from "node:crypto";
import { ROLE_NAMES } from "../../core/tool-vocab.js";
import { clientQuestions, clientSaid } from "./asks.js";
import { shellQuote } from "../tools/shell.js";

/** A permission's question as the client's question tool shows it. @param {string} question */
const askQuestion = (question) => String(question).slice(0, 600);
/** One of its options as the tool shows it. @param {{ optionId: string, name?: string }} o */
const askLabel = (o) => String(o.name || o.optionId).slice(0, 40);

export class ClientToolset {
  constructor(tools = []) {
    this.tools = new Map();
    for (const t of tools) if (t?.name) this.tools.set(t.name, t);
  }
  // Tools as declared in an Anthropic or OpenAI request body.
  static from(format, body) {
    const raw = Array.isArray(body?.tools) ? body.tools : [];
    const tools = raw
      .map((t) =>
        format === "anthropic"
          ? t?.name
            ? { name: t.name, schema: t.input_schema || {}, description: t.description || "" }
            : null
          : t?.function?.name
            ? {
                name: t.function.name,
                schema: t.function.parameters || {},
                description: t.function.description || "",
              }
            : t?.name
              ? {
                  name: t.name,
                  schema: t.parameters || t.input_schema || {},
                  description: t.description || "",
                }
              : null,
      )
      .filter(Boolean);
    return new ClientToolset(tools);
  }
  get size() {
    return this.tools.size;
  }
  nameFor(role) {
    for (const n of ROLE_NAMES[role] || []) if (this.tools.has(n)) return n;
    return null;
  }
  has(role) {
    return !!this.nameFor(role);
  }
  schema(role) {
    const n = this.nameFor(role);
    return n ? this.tools.get(n).schema || {} : null;
  }
  props(role) {
    return this.schema(role)?.properties || {};
  }
  summary() {
    return ["ask", "todo", "read", "write", "edit", "bash"].filter((r) => this.has(r));
  }

  // ---- building tool calls the client understands -------------------------------------------------
  /**
   * The options a permission question shows: Claude Code's question tool takes four choices at most, the first four;
   * another client's one question shows every one. Its answer is read against these (`parseAskAnswer`'s `shown`).
   * @template {{ optionId: string, name?: string, kind?: string }} T @param {T[]} options @returns {T[]}
   */
  askShown(options = []) {
    const p = this.props("ask");
    return !p.questions && p.question ? options : options.slice(0, 4);
  }
  // A permission prompt as a question with the agent's options as the choices.
  /** @param {{ question: string, header?: string, options?: { optionId: string, name?: string, kind?: string }[], description?: string }} q */
  buildAsk({ question, header = "Permission", options = [], description = "" }) {
    const name = this.nameFor("ask");
    if (!name) return null;
    const p = this.props("ask");
    const opts = this.askShown(options).map((o) => ({
      label: askLabel(o),
      description:
        o.description ||
        (o.kind
          ? {
              allow_once: "allow this once",
              allow_always: "allow and remember",
              reject_once: "refuse this once",
              reject_always: "refuse and remember",
            }[o.kind] || ""
          : ""),
    }));
    if (p.questions)
      return {
        name,
        input: {
          questions: [
            {
              question: askQuestion(question),
              header: String(header).slice(0, 12),
              options: opts,
              multiSelect: false,
            },
          ],
        },
      };
    if (p.question) return { name, input: { question: askQuestion(question), options: opts.map((o) => o.label) } };
    return {
      name,
      input: {
        questions: [
          {
            question: String(question).slice(0, 600),
            header: String(header).slice(0, 12),
            options: opts,
            multiSelect: false,
          },
        ],
      },
    };
  }
  // An agent's questions (HarnessV3-ACP AC2-4) in one call of the client's question tool: Claude Code's takes one to
  // four questions of two to four choices each, with a header of twelve characters at most; another client's, one
  // question with its choices. A form that doesn't fit its shape gets none (null), nor does one that asks for a secret,
  // which would stay in the chat's words.
  /** @param {import("./asks.js").AskForm} form */
  buildQuestions(form) {
    const name = this.nameFor("ask");
    if (!name) return null;
    const qs = clientQuestions(form);
    if (!qs.length || qs.some((q) => q.words === "secret")) return null;
    const p = this.props("ask");
    if (p.question && !p.questions) {
      if (qs.length !== 1 || !qs[0].choices.length) return null;
      return { name, input: { question: qs[0].prompt || form.title, options: qs[0].choices.map((c) => c.label) } };
    }
    if (qs.length > 4 || qs.some((q) => q.choices.length < 2 || q.choices.length > 4)) return null;
    return {
      name,
      input: {
        questions: qs.map((q) => ({
          question: q.prompt || form.title,
          header: (q.header || form.agent || "Question").slice(0, 12),
          options: q.choices.map((c) => ({ label: c.label, description: c.description })),
          multiSelect: q.several,
        })),
      },
    };
  }
  // A plan as the client's task list. Claude Code's TodoWrite wants {content, status, activeForm}.
  buildTodo(entries) {
    const name = this.nameFor("todo");
    if (!name) return null;
    const p = this.props("todo");
    const items = (entries || []).map((e) => ({
      content: String(e.content || "").slice(0, 300),
      status: ["pending", "in_progress", "completed"].includes(e.status) ? e.status : "pending",
      activeForm: String(e.content || "").slice(0, 300),
      priority: ["high", "medium", "low"].includes(e.priority) ? e.priority : "medium",
    }));
    if (p.todos) return { name, input: { todos: items } };
    if (p.plan) return { name, input: { plan: items.map((i) => ({ step: i.content, status: i.status })) } };
    return { name, input: { todos: items } };
  }
  buildRead({ path, line = null, limit = null }) {
    const name = this.nameFor("read");
    if (!name) return null;
    const p = this.props("read");
    const input = {};
    input[p.file_path ? "file_path" : p.path ? "path" : p.filePath ? "filePath" : "file_path"] = path;
    if (line != null && line > 1) input[p.offset ? "offset" : p.start_line ? "start_line" : "offset"] = line;
    if (limit != null)
      input[p.limit ? "limit" : p.end_line ? "end_line" : "limit"] =
        p.end_line && line ? line + limit - 1 : limit;
    return { name, input };
  }
  buildWrite({ path, content }) {
    const name = this.nameFor("write");
    if (!name) return null;
    const p = this.props("write");
    const input = {};
    input[p.file_path ? "file_path" : p.path ? "path" : "file_path"] = path;
    input[p.content ? "content" : p.contents ? "contents" : p.text ? "text" : "content"] = content;
    return { name, input };
  }
  buildBash({ command, args = [], cwd = null, timeoutMs = null, description = "" }) {
    const name = this.nameFor("bash");
    if (!name) return null;
    const p = this.props("bash");
    const full = [command, ...(args || []).map(shellQuote)].join(" ");
    const cmd = cwd ? `cd ${shellQuote(String(cwd).replace(/\\/g, "/"))} && ${full}` : full;
    const input = {};
    input[p.command ? "command" : p.cmd ? "cmd" : "command"] = cmd;
    if (timeoutMs && p.timeout) input.timeout = Math.min(600000, Math.max(1000, timeoutMs));
    if (p.description && description) input.description = String(description).slice(0, 100);
    return { name, input };
  }

  // ---- reading results the client sends back ---------------------------------------------------------
  // Which option did the person pick, asked in `question`'s words? The one whose label, as the question showed it
  // (`shown`, `askShown`'s: one it never showed is never picked), is the answer exactly in the client's machine format
  // (`clientSaid`'s: the answer keyed by the question, its `"<question>"="<answer>"` pair, or the result whole). Words
  // are never searched for a label, a yes or a no: "Don't allow this" picks nothing, nor does an answer that names two
  // options (null), and a question nobody answered by a label refuses.
  /**
   * @param {string} text @param {{ optionId: string, name?: string, kind?: string }[]} [options] @param {string} [question]
   * @param {{ optionId: string, name?: string, kind?: string }[]} [shown]
   */
  static parseAskAnswer(text, options = [], question = "", shown = options) {
    const said = clientSaid(String(text || ""), [askQuestion(question)])[0];
    const named = new Set(
      (Array.isArray(said) ? said : said == null ? [] : [said]).flatMap((w) => shown.filter((o) => askLabel(o) === w.trim()).map((o) => o.optionId)),
    );
    return named.size === 1 ? [...named][0] : null;
  }
  // Claude Code-style Read results come back as `cat -n` output; give the agent the bare file text.
  static parseReadResult(text) {
    const t = String(text || "");
    const lines = t.split("\n");
    if (lines.length && lines.filter(Boolean).every((l) => /^\s*\d+(\t|→| )/.test(l)))
      return lines.map((l) => l.replace(/^\s*\d+(\t|→| )?/, "")).join("\n");
    return t;
  }
  // A command's output plus, when present, the exit code the client mentioned.
  static parseBashResult(text, isError = false) {
    let t = String(text || "");
    let exitCode = isError ? 1 : 0;
    const m = /(?:exit code|exited with(?: code)?|Exit status)[:\s]+(-?\d+)/i.exec(t);
    if (m) {
      exitCode = Number(m[1]);
    }
    if (
      /^\s*Error:|command not found|No such file|is not recognized as/i.test(t) &&
      exitCode === 0 &&
      isError
    )
      exitCode = 1;
    return { output: t, exitCode };
  }
}

// Ids for the tool calls Filament emits; the prefix lets the next request be recognised as a continuation.
export const ACTION_PREFIX = "filament_act_";
export function newActionId() {
  return ACTION_PREFIX + randomBytes(6).toString("hex");
}
export function isActionId(id) {
  return typeof id === "string" && id.startsWith(ACTION_PREFIX);
}

// Tool results in the client's newest message(s): Anthropic tool_result blocks, OpenAI `tool` role messages.
export function extractToolResults(format, body) {
  const out = [];
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const textOf = (c) =>
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c
            .map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text || "" : b?.text || ""))
            .join("\n")
        : c == null
          ? ""
          : JSON.stringify(c);
  if (format === "anthropic") {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== "user") break;
      if (!Array.isArray(m.content)) break;
      let any = false;
      for (const b of m.content)
        if (b?.type === "tool_result") {
          any = true;
          out.unshift({ id: b.tool_use_id, text: textOf(b.content), isError: !!b.is_error });
        }
      if (!any) break;
    }
  } else {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== "tool") break;
      out.unshift({ id: m.tool_call_id, text: textOf(m.content), isError: false });
    }
  }
  return out;
}
// Did the newest message carry anything besides tool results (a fresh user message)?
export function newestUserText(format, body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  if (!last) return "";
  if (format === "anthropic") {
    if (last.role !== "user") return "";
    if (typeof last.content === "string") return last.content;
    return (last.content || [])
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  if (last.role === "tool") return "";
  if (last.role !== "user") return "";
  return typeof last.content === "string"
    ? last.content
    : (last.content || [])
        .filter((b) => b?.type === "text")
        .map((b) => b.text)
        .join("\n");
}
