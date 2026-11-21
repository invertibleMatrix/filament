// @ts-check
// The admin API's MCP servers area (HarnessV4_Settings_Plan HS-1): Settings › MCP servers and a chat's own list. The
// list a place resolves (`?scope=all|project:<id>|chat:<id>`), one server written, switched or taken out of a place,
// a place back to what it inherits, a server tested, its remote servers asked whether they want a sign-in as the list
// opens, and the servers other apps keep, offered and brought in. Every
// answer shows credentials as the placeholder (HS-D8); a write to a chat is refused, in words, to a harness tab that
// only follows it. A remote server's sign-in (HS-7): started from its row, asked after, cancelled, signed out, and the
// page the browser comes back to from the server's own (HS-D85) — or, from a page on another machine, the address that
// browser came back to, pasted (the owner's remote Filament of 11-06).
import { sendJson } from "../../app/pipeline/respond.js";
import { BACK_PATH } from "../../app/sessions/mcp-sign-in.js";
import { maskAnswer } from "../../services/mcp-servers.js";
import { tabOf, takeOf } from "../../services/session-writers.js";
import { isLocalCaller } from "../guards.js";

/** @param {string} s */
const escaped = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * What a return this Filament did not take says beside its words: it may be another machine's (the owner's remote
 * Filament of 11-06). A page there sends its browser back to 127.0.0.1 — this computer's Filament, where it runs on the
 * same port —, and that Filament's sheet takes the address pasted.
 */
export const ANOTHER_FILAMENT_WORDS = "Started from a page of Filament on another machine? This address is that Filament's: copy it from the address bar and paste it in the sheet there.";

/**
 * The page the browser lands on back from a server's sign-in page: what happened, in both themes, with nothing loaded
 * from anywhere. `also`: a second paragraph.
 * @param {any} res @param {{ ok: boolean, words: string }} said @param {string} [also]
 */
