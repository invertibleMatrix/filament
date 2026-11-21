// @ts-check
// The resources of the developer's MCP servers (the owner's word of 10-27: "Filament uses their tools but not their
// resources … i will leave this upto you to decide"), as Claude Code reaches them: one tool that only reads — `list`
// names what each server offers by address (its resources, and the templates it fills in), `read` gives one's content.
// Offered where a connected server says it has resources (`capabilities.resources`), after the servers' own tools, so
// a session without one sends the set it always sent. Its answers are the server's words, redacted as a tool's result
// is and cut to the result budget. MCP's prompts stay out: they are the person's to pick, as a command, not the agent's.
import { McpError, resourceResultText } from "../../adapters/tools/mcp-client.js";

export const MCP_RESOURCES = "mcp_resources";
/** At most this many resources a list names per server, templates included. */
export const RESOURCES_LIST_MAX = 200;
/** A description cut to this many characters in a list. */
const DESCRIPTION_CHARS = 200;
/** At most this many pages a list reads of one server's resources, and of its templates: one that pages without end ends here. */
export const RESOURCES_PAGES_MAX = 25;

export const MCP_RESOURCES_TOOL = Object.freeze({
  name: MCP_RESOURCES,
  description:
    "Reads what the developer's MCP servers offer as resources — files, records, pages and documents a server gives by address, beside its tools. list: the resources of every server that has any, or of one (server) — each one's address (uri), its name and what it is; a template's address has {parts} you fill in. read: one resource's content (uri, and server where more than one server has resources). It only reads.",
  input_schema: Object.freeze({
    type: "object",
    properties: Object.freeze({
      action: Object.freeze({ type: "string", enum: Object.freeze(["list", "read"]) }),
      server: Object.freeze({ type: "string", description: "list: that server's only; read: the server the resource is on" }),
      uri: Object.freeze({ type: "string", description: "read: the resource's address, as list gives it (a template's with its {parts} filled in)" }),
    }),
    required: Object.freeze(["action"]),
  }),
});

/**
 * A server whose resources the tool reaches: its name and its connection.
 * @typedef {{ name: string, conn: import("../../adapters/tools/mcp-client.js").McpConnection }} ResourceServer
 */
/** @typedef {{ signal?: AbortSignal | null, maxBytes: number, redact?: ((text: string) => string) | null }} ResourceTake */

/** One line of a list. @param {any} r @param {string} uri */
const lineOf = (r, uri) => {
  const name = String(r?.title || r?.name || "").trim();
  const mime = r?.mimeType ? ` (${r.mimeType})` : "";
  const d = String(r?.description || "").replace(/\s+/g, " ").trim();
  const about = d ? `: ${d.length > DESCRIPTION_CHARS ? `${d.slice(0, DESCRIPTION_CHARS - 1)}…` : d}` : "";
  return `- ${uri}${name && name !== uri ? ` — ${name}` : ""}${mime}${about}`;
};

/**
 * One server's resources and templates, page by page, at most RESOURCES_LIST_MAX in all.
 * @param {ResourceServer} s @param {AbortSignal | null} signal
 */
