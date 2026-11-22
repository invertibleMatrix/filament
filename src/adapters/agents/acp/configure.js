// The requested mode, model and effort applied to an agent session, in that order, with a note on the record for
// every request the agent honoured, refused or does not offer. Two model shapes: an agent whose "model" option lists
// complete ids, and one that lists base models plus one option per parameter (Cursor), where a flat model name is
// taken apart into the base and its parameter values.
import { pushNote } from "../../../core/notes.js";
import { readSessionOffer, planVariant, matchOffered, resolveMode, modelSelection, typedName } from "./negotiate.js";

/** The modes in which an agent asks before it changes anything: Claude's, Gemini's and Qoder's `default`, Cursor's `agent`. */
const ASKING_MODES = ["default", "agent"];

/**
 * The mode in which a session's agent asks before it changes anything, where it offers one.
 * @param {{ availableModes?: string[] }} conv
 */
export const askingMode = (conv) => ASKING_MODES.find((m) => conv.availableModes?.includes(m)) || null;

/**
 * The common words for a mode, each mapped onto what an agent offers (`resolveMode`): Cursor's `agent` is Gemini's
 * and Qoder's `yolo`, Antigravity's `auto` where its account offers it, else its `accept-edits` (agy 1.5 names its modes
 * `default`, `accept-edits`, `plan` and `auto`, read live on 1.5.14); `ask` is an agent's own `ask`, else its `default`
 * (it asks before it acts), else its plan mode.
 */
export const MODE_ALIASES = Object.freeze({
  agent: ["agent", "yolo", "bypassPermissions", "auto", "acceptEdits", "accept-edits"],
  plan: ["plan", "dontAsk"],
  ask: ["ask", "default", "plan"],
});

/**
 * Whether a mode's name is one in which an agent asks before it acts, only plans, or only reads (Codex's
 * `read-only`) — by the common words and the upstream's own names for them (`acp.modeAliases`). Never one in which it
 * asks nobody, nor a name Filament does not know: what a registry agent's own mode lets it run, nobody here can say.
 * @param {string} mode @param {{ modeAliases?: Record<string, string[]> }} [acp]
 */
export const modeAsks = (mode, acp = {}) => {
  const aliases = { ...MODE_ALIASES, ...(acp.modeAliases || {}) };
  const named = String(mode).toLowerCase();
  const among = (/** @type {readonly string[] | undefined} */ names) => (names || []).some((m) => String(m).toLowerCase() === named);
  return among(["plan", "ask", "read-only", ...(aliases.plan || []), ...(aliases.ask || [])]) && !among(["agent", ...(aliases.agent || [])]);
};

/**
 * The model an agent offers as its own pick, for the word `auto`: one named `auto` (Gemini's), else of that kind
 * (Cursor's `auto-smart`) — never a model whose name merely holds the word. Null where it offers none.
 * @param {readonly string[] | undefined} offered
 */
export const offeredAuto = (offered = []) =>
  offered.find((m) => String(m).toLowerCase() === "auto") || offered.find((m) => /^auto-/i.test(String(m))) || null;

/**
 * Each switch waits for the agent's answer as long as it takes (HarnessV3-FailurePoints §4 B): the turn's stop
 * (`signal`) ends the wait, and it ends the whole, thrown, not noted as a switch the agent refused. Each is said as it
 * starts (`step`, §5.1 item 2): the turn names what it waits on. `typed`: the names typed on the upstream's card
 * (its `models`, HarnessV4_Tasks E9). `keyed`: the models the account's API key offers beyond the agent's own list
 * (bridge.js `#keyOffers`). `facts`: the turn's, which keep that the agent answered the set of its model with another
 * (`modelKept`).
 */
