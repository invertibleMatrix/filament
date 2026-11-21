// @ts-check
// The admin API's upstreams area: the model list and its ping, the connection test, agent detection and login, the
// agent/session inspectors, the coding agents' accounts and plans, the Cursor SDK's status and install, and the Qoder
// account's device login.
import { sendJson } from "../../app/pipeline/respond.js";
import { agentsDevice, drives, pressRefused, readBody } from "../guards.js";
import { heldGrant } from "../../services/devices.js";
import { houseAuth } from "../../services/house.js";
import { loopbackPost } from "../../services/loopback.js";
import { parseModelSuffix } from "../../core/shaping.js";
import { callRoom, findUpstream, aggregateModels, placeAgentRoute, turnOnAgentRoute, maxOutputForModel } from "../../core/routing.js";
import { withAgentWords } from "../../app/model-book.js";
import { modelsThatAnswer } from "../../app/readiness.js";
import { estimateBodyTokens, DEFAULT_OUTPUT_TOKENS } from "../../core/tokens.js";
import { buildFamilies } from "../../core/model-families.js";
import { capsAt, placeOfName, withoutOperatorCaps, CAP_FIELDS } from "../../core/model-caps.js";
import { priceCard, priceSourceOf, rowFieldFor, statedPricesOf, billingOf } from "../../core/pricing.js";
import { accountIsOff, isAgentUpstream, isMachineUpstream, UPSTREAM, UPSTREAM_TYPES } from "../../core/schema.js";
import { PROVIDERS, OTHER_KINDS, providerById, providerForBaseUrl, isOtherModel } from "../../core/providers.js";
import { CURSOR_SDK_OFF, agentUpstream, agentRoute, agentKey, agentTitle, cursorSdkHeld, cursorSdkOn, installCommand, signInLine, seededOn, KNOWN_AGENTS } from "../../core/catalogues.js";
import { normalizeConfig, validateConfig, redactConfig, coerceLeaf, selfAddress } from "../../services/config/store.js";
import { detectAgents, detectAgentsWithStatus, programHere, startAgentLogin } from "../../adapters/agents/acp/detect.js";
import {
  sdkStatus,
  loadCursorSdk,
  resetSdkCache,
  installCursorSdk,
  SDK_INSTALL_HINT,
} from "../../adapters/agents/cursor-sdk.js";
import * as qoder from "../../adapters/providers/qoder.js";
import { savedOf, testsMore, testUpstream } from "../../app/upstream-test.js";
import { dumpModelCache, probeProviderModels } from "../../adapters/providers/http.js";
import { offlineWords } from "../../adapters/providers/filament.js";

/**
 * The models another machine's agents' device reads here: those that answer, by name and label alone — never a third
 * machine's, which that machine lends to this one alone (the m-upstream hunt's), and a coding agent's only while their
 * device may use the coding agents here (`codingAgents`, or Full control): listed else, their chat on one is refused
 * (acp-turn.js), and a sub-agent sent here could be put on it (remote-agents.js `modelThere`).
 * @param {any[]} models @param {any} cfg @param {any} device  their device as it stands
 */
