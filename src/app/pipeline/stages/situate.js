// @ts-check
// Memory: where this request sits (project, client, session chain). Read-only here; nothing is stored yet. The
// trace, the situation, the session the request belongs to and the helpers the later stages share go on `ctx.memory`.
import { detectHousekeeping } from "../../housekeeping.js";
import { chainRefOf } from "../../../core/conversation.js";
import { isMachineryRequest } from "../../../services/house.js";
import { modelsLentTo } from "../../../services/devices.js";
import { requestDocument, resolveChainSettings } from "../../../services/session-settings.js";

/**
 * What a turn — the loop's or a coding agent's — runs under: memory's situation and preparation where it made both;
 * a turn of a chat Filament composes that Memory settings leave out, or whose situate failed, the session's settings
 * alone (`settingsOnly`) with the turn memory kept of it and nothing else (`kept`: its preparation is `silent`, and says
 * why it is left out, or what failed); else the session's settings alone, with no memory state: a request memory left
 * out (`settingsOnly`), or one it situated and did not prepare (a housekeeping probe), which stays memory-quiet.
 * `chain`: the session the turn's own tools ride — the task graph, artifacts, pictures, the browser, teams and flows —
 * memory's chain where its prepare names it, else the session the request belongs to (`session`): where memory left the
 * turn out (D4 of 11-01), for a Memory setting or a reason of its own, and where its prepare failed and no turn of it
 * could be kept, which names no chain; none for a probe. `rowless`: memory keeps no turn of it — one it left out for a
 * reason of its own, or one the archive could not write — the chat's own agent's pictures are kept on that session, and
 * the turn offers the tools the chat's other turns offer.
 * @param {import("../context.js").MemoryState} m
 * @returns {{ sit: any, prep: any, chain: string | null, rowless: boolean } | null}
 */
export function turnMemState(m) {
  if (m.prep) return { sit: m.sit || m.settingsOnly, prep: m.prep, chain: m.prep.chain ? String(m.prep.chain) : m.session?.chain ?? null, rowless: !m.prep.chain };
  if (m.settingsOnly) return { sit: m.settingsOnly, prep: null, chain: m.session?.chain ?? null, rowless: true };
  return m.sit?.settings ? { sit: { settings: m.sit.settings, composed: !!m.sit.composed }, prep: null, chain: null, rowless: false } : null;
}

/**
 * Whether memory leaves a request out: false where memory situated it; else the Memory setting that leaves it out, in
 * its words (memory/brain.js `capturedOut`), or true for a reason of memory's own — Filament's own call, a situate that
 * failed (`failed`), memory not started.
 * @param {import("../context.js").MemoryState} m
 * @returns {boolean | string}
 */
export function leftOutOf(m) {
  return m.sit ? false : m.excluded?.() || true;
}

/**
 * Whether memory leaves the request's chat out, as a coding agent's turn takes it (its agent's session offered none of
 * memory's tools there): `leftOutOf`, save a request whose situate failed — its chat is one memory works in, as the
 * chat's other turns are memory's, unless a Memory setting leaves it out.
 * @param {import("../context.js").MemoryState} m
 * @returns {boolean | string}
 */
export function chatLeftOutOf(m) {
  return m.failed ? m.excluded?.() || false : leftOutOf(m);
}