function backPage(res, said, also = "") {
  const title = said.ok ? "Signed in" : "Not signed in";
  res.writeHead(said.ok ? 200 : 400, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Filament · ${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
background:#f5f5f7;color:#1d1d1f}main{max-width:440px;margin:24px;padding:28px 32px;border-radius:14px;background:#fff;
box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06)}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#3a3a3c}
.mark{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:${said.ok ? "#34c759" : "#ff9f0a"}}
p+p{margin-top:12px}
@media (prefers-color-scheme:dark){body{background:#1c1c1e;color:#f5f5f7}main{background:#2c2c2e;box-shadow:none}p{color:#d1d1d6}}
</style></head><body><main><h1><span class="mark"></span>${title}</h1><p>${escaped(said.words)}</p>${also ? `<p>${escaped(also)}</p>` : ""}</main></body></html>`);
}

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function mcpServerRoutes(a) {
  const { mcpServers, mcpSignIns = null, sessionWriters = null, machine = null } = a;
  /**
   * One row's work answered: its result masked, or its refusal with its status and words.
   * @param {any} r @param {() => any} fn
   */
  const answer = async (r, fn) => {
    try {
      if (!mcpServers) return sendJson(r.res, 503, { error: "MCP servers are not wired in this Filament" });
      return sendJson(r.res, 200, maskAnswer(await fn()));
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600) return sendJson(r.res, e.status, { error: e.message, ...(e.extra || {}) });
      throw e;
    }
  };
  /**
   * A write to a chat's list from a tab that only follows the chat is refused, as every other write to the chat is.
   * @param {any} r @param {string} scope
   */
  const readOnly = (r, scope) => {
    const chat = /^chat:(.+)$/.exec(scope);
    const why = chat ? sessionWriters?.refusal(chat[1], tabOf(r.req), { take: takeOf(r.req) }) || null : null;
    return why ? sendJson(r.res, 409, { error: why, readOnly: true }) : null;
  };
  const scopeOf = (/** @type {any} */ r) => decodeURIComponent(String(r.params.scope || ""));
  /** A sign-in asked after or cancelled, by its id. @param {any} r @param {"status" | "cancel"} what */
  const pendingOne = (r, what) =>
    mcpSignIns ? answer(r, () => mcpSignIns[what](decodeURIComponent(r.params.id))) : sendJson(r.res, 503, { error: "sign-ins to MCP servers are not wired in this Filament" });
  /**
   * The address a browser on another machine came back to, pasted on the page that started the sign-in (the owner's
   * remote Filament of 11-06): the server's page sent that browser to 127.0.0.1 there — nothing, or that machine's own
   * Filament, which waits for no such sign-in and keeps nothing of it. Its code is taken here as the return would take
   * it, by its state, once; the address is never asked for: nothing is sent to it.
   * @param {any} r @param {unknown} text
   */
  const pastedBack = async (r, text) => {
    if (!mcpSignIns) return sendJson(r.res, 503, { error: "sign-ins to MCP servers are not wired in this Filament" });
    let back = null;
    try {
      back = new URL(String(text ?? "").trim());
    } catch {}
    if (!back || back.pathname !== BACK_PATH || !back.searchParams.get("state"))
      return sendJson(r.res, 400, { error: `That is not the address the sign-in came back to: paste the whole address from the browser's address bar, the one with ${BACK_PATH}?` });
    const said = await mcpSignIns.back(back.searchParams);
    return said.ok ? sendJson(r.res, 200, { ok: true, words: said.words }) : sendJson(r.res, 400, { error: said.words });
  };
  return [
    ["GET", "/mcp-servers", (r) => answer(r, () => mcpServers.list(r.url.searchParams.get("scope") || "all"))],
    ["POST", "/mcp-servers/test", (r) => answer(r, async () => {
      const b = await r.json();
      return mcpServers.test(b?.scope || "all", b?.server);
    })],
    // Its remote servers asked whether they want a sign-in, as the list opens: the list again once they answered.
    ["POST", "/mcp-servers/look", (r) => answer(r, async () => {
      const b = await r.json();
      return mcpServers.look(b?.scope || "all");
    })],
    // Import from other apps (HS-6, HS-D75): what the apps' files hold, masked; the picks, written from the files.
    ["GET", "/mcp-servers/import", (r) => answer(r, () => mcpServers.scan(r.url.searchParams.get("scope") || "all"))],
    ["POST", "/mcp-servers/import", async (r) => {
      const b = await r.json();
      const scope = String(b?.scope || "all");
      return readOnly(r, scope) || answer(r, () => mcpServers.bring(scope, b?.picks));
    }],
    // Sign-ins (HS-7), before the rows that take any name: a sign-in is the address's, not a place's write.
    ["POST", "/mcp-servers/sign-in", async (r) => {
      const b = await r.json();
      if (b?.pasted !== undefined) return pastedBack(r, b.pasted);
      const scope = String(b?.scope || "all");
      // A page on another machine (HC-156, the owner's remote Filament of 11-06): the server's page sends its browser
      // back to 127.0.0.1, which is Filament on this machine alone. Its sign-in starts once it says it takes the address
      // that browser lands on, pasted (`paste`); until then it is told so, `elsewhere`, and nothing starts.
      if (!isLocalCaller(r.req) && b?.paste !== true) {
        const here = String(machine?.get?.()?.name || "");
        return sendJson(r.res, 400, {
          error: `Sign in from a browser on Filament's computer${here ? ` (${here})` : ""}, or paste the address the server's page sends this browser to: it goes back to 127.0.0.1, which is Filament only there`,
          elsewhere: true,
          ...(here ? { machine: here } : {}),
        });
      }
      // Another account (HarnessV4_Space_Plan S4b): the place picks it once it is kept, a write like any other.
      const account = typeof b?.account === "string" && b.account.trim() ? b.account : "";
      if (account) {
        const no = readOnly(r, scope);
        if (no) return no;
      }
      const o = { clientId: String(b?.clientId || "").trim(), clientSecret: String(b?.clientSecret || "").trim(), ...(account ? { account } : {}) };
      return answer(r, () => mcpServers.signIn(scope, b?.name, o));
    }],
    // A return no sign-in of this Filament's waits for — a sign-in started from a page of another machine's Filament
    // lands here where this one runs on its port — says whose it may be; one it waited for, failed, says why alone (the
    // hunt of p4-signins).
    ["GET", "/mcp-servers/sign-in/back", async (r) => {
      /** @type {{ ok: boolean, words: string, none?: boolean }} */
      const said = mcpSignIns ? await mcpSignIns.back(r.url.searchParams) : { ok: false, words: "Sign-ins to MCP servers are not wired in this Filament." };
      return backPage(r.res, said, said.none && r.url.searchParams.get("code") && r.url.searchParams.get("state") ? ANOTHER_FILAMENT_WORDS : "");
    }],
    ["GET", "/mcp-servers/sign-in/:id", (r) => pendingOne(r, "status")],
    ["DELETE", "/mcp-servers/sign-in/:id", (r) => pendingOne(r, "cancel")],
    ["POST", "/mcp-servers/sign-out", (r) => answer(r, async () => {
      const b = await r.json();
      return mcpServers.signOut(b?.scope || "all", b?.name);
    })],
    ["PUT", "/mcp-servers/:scope/:name", async (r) => readOnly(r, scopeOf(r)) || answer(r, async () => mcpServers.put(scopeOf(r), decodeURIComponent(r.params.name), await r.json()))],
    ["DELETE", "/mcp-servers/:scope/:name", (r) => readOnly(r, scopeOf(r)) || answer(r, () => mcpServers.remove(scopeOf(r), decodeURIComponent(r.params.name)))],
    ["DELETE", "/mcp-servers/:scope", (r) => readOnly(r, scopeOf(r)) || answer(r, () => mcpServers.reset(scopeOf(r)))],
  ];
}
