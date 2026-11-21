// @ts-check
// A Codex item as the call Filament draws for it: a command, a file change, an MCP tool, a web search, an image.
// Pure, and read twice: by the bridge as Codex reports a turn it runs (adapters/agents/codex/items.js), and by the
// import as it reads a chat Codex kept on disk (services/memory/import/codex.js) — so a chat brought in shows the
// cards a chat run here shows. An item is in the app-server's shape: `{ type, id, … }`, camelCase.

/**
 * One file change as the loop's call the session's switch judges, and its card shows (HarnessV3-ACP, AC3's drive D5):
 * a new file's text to write, a deletion, or an update's own patch. @param {any} change
 */
export function changeInput(change) {
  const path = String(change?.kind?.move_path || change?.path || "");
  const kind = String(change?.kind?.type || "update");
  if (kind === "add") return { path, content: String(change?.diff ?? "") };
  if (kind === "delete") return { path, deleted: true };
  return { path, patch: String(change?.diff ?? "") };
}

/**
 * A command's card. Codex reads each command for what it does (`commandActions`): one that only reads a file, lists
 * a folder or searches reads as that call, as Codex's own app shows it; anything else is a command. Each carries the
 * folder Codex ran it in (`cwd`), which says where the agent works (HarnessV4_Git_Plan GW-D68).
 * @param {any} item
 * @returns {{ toolName: string, kind: string, title: string, rawInput: Record<string, unknown>, locations?: { path: string }[] }}
 */
export function commandCall(item) {
  const command = String(item?.command ?? "");
  const actions = Array.isArray(item?.commandActions) ? item.commandActions : [];
  const only = actions.length === 1 ? actions[0] : null;
  const ran = typeof item?.cwd === "string" && item.cwd ? { cwd: item.cwd } : {};
  if (only?.type === "read" && only.path)
    return { toolName: "read", kind: "read", title: `Read ${only.path}`, rawInput: { file_path: String(only.path), ...ran }, locations: [{ path: String(only.path) }] };
  if (only?.type === "listFiles")
    return { toolName: "ls", kind: "read", title: `List ${only.path || "."}`, rawInput: { pattern: String(only.path || "."), ...ran } };
  if (only?.type === "search" && only.query)
    return { toolName: "grep", kind: "search", title: `Search ${only.query}`, rawInput: { pattern: String(only.query), ...(only.path ? { path: String(only.path) } : {}), ...ran } };
  return { toolName: "bash", kind: "execute", title: command, rawInput: { command, ...ran } };
}

/**
 * A file change's card: a new file is written, a deleted one deleted, any other change (a move too) an edit of the file
 * it leaves. @param {any} change
 * @returns {{ toolName: string, kind: string, title: string, rawInput: Record<string, unknown>, locations?: { path: string }[] }}
 */
export function fileCall(change) {
  const path = String(change?.kind?.move_path || change?.path || "");
  const kind = String(change?.kind?.type || "update");
  if (kind === "add") return { toolName: "write", kind: "edit", title: `Write ${path}`, rawInput: { file_path: path } };
  if (kind === "delete") return { toolName: "", kind: "delete", title: "Delete", rawInput: {}, locations: [{ path }] };
  return { toolName: "edit", kind: "edit", title: `Edit ${path}`, rawInput: { file_path: path } };
}

/**
 * A call's card for the items that are one call: an MCP tool, a dynamic tool, a web search, an image looked at or
 * made, a pause. Null for an item that is no call.
 * @param {any} item
 * @returns {{ toolName: string, kind: string, title: string, rawInput: any, locations?: { path: string }[] } | null}
 */
export function itemCall(item) {
  switch (item?.type) {
    case "mcpToolCall":
      return { toolName: `mcp__${item.server}__${item.tool}`, kind: item.readOnlyHint ? "read" : "other", title: String(item.tool || "tool"), rawInput: item.arguments ?? {} };
    case "dynamicToolCall":
      return { toolName: String(item.tool || "tool"), kind: "other", title: String(item.tool || "tool"), rawInput: item.arguments ?? {} };
    case "webSearch": {
      const query = String(item.query || item.action?.query || item.action?.url || "");
      return { toolName: "web_search", kind: "fetch", title: `Search the web: ${query}`, rawInput: { query } };
    }
    case "imageView":
      return { toolName: "read", kind: "read", title: `Read ${item.path}`, rawInput: { file_path: String(item.path || "") }, locations: [{ path: String(item.path || "") }] };
    case "imageGeneration":
      return { toolName: "image_generation", kind: "other", title: "Generate an image", rawInput: { prompt: String(item.revisedPrompt || "") } };
    case "sleep":
      return { toolName: "", kind: "other", title: `Wait ${Math.round((Number(item.durationMs) || 0) / 1000)} s`, rawInput: {} };
    default:
      return null;
  }
}

/**
 * What a finished call said, for its card: an MCP result's content, a dynamic tool's text, an image's file, or why
 * Codex could not make it. @param {any} item
 */
export function itemResult(item) {
  if (item?.type === "mcpToolCall") return item.error?.message ? [{ type: "text", text: String(item.error.message) }] : item.result?.content || [];
  if (item?.type === "dynamicToolCall")
    return (item.contentItems || []).filter((/** @type {any} */ c) => c?.type === "inputText").map((/** @type {any} */ c) => ({ type: "text", text: String(c.text || "") }));
  if (item?.type === "imageGeneration" && item.failure)
    return [{ type: "text", text: item.failure.type === "usageLimitExceeded" ? "Not made: the plan's image limit is reached." : `Not made (${item.failure.type}).` }];
  if (item?.type === "imageGeneration") return item.savedPath ? [{ type: "text", text: `Saved ${item.savedPath}` }] : [];
  // An image Codex looked at: its file, which the run log copies as the call ends, for the card (HarnessV4_Tasks U9).
  if (item?.type === "imageView" && item.path) return [{ type: "image", path: String(item.path) }];
  return [];
}

/** Whether a finished item failed: by its status, or as its kind says a failure (an image's, Codex could not make). @param {any} item */
export function itemFailed(item) {
  if (String(item?.status || "") === "failed") return true;
  if (item?.type === "dynamicToolCall") return item.success === false;
  if (item?.type === "mcpToolCall") return !!item.error;
  if (item?.type === "imageGeneration") return !!item.failure;
  return false;
}