/** @type {import("../context.js").Stage} */
export async function situate(ctx, { memory, config, plugins, skills }) {
  const { format, body, pre, headers } = ctx;
  // A session's settings document, resolved once per request. A command that changes the settings answers locally and
  // ends its request.
  /** @param {string | null} chainId */
  const docFor = (chainId) => (chainId && memory.archive ? resolveChainSettings(memory.archive, config(), chainId) || null : null);
  // Every memory step of this request, timed and content-free; lands on the record as memoryTrace. Another machine's
  // chat's call to this machine's models (services/devices.js `modelsLentTo`, the remote-agents plan's m-door) has none,
  // whatever its headers say: its memory is its own machine's — nothing here rides it, not a briefing, and nothing of it
  // is kept — so it is never situated, as a request is with memory not started.
  const trace = modelsLentTo(ctx.req) ? null : memory.trace();
  // The situation carries `sit.window` (Step 3 D1): where this request was typed — `harness`, or the client's own
  // conversation key before any x-filament-chain header resolved it. Memory computes it with the chain key (one
  // owner); every stage that needs the window reads it from here.
  // A session turn — a turn of a chat Filament composes — keeps its turns whether or not Memory settings leave its chat
  // out (`keep`): its history is composed from them and its page reads them. A call Filament's machinery makes for such a
  // chat (a loop's tick, a sub-agent's call: house-only lineage naming it) is the chat's too (`keep`): it opens no turn,
  // and reads the chat's own record through filament_recall. Memory situates one they leave out all the same, saying why
  // (`leftOut`); it is kept apart (`kept`), so every stage that asks whether memory works in the request reads that it
  // does not, and memory's prepare keeps its turn, where it opens one, and does nothing else.
  const named = chainRefOf(headers);
  const forChat = isMachineryRequest(headers) && !!named && !!memory.archive?.chainHead?.(String(named))?.native;
  const asked = { format, body, responsesBody: pre?.responsesBody || null, headers, model: body.model, cwdHint: headers["x-filament-cwd"] || "", keep: pre?.api === "session" || forChat };
  // A situate that failed leaves this request out of memory, and not its chat (`chatLeftOutOf`); a request of a chat
  // Filament composes is situated from what it names alone all the same (`missed`), and kept apart as one Memory settings
  // leave out is: its turn is kept where the archive can write it, and memory does nothing else for it.
  let failed = false;
  /** Why it failed, in its own words, where it did. @type {string | null} */
  let failedWhy = null;
  const situated = trace
    ? memory.situate(asked, trace, (why) => {
        failed = true;
        failedWhy = why;
      })
    : null;
  const kept = situated?.leftOut || situated?.missed ? situated : null;
  const sit = kept ? null : situated;
  // Memory's tools keep to the request's project's sessions where its caller reaches no others (port.js) — the ones
  // memory hands it, and a coding agent's over Filament's MCP server, which its turn is given whether or not memory
  // situates it.
  const confined = ctx.reads === false;
  // A turn a coding agent began by itself (HarnessV3-ACP AC3-9): its message is Filament's words for what the agent
  // read, never the person's, and no probe.
  const ownCycle = pre?.api === "session" ? pre.ownCycle ?? null : null;
  // Housekeeping (a client's title or summary probe), detected ONCE per request (Step 3 D12) and kept on ctx.memory:
  // the route stage turns it into the `housekeeping` flag memoryPrepare reads; the handed stage reads its kind (a
  // summary probe is a compaction).
  const housekeeping = sit && !ownCycle ? detectHousekeeping(format, body) : null;
  // How many of Filament's own texts this request's history lost (D11); memory-prepare puts the count on the record.
  let localDropped = 0;
  // The session the request belongs to, found whether memory situates the request or leaves it out: what its chat
  // commands act on (`ctx.memory.session`).
  /** @type {{ chain: string, composed: boolean } | null} */
  let session = null;
  if (sit) {
    sit.ownCycle = ownCycle;
    // A session turn's send, by the page's own name for it: the turn keeps it.
    sit.send = pre?.api === "session" ? pre.send ?? null : null;
    // A session turn whose message is a thread's brief: the turn is marked as one.
    sit.brief = pre?.api === "session" && pre.brief === true;
    // …and who began it, where it is not the person (core/turn-by.js): the turn keeps it.
    sit.by = pre?.api === "session" ? pre.by ?? null : null;
    sit.confined = confined;
    const chainRef = chainRefOf(headers);
    // Whether the composer shapes this chain's history (a native session's turn, or a loop tick riding one).
    sit.composed = !!pre?.settings || !!(chainRef && memory.archive?.chainHead?.(String(chainRef))?.native);
    // The settings this request runs under (one document for every session, HarnessV3 Step 1), on `sit.settings`
    // for memory and the loop. A native turn brings its own resolved; any other request runs under the document
    // `requestDocument` gives: a composed request the whole document, any other the knobs its session or project
    // chose, reading the config for everything else as it did before it had a document. A request belongs to a
    // session through Filament's own `x-filament-chain` header, or the session memory identified from the
    // conversation. Traffic that is nobody's session has none.
    // `lookupChainId` is read-only on purpose: the chain is still created where it always was (memory's prepare
    // pass, through the creator), so a request's trace still says whether the lookup found the session or made it.
    // A native turn brings its settings resolved and never looks its chain up here. The request's `session` is the
    // chain the header names, where memory found it, else the one memory identified.
    const found = sit.chainRef || (pre?.settings ? null : memory.lookupChainId(sit));
    const chainId = chainRef || found;
    if (found) session = { chain: String(found), composed: sit.composed };
    let resolved = null;
    // A chain not made yet is born with its own layer empty: its first request runs under the layers below, as the
    // config says them.
    if (!pre?.settings && chainId) resolved = docFor(chainId);
    const doc = pre?.settings || requestDocument(resolved, sit.composed);
    // What the plugins on at this chat's place bring (HarnessV4_SpacesPlugins_Plan B3): their MCP servers beside yours,
    // their skills and commands beside your skills — for the loop and a coding agent alike; and the files of your
    // skills on there (HarnessV4_Skills_Plan S1-6).
    const projectId = sit.project?.id && sit.project.id !== "none" ? String(sit.project.id) : null;
    const withPlugins = doc && plugins ? plugins.into(doc, { project: projectId, chat: chainId || null, cwd: String(headers["x-filament-cwd"] || sit.project?.cwd || "") }) : doc;
    sit.settings = withPlugins && skills ? skills.into(withPlugins) : withPlugins;
    // Filament's own texts stay out of what the model sees (D11): replies it wrote itself and cues it placed are
    // removed from the history right here, for every request of an identified session except /v1/responses. The
    // client still shows the exchange; no destination is checked because the route isn't chosen yet, and an agent
    // upstream only ever gets the newest message, so filtering the history is harmless there.
    if (!pre?.responsesBody && chainId && memory.dropLocalTexts) {
      localDropped = memory.dropLocalTexts(sit, chainId);
      if (localDropped)
        trace?.step("Filament's own replies left out", { messages: localDropped, note: "recorded command answers and cues never reach the model" });
    }
  }
  const traceOn = (rec) => {
    if (!trace) return;
    trace.rebase(rec._t0);
    (rec._onFirstByte ||= []).push(() => trace.mark("firstByte"));
    (rec._onFinish ||= []).push((r) => {
      if (trace.steps.length) r.memoryTrace = trace.toJSON();
    });
  };
  // A request memory leaves out (its folder, model or client excluded in Memory settings, or memory off) is still its
  // session's: the loop or the coding agent runs it under the session's document — its rules, its redaction, its knobs —
  // as it would any other, its own tools ride the session (`turnMemState`), and its commands act on the session.
  // Memory's own work stays off; only the session rides: its settings on `settingsOnly`, where the agent and dispatch
  // stages read them, and the session the header names on `session` — and a session turn's turn, which memory keeps
  // (`kept`).
  let settingsOnly = null;
  if (!sit) {
    const chainRef = chainRefOf(headers);
    const row = chainRef ? memory.archive?.chainHead?.(String(chainRef)) || null : null;
    const composed = !!pre?.settings || !!row?.native;
    if (row) session = { chain: String(row.id), composed };
    const doc = pre?.settings || (chainRef ? requestDocument(docFor(String(chainRef)), composed) : null);
    // Its plugins' values set for its project or Space reach it as they would any chat of the project.
    const project = row?.project_id && row.project_id !== "none" ? String(row.project_id) : null;
    const withPlugins = doc && plugins ? plugins.into(doc, { project, chat: chainRef ? String(chainRef) : null, cwd: String(headers["x-filament-cwd"] || "") }) : doc;
    const settings = withPlugins && skills ? skills.into(withPlugins) : withPlugins;
    if (settings) settingsOnly = { settings, composed };
  }
  // What memory keeps of a chat it leaves out is the session's — its turn as the sessions service composed it, or a call
  // its machinery makes for it: under its document, the page's name for the send, and a turn its coding agent began by
  // itself.
  if (kept) Object.assign(kept, { ownCycle, send: pre?.send ?? null, brief: pre?.brief === true, by: pre?.by ?? null, confined, composed: true, settings: settingsOnly?.settings ?? null });
  // Why Memory settings leave the request out, in their words, read as memory read it — asked only by what says why
  // (`leftOutOf`), once for the request: the folder it reads may walk the conversation. A kept turn's situate said it,
  // save one whose situate failed (`missed`).
  /** @type {{ why: string | null } | null} */
  let read = null;
  const excluded = () => (read ||= { why: sit ? null : kept?.leftOut || (memory.excludedWhy?.(asked) ?? null) }).why;
  // The same, read for a request memory could not read, which is given memory's tools only where it knows no Memory
  // setting leaves it out (memory-prepare.js, t420): one whose leaving-out could not be read is said left out.
  const excludedOrUnread = () => (sit ? null : kept?.leftOut || (memory.excludedWhy?.(asked, { unread: "Memory settings could not be read" }) ?? null));
  ctx.memory = { trace, sit, kept, prep: null, traceOn, localDropped, housekeeping, settingsOnly, session, excluded, excludedOrUnread, failed, failedWhy, confined };
  return "continue";
}
