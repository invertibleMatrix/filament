// @ts-check
// HarnessV3-Tools TL-D22 — `/autofit` weighs the session's MCP servers. A browser server's tools can be thousands of
// tokens in every request; /autofit weighed the loop's own prompt and tools only (Appendix D item 21's gap), so a fit
// could leave a session that still stopped at the window. A turn that connects the session's servers records what
// they add — their tools and the prompt's sentence naming them; /autofit counts it for the servers the session still
// has, so its figure is the one the loop's window event measures.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
// Their tools ride every request in full (E49: load core); a server on demand weighs its names (mcp-on-demand.test.js).
const NOTES = { name: "notes", command: process.execPath, args: [FIXTURE], load: "core" };
/** The same tools under a long name: every tool's name is longer, so they weigh more. */
const PAD = { name: "pad-with-a-much-longer-name", command: process.execPath, args: [FIXTURE], load: "core" };
const WINDOW = 200000;
/** @type {string} */ let root;
/** @type {any} */ let up;
/** @type {any} */ let shim;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-mcp-weight-"));
  up = await fakeUpstream((/** @type {any} */ call) => {
    if (call.kind !== "anthropic") return undefined;
    const model = String(call.body?.model || "");
    const msgs = call.body?.messages || [];
    const all = JSON.stringify(msgs);
    if (all.includes("from here on you are a sub-agent")) return anthropicReply("FORK REPORT", { model });
    if ((msgs.at(-1)?.content || []).some?.((/** @type {any} */ b) => b?.type === "tool_result")) return anthropicReply("PARENT DONE", { model });
    if (all.includes("fork it")) return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "toolu_f1", name: "agent", input: { run_in_background: false, description: "Forked look", prompt: "Look again.", context: "fork" } }] });
    return anthropicReply("ok", { model });
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: WINDOW } } }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

/** @param {any[]} mcp @returns {Promise<string>} */
const sessionWith = async (mcp) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { mcp } } } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** @param {string} id */
const autofitOf = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true } })).json();
/** @param {string} id */
const fixedOf = async (id) => Number((await autofitOf(id)).fixed);
/**
 * A turn, and the loop's own part of its requests as its window event measured it. `asIs`: the card's Send it as it
 * is, the answer where a server changed since the chat's last turn (the owner's of 11-06).
 * @param {string} id @param {string} content @param {boolean} [asIs]
 */
const turnFixed = async (id, content, asIs = false) => {
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...(asIs ? { sendAsIs: true } : {}) } });
  assert.equal(t.status, 200, await t.clone().text());
  const events = (await (await shim.api(`/api/runs/${encodeURIComponent(String(t.headers.get("x-filament-request-id")))}/events?limit=500`)).json()).events || [];
  const fixed = Number(events.find((/** @type {any} */ e) => e.type === "window")?.fixed);
  assert.ok(fixed > 0, "the loop measured its own part");
  return fixed;
};
/** @param {string} id @param {any} body */
const patch = async (id, body) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body });
  assert.equal(r.status, 200, await r.text());
};

// (fails before: yes — the fixed part was the same before and after the server connected; then short by the prompt's sentence)
test("/autofit counts what the session's MCP servers add, as the loop measures it, and stops when the server is gone", async () => {
  const id = await sessionWith([NOTES]);
  const before = await fixedOf(id);
  assert.ok(before > 0, "the loop's own prompt and tools");
  const sent = await turnFixed(id, "hi");
  assert.ok(sent > before + 100, `six tools weigh something: ${sent} against ${before}`);
  assert.equal(await fixedOf(id), sent, "the loop's part as the loop measured it, its servers' tools and sentence in");
  await patch(id, { patch: { plugins: { mcp: [{ ...NOTES, args: [FIXTURE, "--stderr"] }] } } });
  assert.equal(await fixedOf(id), before, "a changed server is not the one weighed until a turn connects it");
  assert.equal(await turnFixed(id, "again", true), sent, "the same tools again");
  assert.equal(await fixedOf(id), sent, "weighed again once connected");
  await patch(id, { unset: ["plugins.mcp"] });
  assert.equal(await fixedOf(id), before, "a server the session no longer has weighs nothing");
});

