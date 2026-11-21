// @ts-check
// A connection's tools for a project's Space (HarnessV4_Space_Plan S4a, SG-D6, SG-D11): a dashboard's source reads one
// and a button calls one, through the MCP server the project's chats have by that name — its sign-in included — with
// no AI. A source's tool must be one its server marks read-only, asked again at each read; its answer's data becomes
// rows (core's `toolData`); a paused dashboard stops its read. A button's call has no clock: it ends, or the person
// stops it. Both send their args as the tool's schema takes them (core's `argsAsSchema`). Keep's sheet asks what each
// tool is, now, before anything is kept. A draft (S5) is sent the way a button calls, as the account its sheet picks,
// to a tool its server does not mark read-only. Connections are pooled per project and server, closed when idle.
import { createMcpPool } from "../adapters/tools/mcp-client.js";
import { COMMAND_MS, TOO_MUCH, argsAsSchema, overBytes, toolData } from "../core/dashboard-sources.js";
import { accountOf, accountWords } from "../core/oauth.js";
import { toolSplits } from "../core/watchers.js";

/** A button's call has no clock (SG-D11): the longest a timer can wait. */
const NO_CLOCK_MS = 2 ** 31 - 1;

/** @typedef {import("../core/dashboard-sources.js").Tool} Tool */
/**
 * What Keep's sheet says of one tool: its server's word on it, or why it cannot be reached.
 * @typedef {{ connection: string, name: string, ok: boolean, words: string }} ToolCheck
 */

/** An error's words. @param {any} e */
const said = (e) => String(e?.message || e || "it failed").replace(/^McpError: /, "");
/** Why a watcher asks no tool its server does not mark read-only. @param {string} connection @param {string} tool */
const notOnlyReads = (connection, tool) => `${connection} does not say ${tool} only reads: a watcher only reads, so it is not asked`;

/**
 * @param {{ serverFor: (project: string, name: string) => ({ ok: true, spec: Record<string, any>, cwd: string } | { ok: false, error: string }),
 *   auth?: import("../adapters/tools/mcp-client.js").McpAuth | null, log?: (level: string, msg: string) => void,
 *   pool?: { servers: ReturnType<typeof createMcpPool>["servers"], closeAll: () => Promise<void> } }} deps
 *   `serverFor`: a server a project's chats have, by its name (app/sessions/mcp-servers.js); `auth`: Filament's sign-ins;
 *   `pool`: the connections (a test's stand-in)
 */
