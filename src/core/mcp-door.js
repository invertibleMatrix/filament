// @ts-check
// The door to the MCP tools that load on demand (E49; the owner's words of 10-26: "we don't wanna bloat the context
// anymore"). A server's tools ride every request in full only where it says `load: "core"`; any other's are named in the
// system prompt, and one tool, `mcp`, finds them, loads what one does and takes, and calls it. What it loads is a tool's
// result, so it joins the conversation after the prefix the provider caches: the tools and the prompt never move for
// it. A call through it is unwrapped before it is judged (`unwrapDoor`), so the gate, the rules, the hooks, the record
// and the page see the server's own tool, as if the model had called it by its name.

export const MCP_DOOR = "mcp";
const PREFIX = "mcp__";
/** At most this many tools a find names, a load reads. */
export const DOOR_FIND_MAX = 20;
export const DOOR_LOAD_MAX = 20;

/**
 * A tool the door reaches: `name` the model-facing mcp__<server>__<tool>, `tool` the server's own name for it.
 * @typedef {{ name: string, description: string, input_schema: any, server: string, tool: string, readOnly?: boolean }} DoorTool
 */
/** @typedef {{ byName: ReadonlyMap<string, DoorTool>, tools: readonly DoorTool[] }} DoorIndex */

/** The door's definition, frozen with the prompt's version (a change to it is a change of every request with it). */
export const DOOR_TOOL = Object.freeze({
  name: MCP_DOOR,
  description:
    "Reaches the tools of the developer's MCP servers that the system prompt names but does not load. find: list one server's tools (server), or search them by what they do (query; with server, that server's only). load: read what named tools do and the input each takes (tools: their names). call: run one (tool: its name; args: its input), judged as its own call would be — one that changes something may ask the developer first. Name a tool as find lists it, with its server where another has one of that name, or whole as mcp__<server>__<tool>.",
  input_schema: Object.freeze({
    type: "object",
    properties: Object.freeze({
      action: Object.freeze({ type: "string", enum: Object.freeze(["find", "load", "call"]) }),
      query: Object.freeze({ type: "string", description: "find: words for what the tool does" }),
      tools: Object.freeze({ type: "array", items: Object.freeze({ type: "string" }), description: `load: the tools' names, at most ${DOOR_LOAD_MAX}` }),
      server: Object.freeze({ type: "string", description: "find: the server whose tools to list; load and call: the server, where a tool's name alone could be another's" }),
      tool: Object.freeze({ type: "string", description: "call: the tool's name" }),
      args: Object.freeze({ type: "object", description: "call: the tool's input, as load shows it" }),
    }),
    required: Object.freeze(["action"]),
  }),
});

/** @param {readonly DoorTool[]} tools @returns {DoorIndex} */
export const doorIndex = (tools) => ({ byName: new Map(tools.map((t) => [t.name, t])), tools });

/** A tool's name as the prompt lists it under its server: what follows mcp__<server>__. @param {DoorTool} t */
export const shortName = (t) => (t.name.startsWith(`${PREFIX}${t.server}__`) ? t.name.slice(`${PREFIX}${t.server}__`.length) : t.tool);

/**
 * The tool a name means: whole (mcp__<server>__<tool>), or as listed under its server — the server named, or the name
 * one server's alone. Words for a name that means none, or several.
 * @param {DoorIndex} index @param {unknown} name @param {unknown} [server]
 * @returns {{ tool: DoorTool } | { error: string }}
 */
export function resolveTool(index, name, server) {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return { error: "Name the tool." };
  const whole = index.byName.get(n) || index.byName.get(`${PREFIX}${n}`);
  if (whole) return { tool: whole };
  const s = typeof server === "string" ? server.trim() : "";
  const hits = index.tools.filter((t) => (!s || t.server === s) && (shortName(t) === n || t.tool === n));
  if (hits.length === 1) return { tool: hits[0] };
  if (hits.length > 1) return { error: `${n} is a tool of ${hits.map((t) => t.server).join(" and ")}: name it whole (${hits.map((t) => t.name).join(", ")}).` };
  if (s && !index.tools.some((t) => t.server === s)) return { error: `No MCP server named ${s} is in this session: ${serversSaid(index)}.` };
  return { error: `No tool named ${n}${s ? ` on ${s}` : ""} in this session's MCP servers. find searches them.` };
}

/** @param {DoorIndex} index */
const serversSaid = (index) => {
  const names = [...new Set(index.tools.map((t) => t.server))];
  return names.length ? `its servers are ${names.join(", ")}` : "it has none";
};

/** @param {any} input */
const actionOf = (input) => String(input?.action ?? "").trim().toLowerCase();

/**
 * A call through the door as the call it stands for: an action call that names a tool of the session's becomes that
 * tool's own call — its name, its args, the door call's id — and anything else stays as it is, for the door to answer.
 * @template {{ name: string, input?: any }} U
 * @param {U} u @param {DoorIndex | null | undefined} index
 * @returns {U}
 */
export function unwrapDoor(u, index) {
  if (!index || u?.name !== MCP_DOOR || actionOf(u.input) !== "call") return u;
  const r = resolveTool(index, u.input?.tool, u.input?.server);
  if (!("tool" in r)) return u;
  const args = u.input?.args;
  return { ...u, name: r.tool.name, input: args && typeof args === "object" && !Array.isArray(args) ? args : {} };
}