// (fails before: yes — the servers' part was not counted, nor named in the note)
test("/autofit splits the part over the servers by their tools, and names them when the loop's part alone is past the target", async () => {
  const id = await sessionWith([NOTES, PAD]);
  const before = await fixedOf(id);
  const sent = await turnFixed(id, "hi");
  assert.equal(await fixedOf(id), sent, "both servers, as the loop measured them");
  // The loop's part alone past the target: the note says what weighs, the servers among it.
  const st = await (await shim.api("/api/state")).json();
  const sized = (/** @type {number} */ window) => st.config.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens: window } } } : u));
  assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: sized(sent) } })).status, 200);
  try {
    const out = await autofitOf(id);
    assert.equal(out.fixed, sent, out.note);
    assert.match(out.note, new RegExp(`its prompt and tools \\(its MCP servers' ≈${(sent - before).toLocaleString("en-US")}\\)`), out.note);
    assert.match(out.note, /switch tools off \(loop\.tools\) or MCP servers \(plugins\.mcp\)/, out.note);
  } finally {
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: sized(WINDOW) } })).status, 200);
  }
  // One server left, its share stays: the shares add up to the whole, each in proportion to its tools' weight.
  await patch(id, { patch: { plugins: { mcp: [NOTES] } } });
  const notes = (await fixedOf(id)) - before;
  await patch(id, { patch: { plugins: { mcp: [PAD] } } });
  const pad = (await fixedOf(id)) - before;
  assert.equal(notes + pad, sent - before, `the shares add up: ${notes} + ${pad}`);
  assert.ok(pad > notes + 20, `the longer tool names weigh more: ${notes} and ${pad}`);
});

// (fails before: yes — a team's lead carried no MCP server, so the line weighed the lead's part alone: HarnessV4_Tasks
// decision 9 gives a lead the session's servers, as any agent has them)
test("a session handed to a team: its lead carries the session's MCP servers, and the line weighs their share with the lead's part, as the lead measures it", async () => {
  const id = await sessionWith([NOTES]);
  const sent = await turnFixed(id, "hi");
  assert.equal(await fixedOf(id), sent, "the servers' share in, as the loop measured it");
  await patch(id, { patch: { engine: { mode: "team", team: "architect" } } });
  const led = await fixedOf(id);
  const mark = up.received.length;
  const leadSent = await turnFixed(id, "lead it");
  const calls = up.received.slice(mark);
  assert.ok(calls.length > 0 && calls.every((/** @type {any} */ c) => (c.body?.tools || []).some((/** @type {any} */ t) => String(t.name).startsWith("mcp__notes__"))), "the lead's requests carry the server's tools");
  // The server's share was weighed beside the main agent's tools, and an estimate rounds up once for its whole text:
  // beside the lead's tools the same share can come out a token or two either way.
  assert.ok(Math.abs(led - leadSent) <= 2, `the lead's part as the lead measured it, the server's share in it: ${led} and ${leadSent}`);
  assert.equal(await fixedOf(id), leadSent);
});

// (fails before: yes — the Hunter on B4: the skill tool rides where skills are listed, and the board left it out of
// the loop's own part while the MCP servers' share took it in)
test("skills listed: the skill tool is the loop's own part, before a turn as the turn measures it, and no server's share", async () => {
  const skills = join(root, "skills", "greet");
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, "SKILL.md"), "---\nname: greet\ndescription: Greet the developer\n---\nSay hello.");
  assert.equal((await shim.api("/api/skills", { method: "POST", body: { paths: [skills] } })).status, 200);
  /** @param {any[]} mcp */
  const withSkills = async (mcp) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { mcp }, skills: { on: [{ name: "greet" }] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  const bare = await withSkills([]);
  const before = await fixedOf(bare);
  assert.equal(await turnFixed(bare, "hi"), before, "the board weighs what the turn sends, the skill tool in it");
  // A server's share is its tools and its sentence, the same with skills listed or not.
  const plain = await sessionWith([NOTES]);
  const plainShare = (await turnFixed(plain, "hi")) - (await fixedOf(await sessionWith([])));
  const both = await withSkills([NOTES]);
  const sent = await turnFixed(both, "hi");
  assert.equal(await fixedOf(both), sent);
  assert.ok(Math.abs(sent - before - plainShare) <= 2, `the server's share, not the skill tool's: ${sent - before} and ${plainShare}`);
});

// (fails before: no — the guard was there from the start; a mutation pass showed nothing held it)
test("a fork's turn leaves the session's weight as the main agent measured it", async () => {
  const id = await sessionWith([NOTES]);
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fork it", stream: false } });
  const raw = await t.text();
  assert.equal(t.status, 200, raw);
  assert.match(raw, /PARENT DONE/, "the fork ran and reported");
  const events = (await (await shim.api(`/api/runs/${encodeURIComponent(String(t.headers.get("x-filament-request-id")))}/events?limit=500`)).json()).events || [];
  const sent = Number(events.find((/** @type {any} */ e) => e.type === "window")?.fixed);
  // A fork sends the main agent's furniture as it was, its own tool list shorter: weighed there, the part would not be the servers'.
  assert.equal(await fixedOf(id), sent);
});
