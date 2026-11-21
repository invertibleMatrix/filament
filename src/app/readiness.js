// @ts-check
// Whether Filament can answer yet (HarnessV3-Launch LD-D1, LD-D2): one rule, read by the console's Get started, Home's
// hero and `--open` from the server, so no page keeps a copy of it.
import { UPSTREAM_TYPES, isMachineUpstream } from "../core/schema.js";
import { findUpstream } from "../core/routing.js";
import { providerForBaseUrl } from "../core/providers.js";
import { isOtherRow } from "../core/model-families.js";
import { offlineWords } from "../adapters/providers/filament.js";

/**
 * Whether an upstream holds what its type needs to answer: a key; nothing for a coding agent (it brings its own login)
 * or a local server the provider catalogue marks keyless (Ollama, LM Studio); a login or a personal token for Qoder;
 * for another machine's models, the machine named — and not found offline, which a call or its listing tells
 * (adapters/providers/filament.js). Whether the key is right only a request can tell: this is whether one is there.
 * @param {any} u  an upstream as configured
 */
export function upstreamCanAnswer(u) {
  if (!u || u.enabled === false) return false;
  if (isMachineUpstream(u)) return !!String(u.machine || "").trim() && !offlineWords(u.id);
  const type = UPSTREAM_TYPES[/** @type {keyof typeof UPSTREAM_TYPES} */ (u.type)];
  if (type?.keyless) return true;
  // A type that signs in keeps its login in a block of its own name (`qoder.accessToken`); a key works for it too.
  if (type?.signIn && u[u.type]?.accessToken) return true;
  return !!u.apiKey || !!providerForBaseUrl(u.baseUrl)?.provider.keyless;
}

/** What a model in the catalogue is that answers no task of its own: the same model again. */
const NOT_A_MODEL = new Set(["effort-variant"]);

/**
 * The catalogue's models that can answer: a model the routes answer on an upstream that can (a coding agent's
 * included: it answers a task whole). The effort twins are the same model again, and a model that isn't for chat
 * answers no task: neither counts.
 * @param {any} cfg @param {readonly any[]} models  the catalogue (`aggregateModels(…).models`)
 * @returns {any[]}
 */
export function modelsThatAnswer(cfg, models) {
  return (models || []).filter(
    (m) =>
      m &&
      !NOT_A_MODEL.has(m.source) &&
      !isOtherRow(cfg, m) &&
      upstreamCanAnswer(findUpstream(cfg, m.upstream)),
  );
}

/**
 * Where `--open` lands (LD-D1): the harness once a model can answer, the console's Home before that.
 * @param {string} base  the server's address, no trailing slash @param {number} answering
 */
export const frontDoorUrl = (base, answering) => (answering > 0 ? `${base}/ui/harness.html` : `${base}/`);

/**
 * What Get started shows (LD-D2), as the server knows it: whether a model can answer, memory's state, and whether the
 * harness has a task yet. `unlisted` names the providers set up that Filament has no list of models for (LD-D3): each
 * can answer and a route reaches it, but nothing has asked it for its models (`discoveryOf`'s `unasked`), so the
 * catalogue lists none of them.
 * @param {{ cfg: any, models: readonly any[], memory: any, discoveryOf?: ((id: string) => any) | null }} o
 */
export async function startFacts({ cfg, models, memory, discoveryOf = null }) {
  const answering = modelsThatAnswer(cfg, models);
  const listedOn = new Set((models || []).map((m) => m?.upstream));
  const unlisted = (cfg.upstreams || [])
    .filter(
      (/** @type {any} */ u) =>
        upstreamCanAnswer(u) &&
        !listedOn.has(u.id) &&
        (cfg.routes || []).some((/** @type {any} */ r) => r.enabled !== false && r.upstream === u.id) &&
        !!discoveryOf?.(u.id)?.unasked,
    )
    .map((/** @type {any} */ u) => String(u.name || u.id));
  const st = memory ? await memory.status() : null;
  const ms = memory?.models?.() || null;
  const installing =
    (st?.jobs || []).find((/** @type {any} */ j) => j.kind === "install" && j.status === "running") || null;
  let used = false;
  try {
    // A task the page made is the harness's (archived ones too: the harness was opened all the same).
    used = !!memory?.sessions("", {
      limit: 1,
      client: "harness",
      kinds: ["interactive", "fork"],
      archived: "all",
    })?.length;
  } catch {
    // no archive: no task can be known
  }
  return {
    connected: { ok: answering.length > 0, models: answering.length, example: answering[0]?.id || null, unlisted },
    memory: {
      enabled: !!st?.enabled,
      installed: !!st?.engine?.installed,
      installing,
      // The bundle that came with Filament is here (AH-D2): the only thing its engine installs from.
      bundled: !!st?.engine?.bundle?.ready,
      // What memory calls where no chat is named; `chosen` where the person set none (each chat's compaction model, else
      // its own, stands then).
      learnsWith: ms?.now || null,
      chosen: !!ms?.now && ms?.from !== "memory",
      // As set: "" unset, `off`, or a model named. "Learns nothing" reads differently when it was asked for.
      summarizer: ms?.summarizer || "",
      // Why it learns with none, in words; null while it has one.
      whyNone: ms?.whyNone || null,
    },
    harness: { used },
  };
}