export async function applySessionSettings({
  proc,
  conv,
  acp,
  modelId: named,
  typed = /** @type {string[]} */ ([]),
  keyed = /** @type {string[]} */ ([]),
  effort,
  mode,
  modeOverride,
  asks = false,
  notes,
  structured,
  signal = null,
  step = null,
  facts = /** @type {Record<string, any> | null} */ (null),
}) {
  /** @param {string} method @param {any} params */
  const ask = (method, params) => proc.request(method, params, 0, signal);
  /** @type {(s: { step: "mode" | "model" | "effort", to: string }) => void} */
  const say = (s) => step?.(s);
  /** A switch's failure, a stop's thrown on. @param {any} e */
  const stopped = (e) => {
    if (signal?.aborted) throw e;
  };
  // Mode can change on any turn (`@plan` / `@ask` / `@agent` / any agent mode id as a suffix, or the upstream default).
  // Names differ per agent, so aliases map the common words onto what this agent offers.
  const aliases = { ...MODE_ALIASES, ...(acp.modeAliases || {}) };
  let wanted = resolveMode(mode, conv.availableModes, aliases);
  // A turn that names its mode ends the agent's own planning (HarnessV3-ACP AC3-3).
  if (modeOverride) conv.keepPlan = false;
  // A harness session's switch answers the agent (HarnessV3-ACP AC3-2, `asks`): a mode in which the agent asks nobody
  // — the upstream's default, or the common word `agent` — gives way to the one in which it asks. A mode the person
  // names on the turn (`@bypassPermissions`), or a plan or ask mode, stays.
  const answers = asks && !modeOverride && wanted && [...aliases.agent, "agent"].includes(wanted);
  const asking = answers ? askingMode(conv) : null;
  // One that offers no mode known to ask — a registry agent's `ask`/`code`/`auto` — is never switched into one that
  // asks nobody: the switch would never hear of a call (the review of 11-10). It keeps the mode its session opened in.
  const kept = answers && !asking && wanted !== conv.mode;
  // The agent in its plan mode by its own move, or told to keep planning (`conv.keepPlan`, AC3-3), plans on until its
  // plan is accepted: any other mode would end its planning, the upstream's own too (the bug report's L24).
  if (conv.keepPlan && conv.mode === "plan" && wanted !== "plan") {
    notes.push("acp: mode plan kept: the agent plans on until its plan is accepted");
    wanted = "plan";
  } else if (asking && asking !== wanted) {
    notes.push(`acp: mode ${asking} instead of ${wanted}: the agent asks before it acts, and the switch Filament holds for this turn answers`);
    wanted = asking;
  } else if (kept) {
    notes.push(`acp: mode ${conv.mode || "as its session opened"} kept, not ${wanted}: the agent offers no mode Filament knows to ask before it acts, and ${wanted} would run its calls without the switch Filament holds for this turn`);
    wanted = conv.mode || null;
  }
  if (kept) {
    // Nothing to switch: the mode it opened in stands.
  } else if (!wanted)
    pushNote(notes, structured, { kind: "mode-not-offered", mode, has: conv.availableModes || [] });
  else if (wanted !== conv.mode) {
    try {
      say({ step: "mode", to: wanted });
      await ask("session/set_mode", { sessionId: conv.sessionId, modeId: wanted });
      notes.push(`acp: mode ${conv.mode} -> ${wanted}${wanted !== mode ? ` (alias of ${mode})` : ""}`);
      conv.mode = wanted;
    } catch (e) {
      stopped(e);
      notes.push(`acp: mode ${wanted} not applied (${e.message})`);
    }
  } else if (modeOverride) notes.push(`acp: mode ${wanted}`);
  // Session-level model selection. Two shapes: an agent whose "model" option lists complete ids (Claude Code adapter:
  // opus, opus[1m], sonnet…), or one that lists base models plus one option per parameter (Cursor: effort, fast,
  // thinking, context). For the second, a flat name such as cursor-grok-4.6-xhigh-fast is taken apart into the base
  // model and its parameter values: Cursor ignores --model in ACP mode, so set_config_option is the only way to choose.
  let effortHandled = false;
  // `auto` is the agent's own pick of model: the one it offers as such (`offeredAuto`), switched to, since a session
  // can open on another — Cursor keeps the model a session last switched to as its next sessions' —; where it offers
  // none, the session's model as it is, as for `default`.
  const ownAuto = named === "auto" ? offeredAuto(conv.availableModels) : null;
  const modelId = ownAuto || named;
  const switchable = !!modelId && (!!ownAuto || (modelId !== "auto" && modelId !== "default"));
  // → the model the answer names as the session's current one, or null where it names none.
  const absorb = (r) => {
    if (Array.isArray(r?.configOptions)) {
      const o = readSessionOffer({ configOptions: r.configOptions });
      conv.paramOptions = o.params;
      conv.effortOptions = o.efforts;
      conv.effortConfigId = o.effortConfigId;
      conv.effort = o.currentEffort ?? conv.effort;
      if (o.models.length) {
        conv.availableModels = o.models;
        // Its words for its models: an answer that names its ids alone does not take them back.
        conv.modelLabels = { ...conv.modelLabels, ...o.modelLabels };
      }
      if (o.currentModel) conv.modelId = o.currentModel;
      return o.currentModel || null;
    }
    return null;
  };
  // The set is verified: an answer that names another current model than the one set says the agent kept that one.
  // The session's model is then the agent's word, the turn's record says so, and the turn names it as the model that
  // answers where its agent's messages name none (bridge.js `answeringModel`) — with the agent's own word that it is
  // not on the model asked for (`facts.modelKept`), which says so whatever the two names are.
  const verified = (set, now) => {
    if (!now || String(now).toLowerCase() === String(set).toLowerCase()) return;
    notes.push(`acp: the agent answered the set of model ${set} with ${now} as its current model, and is kept on it`);
    conv.modelId = now;
    if (facts) facts.modelKept = true;
  };
  const paramsNow = () =>
    conv.paramOptions ??
    (conv.effortOptions?.length
      ? [
          {
            id: conv.effortConfigId || "effort",
            values: conv.effortOptions,
            current: conv.effort ?? null,
            category: "thought_level",
          },
        ]
      : []);
  // A reopened session's word for its model proves nothing (`conv.modelUnproven`, sessions.js `resumedConversation`):
  // Claude Code resumes a session on its default where it cannot restore the model the session ran on, and its
  // adapter still names that model as the current one (claude-agent-acp 0.93 session-model.js: no set on a resume) —
  // the owner's of 11-17, a follow-up to a sub-agent launched on Fable answered by Opus. Its model is set once more,
  // which the adapter takes as a repair: one set, the first turn after each reopen, tried once whether it is taken or
  // not (a reply from another model is said then, answering-model.js).
  const setAgain = (/** @type {string} */ m) => `acp: model ${m} set again: the session reopened, and its word for its model is not proof it runs on it`;
  let variant =
    conv.modelConfig && switchable
      ? planVariant(modelId, effort, { models: conv.availableModels, params: paramsNow(), labels: conv.modelLabels })
      : null;
  if (variant) {
    /** One option of the variant, said as what it sets: its effort, or the model. @param {string} configId @param {string} value */
    const setOpt = async (configId, value) => {
      say(configId === variant?.effortParam ? { step: "effort", to: String(value) } : { step: "model", to: modelId });
      return absorb(await ask("session/set_config_option", { sessionId: conv.sessionId, configId, value }));
    };
    const applied = [];
    try {
      if (variant.base !== conv.modelId || conv.modelUnproven) {
        const again = variant.base === conv.modelId;
        // Tried once a reopen, taken or not: one refused is not asked again at every turn.
        delete conv.modelUnproven;
        const now = await setOpt(conv.modelConfigId || "model", variant.base);
        if (again) notes.push(setAgain(variant.base));
        conv.modelId = variant.base;
        verified(variant.base, now);
        variant =
          planVariant(modelId, effort, { models: conv.availableModels, params: paramsNow(), labels: conv.modelLabels }) ||
          variant;
      } // the option set changes with the model
      for (const [pid, val] of variant.set) {
        const p = paramsNow().find((x) => x.id === pid);
        if (!p) continue;
        if (String(p.current) !== String(val)) {
          if (!p.values.includes(val)) {
            notes.push(`acp: ${pid} ${val} not offered (has ${p.values.join("/")})`);
            continue;
          }
          await setOpt(pid, val);
        }
        applied.push([pid, val]);
      }
      const label = (k, v) =>
        /^(true|false)$/i.test(v) ? `${k} ${/^true$/i.test(v) ? "on" : "off"}` : `${k} ${v}`;
      notes.push(
        `acp: model ${variant.base}${applied.length ? ` (${applied.map(([k, v]) => label(k, v)).join(", ")})` : ""}`,
      );
      if (variant.unknown.length)
        pushNote(notes, structured, { kind: "model-name-ignored", ignored: variant.unknown });
      effortHandled = true;
      if (effort && !applied.some(([k]) => k === variant.effortParam))
        pushNote(notes, structured, {
          kind: "effort-not-applied",
          effort,
          reason: variant.effortParam
            ? `${variant.base} offers ${paramsNow()
                .find((x) => x.id === variant.effortParam)
                ?.values.join("/")}`
            : `${variant.base} has no effort setting`,
        });
      const eff = paramsNow().find((x) => x.id === variant.effortParam);
      if (eff) conv.effort = eff.current;
    } catch (e) {
      stopped(e);
      notes.push(`acp: model ${variant.base} not applied (${e.message})`);
    }
  } else if ((modelSelection(acp) === "session" || conv.modelConfig) && switchable) {
    // A name typed on the upstream's card is taken exactly or not at all (HarnessV4_Tasks E9): its closest match would
    // run another model under the name. A name nobody typed — a catalogue's `claude-sonnet-5` — finds the agent's own.
    // Typed, whatever effort Filament left on the id (`typedName`): the id whole where the agent offers it — one whose
    // own ids end in an effort —, else the name as the card holds it, which the note names too.
    const card = typedName(modelId, typed);
    const isTyped = card != null;
    // A model from the account's API key, named as the key lists it: one the agent does not take is said as a typed
    // name's is.
    const fromKey = isTyped ? null : typedName(modelId, keyed);
    const offeredAs = (/** @type {string} */ name) => conv.availableModels.find((x) => String(x).toLowerCase() === name.toLowerCase());
    const target = !conv.availableModels?.length
      ? modelId
      : isTyped
        ? offeredAs(String(modelId)) || offeredAs(card) || null
        : matchOffered(modelId, conv.availableModels, conv.modelLabels);
    if (!target)
      pushNote(notes, structured, {
        kind: "model-not-offered",
        model: card ?? fromKey ?? modelId,
        offers: conv.availableModels.slice(0, 8),
        keeping: conv.modelId || "default",
        ...(isTyped ? { typed: true } : fromKey ? { keyed: true } : {}),
      });
    // A reopened session's model is set again (`setAgain`).
    else if (target !== conv.modelId || conv.modelUnproven) {
      const from = conv.modelId || "default";
      const again = target === conv.modelId;
      delete conv.modelUnproven;
      try {
        say({ step: "model", to: target });
        let now = null;
        if (conv.modelConfig) {
          now = absorb(await ask("session/set_config_option", { sessionId: conv.sessionId, configId: conv.modelConfigId || "model", value: target }));
        } // the option set can change with the model (Haiku has no effort levels)
        else {
          try {
            await ask("session/set_model", { sessionId: conv.sessionId, modelId: target });
          } catch (e) {
            if (!/method not found/i.test(e.message)) throw e;
            await ask("session/set_config_option", { sessionId: conv.sessionId, configId: "model", value: target });
            conv.modelConfig = true;
            conv.modelConfigId = "model";
          }
        } // an agent that offers no model option: session/set_model, or the option where that method is unknown
        notes.push(
          again
            ? setAgain(target)
            : `acp: model ${from} -> ${target}${target !== (card ?? modelId) ? ` (closest match for ${modelId})` : ""}`,
        );
        conv.modelId = target;
        verified(target, now);
      } catch (e) {
        stopped(e);
        notes.push(`acp: model ${target} not applied (${e.message})`);
      }
    } else notes.push(`acp: model ${target}`);
  } else if (modelId) notes.push(`acp: model ${modelId}`);
  // Effort as a session config option (Claude Code adapter offers low … max); otherwise it lives in the model id.
  if (effort && !effortHandled) {
    if (conv.effortOptions?.length) {
      const tgt = matchOffered(effort, conv.effortOptions);
      if (!tgt) notes.push(`acp: effort ${effort} not offered (agent has ${conv.effortOptions.join("/")})`);
      else if (tgt !== conv.effort) {
        try {
          say({ step: "effort", to: tgt });
          await ask("session/set_config_option", { sessionId: conv.sessionId, configId: conv.effortConfigId || "effort", value: tgt });
          notes.push(`acp: effort ${conv.effort || "default"} -> ${tgt}`);
          conv.effort = tgt;
        } catch (e) {
          stopped(e);
          notes.push(`acp: effort ${tgt} not applied (${e.message})`);
        }
      } else notes.push(`acp: effort ${tgt}`);
    } else if (!("effortOptions" in conv) && !acp.effortTemplate) {
      // a conversation whose offer is not known (restored from the state file, its agent offering none on load):
      // try the option once
      try {
        say({ step: "effort", to: String(effort).toLowerCase() });
        await ask("session/set_config_option", { sessionId: conv.sessionId, configId: "effort", value: String(effort).toLowerCase() });
        conv.effortOptions = ["default", "low", "medium", "high", "xhigh", "max"];
        conv.effortConfigId = "effort";
        conv.effort = String(effort).toLowerCase();
        notes.push(`acp: effort -> ${conv.effort}`);
      } catch (e) {
        stopped(e);
        conv.effortOptions = [];
        pushNote(notes, structured, {
          kind: "effort-not-applied",
          effort,
          reason: `this agent has no effort setting (${e.message.slice(0, 80)})`,
        });
      }
    } else if (!acp.effortTemplate)
      pushNote(notes, structured, {
        kind: "effort-not-applied",
        effort,
        reason: conv.modelConfig
          ? `${conv.modelId || "this model"} offers no effort levels`
          : "this agent has no effort setting; choose it by model name or set acp.effortTemplate",
      });
  }
}