export function createSpaceTools({ serverFor, auth = null, log = () => {}, pool }) {
  const conns = pool || createMcpPool({ log, auth });

  /**
   * A project's server connected, by its name, or why not. `account`: another account than the one the project picks
   * (a draft's From, HarnessV4_Space_Plan S5c) — a server reached over HTTP signs in as that one, in a slot of its own,
   * so the project's own connection stays as it is.
   * @param {string} project @param {string} connection @param {string} [account]
   */
  async function connect(project, connection, account) {
    const s = serverFor(project, connection);
    if (!s.ok) return s;
    const want = account ? accountOf(account) : null;
    const other = want != null && typeof s.spec.url === "string" && want !== accountOf(s.spec.account);
    const spec = other ? { ...s.spec, account: want } : s.spec;
    // One pool slot per project and server — and account, where it is not the project's —: a project's other servers
    // stay connected.
    const slot = `space:${project}:${connection}${other ? `#${accountWords(want)}` : ""}`;
    const [r] = await conns.servers(slot, [/** @type {any} */ ({ ...spec, name: connection })], { cwd: s.cwd });
    if (!r?.conn) return { ok: /** @type {const} */ (false), error: r?.problem || `${connection} could not be reached` };
    return { ok: /** @type {const} */ (true), conn: r.conn };
  }

  /**
   * A project's server connected, and asked for its tools now: what a source may read, what Keep's sheet says and the
   * shape a button's sheet takes are its word of now, not the one it gave as it connected (found by the Hunters on S4a:
   * Keep's sheet said "only reads" of a tool its server no longer said so of).
   * @param {string} project @param {string} connection @param {string} [account]
   */
  async function listed(project, connection, account) {
    const c = await connect(project, connection, account);
    if (!c.ok || !c.conn.relist) return c;
    try {
      await c.conn.relist();
      return c;
    } catch (e) {
      return { ok: /** @type {const} */ (false), error: `${connection} could not say its tools (${said(e)})` };
    }
  }

  /**
   * A tool by the name the loop gives it (mcp-client.js `toolNameFor`), which is how a watcher's trigger names it: its
   * server connected and asked for its tools now, and the one it lists under that name — whatever the server's own
   * name for it, which the loop cleans and cuts. A name reads more than one way where a server's own holds `__`
   * (core's `toolSplits`): the first server that lists it. Or why not: of a server that has no such tool or could not
   * be reached, before one the project's chats do not have.
   * @param {string} project @param {string} name
   */
  async function named(project, name) {
    let why = "";
    let none = "";
    for (const p of toolSplits(name)) {
      const s = serverFor(project, p.connection);
      if (!s.ok) {
        none ||= s.error;
        continue;
      }
      const c = await listed(project, p.connection);
      const t = c.ok ? c.conn.tools.find((x) => x.name === name) : null;
      if (c.ok && t) return { ok: /** @type {const} */ (true), conn: c.conn, connection: p.connection, t };
      why ||= c.ok ? `${p.connection} has no tool ${p.name}` : c.error;
    }
    return { ok: /** @type {const} */ (false), error: why || none || `${name} names no connection's tool` };
  }

  return {
    /**
     * A source's tool read (S4a): the tool there and marked read-only by its server, called with its args as its schema
     * takes them — 60 s at most —, its answer's data as JSON text; or why not, in words. `signal` stops it — its
     * dashboard paused, taken out or kept again —: a call not sent is not sent, and a server is told to cancel one that
     * was (found by the Hunter on S4a: a paused dashboard's call ran on, and the next read overlapped it).
     * @param {string} project @param {Tool} tool @param {AbortSignal} [signal]
     * @returns {Promise<import("../core/dashboard-sources.js").CommandOut>}
     */
    async read(project, tool, signal) {
      const c = await listed(project, tool.connection);
      if (signal?.aborted) return { ok: false, error: "the read was stopped" };
      if (!c.ok) return { ok: false, error: c.error };
      const t = c.conn.tools.find((x) => x.tool === tool.name);
      if (!t) return { ok: false, error: `${tool.connection} has no tool ${tool.name}` };
      if (!t.readOnly) return { ok: false, error: `${tool.connection} does not say ${tool.name} only reads: a source only reads, so it is not called` };
      try {
        return toolData(await c.conn.call(tool.name, argsAsSchema(tool.args, t.input_schema), { timeoutMs: COMMAND_MS, raw: true, signal: signal || null }));
      } catch (e) {
        return { ok: false, error: signal?.aborted ? "the read was stopped" : said(e) };
      }
    },
    /**
     * A watcher's tool asked (the plan of 11-11, its w4), by the name the loop gives it (`named`): as a source's read —
     * the tool there and marked read-only by its server, asked again each time, its args as its schema takes them, 60 s
     * at most —, its answer's data as JSON text, or its words where it answers words, "" where it answers nothing: a
     * tool with nothing to say holds no items. Or why not: its own failure, or more than a megabyte, never compared
     * in part. `signal` stops it.
     * @param {string} project @param {{ tool: string, args: Record<string, unknown> }} asked @param {AbortSignal} [signal]
     * @returns {Promise<{ ok: true, out: string } | { ok: false, error: string }>}
     */
    async ask(project, asked, signal) {
      const c = await named(project, asked.tool);
      if (signal?.aborted) return { ok: false, error: "the ask was stopped" };
      if (!c.ok) return { ok: false, error: c.error };
      const t = c.t;
      if (!t.readOnly) return { ok: false, error: notOnlyReads(c.connection, t.tool) };
      try {
        const r = await c.conn.call(t.tool, argsAsSchema(asked.args, t.input_schema), { timeoutMs: COMMAND_MS, raw: true, signal: signal || null });
        const data = toolData(r);
        // Data, the tool's own failure, or data past what a source may say.
        if (data.ok || r?.isError || r?.structuredContent !== undefined) return data;
        // Words, not data: a watcher compares them by their lines. None at all is an answer of no items — but parts
        // that are no text (an image) are no answer a watcher reads.
        const parts = Array.isArray(r?.content) ? r.content : [];
        const words = parts.filter((/** @type {any} */ x) => x?.type === "text").map((/** @type {any} */ x) => String(x.text ?? "")).join("\n");
        if (!words.trim()) return parts.some((/** @type {any} */ x) => x?.type !== "text") ? data : { ok: true, out: "" };
        return overBytes(words) ? { ok: false, error: TOO_MUCH } : { ok: true, out: words };
      } catch (e) {
        return { ok: false, error: signal?.aborted ? "the ask was stopped" : said(e) };
      }
    },
    /**
     * Whether a watcher's tool can be asked, said as an agent proposes the watcher: by the name the loop gives it
     * (`named`), a tool the project's chats have, switched on, that its server marks read-only now. Nothing is called.
     * Or why not, in the words an ask of it would fail with.
     * @param {string} project @param {string} tool
     * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
     */
    async askable(project, tool) {
      const c = await named(project, tool);
      if (!c.ok) return { ok: false, error: c.error };
      return c.t.readOnly ? { ok: true } : { ok: false, error: notOnlyReads(c.connection, c.t.tool) };
    },
    /**
     * A button's tool called (S4a), its args filled — sent as the tool's schema takes them: a row's key or an answer that
     * reads as a number goes as one where the tool takes a number —: no clock — it ends, or `signal` stops it. Says the
     * args it sent. Its server asked for its tools first, as the sheet's schema was (found by the Hunter on S4a: shaped
     * by the list it gave as it connected, a changed schema was sent the old way).
     * @param {string} project @param {Tool} tool @param {Record<string, unknown>} args @param {AbortSignal} [signal]
     * @returns {Promise<import("../core/dashboard-sources.js").ActionOut>}
     */
    async act(project, tool, args, signal) {
      const c = await listed(project, tool.connection);
      // Stopped while its server was connecting: nothing is called.
      if (signal?.aborted) return { ok: false, error: "you stopped it", said: "", sent: false };
      if (!c.ok) return { ok: false, error: c.error, said: "" };
      const t = c.conn.tools.find((x) => x.tool === tool.name);
      if (!t) return { ok: false, error: `${tool.connection} has no tool ${tool.name}`, said: "" };
      const sent = /** @type {Record<string, unknown>} */ (argsAsSchema(args, t.input_schema));
      if (signal?.aborted) return { ok: false, error: "you stopped it", said: "", sent: false };
      try {
        const r = await c.conn.call(tool.name, sent, { timeoutMs: NO_CLOCK_MS, signal: signal || null });
        return { ok: true, said: typeof r === "string" ? r : String(r?.text ?? ""), args: sent };
      } catch (e) {
        // Stopped once sent: Filament lets the call go and tells the server to cancel it (mcp-client.js); what the tool
        // did before it heard that stays done.
        return { ok: false, error: signal?.aborted ? "you stopped it" : said(e), said: "", args: sent, ...(signal?.aborted ? { sent: true } : {}) };
      }
    },
    /**
     * Whether a draft's tool can send (S5c, its case 7): its server reached — as the account picked —, the tool there,
     * and not one its server marks read-only, which sends nothing. In words either way.
     * @param {string} project @param {{ connection: string, name: string }} tool @param {string} [account]
     * @returns {Promise<{ ok: boolean, words: string }>}
     */
    async sendable(project, tool, account) {
      const c = await listed(project, tool.connection, account);
      if (!c.ok) return { ok: false, words: c.error };
      const t = c.conn.tools.find((x) => x.tool === tool.name);
      if (!t) return { ok: false, words: `${tool.connection} has no tool ${tool.name}` };
      if (t.readOnly) return { ok: false, words: `${tool.connection} says ${tool.name} only reads: it sends nothing` };
      return { ok: true, words: `Sends through ${tool.connection} › ${tool.name}` };
    },
    /**
     * A draft sent (S5c): its tool — asked for now, and not one its server marks read-only — called with the args as the
     * person's Send filled them, as its schema takes them, as the account picked. No clock: it ends, or `signal` stops
     * it.
     * @param {string} project @param {{ connection: string, name: string }} tool @param {Record<string, unknown>} args
     * @param {string} [account] @param {AbortSignal} [signal]
     * @returns {Promise<import("../core/dashboard-sources.js").ActionOut>}
     */
    async send(project, tool, args, account, signal) {
      const c = await listed(project, tool.connection, account);
      if (signal?.aborted) return { ok: false, error: "you stopped it", said: "", sent: false };
      if (!c.ok) return { ok: false, error: c.error, said: "" };
      const t = c.conn.tools.find((x) => x.tool === tool.name);
      if (!t) return { ok: false, error: `${tool.connection} has no tool ${tool.name}`, said: "" };
      if (t.readOnly) return { ok: false, error: `${tool.connection} says ${tool.name} only reads: it sends nothing`, said: "" };
      const sent = /** @type {Record<string, unknown>} */ (argsAsSchema(args, t.input_schema));
      try {
        const r = await c.conn.call(tool.name, sent, { timeoutMs: NO_CLOCK_MS, signal: signal || null });
        return { ok: true, said: typeof r === "string" ? r : String(r?.text ?? ""), args: sent };
      } catch (e) {
        return { ok: false, error: signal?.aborted ? "you stopped it" : said(e), said: "", args: sent, ...(signal?.aborted ? { sent: true } : {}) };
      }
    },
    /**
     * A tool's input schema, as its server lists it (S4a) — what a button's sheet shapes its call by —, or null where the
     * server or the tool cannot be reached.
     * @param {string} project @param {Tool} tool
     * @returns {Promise<any>}
     */
    async schema(project, tool) {
      const c = await listed(project, tool.connection);
      return c.ok ? (c.conn.tools.find((x) => x.tool === tool.name)?.input_schema ?? null) : null;
    },
    /**
     * What Keep's sheet says of each tool a dashboard names (S4a): each server asked for its tools once, now; a source's
     * tool must be one it marks read-only, a button's may be any it has.
     * @param {string} project @param {{ connection: string, name: string, reads: boolean }[]} tools
     * @returns {Promise<(ToolCheck & { reads: boolean })[]>}
     */
    async check(project, tools) {
      /** @type {Map<string, Awaited<ReturnType<typeof listed>>>} */
      const got = new Map();
      for (const name of new Set(tools.map((t) => t.connection))) got.set(name, await listed(project, name));
      return tools.map((t) => {
        const c = /** @type {Awaited<ReturnType<typeof listed>>} */ (got.get(t.connection));
        const base = { connection: t.connection, name: t.name, reads: t.reads };
        if (!c.ok) return { ...base, ok: false, words: c.error };
        const found = c.conn.tools.find((x) => x.tool === t.name);
        if (!found) return { ...base, ok: false, words: `${t.connection} has no tool ${t.name}` };
        if (t.reads && !found.readOnly) return { ...base, ok: false, words: `${t.connection} does not say it only reads: it will not be read` };
        return { ...base, ok: true, words: found.readOnly ? "only reads, its server says" : "acts: Filament calls it only from its sheet, when you press Run" };
      });
    },
    /**
     * A connection's tools as the Pull sheet offers them (the Space Apps plan of 10-29): each by its name, whether its
     * server marks it read-only — a pull reads only those — and its first words; or why the server cannot be reached.
     * Its server asked for them now; nothing is called.
     * @param {string} project @param {string} connection
     * @returns {Promise<{ ok: true, tools: { name: string, readOnly: boolean, description: string }[] } | { ok: false, error: string }>}
     */
    async toolsOf(project, connection) {
      const c = await listed(project, connection);
      if (!c.ok) return { ok: false, error: c.error };
      return { ok: true, tools: c.conn.tools.map((t) => ({ name: t.tool, readOnly: t.readOnly === true, description: String(t.description || "").slice(0, 200) })) };
    },
    /** Every connection closed. */
    close: () => conns.closeAll(),
  };
}

/** @typedef {ReturnType<typeof createSpaceTools>} SpaceTools */