export function agentsModels(models, cfg, device) {
  const coders = heldGrant(device, "codingAgents");
  return models
    .filter((m) => m.answers && !isMachineUpstream(findUpstream(cfg, m.upstream)) && (coders || !isAgentUpstream(findUpstream(cfg, m.upstream))))
    .map((m) => ({ id: m.id, ...(m.label ? { label: m.label } : {}), answers: true }));
}

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function upstreamRoutes(a) {
  const {
    config,
    log,
    usage,
    bridge,
    agentBridges,
    accounts,
    logins,
    mcp,
    qoderLogins,
    overrides,
    cfgForModels,
    discover,
    persistModelCache,
    discoveryOf,
    ownNames = null,
    keyedFor = null,
    labelsFor,
    destinationFor,
    providers = null,
  } = a;
  /** Where Filament listens now, a ping's door (a port saved since waits for a restart). */
  const selfBase = a.selfBase || (() => selfAddress(config.get().server));
  /** The Cursor SDK's install under way, or null (HarnessV3-FailurePoints FP-D3). @type {ReturnType<typeof installCursorSdk> | null} */
  let sdkInstalling = null;
  /** An enabled coding agent's upstream by id, or null. @param {string} id */
  const agentOf = (id) => (config.get().upstreams || []).find((/** @type {any} */ u) => u.id === id && isAgentUpstream(u) && u.enabled !== false) || null;
  /**
   * An agent upstream the accounts list shows: one on, or an account turned off by itself (`acp.accountOff`); never
   * Cursor's SDK while its Experimental switch is off, which Settings › Coding agents leaves out too.
   * @param {any} u
   */
  const listed = (u) => isAgentUpstream(u) && (u.enabled !== false || accountIsOff(u)) && !cursorSdkHeld(config.get(), u);
  /**
   * An agent upstream as the accounts' readers take it: its name as the pages show it, the agent it runs, whether its
   * program is on this computer (the picker offers none that isn't), the command that signs it in (the catalogue's, with
   * an added account's folder; Cursor's SDK route runs on its key), its account as the store has it, and its signing in
   * (HarnessV3-ACP AC3-7): whether its agent says who it runs as, its name ("Default" or the one given), its ways to sign
   * in, whether it signs out, the sign-in under way and how the last one ended. `keyModels`, on a Claude Code account
   * that runs on an API key: the models its key offers beyond Claude Code's own list, as its last listing found them,
   * and why they could not be asked for (acp/bridge.js `#keyOffers`).
   * @param {any} u
   */
  const agentRow = async (u) => {
    const agent = agentKey(u);
    const known = KNOWN_AGENTS.find((k) => k.id === agent);
    const keyed = keyedFor?.(u.id);
    return {
      upstream: u.id,
      name: agentTitle(u),
      type: u.type,
      agent,
      here: programHere(u, known?.command),
      login: u.acp?.home ? signInLine(u, process.platform) : u.type === "cursor-sdk" ? null : known?.login || null,
      account: accounts.view(u.id),
      // Turned off by itself in Settings → Coding agents: listed, so it can be turned on again; nothing runs on it.
      off: u.enabled === false,
      ...(keyed ? { keyModels: { names: keyed.names, note: keyed.note } } : {}),
      ...(await logins.state(u)),
    };
  };
  /**
   * A change to an account, answered with the account as it then stands (none once removed); the change's refusal
   * with its status. The body is read before: a refused one has been answered already.
   * @param {any} r @param {() => Promise<any> | any} fn
   */
  const changed = async (r, fn) => {
    try {
      const out = (await fn()) || {};
      const u = (config.get().upstreams || []).find((/** @type {any} */ x) => x.id === r.params.id && listed(x));
      return sendJson(r.res, 200, { ...out, agent: u ? await agentRow(u) : null });
    } catch (/** @type {any} */ e) {
      return sendJson(r.res, e?.status || 502, { error: e?.message || String(e) });
    }
  };
  return [
    [
      "POST",
      "/models/ping",
      async (r) => {
        const { req, res } = r;
        let body;
        try {
          body = JSON.parse(await readBody(req, config.get().server.maxBodyBytes));
        } catch {
          return sendJson(res, 400, { error: "invalid JSON" });
        }
        const model = String(body?.model || "").trim();
        if (!model) return sendJson(res, 400, { error: "model is required" });
        const t0 = performance.now();
        // Filament's own call: the most the model can write, inside its window — a reasoning model thinks inside the same
        // room, and a cap sized to one word left it nothing to answer with (HarnessV3-FailurePoints §13).
        const ping = { model, stream: false, messages: [{ role: "user", content: "Reply with exactly one word: pong" }] };
        try {
          const r2 = await loopbackPost(`${selfBase()}/v1/messages`, {
            headers: {
              "content-type": "application/json",
              ...houseAuth(),
              "user-agent": "filament-ping/0.1",
              "x-session-id": `ping-${model}`,
            },
            body: JSON.stringify({ ...ping, max_tokens: callRoom(config.get(), model, estimateBodyTokens(ping, "request")) }),
            signal: AbortSignal.timeout(180000),
          });
          const ms = Math.round(performance.now() - t0);
          const j = await r2.json().catch(() => null);
          const id = r2.headers.get("x-filament-request-id");
          const rec = id ? usage.byId.get(id) : null;
          const text = Array.isArray(j?.content)
            ? j.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join(" ")
                .trim()
            : "";
          return sendJson(res, 200, {
            ok: r2.ok,
            status: r2.status,
            ms,
            text: text.slice(0, 200),
            error: r2.ok ? null : j?.error?.message || j?.error || `HTTP ${r2.status}`,
            requestId: id,
            upstream: rec?.upstream || null,
            upstreamModel: rec?.upstreamModel || null,
            tokens: rec?.tokens || null,
            cost: rec?.cost ?? null,
            changes: rec?.changes || [],
          });
        } catch (/** @type {any} */ e) {
          return sendJson(res, 200, {
            ok: false,
            status: 0,
            ms: Math.round(performance.now() - t0),
            error: e.name === "TimeoutError" ? "no answer within 3 minutes" : e.message,
          });
        }
      },
    ],
    [
      "GET",
      "/models",
      async (r) => {
        const { url, res } = r;
        // Another machine's agents read the list as it stands (remote.js AGENT_ROUTES): a Refresh, which asks every
        // provider, is the person's.
        const force = url.searchParams.get("refresh") === "1" && !agentsDevice(r.who);
        const out = await aggregateModels(await cfgForModels(force), { force, discover });
        persistModelCache();
        // A save's discovery (Providers P0): still asking says so; one that failed says why (above the names kept from
        // before, when a new key was wrong) until a newer list is known — a read serves the cache and never asks, so
        // without this a failed ask read as "no names came back", or as nothing at all. An agent's failed Refresh is
        // said the same way, by the Refresh itself too: its names come from the agent, not a listing with an error of
        // its own. A Refresh asked everyone just now, so being asked and never asked are past.
        for (const [id, info] of Object.entries(out.upstreams || {})) {
          // The names it listed itself, apart from the ones typed on its card (HarnessV4_Tasks E9): the card says when
          // a typed name is not among them.
          const own = ownNames?.(id);
          if (own) /** @type {any} */ (info).listed = own;
          // A Claude Code account on an API key: the names its key offers beyond that list, which the card marks, and
          // why they could not be asked for, which it says in a line (acp/bridge.js `#keyOffers`).
          const keyed = keyedFor?.(id);
          if (keyed?.names.length) /** @type {any} */ (info).keyed = keyed.names;
          if (keyed?.note) /** @type {any} */ (info).keyNote = keyed.note;
          // Another machine's models, while a call or its listing found that machine offline: why, in words — its models
          // answer nothing meanwhile (readiness.js).
          const off = offlineWords(id);
          if (off) /** @type {any} */ (info).offline = off;
          const d = discoveryOf?.(id);
          if (!d) continue;
          if (d.asking && !force) /** @type {any} */ (info).discovering = true;
          else if (d.unasked && !force) /** @type {any} */ (info).unasked = true;
          else if (d.error && !(/** @type {any} */ (info).error)) /** @type {any} */ (info).error = d.error;
        }
        if (force) {
          // Nothing-silent: a listing that states context windows changes the context stamp's arithmetic the moment it
          // is captured, so the refresh says what was adopted (it serves below the operator's pricing word).
          for (const [id, v] of Object.entries(dumpModelCache())) {
            const w = Object.keys(v?.windows || {}).length;
            if (w > 0)
              log("info", `models: ${id}'s listing stated context windows for ${w} of its ${(v?.names || []).length} discovered models — they serve below the operator's pricing word`);
            const c = Object.keys(v?.caps || {}).length;
            if (c > 0)
              log("info", `models: ${id}'s listing stated what ${c} of its models take (reasoning levels, thinking, output ceiling) — the picker offers it below each model's own row on the Upstreams page`);
          }
        }
        const cfg = config.get();
        // A model a coding agent serves says so: the harness offers only API models where its own loop must run one
        // (a sub-agent's model), and the agent brings hands of its own. Where the agent's listing named the model, its
        // name and description come too (HarnessV3-ACP AF2): Claude Code's `haiku` is "Haiku 4.5"; its `opus`,
        // "Opus 5 · …".
        withAgentWords(cfg, out.models, labelsFor);
        // The most it can write, where Filament knows it (its table, its listing): the Lab's empty max_tokens sends
        // it (HarnessV4_Tasks decision 12). Null where none is stated.
        for (const m of out.models) m.outputCeiling = maxOutputForModel(cfg, m.id) || null;
        // Whether a chat can run on it, as Get started counts them (readiness.js): the command line's list of models is
        // these, never a second rule of its own.
        const answering = new Set(modelsThatAnswer(cfg, out.models));
        for (const m of out.models) m.answers = answering.has(m);
        // Another machine's models (the remote-agents plan's m-upstream) name their machine, and while it is found
        // offline, why: the picker's tab for them says it (composer/model.js `sourceMachine`).
        for (const m of out.models) {
          const u = findUpstream(cfg, m.upstream);
          if (!isMachineUpstream(u)) continue;
          m.machine = u.machine;
          const off = /** @type {any} */ (out.upstreams)?.[u.id]?.offline;
          if (off) m.offline = off;
        }
        // Another machine's agents read the models that answer, by name and label alone: the providers this machine
        // keeps, and what asking them said, are the person's. A third machine's models are not theirs: that machine lends
        // them to this one alone (the m-upstream hunt's).
        if (agentsDevice(r.who)) return sendJson(res, 200, { models: agentsModels(out.models, cfg, /** @type {any} */ (r.who).device) });
        // The harness picks models, not ids: the catalogue folded into families with their parameters (effort,
        // speed, thinking, window), each saying whether a choice is a member id or a setting Filament applies.
        // `outputDefault`: what Filament asks for where a model states no ceiling (`outputCeiling`'s fallback).
        return sendJson(res, 200, { ...out, families: buildFamilies(cfg, out.models), outputDefault: DEFAULT_OUTPUT_TOKENS });
      },
    ],
    [
      "POST",
      "/models/caps",
      async (r) => {
        // The dashboard's Tune sheet: what each of one upstream's models can do, from the DRAFT upstream the page
        // holds (its unsaved rows and rules), with the answer's sources, the fallback without the operator's word,
        // what the harness picker would offer, and the draft rows' problems — so the sheet previews before a save.
        let body;
        try {
          body = JSON.parse(await readBody(r.req, config.get().server.maxBodyBytes));
        } catch {
          return sendJson(r.res, 400, { error: "invalid JSON" });
        }
        const draft = body?.upstream;
        const id = String(draft?.id || body?.id || "");
        const base = await cfgForModels(false);
        const saved = (base.upstreams || []).find((/** @type {any} */ u) => u.id === id);
        if (!saved) return sendJson(r.res, 404, { error: `upstream "${id}" is not in the saved configuration` });
        const pricing = draft && typeof draft.pricing === "object" ? coerceLeaf(UPSTREAM.pricing, draft.pricing) : saved.pricing;
        const rules = draft && typeof draft.rules === "object" && draft.rules ? draft.rules : saved.rules;
        // The card's family table (Providers P2) lists every name the upstream offers, the hidden ones too: the page
        // ticks them from its own draft's hiddenModels, so the answer does not depend on them (and is cached without).
        const listAll = body?.families === true;
        const up = { ...saved, pricing, rules, ...(listAll ? { hiddenModels: [] } : {}) };
        const cfgX = { ...base, upstreams: base.upstreams.map((/** @type {any} */ u) => (u.id === id ? up : u)) };
        const rows = ((await aggregateModels(cfgX, { discover })).models || []).filter((/** @type {any} */ m) => m.upstream === id && m.source !== "effort-variant");
        const famOf = new Map();
        const fams = buildFamilies(cfgX, rows);
        for (const f of fams) for (const m of f.members) famOf.set(m.id, f);
        const rowOf = new Map(rows.map((/** @type {any} */ m) => [m.id, m]));
        /** The member that speaks for a family: the one whose id spells no variant, else the first. @param {any} f */
        const leadOf = (f) => (f.members.find((/** @type {any} */ x) => !x.effort && !x.speed && !x.thinking && !x.window) || f.members[0]).id;
        const families = listAll
          ? fams.map((f) => {
              const lead = leadOf(f);
              return {
                id: f.id,
                kind: f.kind,
                // the family as this upstream spells it: a family of variant ids by its base row, a model by its own name
                name: (f.kind === "variants" ? placeOfName(cfgX, f.id)?.sent : null) || rowOf.get(lead)?.upstreamModel || f.id,
                lead,
                members: f.members.map((/** @type {any} */ x) => ({ ...x, name: rowOf.get(x.id)?.upstreamModel ?? x.id, source: rowOf.get(x.id)?.source || null })),
              };
            })
          : null;
        const asked = Array.isArray(body?.names) && body.names.length ? body.names.map(String) : null;
        // The names asked for; with the families and none asked, each family's lead (what its row shows and its Tune
        // opens on) — not one card per id of a provider that lists hundreds.
        const want = asked ? new Set(asked) : families ? new Set(families.map((f) => f.lead)) : null;
        const models = rows
          .filter((/** @type {any} */ m) => !want || want.has(m.id) || want.has(String(m.upstreamModel)))
          .map((/** @type {any} */ m) => {
            const place = placeOfName(cfgX, m.id);
            if (!place) return { id: m.id, upstreamModel: m.upstreamModel, caps: null, fallback: null, offer: null };
            const f = famOf.get(m.id);
            // The price as the server reads it — the built-in API rates included, which the page cannot know itself. An
            // agent's too, with its source: the page shows an agent only a row someone wrote, as its records price it
            // (records.js; HarnessV3-FixRound decision 26).
            const card = priceCard(place.sent, place.up?.pricing);
            return {
              id: m.id,
              upstreamModel: m.upstreamModel,
              sent: place.sent,
              price: card ? { ...card, source: priceSourceOf(place.sent, place.up?.pricing), stated: statedPricesOf(place.sent, place.up?.pricing) } : null,
              // How it is billed (Providers P4), and how its provider is without any row's say — what the sheet's
              // "Like the provider" stands for.
              billing: { ...billingOf(place.sent, place.up), provider: billingOf(place.sent, place.up ? { ...place.up, pricing: null } : null).billing },
              caps: capsAt(cfgX, place.up, place.sent, place.rules),
              fallback: capsAt(cfgX, withoutOperatorCaps(place.up), place.sent, place.rules),
              // Which of this upstream's rows said each value (a prefix row speaks for every model it starts), so the
              // sheet can say so.
              rowKeys: Object.fromEntries(CAP_FIELDS.map((k) => [k, rowFieldFor(place.sent, up.pricing, k)?.key]).filter(([, key]) => key)),
              // A family of variant ids is tuned on its base row, which covers every id it starts (grok-4.7 → grok-4.7-fast).
              // A family whose windows are names of their own says which name is which window (0: the plain member's).
              offer: f ? { family: f.id, familyKey: f.kind === "variants" ? placeOfName(cfgX, f.id)?.sent || null : null, kind: f.kind, members: f.members.map((/** @type {any} */ x) => x.id), effort: f.effort, speed: f.speed, thinking: f.thinking, window: f.window, price: f.price || null,
                ...(f.window?.via === "name" ? { windowIds: Object.fromEntries(f.members.filter((/** @type {any} */ x) => !x.effort && !x.speed && !x.thinking).map((/** @type {any} */ x) => [String(x.window || 0), x.id])) } : {}) } : null,
              // The policy the offer was narrowed by, so the sheet can say why a capability is not offered.
              policy: { effortAllowed: place.rules?.effort?.allowed || null, effortSuffixes: place.rules?.effort?.suffixes || null, speedMode: place.rules?.speed?.mode || "client", speedSuffix: place.rules?.speed?.suffix !== false },
            };
          });
        // The draft rows' own problems, in the words a save would answer with (the row named, not its index).
        const v = validateConfig({ ...cfgX, upstreams: [up], routes: [] });
        const errors = v.errors.filter((e) => e.startsWith("upstreams[0].pricing[")).map((e) => e.replace(/^upstreams\[0\]\./, ""));
        return sendJson(r.res, 200, { upstream: id, type: up.type, agent: isAgentUpstream(up), models, errors, ...(families ? { families } : {}) });
      },
    ],
    [
      "GET",
      "/acp/status",
      (r) => {
        const all = agentBridges.map((/** @type {any} */ b) => b.status());
        return sendJson(r.res, 200, {
          permissions: all
            .flatMap((s) => s.permissions)
            .sort((x, y) => y.at - x.at)
            .slice(0, 50),
          processes: all.flatMap((s) => s.processes),
          conversations: all.flatMap((s) => s.conversations),
          turns: all.flatMap((s) => s.turns),
          mcp: mcp.hits.slice(-30).reverse(),
          sdk: sdkStatus(),
        });
      },
    ],
    // The raw messages one conversation's agent session kept (`acp.rawMessages`, AC1-7), oldest first. In memory only:
    // they hold whole files and results, so nothing else serves them.
    [
      "GET",
      "/acp/conversations/:key/raw",
      (r) => {
        const raw = bridge.rawOf(decodeURIComponent(r.params.key));
        return raw ? sendJson(r.res, 200, { raw }) : sendJson(r.res, 404, { error: "no such conversation" });
      },
    ],
    // What each agent declared the last time Filament started it (HarnessV3-ACP AC0-1), kept: read without starting one.
    ["GET", "/acp/profiles", (r) => sendJson(r.res, 200, { profiles: bridge.profiles.all() })],
    // Each coding agent's account and its plan's windows, as the agents said them (HarnessV3-ACP AC3-6): every enabled
    // agent upstream, its account or none yet. A read is a page asking again: an agent that keeps who it runs as to
    // itself has its sign-in read again where its reading is a minute old — the answer never waits for it, and what it
    // finds comes as the store's change.
    [
      "GET",
      "/agent-accounts",
      async (r) => {
        // A view-only device reads the accounts as they stand: asking each agent's CLI afresh is this machine's to do
        // (the hunt of p1-auth: VIEW_ROUTES lists no GET that acts).
        if (drives(r.who)) logins.refresh();
        return sendJson(r.res, 200, { agents: await Promise.all((config.get().upstreams || []).filter(listed).map(agentRow)) });
      },
    ],
    // *Check now*: the agent asked afresh (Codex its account and plan, Cursor its key's owner, Claude's throwaway agent who
    // it runs as and its plan's usage; one that keeps who it runs as to itself, its CLI's or its files' word on its
    // sign-in), then the account as it now stands, and what the check came to (`checked`: its plan read, as it was, or
    // why not — null where the agent says nothing of it).
    [
      "POST",
      "/agent-accounts/:id/check",
      async (r) => {
        const u = agentOf(r.params.id);
        if (!u) return sendJson(r.res, 404, { error: "no such coding agent" });
        // Nothing reaches Cursor through its SDK while its switch is off (the bug hunt of 5d57bbe8a).
        if (cursorSdkHeld(config.get(), u)) return sendJson(r.res, 400, { error: `${CURSOR_SDK_OFF}.` });
        /** @type {import("../../core/ports.js").AccountCheck | void} */
        let checked = undefined;
        /** @type {any} */
        let failed = null;
        try {
          checked = await destinationFor(u).agent.checkAccount(u);
        } catch (/** @type {any} */ e) {
          failed = e;
        }
        // Its CLI's or its files' word, whether or not its agent could be asked.
        await logins.check(u);
        if (failed) return sendJson(r.res, 502, { error: failed.message, agent: await agentRow(u) });
        return sendJson(r.res, 200, { agent: await agentRow(u), checked: checked || null });
      },
    ],
    // More than one account (HarnessV3-ACP AC3-7): an account added beside an agent's (`{ from, name }`: the agent's
    // upstream and the account's name), renamed, removed; signed in (`{ way, key }`: one of the row's ways — several and
    // none chosen answers `choose`, and so does a key's way with no `key`, which no answer says back), its sign-in
    // stopped, signed out.
    [
      "POST",
      "/agent-accounts",
      async (r) => {
        const body = await r.json();
        try {
          return sendJson(r.res, 200, { agent: await agentRow(logins.add({ from: String(body?.from || ""), name: String(body?.name || "") })) });
        } catch (/** @type {any} */ e) {
          return sendJson(r.res, e?.status || 500, { error: e?.message || String(e) });
        }
      },
    ],
    [
      "PATCH",
      "/agent-accounts/:id",
      async (r) => {
        const body = await r.json();
        return changed(r, () => void logins.rename(r.params.id, String(body?.name || "")));
      },
    ],
    ["DELETE", "/agent-accounts/:id", (r) => changed(r, () => logins.remove(r.params.id))],
    [
      "POST",
      "/agent-accounts/:id/sign-in",
      async (r) => {
        const body = await r.json();
        return changed(r, () => logins.signIn(r.params.id, { way: String(body?.way || ""), key: typeof body?.key === "string" ? body.key : "" }));
      },
    ],
    ["POST", "/agent-accounts/:id/sign-in/cancel", (r) => changed(r, async () => ({ stopped: await logins.cancelSignIn(r.params.id) }))],
    ["POST", "/agent-accounts/:id/sign-out", (r) => changed(r, () => logins.signOut(r.params.id))],
    // An account turned off with its sign-in kept, or on again (the owner's of 11-05).
    ["POST", "/agent-accounts/:id/off", (r) => changed(r, () => logins.setOff(r.params.id, true))],
    ["POST", "/agent-accounts/:id/on", (r) => changed(r, () => logins.setOff(r.params.id, false))],
    // One of a Codex account's reset credits, spent at the person's word: Codex's word on it, and the account after.
    [
      "POST",
      "/agent-accounts/:id/reset-credit",
      async (r) => {
        const u = agentOf(r.params.id);
        const agent = u ? destinationFor(u).agent : null;
        if (!u || !agent?.useResetCredit) return sendJson(r.res, 404, { error: "only a Codex account has reset credits" });
        try {
          return sendJson(r.res, 200, { outcome: await agent.useResetCredit(u), agent: await agentRow(u) });
        } catch (/** @type {any} */ e) {
          return sendJson(r.res, 502, { error: e.message, agent: await agentRow(u) });
        }
      },
    ],
    [
      "GET",
      "/sdk/status",
      async (r) => {
        const st = sdkStatus();
        // What the disk holds is read either way; the SDK is loaded into Filament only while its switch is on (the
        // re-read of 11-11: its status loaded it, and its install ran npm, with Cursor's SDK switched off).
        if (r.url.searchParams.get("load") === "1" && !cursorSdkOn(config.get())) return sendJson(r.res, 400, { error: `${CURSOR_SDK_OFF}.` });
        const load =
          r.url.searchParams.get("load") === "1"
            ? await loadCursorSdk({ loader: overrides.cursorSdkLoader || null })
            : null;
        return sendJson(r.res, 200, {
          ...st,
          ...(load
            ? {
                loaded: load.ok,
                loadError: load.ok ? null : load.error,
                version: load.ok ? load.version : st.version,
              }
            : {}),
          // The install under way: when it began, and its output's newest lines.
          installing: sdkInstalling ? { since: sdkInstalling.since, output: sdkInstalling.output().split(/\r?\n/).slice(-12).join("\n") } : null,
        });
      },
    ],
    [
      "POST",
      "/sdk/install",
      async (r) => {
        // `npm install -g @cursor/sdk`, run for the person until it ends or they stop it; the output tail comes back so
        // a failure is readable. One at a time, and only while Cursor's SDK is switched on.
        if (!cursorSdkOn(config.get())) return sendJson(r.res, 400, { error: `${CURSOR_SDK_OFF}.` });
        if (sdkInstalling) return sendJson(r.res, 409, { error: "the Cursor SDK is being installed already: its status shows its output, and its stop ends it" });
        const t0 = Date.now();
        const installing = installCursorSdk({ spawnImpl: overrides.sdkInstallSpawn || undefined });
        sdkInstalling = installing;
        const run = await installing.done.finally(() => {
          if (sdkInstalling === installing) sdkInstalling = null;
        });
        resetSdkCache();
        const st = sdkStatus();
        const load = st.installed ? await loadCursorSdk({ force: true }) : null;
        log(
          run.code === 0 ? "info" : "warn",
          `cursor sdk install ${run.stopped ? "stopped by the person" : `exited ${run.code}`} in ${Math.round((Date.now() - t0) / 1000)} s; installed=${st.installed}`,
        );
        return sendJson(r.res, 200, {
          ok: run.code === 0 && st.installed && !!load?.ok,
          code: run.code,
          stopped: run.stopped,
          ms: Date.now() - t0,
          output: run.out.split(/\r?\n/).slice(-12).join("\n"),
          status: { ...st, loaded: !!load?.ok, loadError: load && !load.ok ? load.error : null },
          hint: SDK_INSTALL_HINT,
        });
      },
    ],
    // The Cursor SDK's install stopped by the person: it has no clock (HarnessV3-FailurePoints FP-D3).
    ["POST", "/sdk/install/stop", (r) => sendJson(r.res, 200, { stopped: sdkInstalling ? (sdkInstalling.stop(), true) : false })],
    // ---- Qoder account login (PKCE device flow) ----
    [
      "POST",
      "/qoder/:id/login/start",
      (r) => {
        const id = decodeURIComponent(r.params.id);
        const u = (config.get().upstreams || []).find((x) => x.id === id && x.type === "qoder");
        if (!u) return sendJson(r.res, 404, { error: "no Qoder upstream with that id" });
        for (const [nonce, pend] of qoderLogins) if (Date.now() > pend.expiresAt) qoderLogins.delete(nonce); // logins nobody polled expire with their device code
        const s = qoder.startDeviceLogin(u.qoder?.region);
        qoderLogins.set(s.nonce, { ...s, upstreamId: id });
        return sendJson(r.res, 200, {
          nonce: s.nonce,
          url: s.url,
          userCode: s.userCode,
          expiresAt: s.expiresAt,
        });
      },
    ],
    [
      "POST",
      "/qoder/:id/login/poll",
      async (r) => {
        const { res, json } = r;
        const input = await json();
        const pend = qoderLogins.get(input?.nonce);
        if (!pend) return sendJson(res, 404, { error: "unknown or expired login attempt; start again" });
        if (Date.now() > pend.expiresAt) {
          qoderLogins.delete(pend.nonce);
          return sendJson(res, 200, { status: "expired" });
        }
        try {
          const rr = await qoder.pollDeviceLogin(pend);
          if (rr.status !== "ok") return sendJson(res, 200, { status: "pending" });
          const info = await qoder.fetchUserInfo(rr.accessToken, pend.region);
          const u = (config.get().upstreams || []).find((x) => x.id === pend.upstreamId);
          if (!u) return sendJson(res, 404, { error: "upstream disappeared" });
          u.qoder = {
            ...(u.qoder || {}),
            authMethod: "device",
            accessToken: rr.accessToken,
            refreshToken: rr.refreshToken,
            userId: rr.userId || info.id || "",
            machineId: pend.machineId,
            name: info.name || "",
            email: info.email || "",
            expiresAt: rr.expiresAt,
          };
          u.enabled = true;
          config.save();
          qoderLogins.delete(pend.nonce);
          log("info", `qoder login completed for ${u.id} (${info.email || rr.userId})`);
          return sendJson(res, 200, {
            status: "ok",
            email: info.email,
            name: info.name,
            userId: u.qoder.userId,
            expiresAt: rr.expiresAt,
          });
        } catch (/** @type {any} */ e) {
          qoderLogins.delete(pend.nonce);
          return sendJson(res, 200, { status: "error", error: e.message });
        }
      },
    ],
    [
      "POST",
      "/qoder/:id/logout",
      (r) => {
        const id = decodeURIComponent(r.params.id);
        const u = (config.get().upstreams || []).find((x) => x.id === id && x.type === "qoder");
        if (!u) return sendJson(r.res, 404, { error: "not found" });
        u.qoder = { authMethod: "device" };
        u.apiKey = "";
        config.save();
        return sendJson(r.res, 200, { ok: true });
      },
    ],
    [
      "GET",
      "/qoder/:id/status",
      async (r) => {
        const { url, res, params } = r;
        const id = decodeURIComponent(params.id);
        const u = (config.get().upstreams || []).find((x) => x.id === id && x.type === "qoder");
        if (!u) return sendJson(res, 404, { error: "not found" });
        const q = u.qoder || {};
        const pat = String(u.apiKey || "").startsWith("pt-");
        const out = {
          loggedIn: !!(q.accessToken && q.userId) || pat,
          method: q.accessToken ? "device" : pat ? "pat" : null,
          email: q.email || null,
          name: q.name || null,
          expiresAt: q.expiresAt || null,
          expired: !!(q.expiresAt && q.expiresAt < Date.now()),
        };
        if (out.loggedIn && url.searchParams.get("quota") === "1") {
          try {
            const creds = await qoder.resolveCredentials(u);
            out.quota = await qoder.fetchQuota(creds.accessToken, creds.region);
          } catch (/** @type {any} */ e) {
            out.quota = { error: e.message };
          }
        }
        return sendJson(res, 200, out);
      },
    ],
    [
      "GET",
      "/acp/agents",
      async (r) =>
        sendJson(r.res, 200, {
          agents: (r.url.searchParams.get("status") === "0"
            ? detectAgents()
            : await detectAgentsWithStatus()
          ).map((x) => ({
            ...x,
            install: installCommand(x, process.platform)?.line || null,
            configured: !!(config.get().upstreams || []).find((u) => u.id === x.id),
            enabled: !!(config.get().upstreams || []).find((u) => u.id === x.id && u.enabled !== false),
          })),
        }),
    ],
    [
      "POST",
      "/acp/agents/:id/login",
      (r) => {
        const { res, params } = r;
        const id = decodeURIComponent(params.id);
        const agent = detectAgents().find((x) => x.id === id);
        if (!agent) return sendJson(res, 404, { error: "unknown agent" });
        if (!agent.installed)
          return sendJson(res, 400, { error: `${agent.name} is not installed: ${installCommand(agent, process.platform)?.line}` });
        try {
          const opened = startAgentLogin(agent);
          log("info", `${opened.ok ? "opened a login terminal" : "no terminal to open a login in"} for ${agent.id}: ${opened.command}`);
          return sendJson(res, 200, opened);
        } catch (/** @type {any} */ e) {
          return sendJson(res, 500, { error: e.message });
        }
      },
    ],
    [
      "POST",
      "/acp/detect",
      async (r) => {
        // Add every known agent that is missing, as a fresh install seeds it, and enable the ones on by default whose CLI
        // is present (`seededOn`), their own routes with them — but not one turned off in the harness's Settings →
        // Coding agents (`acp.turnedOff`, HarnessV3-ACP AC3-8), nor an account turned off there (`acp.accountOff`).
        // Another agent is turned on there, by its Connect. Never disables anything.
        const agents = detectAgents();
        const next = structuredClone(config.get());
        const added = [],
          enabled = [];
        for (const agent of agents) {
          let u = (next.upstreams ||= []).find((x) => x.id === agent.id);
          if (!u) {
            u = agentUpstream(agent, { enabled: seededOn(agent) });
            next.upstreams.push(u);
            added.push(agent.id);
          }
          const on = seededOn(agent) && u.enabled === false && !u.acp?.turnedOff && !u.acp?.accountOff;
          if (on) {
            u.enabled = true;
            enabled.push(agent.id);
          }
          if (agent.modelSelection && u.acp && (!u.acp.modelSelection || u.acp.modelSelection === "arg"))
            u.acp.modelSelection = agent.modelSelection; // adapters that select the model per session, not per process
          // Another agent's routes are left as they are: a route the user disabled stays disabled.
          const route = agentRoute(agent, { enabled: true });
          const moved = on ? turnOnAgentRoute((next.routes ||= []), agent.id, agent.prefix, route) : placeAgentRoute((next.routes ||= []), agent.id, agent.prefix, route);
          if (moved) log("info", `route ${moved.moved} moved above ${moved.above}, which was catching its names`);
        }
        const merged = normalizeConfig(next);
        const v = validateConfig(merged);
        if (!v.ok)
          return sendJson(r.res, 400, { error: "detection produced an invalid config", errors: v.errors });
        config.set(merged);
        config.save();
        log("info", `agents detected: added ${added.join(",") || "-"}; enabled ${enabled.join(",") || "-"}`);
        return sendJson(r.res, 200, {
          ok: true,
          added,
          enabled,
          agents: agents.map((x) => ({ id: x.id, installed: x.installed })),
          config: redactConfig(config.get()),
        });
      },
    ],
    [
      "GET",
      "/acp/:id/offer",
      async (r) => {
        const id = decodeURIComponent(r.params.id);
        const u = findUpstream(config.get(), id);
        if (!isAgentUpstream(u)) return sendJson(r.res, 404, { error: "not an agent upstream" });
        // The catalogue's words, for one PATH detection doesn't look for too (Antigravity, which ACP's registry installs).
        const known = KNOWN_AGENTS.find((x) => x.id === id) || null;
        return sendJson(r.res, 200, {
          ...(await destinationFor(u).agent.offer(u, { force: r.url.searchParams.get("refresh") === "1" })),
          guide: known?.guide || null,
          account: known?.account || null,
          login: known?.login || null,
          notes: known?.notes || null,
          prefix:
            (config.get().routes || [])
              .find((rt) => rt.upstream === id && rt.enabled !== false)
              ?.match?.replace(/\*.*$/, "") || `${id}/`,
        });
      },
    ],
    [
      "GET",
      "/acp/:id/sessions",
      async (r) => {
        const id = decodeURIComponent(r.params.id);
        const u = findUpstream(config.get(), id);
        if (!isAgentUpstream(u)) return sendJson(r.res, 404, { error: "not an agent upstream" });
        return sendJson(r.res, 200, await destinationFor(u).agent.listSessions(u));
      },
    ],
    [
      "POST",
      "/acp/processes/:key*/kill",
      (r) => {
        const key = decodeURIComponent(r.params.key);
        return sendJson(r.res, 200, { ok: agentBridges.some((/** @type {any} */ b) => b.killProcess(key)) });
      },
    ],
    [
      "DELETE",
      "/acp/conversations/:key*",
      (r) => {
        const key = decodeURIComponent(r.params.key);
        return sendJson(r.res, 200, { ok: agentBridges.some((/** @type {any} */ b) => b.forgetConversation(key)) });
      },
    ],
    // "Add a provider" (Providers P1): the catalogue the page's tiles are drawn from — addresses, plans, key pages and
    // hints; nothing secret is in it.
    ["GET", "/providers", async (r) => sendJson(r.res, 200, { providers: PROVIDERS, otherKinds: OTHER_KINDS })],
    [
      "POST",
      "/providers/probe",
      async (r) => {
        // A draft provider asked for its model list before anything is saved, answered as the picker will show it:
        // families over the saved configuration plus this draft and its prefix route at the top, the ids that are
        // not chat models set apart, and the hints its rows would start with. Nothing is written — not the config,
        // not the model cache — and the key is used for this one ask only.
        const input = await r.json();
        const draft = input?.upstream;
        if (!draft || typeof draft !== "object") return sendJson(r.res, 400, { error: "body.upstream is required" });
        const prefix = String(input.prefix ?? "").trim().replace(/\/+$/, "") || String(draft.id || "draft");
        const up = normalizeConfig({ upstreams: [{ ...draft, id: String(draft.id || prefix), enabled: true, hiddenModels: [] }] }).upstreams[0];
        if (isAgentUpstream(up) || UPSTREAM_TYPES[up.type]?.local || UPSTREAM_TYPES[up.type]?.builtin)
          return sendJson(r.res, 400, { error: `a ${up.type} upstream is not an API provider; it has no model list to probe` });
        const known = providerById(String(input.provider || "")) || providerForBaseUrl(up.baseUrl)?.provider || null;
        const hints = known?.hints || {};
        const none = { models: [], families: [], other: [], hints };
        if (!/^https?:\/\/[^/\s]+/i.test(String(up.baseUrl || "")))
          return sendJson(r.res, 200, { ok: false, status: 0, ms: 0, error: "the address must start with http:// or https://", sample: "", ...none });
        // A draft brings its own key: a saved upstream's stored one is never spliced in here.
        if (up.apiKey === "__SECRET__") up.apiKey = "";
        const got = await probeProviderModels(up);
        if (!got.ok) return sendJson(r.res, 200, { ...got, ...none });
        const other = got.names.filter((n) => isOtherModel(known, n));
        const set = new Set(other);
        const chat = got.names.filter((n) => !set.has(n));
        const base = await cfgForModels(false);
        const route = { match: `${prefix}/*`, upstream: up.id, upstreamModel: "{1}", format: "auto", enabled: true, fallbacks: [], discoverPrefixes: [...(known?.route?.discoverPrefixes || [])], rules: {} };
        const cfgX = {
          ...base,
          upstreams: [...(base.upstreams || []).filter((/** @type {any} */ x) => x.id !== up.id), { ...up, pricing: { ...hints, ...(up.pricing || {}) } }],
          routes: [route, ...(base.routes || [])],
        };
        /** @type {any} */
        const discoverX = async (/** @type {any} */ x) => (x.id === up.id ? { names: chat, source: "discovered" } : discover(x, { force: false }));
        const rows = ((await aggregateModels(cfgX, { discover: discoverX })).models || []).filter((/** @type {any} */ m) => m.upstream === up.id && m.source !== "effort-variant");
        const sentOf = new Map(rows.map((/** @type {any} */ m) => [m.id, m.upstreamModel]));
        // Each member also carries the name the provider spells, which is what the upstream's hidden list holds.
        const families = buildFamilies(cfgX, rows).map((f) => ({ ...f, members: f.members.map((m) => ({ ...m, name: sentOf.get(m.id) ?? m.id })) }));
        return sendJson(r.res, 200, { ok: true, status: got.status, ms: got.ms, sample: got.sample, models: got.names, families, other, hints });
      },
    ],
    [
      "GET",
      "/upstreams/:id/test",
      async (r) => {
        // The id arrives as the URL spelled it (no decode). The answer is kept for Settings › Providers' dot (HS-2).
        const u = findUpstream(config.get(), r.params.id);
        if (!u) return sendJson(r.res, 404, { error: "upstream not found" });
        const out = await testUpstream(u, config, destinationFor);
        providers?.tested(u.id, out);
        return sendJson(r.res, 200, out);
      },
    ],
    [
      "POST",
      "/upstreams/test",
      async (r) => {
        const input = await r.json();
        let u = input?.upstream;
        if (!u) return sendJson(r.res, 400, { error: "body.upstream is required" });
        // The form's values are tested, saved or not: the program they name is started, and a kept key goes to the
        // address they name. So one that is not a kept upstream tested as it is kept is a press (`testsMore`; s-rows,
        // 11-12), refused this computer's caller without the desktop app's key (guards.js `pressRefused`).
        const unpressed = pressRefused(r.req);
        if (unpressed && testsMore(u, config)) return sendJson(r.res, 403, { error: unpressed, press: true });
        if (!u.apiKey || u.apiKey === "__SECRET__") u = { ...u, apiKey: savedOf(u, config)?.apiKey || "" };
        return sendJson(r.res, 200, await testUpstream(u, config, destinationFor));
      },
    ],
  ];
}