/**
 * A door call read without the session's tools, for its card (tool-vocab `cardOf`): a call as the tool it names —
 * whole where its words make it whole — and find and load by what they look for. Null for any other call.
 * @param {string} name @param {any} input
 * @returns {{ call: { name: string, input: any } } | { title: string, subject: string } | null}
 */
export function doorCall(name, input) {
  if (name !== MCP_DOOR) return null;
  const action = actionOf(input);
  if (action === "find") return { title: "Look for tools", subject: String(input?.query ?? "") };
  if (action === "load") return { title: "Load tools", subject: (Array.isArray(input?.tools) ? input.tools : [input?.tool]).filter((t) => typeof t === "string" && t).join(", ") };
  if (action !== "call") return null;
  const tool = String(input?.tool ?? "").trim();
  const server = String(input?.server ?? "").trim();
  const whole = tool.startsWith(PREFIX) ? tool : server && tool ? `${PREFIX}${server}__${tool}` : "";
  return whole ? { call: { name: whole, input: input?.args ?? null } } : { title: "Call a tool", subject: tool };
}

/** A description's first sentence, cut short. @param {string} d */
const firstLine = (d) => {
  const one = String(d || "").split(/\n/)[0].trim();
  const cut = /^(.{20,}?[.!?])\s/.exec(one);
  const s = cut ? cut[1] : one;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

/**
 * What the door answers for find and load, and for a call it could not unwrap. Throws in words for what it cannot do,
 * as any tool's failure reaches the model.
 * @param {any} input @param {DoorIndex} index
 * @returns {string}
 */
export function doorAnswer(input, index) {
  const action = actionOf(input);
  if (action === "find") {
    const words = String(input?.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const server = typeof input?.server === "string" ? input.server.trim() : "";
    const of = server ? index.tools.filter((t) => t.server === server) : index.tools;
    if (server && !of.length) throw new Error(`No MCP server named ${server} is in this session: ${serversSaid(index)}.`);
    if (!words.length && !server) throw new Error("find needs a server, to list its tools, or a query: words for what the tool does.");
    // A server's tools listed whole: every one by its name and first line.
    if (!words.length)
      return [`${server}'s ${of.length} tool${of.length === 1 ? "" : "s"}:`, ...of.map((t) => `- ${shortName(t)}${t.readOnly ? " (reads only)" : ""}: ${firstLine(t.description)}`), "load reads what one does and the input it takes."].join("\n");
    const scored = of
      .map((t) => {
        const name = `${t.server} ${shortName(t)}`.toLowerCase();
        const text = String(t.description || "").toLowerCase();
        return { t, score: words.reduce((n, w) => n + (name.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return `No tool of ${server ? server : "this session's MCP servers"} matches "${input.query}".${server ? "" : " find with a server lists its tools."}`;
    const shown = scored.slice(0, DOOR_FIND_MAX);
    return [
      `${scored.length} tool${scored.length === 1 ? "" : "s"} match${scored.length === 1 ? "es" : ""}${scored.length > shown.length ? `; the ${shown.length} closest` : ""}:`,
      ...shown.map(({ t }) => `- ${t.name}${t.readOnly ? " (reads only)" : ""}: ${firstLine(t.description)}`),
      "load reads what one does and the input it takes.",
    ].join("\n");
  }
  if (action === "load") {
    const asked = (Array.isArray(input?.tools) ? input.tools : typeof input?.tool === "string" ? [input.tool] : []).map(String);
    if (!asked.length) throw new Error("load needs tools: the names of the tools to read.");
    const out = [];
    for (const n of asked.slice(0, DOOR_LOAD_MAX)) {
      const r = resolveTool(index, n, input?.server);
      out.push("tool" in r ? toolText(r.tool) : `## ${n}\n${r.error}`);
    }
    if (asked.length > DOOR_LOAD_MAX) out.push(`(${asked.length - DOOR_LOAD_MAX} more not loaded: at most ${DOOR_LOAD_MAX} at a time.)`);
    return out.join("\n\n");
  }
  if (action === "call") {
    const r = resolveTool(index, input?.tool, input?.server);
    throw new Error("error" in r ? r.error : `Call ${r.tool.name} with its args.`);
  }
  throw new Error(`mcp's action is find, load or call${action ? `, not ${action}` : ""}.`);
}

/** One tool loaded: its whole name, what it does, the input it takes, and how to call it. @param {DoorTool} t */
const toolText = (t) =>
  [
    `## ${t.name}${t.readOnly ? " (reads only)" : ""}`,
    String(t.description || "").trim() || "(its server says nothing of what it does)",
    `Input (JSON Schema): ${JSON.stringify(t.input_schema ?? { type: "object" })}`,
    `Call it: mcp with action call, tool ${t.name}, args as above.`,
  ].join("\n");

/**
 * The prompt's lines for the servers whose tools load on demand: each server with how many tools it has — their names
 * come with find, so a server costs its line however many it has — and what of it the project uses, where it says.
 * @param {readonly { name: string, names: readonly string[], note?: string }[]} servers
 */
export const doorLines = (servers) =>
  servers.map((s) => `- ${s.name}: ${s.names.length ? `${s.names.length} tool${s.names.length === 1 ? "" : "s"}` : "no tools"}${s.note ? ` — in this project: ${s.note}` : ""}`).join("\n");