async function listOf(s, signal) {
  const ask = /** @type {NonNullable<typeof s.conn.request>} */ (s.conn.request);
  /** @type {string[]} */
  const lines = [];
  let more = false;
  /** @param {string} method @param {string} field @param {(x: any) => string} line */
  // A page that brings nothing while it names a next one, a cursor seen before, or past RESOURCES_PAGES_MAX: the list
  // goes no further, and says the server has more (the Hunter's find of 10-27: such a server held the call forever).
  const pages = async (method, field, line) => {
    /** @type {string | undefined} */
    let cursor;
    const seen = new Set();
    for (let page = 1; ; page++) {
      const p = await ask(method, cursor ? { cursor } : {}, { signal });
      const items = Array.isArray(p?.[field]) ? p[field] : [];
      for (const x of items) {
        if (lines.length >= RESOURCES_LIST_MAX) {
          more = true;
          return;
        }
        lines.push(line(x));
      }
      const next = typeof p?.nextCursor === "string" && p.nextCursor ? p.nextCursor : null;
      if (!next) return;
      if (!items.length || seen.has(next) || page >= RESOURCES_PAGES_MAX) {
        more = true;
        return;
      }
      seen.add(next);
      cursor = next;
    }
  };
  await pages("resources/list", "resources", (r) => lineOf(r, String(r?.uri || "")));
  const listed = lines.length;
  // Templates are a server's to offer or not: one that has none answers "method not found", which is no failure. Any
  // other failure leaves the resources listed, and says so; a stop still stops.
  /** @type {string | null} */
  let templatesWhy = null;
  if (!more)
    await pages("resources/templates/list", "resourceTemplates", (t) => `${lineOf(t, String(t?.uriTemplate || ""))} (a template: fill in its {parts})`).catch((e) => {
      if (signal?.aborted) throw e;
      if (!(e instanceof McpError && e.code === -32601)) templatesWhy = String(e?.message || e);
    });
  const n = lines.length;
  const counted = `${listed} resource${listed === 1 ? "" : "s"}${n > listed ? ` and ${n - listed} template${n - listed === 1 ? "" : "s"}` : ""}`;
  const untold = templatesWhy ? `its templates could not be listed: ${templatesWhy}` : "";
  if (!n) return more ? `${s.name}: it named none, though it says it has more.` : `${s.name}: no resources${untold ? ` (${untold})` : ""}.`;
  return [`${s.name} (${more ? `the first ${n}: it has more` : counted}):`, ...lines, ...(untold ? [`(${untold})`] : [])].join("\n");
}

/**
 * One call: a list of the servers' resources, or one resource's content — the server's words redacted, the content cut
 * to `maxBytes` (an image beside the text, as a tool's result has one). Throws in words for a call that names nothing
 * this session reaches.
 * @param {any} input @param {readonly ResourceServer[]} servers @param {ResourceTake} take
 * @returns {Promise<string | import("../../core/media.js").MediaResult>}
 */
export async function resourcesAnswer(input, servers, { signal = null, maxBytes, redact = null }) {
  const action = String(input?.action || "");
  const named = typeof input?.server === "string" ? input.server.trim() : "";
  if (!servers.length) throw new Error("no MCP server in this session offers resources");
  const one = named ? servers.find((s) => s.name === named) : null;
  if (named && !one) throw new Error(`no MCP server named "${named}" offers resources here — ${servers.map((s) => s.name).join(", ")} ${servers.length === 1 ? "does" : "do"}`);
  if (action === "list") {
    const said = [];
    for (const s of one ? [one] : servers) {
      try {
        said.push(await listOf(s, signal));
      } catch (/** @type {any} */ e) {
        said.push(`${s.name}: its resources could not be listed (${String(e?.message || e)}).`);
      }
    }
    const whole = said.join("\n\n");
    // Cut to the result budget, as a read is: the list of a server with many resources is long.
    const text = Buffer.byteLength(whole) > maxBytes ? `${Buffer.from(whole).subarray(0, Math.max(0, maxBytes - 120)).toString("utf8").replace(/\uFFFD+$/, "")}\n… (the list was cut: name a server to see its own)` : whole;
    return redact ? redact(text) : text;
  }
  if (action === "read") {
    const uri = typeof input?.uri === "string" ? input.uri.trim() : "";
    if (!uri) throw new Error("read needs uri: the resource's address, as list gives it");
    if (!one && servers.length > 1) throw new Error(`name the server the resource is on: ${servers.map((s) => s.name).join(", ")} have resources`);
    const s = one || servers[0];
    let got;
    try {
      got = await /** @type {NonNullable<typeof s.conn.request>} */ (s.conn.request)("resources/read", { uri }, { signal });
    } catch (/** @type {any} */ e) {
      const words = String(e?.message || e);
      throw new Error(`${s.name} could not read ${uri}: ${redact ? redact(words) : words}`);
    }
    return resourceResultText(got, maxBytes, redact);
  }
  throw new Error('action is "list" or "read"');
}
