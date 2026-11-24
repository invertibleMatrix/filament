// @ts-check
// The composer: the glass shell, the mode switch, the model picker, the tuning chip, attachments, the queue and
// the slash/mention panels — and under the box, the session strip with Session. The send key is General's Send with:
// Enter, or Ctrl+Enter; while a run is live it steers, or queues where A message while the agent works says to wait,
// and with Enter sending, Ctrl+Enter vetoes. Stopping is the Stop button only — Esc is never a stop (one slip of a key
// must not kill a run). The controls are views of the session's settings: a change writes at once through
// `cb.onSettingChange` — a model or a tuning choice moves several knobs and goes as one change through
// `cb.onSettingsWrite` (HarnessV3 §15 item 92) — or, for a chat with no session yet, is held for the create call.
//
// The widgets are not the composer's (HarnessV3 Step 4 D8): it offers two slots — `bar`, in the typing row beside the
// model, and `strip`, under the box beside Session — and the app mounts the widget layout into them. What the
// composer owns for them is its live figures (`live()`): the reply's record and usage, the streamed output and the
// typed estimate, which the Context widget reads; `cb.onLive` says when they moved — and `cb.onModel`, the model
// chosen, which the Account instrument follows. Over the box it says the plan's notice the app hands it
// (HarnessV3-ACP AC3-6).
import { h } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { store } from "../../lib/store.js";
import { saveDraft, saveDraftFiles, state } from "../state.js";
import { ICONS } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { createModeSwitch } from "./mode.js";
import { createModelSelect, shownName } from "./model.js";
import { createEffortControl, splitEffortLane, lastTuning } from "./effort.js";
import { locate, tuningOf, planWrite, planReset, heldFlat, fitLevel, memberFor, familyName, prettyModel } from "../lib/families.js";
import { createAttachments } from "./attachments.js";
import { foldToFit } from "./bar-fit.js";
import { createQueue, queuedText, queuedFiles, queuedOverrules, queuedAnswer, queuedVia } from "./queue.js";
import { createSlashPanel } from "./slash.js";
import { createRichBox } from "./rich-box.js";
import { createAskLine } from "./ask-line.js";
import { createOverruleLine, withOverruled } from "./overrule-line.js";
import { addressed, askDraft, leadingTags, unknownTagsPast } from "../lib/agent-cards.js";
import { BTW_USAGE, btwOf } from "../lib/side.js";
import { CRAFT_USAGE, craftOf } from "../lib/craft.js";
import { sourceWords, sourceOfKnob, agentTakesWords, compactionCardOf, possessive, steerForkOf } from "../lib/labels.js";
import { awayKeys, putAway } from "../../lib/accounts.js";
import { prefs } from "../prefs.js";
import { comboOf, composerKeys } from "../shortcuts.js";
import { WORDS } from "../lib/words.js";

/** Filament's own at-commands (docs/COMMANDS.md): a draft that starts with one is never held as a mistyped agent. */
const OWN_AT_WORDS = new Set(["mem"]);
/** How close two presses of Esc in an empty box are to count as one Esc Esc (the rewind's list). */
const ESC_TWICE_MS = 600;
/** What the line over the box says of a session nothing is known of yet. @type {import("./ask-line.js").AskFacts} */
const NO_ASK_FACTS = Object.freeze({ defaultModel: "", tokens: null, running: false, runningTokens: 0, limit: null, refusedPictures: () => false, families: [] });

/** What the bar over the box says on a view-only device's page (the owner's remote Filament of 11-06, p4-view-ui). */
export const VIEW_ONLY_WORDS = "This device is view-only: it reads this Filament and sends nothing";
/** The box's words there. */
const VIEW_ONLY_PLACEHOLDER = "View-only — this device reads the chat and sends nothing";

/** A tuning that asks for nothing: Auto, the standard speed and window, no thinking. */
const NO_TUNING = Object.freeze({ effort: null, speed: "standard", thinking: "off", window: 0 });

/**
 * @param {HTMLElement} host
 * @param {{ onSend: (text: string, attachments: any[], modifier: "normal" | "veto", o?: { queued?: boolean, overrules?: import("./overrule-line.js").Overruling[], sendAsIs?: boolean, carry?: string, modeSwitch?: boolean, via?: import("./queue.js").SendVia }) => (boolean | "queue" | void | Promise<boolean | "queue" | void>), whyRefused?: () => { said: string, again: boolean }, onStop: () => void, onForceStop?: () => void, getChat: () => any, onToast?: (msg: string) => void, onOpenOverview?: () => void,
 *   onSettingChange?: (path: string, value: any | null) => void, onSettingsWrite?: (change: { patch?: any, unset?: string[] }) => void, onLive?: () => void, onHeldChange?: () => void, onTakeOver?: () => void,
 *   onForgetRule?: (rule: import("./mode.js").RuleRow) => void, onModel?: (name: string) => void,
 *   onPlanDetails?: () => void,
 *   agentCards?: () => import("../lib/agent-cards.js").AgentCard[], askFacts?: () => import("./ask-line.js").AskFacts,
 *   teams?: () => { key: string, name: string, line?: string }[], onBrief?: (team: string | null, ask?: string, typed?: string) => void, canBrief?: () => boolean, whyNoBrief?: () => string | null,
 *   onAsk?: (ask: { tags: string[], question: string, changes: string | null, files: any[] }) => (boolean | string | void | Promise<boolean | string | void>),
 *   isFile?: (word: string) => Promise<boolean>, onAskDraft?: (on: boolean) => void,
 *   onSide?: (ask: { question: string, files: any[] }) => (boolean | void | Promise<boolean | void>),
 *   onCompactionCard?: (card: { message: string, files: any[] }) => (boolean | void | Promise<boolean | void>),
 *   onCraft?: (craft: { words: string }) => (boolean | void | Promise<boolean | void>),
 *   onRewind?: () => void, onWelcome?: () => void, toBox?: () => void }} cb
 *   A draft that starts with saved agents' tags is theirs (HarnessV4_Tasks E15 step 2): `agentCards` are your agents,
 *   `askFacts` what the line over the box says of the session, `onAsk` the send — false puts the draft back, a text
 *   is what is left to ask — `isFile` whether a first `@word` that names no agent names a file of the project, and
 *   `onAskDraft` hears when a draft becomes the agents' and when it stops being theirs. A message may overrule what
 *   saved agents answered the main agent (step 3): the shown chat keeps whose answers (`overruling`, set by a card's
 *   Overrule), the line over the box says so, and the send carries them (`overrules`). `onSide`: a draft that is
 *   `/btw <question>` (step 5, BW-16) is asked on the side — false puts the draft back. The models its agents run on are
 *   the Agents tab's, never the model picker's (the owner's plan of 11-05: three places at most). `onCompactionCard`: a
 *   draft that is `/compaction`, with or without a message after it, brings up the compaction card holding that
 *   message (the owner's words of 10-18) — false puts the draft back. `toBox`: the box is about to take words or the
 *   keys — focused, added to, a message taken back into it, turned to an answer — so the app brings it on screen
 *   where a view hides it (a pane on top, the owner's word of 10-24).
 */
export function createComposer(host, cb) {
  let live = false;
  /** The live run takes steers (a loop run; a plain streaming reply does not). */
  let steerable = false;
  /** The live turn's run reads the pictures a message sent into it carries (its meta's `steerImages`). */
  let liveReadsPictures = false;
  /** The live turn's run is known (its kind came with it). */
  let runKnown = false;
  /** The live turn is followed from elsewhere and the server holds no run of it to follow (HarnessV4_Tasks U4): nothing
   *  takes a note, so what is typed waits in the queue for the turn's end. */
  let unfollowed = false;
  /** General's A message while the agent works is Wait for the turn's end, and a turn runs: the box's own send queues
   *  (HarnessV4_Settings_Plan HS-D72). */
  const waitsForEnd = () => live && prefs.get("whileWorking") === "wait";
  /** The live turn is a coding agent's: what is typed goes into its running turn where its agent takes words there
   *  (HarnessV3-ACP AC3-1), held until its run is known. */
  let agentTurn = false;
  /** The agent's run said it takes no words mid-turn: what is typed waits in the queue for the turn's end. */
  let agentQueues = false;
  /** The agent queues what is typed, as Claude Code does (HarnessV3-FailurePoints §7.2): the words wait at the agent,
   *  go in at its next step or run next when its turn ends first — nothing it is doing is cut. */
  let agentQueued = false;
  /** A note can interrupt the agent instead (FP-D8): Interrupt and send, in the menu — never what Enter does. */
  let agentInterrupts = false;
  /** The agent whose turn of its own a message waits behind (HarnessV3-ACP AC3-9). @type {string | null} */
  let ownAgent = null;
  /** Another tab writes the session: this one follows it until the person types here (decision 22; the owner's of 11-14). */
  let readOnly = false;
  /** The page is a view-only device's (the owner's remote Filament of 11-06): it reads the chat and sends nothing. */
  let viewOnly = false;
  /** A team's lead answers this session (HarnessV3-Views VW-D8): what is typed goes to it. */
  let lead = false;
  /** Its team's name, for the box's words (team_v2_plan §10 O4); "" names none. */
  let leadName = "";
  const theLead = () => (leadName ? `${possessive(leadName)} lead` : "the lead");
  /** The box's own send waits for the turn's end (`waitsForEnd`). */
  const holdsForEnd = () => waitsForEnd();

  const mode = createModeSwitch({
    onChange: (id) => cb.onSettingChange?.("loop.permissions", id),
    onUseDefault: () => cb.onSettingChange?.("loop.permissions", null),
    onForget: (rule) => cb.onForgetRule?.(rule),
  });
  const model = createModelSelect({
    onPick: (f) => pickFamily(f),
    onUseDefault: () => { markModel(); cb.onSettingChange?.("model.name", null); },
  });
  const effort = createEffortControl({
    onTune: (want, changed) => { const f = effort.family(); if (f) writeTuning(f, want, changed); },
    onReset: () => resetTuning(),
  });
  // What the box's message may carry is what Filament takes in one request, as the page read it with the config.
  const atts = createAttachments({ onChange: () => refresh(), onReject: (msg) => cb.onToast?.(msg) }, { most: () => Number(state.config?.server?.maxBodyBytes) || 0 });
  /** The teams a message may start by naming them: those its Brief could send. */
  const briefable = () => (cb.onBrief && (cb.canBrief?.() ?? true) && cb.teams?.()) || [];
  // Whom the draft is for, over the box: a draft that starts with a saved agent's tag is that agent's, one that
  // starts with a team's name the team's (U13-D13).
  const ask = createAskLine({
    cards: () => cb.agentCards?.() || [],
    facts: () => cb.askFacts?.() || NO_ASK_FACTS,
    teams: briefable,
    // Past its start a message names a team for the main agent to use, whether or not a Brief could open here.
    uses: () => cb.teams?.() || [],
    whyNoBrief: () => cb.whyNoBrief?.() || null,
    // A held draft's unknown word becomes the agent picked.
    onPick: (word, tag) => {
      ta.value = ta.value.replace(new RegExp(`@${word}(?![A-Za-z0-9-])`), `@${tag}`);
      ta.focus();
      refresh();
    },
    onChoice: () => ta.focus(),
  });
  // Whose answers the next message overrules, over the box (HarnessV4_Tasks E15 step 3, AG-47): the shown chat's.
  /** @returns {import("./overrule-line.js").Overruling[]} */
  const overruling = () => cb.getChat()?.overruling || [];
  /** @param {import("./overrule-line.js").Overruling[]} list */
  const setOverruling = (list) => {
    const c = cb.getChat();
    if (!c) return;
    c.overruling = list;
    over.paint();
    if (!stopBtn.disabled) paintSendWords();
  };
  const over = createOverruleLine({ list: overruling, onClear: () => { setOverruling([]); ta.focus(); } });
  /**
   * The overrule a message to the main agent carries, taken off the box as it goes. A command's turn is Filament's own
   * and overrules nothing: the line stays for the message after it.
   * @param {string} text
   */
  const takeOverruling = (text) => {
    const list = overruling();
    if (!list.length || text.startsWith("/")) return [];
    setOverruling([]);
    return list;
  };
  /** The draft is the agents' now, as the app was last told. */
  let asking = false;
  const paintAsk = () => {
    ask.paint(ta.value, atts.list());
    over.paint();
    const on = !!cb.onAsk && ask.read(ta.value, []).to.length > 0;
    if (on === asking) return;
    asking = on;
    // A draft that became saved agents' is not for the main agent: it overrules nothing.
    if (on && overruling().length) setOverruling([]);
    // What Enter does changed; a stop on its way keeps its own words under the box.
    if (!stopBtn.disabled) paintSendWords();
    cb.onAskDraft?.(on);
  };
  /**
   * Where an `@` typed after `before` stands: at the start, among the leading tags, where a tag addresses saved agents
   * (`agents`); later in a message to the main agent, where a tag names an agent or a team for the main agent to use
   * (`use`, HarnessV4_OneAgent_Plan OA2); neither in a command, in a message that is the agents' own, or with no agents.
   * @param {string} before @returns {{ agents: boolean, use: boolean }}
   */
  const tagPlace = (before) => {
    if (!cb.onAsk) return { agents: false, use: false };
    if (leadingTags(before).question === "") return { agents: true, use: false };
    const draft = before.trimStart();
    return { agents: false, use: !draft.startsWith("/") && !addressed(draft, cb.agentCards?.() || [], briefable()).to.length };
  };
  /** The `@` panel's places for a trigger typed after `before`. @param {string} trigger @param {string} before */
  const atPlace = (trigger, before) => (trigger === "@" ? tagPlace(before) : { agents: false, use: false });

  // The live figures the Context widget reads (Step 4 D9): the reply's record and usage once it lands, the newest
  // turn's facts, the streamed output folded in while a reply streams, and the typed estimate before any of those;
  // whether the session's model is a coding agent's (HarnessV3-ACP AC3-5), and how fast the model writes (AH-S1).
  /** @type {import("../widgets/registry.js").LiveFigures} */
  const figures = { rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false, liveHeld: 0, liveOutBase: 0, liveWindow: null, liveExact: true, agent: false, speed: null, call: null, usedAt: null };
  /** @param {Partial<import("../widgets/registry.js").LiveFigures>} part */
  const setFigures = (part) => {
    Object.assign(figures, part);
    cb.onLive?.();
  };

  /** @type {any[]} */
  let modelRows = [];
  /** The picked model is a coding agent's: its turns run no loop of Filament's, so nothing steers them. */
  let modelIsAgent = false;
  /** A stored model name that carries an effort suffix, split against this page's catalogue. @param {string} name */
  const effortLane = (name) => splitEffortLane(name, (id) => modelRows.some((r) => r.id === id), families);
  /** @type {any[]} the server's model families (the catalogue's `families`, core/model-families.js) */
  let families = [];
  /** The session view's settings as last painted; null for a chat with no session yet (it holds its choices). @type {any} */
  let viewSettings = null;
  /** The session's effective model section — null before a session, or while its document is still loading. */
  const effModel = () => (viewSettings?.effective ? viewSettings.effective.model || {} : null);
  /** The knob paths the session's own layer holds. */
  const ownPaths = () => new Set(Object.entries(viewSettings?.sources || {}).filter(([, v]) => v === "session").map(([k]) => k));
  /** The chat whose own truth the tuning control was last painted from (its document, or a new chat's held tuning). */
  let facesOf = /** @type {any} */ (null);
  const currentChat = () => cb.getChat?.() ?? null;

  /**
   * The model in force, located among the families, with the tuning it runs with: the session's settings — or, for a
   * new chat, the person's last tuning fitted to this model. Undefined while a session's document is loading (the
   * faces stay as painted); null for a model no family knows (the chip has nothing to offer).
   */
  const tuningNow = () => {
    const name = shownName(model.name().trim());
    const at = name ? locate(families, name) : null;
    if (!at) return null;
    const f = at.family;
    if (viewSettings) {
      const eff = effModel();
      if (!eff) return undefined;
      const lane = effortLane(String(eff.name || ""));
      return { at, tuning: tuningOf(at, { effort: eff.effort || lane?.effort || null, fast: eff.fast === true, flex: eff.flex === true, window: Number(eff.window) || null, thinkingBudget: Number(eff.thinking?.budget) || null }) };
    }
    const last = lastTuning();
    return {
      at,
      tuning: tuningOf(at, {
        effort: f.effort?.via === "setting" ? fitLevel(f.effort.levels, last.effort) : null,
        fast: last.speed === "fast" && f.speed?.via === "setting",
        flex: last.speed === "flex" && f.speed?.via === "setting",
        window: f.window?.via === "setting" && f.window.options.includes(last.window) ? last.window : null,
        thinkingBudget: last.thinking === "on" && f.thinking?.via === "setting" ? 16000 : null,
      }),
    };
  };
  const repaintTuning = () => {
    const now = tuningNow();
    if (now === undefined) return;
    effort.setFamily(now ? now.at.family : null, now ? now.tuning : null);
  };

  /**
   * A tuning (or a model) chosen: a session writes the name and every setting that moves as one change; a new chat
   * holds them — the name on the chip, the tuning in the control — for the create call.
   * @param {any} f @param {import("../lib/families.js").Tuning} want @param {keyof import("../lib/families.js").Tuning | null} changed
   */
  const writeTuning = (f, want, changed) => {
    if (!viewSettings || !cb.onSettingsWrite) {
      const member = memberFor(f, want, changed);
      if (member.id !== shownName(model.name().trim())) { model.set(member.id); markModel(); cb.onSettingChange?.("model.name", member.id); }
      repaintTuning();
      cb.onHeldChange?.();
      return;
    }
    // The session's document may still be loading: then the choice is written whole, pruned against nothing.
    const eff = effModel() || {};
    const plan = planWrite(f, want, { changed, eff: { ...eff, name: eff.name || model.name().trim() }, thinkingBudget: Number(eff.thinking?.budget) || undefined });
    if (!plan.patch) return;
    if (plan.patch.model.name) { model.set(plan.patch.model.name); markModel(); }
    cb.onSettingsWrite({ patch: plan.patch });
  };
  /** A model picked: the tuning in force carries over where the new model takes it (a level fitted to its levels).
   *  While the session's document loads, the painted tuning carries — none while nothing is painted, so the pick
   *  names the model only. @param {any} f */
  const pickFamily = (f) => {
    const now = tuningNow();
    const before = now ? now.tuning : now === null ? lastTuning() : effort.family() ? effort.tuning() : NO_TUNING;
    writeTuning(f, {
      effort: f.effort ? fitLevel(f.effort.levels, before.effort) : null,
      speed: f.speed?.options?.includes(before.speed) ? before.speed : "standard",
      thinking: f.thinking ? before.thinking : "off",
      window: f.window?.options?.includes(before.window) ? before.window : 0,
    }, null);
  };
  /** "Use the defaults": the session's own tuning unset, a family of variant ids back on its plain member. */
  const resetTuning = () => {
    const f = effort.family();
    if (!f) return;
    if (!viewSettings || !cb.onSettingsWrite) {
      const plan = planReset(f, { eff: { name: model.name().trim() } });
      if (plan.name !== shownName(model.name().trim())) { model.set(plan.name); markModel(); cb.onSettingChange?.("model.name", plan.name); }
      repaintTuning();
      cb.onHeldChange?.();
      return;
    }
    const eff = effModel() || {};
    const plan = planReset(f, { eff: { ...eff, name: eff.name || model.name().trim() }, own: ownPaths() });
    if (!plan.patch && !plan.unset.length) { repaintTuning(); return; }
    if (plan.patch?.model?.name) { model.set(plan.patch.model.name); markModel(); }
    cb.onSettingsWrite({ ...(plan.patch ? { patch: plan.patch } : {}), unset: plan.unset });
  };
  /** The model name last marked, and whether it was a coding agent's then. */
  let markedName = "";
  let markedAgent = false;
  // Whether the picked model is a coding agent's: its row in the catalogue says so, or — for a name the list does not
  // carry (an alias, a name typed or set by a command) — the session's own view, the server's answer for the model in
  // force (`engine.coder`, HarnessV3-ACP AC3-5). The window is the server's, with the session's settings (Step 4 D4) —
  // the model list is never asked for one.
  const markModel = () => {
    const raw = model.name().trim();
    const inForce = String(viewSettings?.effective?.model?.name || "");
    const coder = !!viewSettings?.engine?.coder && !!inForce && (effortLane(inForce)?.base || inForce) === raw;
    modelIsAgent = coder || modelRows.some((m) => m.id === raw && m.codingAgent);
    // The meter reads an agent's session as the agent counts it (HarnessV3-ACP AC3-5).
    if (figures.agent !== modelIsAgent) setFigures({ agent: modelIsAgent });
    // Whose plan the next turn spends follows the model (HarnessV3-ACP AC3-6): said once per change of the model, or of
    // whether it is a coding agent's — the catalogue or the session's view can say that after the name.
    if (raw !== markedName || modelIsAgent !== markedAgent) {
      markedName = raw;
      markedAgent = modelIsAgent;
      cb.onModel?.(raw);
    }
    if (!live) paintPlaceholder();
  };

  /** The placeholder follows the model, the live state, who answers and what waits for an answer. */
  const paintPlaceholder = () => {
    ta.placeholder = viewOnly
      ? VIEW_ONLY_PLACEHOLDER
      : live
        ? agentQueues && ownAgent ? `${ownAgent} is working on its own — what you send now goes out when it's done`
          : agentQueues ? "A coding agent is working — what you send now goes out when it ends"
          // Wait for the turn's end (HS-D72) holds a message on every engine, a steerable run's too.
          : waitsForEnd() ? "A turn is running — what you send now goes out when it ends"
          // A team in charge is named (team_v2_plan §10 O4): "Tell Builders's lead". The send key's row, Send at its next
          // step, in its own words (the owner's of 11-09): whatever an agent's run does with a note, it reads it then.
          : steerable ? (lead ? `Tell ${theLead()} — it reads your words at its next step` : "A turn is running — what you send now is read at its next step")
          : agentTurn && runKnown ? `The ${lead ? "lead" : "agent"} is working — what you send now is read at its next step`
          : unfollowed ? "A turn is running — what you send now goes out when it ends"
          : agentTurn ? "The agent is starting — what you send now is held until it's up"
          : "The turn is starting — what you send now reaches its run as soon as it starts"
        : lead ? `Tell ${theLead()}`
        : cb.getChat()?.turns?.length ? "Ask for follow-up changes" : "Ask Filament anything, @ to ask an agent or add context, / for commands, $ for skills";
  };

  // The box itself: read and written as a textarea is, a chat tagged in it drawn as the chat's link (rich-box.js).
  const ta = createRichBox({ placeholder: "Ask Filament anything, @ to ask an agent or add context, / for commands, $ for skills" });

  const slash = createSlashPanel({
    onInsert: (text, o) => {
      const at = ta.selectionStart ?? ta.value.length;
      const upTo = ta.value.slice(0, at);
      const token = /[/@$#][^\s]*$/.exec(upTo);
      const from = token ? at - token[0].length : at;
      const after = ta.value.slice(at);
      // A space already after the word stands for the one a tag brings: one space between, the caret after it.
      const spaced = text.endsWith(" ") && /^\s/.test(after);
      let value = ta.value.slice(0, from) + (spaced ? text.slice(0, -1) : text) + after;
      // A past chat is tagged where it was typed; where the chat's model has no memory tools to load it, it rides as a
      // visible first line (`@mem load <id>`) instead, pasted in at Send — never a hidden attachment.
      if (o?.prefixLine && !value.split("\n").includes(o.prefixLine)) value = `${o.prefixLine}\n${value.replace(/^\n+/, "")}`;
      ta.value = value;
      // The caret stands after what went in, where the words typed go on — a folder's files are typed after it.
      const caret = value.length - after.length + (spaced ? 1 : 0);
      ta.setSelectionRange(caret, caret);
      ta.focus();
      refresh();
    },
    onToast: cb.onToast,
    getChain: () => cb.getChat()?.chainId || "",
    getFolder: () => cb.getChat()?.cwd || "",
    getCards: () => cb.agentCards?.() || [],
    // Memory's tools for this chat's model (memory on, its tools on): a tagged chat is then loaded by them where needed.
    memoryTools: () => {
      const m = cb.getChat()?.view?.settings?.effective?.memory;
      return !m || (m.enabled !== false && m.tools !== false);
    },
    // The teams, where a tag would address an agent: a pick opens the team's Brief and sends nothing (team_v2_plan §10 O5).
    getTeams: briefable,
    onBrief: (team) => cb.onBrief?.(team),
    // A coding agent's chat offers the agent's own commands, read by its newest run (AC1-6).
    getAgentRun: () => (modelIsAgent ? [...(cb.getChat()?.turns || [])].reverse().find((/** @type {any} */ t) => t.runId)?.runId || null : null),
    onActive: (id) => { if (id) ta.setAttribute("aria-activedescendant", id); else ta.removeAttribute("aria-activedescendant"); },
    // The / list's Change the model… opens this box's picker on the words typed, and the focus comes back to the box.
    onOpenModel: (query) => model.open(query, { onClose: () => ta.focus() }),
    modelMatches: (query) => model.matches(query),
    modelKey: () => comboOf("model"),
  });

  /** Open a panel from the `+` menu: the trigger character lands at the caret and the panel opens on it. @param {string} trigger */
  const openPanel = (trigger) => {
    const at = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, at);
    const sep = before && !/\s$/.test(before) ? " " : "";
    ta.value = `${before}${sep}${trigger}${ta.value.slice(at)}`;
    ta.selectionStart = ta.selectionEnd = at + sep.length + 1;
    ta.focus();
    refresh();
    slash.open(trigger, "", atPlace(trigger, before));
  };
  /** Ask a saved agent, from the `+` menu: the `@` lands at the draft's start and the panel opens on your agents. */
  const openAsk = () => {
    const d = askDraft(ta.value, ask.read(ta.value, []).to.length > 0);
    ta.value = d.value;
    ta.selectionStart = ta.selectionEnd = d.caret;
    ta.focus();
    refresh();
    slash.open("@", "", { agents: true });
  };

  const queue = createQueue({
    onSteer: (it) => {
      // A row's Steer the send does not take (the session is another tab's, the turn takes no words after all) goes
      // back first: a row that left the queue is never lost (HarnessV4_Tasks U4). While a turn runs it is the queue
      // panel's own row, by a click (`via`, the owner's of 11-09); between turns it is no mid-turn send.
      Promise.resolve(cb.onSend(queuedText(it), [], "normal", { queued: true, overrules: queuedOverrules(it), ...queuedAnswer(it), ...(live ? { via: { row: "queue-next-step", by: /** @type {const} */ ("click") } } : {}) })).then((ok) => {
        if (ok !== false && ok !== "queue") return;
        queue.putBack(it);
        paintQueue();
      });
    },
    // The box becomes the message: its words, its files and what it overrules.
    onEdit: (it) => {
      ta.value = queuedText(it);
      atts.restore(queuedFiles(it));
      if (queuedOverrules(it).length) setOverruling(queuedOverrules(it));
      ta.focus();
      refresh();
    },
    onContinue: () => drain(),
  });
  // One queued message per run end; the run it starts drains the next when it ends. A stop or an error pauses
  // the drain until Continue. A message the page refuses (another tab writes the session, no model to answer, the
  // chat's own turn still running) goes back first: the drain never loses one. And the queue then waits, paused, with
  // the send's own reason (HarnessV4_Tasks U4): no turn runs whose end would send it, and the send's toast has passed.
  const drain = () => {
    if (live || queue.paused()) return;
    const next = queue.shift();
    if (!next) return;
    Promise.resolve(cb.onSend(queuedText(next), queuedFiles(next), "normal", { queued: true, overrules: queuedOverrules(next), ...queuedAnswer(next), ...queuedVia(next) })).then(
      (ok) => {
        // "queue": a turn runs after all, and takes no words — the message waits for its end, as the send said.
        if (ok === "queue") queue.putBack(next);
        else if (ok === false) {
          const why = cb.whyRefused?.();
          queue.refused(next, why?.said || "", why?.again ?? true);
        } else return;
        paintQueue();
      },
      // A send that threw: the message waits in the queue, paused, with why.
      (e) => {
        queue.refused(next, `It did not go: ${String(e?.message || e).slice(0, 200)}`, true);
        paintQueue();
      },
    );
  };

  const autosize = () => { ta.style.height = "0"; ta.style.height = Math.min(220, ta.scrollHeight + 2) + "px"; };

  const refresh = () => {
    autosize();
    // A panel over a word the box no longer holds at the caret — the box emptied by a send, set by the page — closes:
    // Enter then sends or makes its line, never picks a row of it (the Hunter's of 10-28).
    if (!/(?:^|\s)[/@#$][^\s]*$/.test(ta.value.slice(0, ta.selectionStart ?? ta.value.length))) slash.close();
    const c = cb.getChat();
    if (c) {
      saveDraft(c, ta.value);
      saveDraftFiles(c, atts.list());
    }
    const chars = c
      ? c.turns.reduce((n, t) => n + (t.userText || "").length + t.blocks.reduce((m, b) => m + (b.text || "").length, 0), 0) + ta.value.length
      : ta.value.length;
    setFigures({ estimate: fmt.tokens(chars) });
    paintQueue();
    paintAsk();
    sendBtn.classList.toggle("idle", !(ta.value.trim() || atts.list().length));
  };

  /** The queue's face stays honest wherever the queue moves — sends, stops, pauses, edits inside the panel. */
  const paintQueue = () => {
    queuePill.classList.toggle("hidden", !queue.size());
    queuePill.textContent = queue.size() ? `${queue.size()} queued${queue.paused() ? " · paused" : ""}` : "";
  };

  /**
   * A message back in the box, before what the box holds by then — another message given back, words typed since: its
   * words (with none of its own, the box's are left untouched), its files before the box's, and the saved agents'
   * answers it overruled on the line over the box, beside any overruled since.
   * @param {string} text @param {any[]} files @param {readonly import("./overrule-line.js").Overruling[]} overrules
   */
  const backInBox = (text, files, overrules) => {
    if (text) {
      const had = ta.value.replace(/^\s+/, "");
      ta.value = had ? `${text}\n\n${had}` : text;
    }
    atts.restore([...files, ...atts.list()]);
    if (overrules.length) setOverruling(overrules.reduce((list, o) => withOverruled(list, o), overruling()));
    slash.close();
    refresh();
  };

  /**
   * @param {any} modifier  normal, veto or interrupt @param {boolean} [asWritten]  the draft goes to the main agent whatever it starts with
   * @param {boolean} [own]  the box's own send (its key, its button), which follows A message while the agent works; a
   *   ⌄ menu item does what it says
   * @param {"key" | "click"} [by]  pressed with a key (the send key, the veto key) or clicked (the button, a row of the
   *   ⌄ menu): said with the row it goes by while a turn runs (`via`, the owner's of 11-09)
   */
  const send = (modifier, asWritten = false, own = false, by = "click") => {
    if (viewOnly) return;
    const text = ta.value.trim();
    const files = atts.list();
    if ((!text && !files.length) || !cb.getChat()) return;
    // Attachments that together pass what Filament takes in one request are refused here, in words, whatever way the
    // message would go: the server would refuse it whole.
    const over = atts.over();
    if (over) return void cb.onToast?.(over);
    // `/btw <question>` (HarnessV4_Tasks E15 step 5, BW-16): a side question. Like the agents' message it never joins
    // the session's own send, its queue or the running turn: the main agent hears nothing of it.
    const onSide = asWritten ? null : cb.onSide || null;
    const side = onSide ? btwOf(text) : null;
    if (onSide && side != null) {
      if (!side) return void cb.onToast?.(BTW_USAGE);
      ta.value = "";
      atts.clear();
      refresh();
      const c = cb.getChat();
      if (c) saveDraft(c, "");
      Promise.resolve(onSide({ question: side, files })).then((ok) => {
        if (ok !== false) return;
        backInBox(text, files, []);
      });
      return;
    }
    // `/compaction` (the owner's words of 10-18): the compaction card, brought up now, holding the message after the
    // word and the files with it. Nothing goes to the session until the card is answered.
    const card = asWritten || !cb.onCompactionCard ? null : compactionCardOf(text);
    if (card != null) {
      ta.value = "";
      atts.clear();
      refresh();
      const c = cb.getChat();
      if (c) saveDraft(c, "");
      Promise.resolve(cb.onCompactionCard?.({ message: card, files })).then((ok) => {
        if (ok !== false) return;
        backInBox(text, files, []);
      });
      return;
    }
    // `/rewind` (the Designer's rewind in place of 10-27): the list of your messages to go back to; nothing moves until
    // its confirm is pressed.
    if (!asWritten && cb.onRewind && /^\/rewind\s*$/i.test(text.trim())) {
      ta.value = "";
      refresh();
      const c = cb.getChat();
      if (c) saveDraft(c, "");
      cb.onRewind();
      return;
    }
    // `/welcome` (the owner's FTUE of 11-05): the welcome tour, at the step it was left on; nothing is sent.
    if (!asWritten && cb.onWelcome && /^\/welcome\s*$/i.test(text.trim())) {
      ta.value = "";
      refresh();
      const c = cb.getChat();
      if (c) saveDraft(c, "");
      cb.onWelcome();
      return;
    }
    // `/craft <words>` (the owner's word of 10-27): a crafter chat of its own opens, and this one carries on.
    const craft = asWritten || !cb.onCraft ? null : craftOf(text);
    if (craft != null) {
      if (!craft) return void cb.onToast?.(CRAFT_USAGE);
      ta.value = "";
      refresh();
      const c = cb.getChat();
      if (c) saveDraft(c, "");
      Promise.resolve(cb.onCraft?.({ words: craft })).then((ok) => {
        if (ok !== false) return;
        backInBox(text, [], []);
      });
      return;
    }
    if (!asWritten && cb.onAsk) {
      const who = ask.read(text, files);
      // A draft that opens with a team's name (U13-D13): its Brief opens, filled with the rest, and its Send starts
      // the team. The draft stays in the box until the team starts — a Brief closed loses nothing.
      if (who.team) {
        cb.onBrief?.(who.team.team.key, who.team.ask, text);
        return;
      }
      // The agents' message: it never joins the session's own send, its queue or the running turn (L-94).
      if (who.to.length) {
        if (who.stop) {
          ask.press(text);
          paintAsk();
          return;
        }
        ta.value = "";
        atts.clear();
        refresh();
        const c = cb.getChat();
        if (c) saveDraft(c, "");
        Promise.resolve(cb.onAsk({ tags: who.to.map((card) => card.tag), question: who.question, changes: who.changes, files, ...(who.models ? { models: who.models } : {}) })).then((back) => {
          if (back !== false && typeof back !== "string") return;
          backInBox(back === false ? text : back, files, []);
        });
        return;
      }
      // A first `@word` that names no agent (AG-4), or `@words` past the start that name no agent and no team
      // (HarnessV4_OneAgent_Plan OA-D11, L4: "@qa" where no QA exists): Filament's own at-command and a file of the
      // project go on as written; the first of the rest is held once, and Enter again sends it as written.
      const first = who.unknown[0];
      const words = (first ? [first] : unknownTagsPast(text, cb.agentCards?.() || [], cb.teams?.() || [])).filter((w) => !OWN_AT_WORDS.has(w.toLowerCase()));
      if (words.length && !ask.passes(text)) {
        Promise.all(words.map((w) => Promise.resolve(cb.isFile ? cb.isFile(w) : false).catch(() => false))).then((files) => {
          if (ta.value.trim() !== text) return;
          const word = words.find((_, i) => !files[i]);
          if (!word) return send(modifier, true, own, by);
          ask.hold(text, word, { later: !first });
          paintAsk();
        });
        return;
      }
    }
    // A message to weigh aside first (the ⌄ menu's Weigh aside first, `/steer-fork`) is for the running turn: never
    // held for its end, nor queued with its files, where no turn would be left to weigh it beside.
    const weighs = modifier === "fork" || (!asWritten && steerForkOf(text) != null);
    // Wait for the turn's end: the message joins the chat's queue, whole, and goes when the turn ends. A message to an
    // agent and /btw went at once above: neither joins the turn (HS-D72).
    if (own && modifier === "normal" && !weighs && holdsForEnd()) return toQueue(by);
    // While a turn runs, the row it goes by and how it was pressed (the owner's of 11-09): the steer says it to the run,
    // and the turn a message queued here starts says it in its head, so the ways people send mid-turn can be counted.
    // The veto key vetoes only Filament's loop: an agent's turn takes what it sends as a note, at its next step (the page's
    // `kind`), and that is the row it says.
    /** @type {import("./queue.js").SendVia | null} */
    const via = live ? { row: weighs ? "aside" : modifier === "veto" && !agentTurn ? "veto" : modifier === "interrupt" ? "interrupt" : agentQueues || unfollowed ? "when-done" : "next-step", by } : null;
    // A steer carries words, and pictures where the turn's run says it reads them (`liveReadsPictures`): a message
    // with any other file, or into a run that reads none, waits in the queue, whole, and goes when the turn ends — one
    // to weigh aside stays in the box. A team's result is words (team_v2_plan §10 O3): it goes in with them.
    const plain = files.filter((f) => f.kind !== "team");
    const unsteered = live && plain.length && !(liveReadsPictures && plain.every((f) => f.kind === "image"));
    if (unsteered && weighs) return void cb.onToast?.("A message weighed aside takes words, and pictures where the turn reads them: send its other files once the turn ends");
    const overrules = takeOverruling(text);
    ta.value = "";
    atts.clear();
    refresh();
    const c = cb.getChat();
    if (c) saveDraft(c, "");
    if (unsteered) {
      queue.push(asQueued(text, files, overrules, via));
      paintQueue();
      cb.onToast?.("Queued with its files — it goes when this turn ends");
      return;
    }
    Promise.resolve(cb.onSend(text, files, modifier, { overrules, ...(via ? { via } : {}) })).then(
      (ok) => {
        // Refused: back in the box, before what it holds by then — another message refused, words typed since.
        if (ok === false) backInBox(text, files, overrules);
        // Nothing can steer this turn (a coding agent's): the message waits in the queue for its end, whole — its
        // pictures and a team's result with it (found by the Bug Hunter, 10-19: only the result was kept).
        else if (ok === "queue") {
          queue.push(asQueued(text, files, overrules, via));
          paintQueue();
        }
      },
      // A send that threw: nothing says it went, and the box had let its words go.
      (e) => {
        backInBox(text, files, overrules);
        cb.onToast?.(`Your message did not go: ${String(e?.message || e).slice(0, 200)}. It is back in the box`);
      },
    );
  };

  ta.addEventListener("input", (e) => {
    // Typed here while another window writes the session: the person is here, and it follows them (setReadOnly).
    if (readOnly && !viewOnly && e.isTrusted) cb.onTakeOver?.();
    refresh();
    const at = ta.selectionStart ?? ta.value.length;
    const upTo = ta.value.slice(0, at);
    const token = /(?:^|\s)([/@#$])([^\s]*)$/.exec(upTo);
    if (token) slash.open(token[1], token[2], atPlace(token[1], upTo.slice(0, token.index)));
    else slash.close();
  });
  // Paste a screenshot straight from the clipboard: the image becomes an attachment, any text in the same paste
  // still lands in the textarea — the textarea's own paste puts it there, so a paste that carries words is left to it
  // (a web page's selection, Word's). Only when there is an image — a plain-text paste is left to the textarea.
  ta.addEventListener("paste", (e) => {
    // A view-only device's box takes nothing in (p4-view-ui).
    if (viewOnly) return;
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f) => !!f)
      .map((f, i) => {
        // A pasted screenshot has no real name ("image.png"); give it one the attachment list can tell apart.
        const named = f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${Date.now()}-${i + 1}.png`, { type: f.type || "image/png" });
        return named;
      });
    if (!files.length) return;
    if (!e.clipboardData?.getData("text/plain").trim()) e.preventDefault();
    atts.add(files);
  });
  ta.addEventListener("keydown", (e) => {
    // An input method's Enter ends its word (Chinese, Japanese): it never sends, nor picks in a panel (HC-117).
    if (e.isComposing || e.keyCode === 229) return;
    if (slash.isOpen()) {
      if (e.key === "ArrowDown") { e.preventDefault(); slash.move(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); slash.move(-1); return; }
      if (e.key === "Enter" && slash.choose()) { e.preventDefault(); return; }
      if (e.key === "Escape") { e.preventDefault(); slash.close(); return; }
    }
    // Send with (HarnessV4_Settings_Plan HS-D70): Enter sends and Ctrl+Enter (⌘+Enter) vetoes; or Ctrl+Enter sends,
    // Enter makes the new line and Veto this round has no key (HS-D71).
    if (e.key === "Enter" && !e.shiftKey) {
      const keys = composerKeys();
      const combo = e.ctrlKey || e.metaKey ? "Ctrl+Enter" : "Enter";
      const how = combo === keys["composer-send"] ? "normal" : combo === keys["composer-veto"] ? "veto" : null;
      if (how) { e.preventDefault(); send(how, false, true, "key"); }
    }
    // Esc never stops a live run — the Stop button is the only stop. Esc twice in an empty box: the list of your
    // messages to rewind to, as in Claude Code (the Designer's §1). A view-only device's page rewinds nothing.
    if (e.key === "Escape" && !ta.value && cb.onRewind && !viewOnly) {
      const now = Date.now();
      if (now - lastEsc < ESC_TWICE_MS) {
        lastEsc = 0;
        e.preventDefault();
        cb.onRewind();
      } else lastEsc = now;
    }
  });
  /** When Esc was last pressed in the empty box. */
  let lastEsc = 0;

  const sendBtn = h("button", { class: "send idle", type: "button", title: "Send", "aria-label": "Send", html: ICONS.arrowUp });
  const stopBtn = h("button", { class: "stop hidden", type: "button", title: "Stop", "aria-label": "Stop", html: ICONS.square });
  // Offered when a stop has not ended the turn after a few seconds (HarnessV3-FixRound F2 item 13): the turn ends now.
  const forceBtn = h("button", { class: "force-stop hidden", type: "button", title: "End the turn now, without waiting for the loop's next step — what finished stays" }, "Force stop");
  // While a run is live the send slot becomes the follow-up modifier (§5.5.3): the main action does what the send key
  // does; the chevron offers every way the message can go while the turn runs.
  const modBtn = h("button", { class: "send-mod hidden", type: "button", title: "Follow-up and stop options", "aria-label": "Follow-up and stop options", html: ICONS.chevronDown });
  /**
   * A message as the queue keeps it: its files, what it overrules and the row it was sent by beside its words, when it
   * has any; its words alone, for most.
   * @param {string} text @param {any[]} files @param {import("./overrule-line.js").Overruling[]} overrules
   * @param {import("./queue.js").SendVia | null} [via]
   */
  const asQueued = (text, files, overrules, via = null) => (files.length || overrules.length || via ? { text, files, ...(overrules.length ? { overrules } : {}), ...(via ? { via } : {}) } : text);
  /** The box's message as the queue keeps it, sent by `via`; null when the box is empty. @param {import("./queue.js").SendVia} via */
  const boxMessage = (via) => {
    const text = ta.value.trim();
    const files = atts.list();
    if (!text && !files.length) return null;
    return asQueued(text, files, takeOverruling(text), via);
  };
  /** Send when it's done: the message waits in the queue for the turn's end. @param {"key" | "click"} [by] */
  const toQueue = (by = "click") => {
    const it = boxMessage({ row: "when-done", by });
    if (!it) return;
    queue.push(it);
    ta.value = "";
    atts.clear();
    refresh();
  };
  // Stop and send stops the turn: the words go as a turn of their own.
  const sendNow = () => {
    const it = boxMessage({ row: "stop-and-send", by: "click" });
    if (!it) return;
    queue.sendNow(it);
    ta.value = "";
    atts.clear();
    refresh();
    cb.onStop();
  };
  sendBtn.onclick = () => send("normal", false, true);
  stopBtn.onclick = () => cb.onStop();
  forceBtn.onclick = () => cb.onForceStop?.();
  // The ways a message goes while the turn runs (the owner's of 11-09, option B): the same three rows on every agent that
  // takes a message mid-turn, whatever its run does with one — Send at its next step; Interrupt and send where the agent
  // can be interrupted, Stop and send everywhere else; Send when it's done — and on a turn that takes none, its two. Each
  // says only what Filament makes sure of: what an agent's own adapter does once it is cut short is the adapter's. What
  // is left of a face waits under More ways…, which opens in place. Stop and compact is about the turn, not the typed
  // message: the Context popover has it.
  /** @param {boolean} more  More ways… was pressed: its rows stand in its place */
  const openMenu = (more) => {
    // The keys as Send with sets them, each on the item it does: with Wait for the turn's end the send key queues.
    const keys = composerKeys();
    const holds = holdsForEnd();
    /** The send key's mark, on the item it does. @param {boolean} on */
    const sendKey = (on) => (on ? { kbd: keys["composer-send"] } : {});
    const takesNone = agentQueues || unfollowed;
    const nextStep = {
      label: "Send at its next step",
      ...sendKey(!holds),
      // Before its run is known the message is held for it (HarnessV3-CodebasePass decision 2), and an agent's run may
      // then say it takes no message mid-turn: the words say both.
      desc: runKnown
        ? "It reads this once its current step is done; nothing is cut short."
        : agentTurn
        ? "Held until the agent is up, then it reads this once its current step is done — or after this turn, where it takes no message mid-turn. Nothing is cut short."
        : "Held until the turn's run starts, then it reads this once its current step is done. Nothing is cut short.",
      onClick: () => send("normal"),
    };
    // Never what a key does (HarnessV3-FailurePoints FP-D8): it cuts short what the agent is doing.
    const interrupt = { label: "Interrupt and send", desc: "Cuts short what it's doing and gives it this now, in the same turn.", onClick: () => send("interrupt") };
    const stopAndSend = { label: "Stop and send", desc: "Stops the turn, then sends this as a new turn.", onClick: sendNow };
    const whenDone = {
      label: "Send when it's done",
      ...sendKey(takesNone || holds),
      desc: `Waits for the turn to end, then goes as your next message.${takesNone ? (agentQueues ? " This agent takes no message mid-turn." : " Nothing here reaches this turn while it runs.") : ""}`,
      onClick: () => toQueue(),
    };
    // What waits under More ways…: Stop and send, where Interrupt and send stands in its row; the loop's veto, its key
    // kept, and the forked steer asked for one message (the owner's of 11-05: Enter steers straight unless the switch is on).
    const later = takesNone ? [] : agentInterrupts ? [stopAndSend] : agentTurn ? [] : [
      { label: "Veto this round", ...(keys["composer-veto"] ? { kbd: keys["composer-veto"] } : {}), onClick: () => send("veto") },
      { label: "Weigh aside first", desc: "A fork of the turn sorts it first: a question answered here, work planned as tasks — or type /steer-fork", onClick: () => send("fork") },
    ];
    // More ways… opens the same menu again where it stood, its rows in its place: a press on a row closes the menu first.
    menu([
      ...(takesNone ? [whenDone, stopAndSend] : [nextStep, agentInterrupts ? interrupt : stopAndSend, whenDone]),
      ...(later.length ? [{ type: "separator" }, ...(more ? later : [{ label: "More ways…", onClick: () => openMenu(true) }])] : []),
    ], { anchor: modBtn, side: "top", align: "end", width: 256 });
  };
  modBtn.onclick = (e) => {
    e.stopPropagation();
    openMenu(false);
  };

  const hintEl = h("span", { class: "composer-hint muted" });
  // The queue's face in the bar: how many messages wait for the run to end (the panel above the textarea
  // holds them). Informational — a span, not a control that promises something it does not do.
  const queuePill = h("span", { class: "queue-pill hidden" });

  // --- the session strip under the box (Facade D8/D9) ---
  // The session's own controls live on a quiet line under the composer, out of the typing row: Overview opens the
  // chat's Overview (proposal_ux §3.6: the inspector's sliders became its icon), and the strip's widgets follow it. It
  // does not draw before the session exists (D9, FC 15): a new chat's settings are chosen on the Start board. The
  // widgets say for themselves when they have nothing to be about (`visible`).
  const sessionMain = h("button", {
    class: "strip-btn session-main hidden",
    type: "button",
    title: "Overview: everything about this chat — what it is doing, what it has used, and how it is set up",
    onclick: () => cb.onOpenOverview?.(),
  }, h("span", { class: "strip-ic", html: ICONS.layoutDashboard }), h("span", { class: "session-main-label" }, "Overview"));

  // The widget slots (Step 4 D8): the app mounts the layout's widgets into them — the strip's left holds how Filament
  // treats the conversation, its right (`meters`) what the conversation costs.
  const barSlot = h("span", { class: "widget-slot slot-bar" });
  const stripSlot = h("span", { class: "widget-slot slot-strip" });
  const metersSlot = h("span", { class: "widget-slot slot-meters" });
  // The chat's status capsule (conversation/status-panel.js): first in the strip, under the box the eye is on — in the
  // header it was easy to miss (the owner's word of 10-29). The app mounts it.
  const statusSlot = h("span", { class: "slot-status" });
  // Where the chat works — its branch, its worktree — and the branch's `+N −N`, after Overview's button: the header
  // reads them (header.js `place`), and up there they were easy to miss too (the owner's of 10-30). The app mounts them.
  const placeSlot = h("span", { class: "slot-place" });

  /** The controls' faces from the session view (D6): each shows the value in force and its source's words. */
  const setSessionView = (view, hasSession = true) => {
    sessionMain.classList.toggle("hidden", !hasSession);
    const s = view?.settings || {};
    viewSettings = hasSession ? s : null;
    if (!hasSession) {
      if (!live) paintPlaceholder();
      effort.setNote("the new chat");
      mode.setRules([]);
      repaintTuning();
      facesOf = currentChat();
      return;
    }
    // The document has not landed (the read failed, or the birth write is still in flight): keep whatever faces
    // are painted — blanking them would say "no model" about a fetch. The tuning control is the exception when what
    // it shows is another chat's (a switch, a reload): a pick in this window carries the painted tuning, and would
    // write that chat's levels into this session — so it steps aside until this chat's document lands.
    if (!s.effective) {
      if (facesOf !== currentChat()) effort.setFamily(null, null);
      return;
    }
    const word = (path) => sourceWords(sourceOfKnob(path, s));
    const modelName = String(s.effective?.model?.name || "");
    const effortValue = String(s.effective?.model?.effort || "");
    // A stored name may carry the suffix (D6; `/set model.name` takes one): the display splits it, and the level
    // shows "from the model name" — unless a model.effort setting exists, which wins, as it does on the wire
    // (`withEffort`).
    const lane = modelName ? effortLane(modelName) : null;
    if (modelName) {
      model.set(lane ? lane.base : modelName);
      model.setNote(word("model.name"));
    } else {
      // No model.name of the session's own (a session another client started): the chip keeps the model the
      // transcript says the session last used — an empty setting is not "no model".
      model.setNote("the model this session last used");
    }
    effort.setNote(!effortValue && lane ? "from the model name" : word("model.effort"));
    markModel();
    repaintTuning();
    facesOf = currentChat();
    const perm = String(s.effective?.loop?.permissions || "");
    if (perm) { mode.set(perm); mode.setNote(word("loop.permissions")); }
    mode.setRules(s.rulesInForce || []);
  };
  const HINT_KEY = "harness.hintsSeen";
  /**
   * A stop on its way (BUG-09): the Stop button stands down — disabled, its ring at rest — and the hint says so, until
   * the turn ends (setLive resets it). A second click used to be silently ignored under a still-spinning ring.
   * `compacts`: the stop is Stop and compact's, and the hint says what comes after it.
   * @param {boolean} on @param {boolean} [compacts]
   */
  const setStopping = (on, compacts = false) => {
    stopBtn.disabled = on;
    stopBtn.classList.toggle("stopping", on);
    stopBtn.title = on ? "Stopping…" : "Stop";
    stopBtn.setAttribute("aria-label", on ? "Stopping" : "Stop");
    if (on) hintEl.textContent = compacts ? "Stopping… — the session is compacted once the turn has ended" : "Stopping… — what finished stays";
    else offerForce(false);
  };
  /** The stop has not ended the turn yet: Force stop is offered beside the resting Stop button (F2 item 13).
   *  @param {boolean} on */
  const offerForce = (on) => {
    forceBtn.classList.toggle("hidden", !on);
    forceBtn.disabled = false;
    if (on) hintEl.textContent = "Still stopping — Force stop ends the turn now";
  };
  /**
   * The send button's title and the hint under the box: what Enter does now. A draft that is saved agents' goes to
   * them whatever the turn does (HarnessV4_Tasks E15), so neither promises to steer it.
   */
  function paintSendWords() {
    // A view-only device's page sends nothing: no words on what Enter does there.
    if (viewOnly) {
      hintEl.textContent = "";
      return;
    }
    const on = live;
    // The keys as General's Send with sets them; with Wait for the turn's end the send key queues (HS-D72).
    const keys = composerKeys();
    const key = keys["composer-send"];
    // The veto key vetoes the loop's turn, its run known or not yet — what it sends is held for the run (the hunt of
    // 11-09) —; an agent's turn takes it as a note, and a turn followed with no run to follow takes nothing.
    const veto = on && !agentTurn && !unfollowed && keys["composer-veto"] ? ` · ${keys["composer-veto"]} vetoes` : "";
    const holds = holdsForEnd() && !asking;
    // The row of the ⌄ menu the send key does (the owner's of 11-09), by its name — on the button and in the hint, with
    // the veto key where it vetoes.
    sendBtn.title = asking ? "Ask — the main agent hears nothing"
      : on
      ? agentQueues || unfollowed || holds ? "Send when it's done" : agentTurn && !runKnown ? "Send at its next step — held until the agent is up" : "Send at its next step"
      : "Send";
    const seen = Number(store.get(HINT_KEY) || 0);
    const waits = agentQueues || unfollowed || (agentTurn && (!runKnown || agentQueued));
    hintEl.textContent = on && asking ? `${key} asks · the running turn goes on · the Stop button stops`
      // Your overrule (HarnessV4_Tasks E15 step 3): where the main agent reads it.
      : overruling().length && !asking ? (on ? `${key} sends your overrule${holds ? " when it's done" : ` · ${waits ? "it waits for the agent's next step or this turn's end" : "the main agent reads it at its next step"}`} · the Stop button stops` : `${key} sends your overrule to the main agent`)
      : on
      ? holds || agentQueues || unfollowed ? `${key} sends when it's done${veto} · the Stop button stops`
        : steerable ? `${key} sends at its next step${veto} · the Stop button stops`
        : agentTurn ? (!runKnown ? `${key} sends at its next step, held until the agent is up · the Stop button stops` : `${key} sends at its next step · the Stop button stops`)
        // The loop's turn starting, its run not known yet: what Enter sends is held for it, as the ⌄ menu says.
        : `${key} sends at its next step, held until its run starts${veto} · the Stop button stops`
      : seen < 3 ? `${key} to send · ${keys["composer-newline"]} for a new line` : "";
  }
  /**
   * @param {boolean} on
   * @param {{ kind: string, steer?: string | null, own?: string | null, interrupts?: boolean, pictures?: boolean, unfollowed?: boolean } | null} [run]  the live
   *   turn's run, once known: its kind, what a coding agent's does with a note ("live": its agent takes it into its
   *   running turn, HarnessV3-ACP AC3-1; "next": at its next step, AC-D6; "queued": it waits in the agent's own
   *   queue for its next step, HarnessV3-FailurePoints §7.2), whether a note can interrupt it instead (FP-D8), and
   *   the agent, when the turn is one it began by itself (AC3-9)
   * @param {"done" | "stopped" | "error" | "paused" | "waiting"} [endedBy]  how the shown chat's turn ended; none when
   *   the face only follows the chat shown — a switch, which never sends
   */
  const setLive = (on, run = null, endedBy) => {
    live = on;
    mode.setLive(on);
    const runKind = run?.kind || null;
    runKnown = !!runKind;
    unfollowed = on && !runKnown && run?.unfollowed === true;
    agentTurn = on && (runKind === "coding-agent" || (!runKind && modelIsAgent));
    agentQueues = agentTurn && runKnown && !agentTakesWords(run?.steer);
    agentQueued = agentTurn && runKnown && run?.steer === "queued";
    agentInterrupts = agentTurn && runKnown && run?.interrupts === true;
    ownAgent = agentQueues ? run?.own || null : null;
    steerable = on && runKnown && !agentTurn;
    liveReadsPictures = on && runKnown && run?.pictures === true;
    setFigures({ streaming: on });
    stopBtn.classList.toggle("hidden", !on);
    setStopping(false); // a new state: whatever stop was on its way has landed
    modBtn.classList.toggle("hidden", !on);
    paintSendWords();
    paintPlaceholder();
    // While live the bright button would mean "steer" — Enter already does that, so the send steps back to a
    // ghost and the destructive stop stays the only loud thing on the bar.
    sendBtn.classList.toggle("live", on);
    queue.steers(!agentQueues && !unfollowed, on);
    if (!on && endedBy && queue.ended(endedBy)) drain();
    paintQueue();
  };
  // Send with, or A message while the agent works, changed in Settings: the box's words follow at once; a stop on its
  // way keeps its own.
  prefs.onChange((key) => {
    if (key !== "sendKey" && key !== "whileWorking") return;
    if (!stopBtn.disabled) paintSendWords();
    paintPlaceholder();
  });

  // A tab that follows its session (decision 22): a quiet line saying where it is open, this computer's other window or
  // another machine by its name. The writing follows the person (the owner's of 11-14): typing here takes it over (the
  // box's input, below), and so does a send or a press, so nothing stands down and there is no button to press.
  const roWords = h("span", { class: "ro-words" }, "Open in another window — type here to take it over");
  const readOnlyBar = h("div", { class: "read-only-bar hidden", role: "status" },
    h("span", { class: "ro-ic", html: ICONS.appWindow }),
    roWords);
  /** @param {boolean} on @param {string} [words] */
  const setReadOnly = (on, words) => {
    if (words) roWords.textContent = words;
    if (readOnly === on) return;
    readOnly = on;
    // A view-only device's page takes over nothing: its own bar says what it is (setViewOnly).
    readOnlyBar.classList.toggle("hidden", !on || viewOnly);
  };

  // A view-only device's page (the owner's remote Filament of 11-06, p4-view-ui): the bar says it reads and sends
  // nothing, the box takes no words, and nothing that acts is offered — Add context, the mode, the model and the effort,
  // Send and its menu, Stop — each a write the server refuses it. Hidden by their style, which the class
  // each toggles as the turn moves never brings back.
  const viewOnlyBar = h("div", { class: "read-only-bar view-only-bar hidden", role: "status" },
    h("span", { class: "ro-ic", html: ICONS.eye }),
    h("span", { class: "ro-words" }, VIEW_ONLY_WORDS));
  /** @param {boolean} on */
  const setViewOnly = (on) => {
    if (viewOnly === on) return;
    viewOnly = on;
    viewOnlyBar.classList.toggle("hidden", !on);
    readOnlyBar.classList.toggle("hidden", !readOnly || on);
    ta.setAttribute("contenteditable", on ? "false" : "true");
    ta.setAttribute("aria-readonly", on ? "true" : "false");
    for (const el of [addBtn, mode.el, model.el, effort.el, sendBtn, modBtn, forceBtn, stopBtn]) el.style.display = on ? "none" : "";
    paintPlaceholder();
    paintSendWords();
  };

  // The plan's notice (HarnessV3-ACP AC3-6): the chosen agent's fullest window four-fifths used, or spent — said over
  // the box once per window and period in this browser. Its ✕ puts it away until the window's next period (the
  // notice's key names both); Details opens the Account instrument.
  const PLAN_AWAY_KEY = "harness.planNoticesAway";
  /** @type {{ key: string, tone: "warn" | "error", text: string } | null} */
  let planNotice = null;
  /** The notices put away, oldest first. */
  const away = () => awayKeys(store.get(PLAN_AWAY_KEY));
  const planWords = h("span", { class: "plan-words" });
  const planBar = h("div", { class: "plan-bar hidden", role: "status" },
    h("span", { class: "plan-ic", html: ICONS.gauge }),
    planWords,
    h("button", { class: "plan-more", type: "button", title: "The account and its plan's windows", onclick: () => cb.onPlanDetails?.() }, "Details"),
    h("button", {
      class: "plan-x", type: "button", title: "Put this away until the window's next period", "aria-label": "Put the plan's notice away", html: ICONS.x,
      onclick: () => {
        if (!planNotice) return;
        store.set(PLAN_AWAY_KEY, JSON.stringify(putAway(away(), planNotice.key)));
        paintPlan();
      },
    }));
  const paintPlan = () => {
    const shown = !!planNotice && !away().includes(planNotice.key);
    planBar.classList.toggle("hidden", !shown);
    planBar.classList.toggle("is-error", shown && planNotice?.tone === "error");
    planWords.textContent = shown && planNotice ? planNotice.text : "";
  };

  // Drop files anywhere on the shell. A drag that moves onto a part of it (the box, a button) leaves the part it was over,
  // not the shell: the overlay goes once the drag leaves the shell itself.
  const shell = h("div", { class: "composer-shell" });
  // A view-only page takes no files: the drop is held from the browser, and nothing is offered or kept.
  shell.addEventListener("dragover", (e) => { e.preventDefault(); if (!viewOnly) atts.overlay.classList.remove("hidden"); });
  shell.addEventListener("dragleave", (e) => { if (!shell.contains(/** @type {Node | null} */ (e.relatedTarget))) atts.overlay.classList.add("hidden"); });
  shell.addEventListener("drop", (e) => { e.preventDefault(); atts.overlay.classList.add("hidden"); if (!viewOnly && e.dataTransfer?.files?.length) atts.add(e.dataTransfer.files); });

  // `+` Add context (§5.7): the three panels by their trigger, then the file input.
  const addBtn = h("button", { class: "ghost attach", type: "button", title: "Add context", "aria-label": "Add context", html: ICONS.plus });
  addBtn.onclick = (e) => {
    e.stopPropagation();
    menu([
      ...(cb.onAsk ? [{ label: "Ask an agent", icon: "atSign", tone: "var(--color-sys-purple)", kbd: "@", desc: "Its tag starts the message: it answers beside the chat, and the main agent hears nothing", onClick: openAsk }] : []),
      // A team starts from its Brief (team_v2_plan §10 O5): this opens it; its Send starts the team. A chat not yet
      // begun has none to brief: the Start picks who runs it.
      ...(cb.onBrief && (cb.canBrief?.() ?? true) ? [{ label: "Send a team…", icon: "users", tone: "var(--color-sys-yellow)", desc: "Opens its Brief — on the side or in charge; nothing starts until its Send", onClick: () => cb.onBrief?.(null) }] : []),
      ...(cb.onAsk || (cb.onBrief && (cb.canBrief?.() ?? true)) ? [{ type: "separator" }] : []),
      { type: "label", label: "Add to the message" },
      { label: "Files", icon: "fileText", tone: "var(--color-sys-blue)", kbd: "@", onClick: () => openPanel("@") },
      { label: WORDS.pastChats, icon: "hash", tone: "var(--color-sys-indigo)", kbd: "#", onClick: () => openPanel("#") },
      { label: "Commands", icon: "squareSlash", tone: "var(--color-sys-gray)", kbd: "/", onClick: () => openPanel("/") },
      { type: "separator" },
      { label: "Attach files…", icon: "paperclip", tone: "var(--color-sys-orange)", desc: "Images, PDFs and text, 20 MB each", onClick: () => atts.input.click() },
    ], { anchor: addBtn, side: "top", align: "start", width: 272 });
  };

  // The typing row: Add context and the mode on the left; the window, the model, the effort and the send
  // on the right. Everything about the session rides the strip below the box. Short of room, its pills fold to their
  // glyphs one by one (bar-fit.js).
  const bar = h("div", { class: "composer-bar" },
    addBtn,
    mode.el,
    h("span", { class: "grow" }),
    barSlot,
    model.el,
    effort.el,
    sendBtn,
    modBtn,
    forceBtn,
    stopBtn);
  shell.append(
    atts.overlay,
    viewOnlyBar,
    readOnlyBar,
    planBar,
    ask.el,
    over.el,
    queue.el,
    slash.el,
    atts.el,
    ta,
    bar,
    atts.input);
  foldToFit(bar);
  const strip = h("div", { class: "composer-strip" },
    statusSlot,
    h("span", { class: "session-extras" }, cb.onOpenOverview ? sessionMain : null, cb.onOpenOverview ? h("span", { class: "strip-sep" }) : null, placeSlot, stripSlot),
    h("span", { class: "grow" }),
    queuePill,
    hintEl,
    metersSlot);
  // What waits for the developer — the session's pause, a worker's question — stands over the box,
  // in whichever view shows (HarnessV3-Views V3); the app mounts the dock's decisions here.
  const asksSlot = h("div", { class: "composer-asks" });
  host.append(h("div", { class: "composer" }, asksSlot, shell, strip));

  return {
    setLive,
    meter: refresh,
    /** The widget slots the app mounts the layout into (Step 4 D8). */
    slots: { bar: barSlot, strip: stripSlot, meters: metersSlot },
    /** Where the dock's decisions stand, over the box. */
    asks: asksSlot,
    /** Where the chat's status capsule stands: first in the strip under the box. */
    status: statusSlot,
    /** Where the place chip and its branch's count stand: after Overview's button, before the widgets. */
    place: placeSlot,
    /** The live figures, as the Context widget reads them. */
    live: () => ({ ...figures }),
    /** The reply's record (and the reply's usage, the held figure); the real usage replaces the streamed estimate. @param {any} rec @param {any} [usage] */
    setRecord(rec, usage) { setFigures({ rec: rec || null, usage: usage || null, liveOut: 0, liveHeld: 0, liveOutBase: 0, liveWindow: null, liveExact: true }); },
    /** The newest turn's facts: the held figure once the turn's record has left the ring. @param {any} facts */
    setFacts(facts) { setFigures({ facts: facts || null, liveOut: 0, liveHeld: 0, liveOutBase: 0, liveWindow: null, liveExact: true }); },
    /** What the running turn holds now: what a round sends, by the loop's own measure (BUG-20), or a coding agent's own
     *  count as it works (HarnessV3-ACP AC3-5) — `window` the one it names, `exact` false for Filament's estimate. The
     *  output streamed when it came is the base (`base`, else the output so far): only what streams after it adds to
     *  the figure. @param {number} tokens @param {{ window?: number | null, exact?: boolean, base?: number }} [o] */
    setLiveHeld(tokens, o = {}) {
      setFigures({
        liveHeld: Math.max(0, Math.round(Number(tokens) || 0)),
        liveOutBase: o.base != null ? Math.max(0, Number(o.base) || 0) : figures.liveOut,
        liveWindow: Number(o.window) > 0 ? Number(o.window) : figures.liveWindow ?? null,
        liveExact: o.exact !== false,
      });
    },
    /** The streaming reply's output so far, in tokens, folded into the held estimate until the real usage lands. @param {number} tokens */
    setLiveOut(tokens) { setFigures({ liveOut: Math.max(0, Math.round(Number(tokens) || 0)) }); },
    /** The shown chat's newest model call its runs said (`round-cache`), the Cache instrument's last request; null where
     *  none was heard. Drawn again only when it moved. @param {import("../widgets/registry.js").LiveFigures["call"]} call */
    setCall(call) {
      if (figures.call !== (call || null)) setFigures({ call: call || null });
    },
    /** The shown chat's running turn's newest use of the cache: its start, else the newest moment its model wrote; null
     *  with no turn running. @param {number | null} at */
    setUsedAt(at) {
      const next = Number(at) > 0 ? Number(at) : null;
      if (figures.usedAt !== next) setFigures({ usedAt: next });
    },
    /** The speed gauge's figure (HarnessV3-AtHome AH-S1): the running reply's, read from its stream, else the last
     *  reply's average; null before any. Drawn again only when it moved.
     *  @param {import("../lib/speed.js").SpeedFigure | null} s */
    setSpeed(s) {
      const next = s || null;
      if (JSON.stringify(next) !== JSON.stringify(figures.speed)) setFigures({ speed: next });
    },
    /** The shown chat's queue (HarnessV3-Views V3): the panel draws it, and the drain sends from it alone.
     *  @param {import("./queue.js").QueueState} st */
    setQueue(st) {
      queue.bind(st);
      paintQueue();
    },
    /** Messages for after the running turn (held ones no run read): queued in order, sent as its end drains the queue.
     *  @param {(string | import("./queue.js").QueuedMessage)[]} texts */
    enqueue(texts) {
      queue.add(texts);
      paintQueue();
      if (!live && !queue.paused()) drain();
    },
    /** Notes the turn ended before its agent read them (app.js `unheardNext`): the next messages, whatever ends the
     *  turn, and the first at once where no turn runs (queue.js `queueUnheard`).
     *  @param {(string | import("./queue.js").QueuedMessage)[]} texts */
    enqueueUnheard(texts) {
      if (queue.unheard(texts, !live)) drain();
      paintQueue();
    },
    /** A message sent before those the queue holds — a waiting row's that gives way to the queue (app.js
     *  `armWaiting`): it goes first, ahead of what was sent while it waited. @param {string | import("./queue.js").QueuedMessage} it */
    enqueueFirst(it) {
      queue.putBack(it);
      paintQueue();
      if (!live && !queue.paused()) drain();
    },
    /** The queue goes on: its next message goes now, unless it is paused or a turn runs — what waited behind a message
     *  withdrawn from its waiting row (app.js `armWaiting`'s Cancel), whose turn's end would have sent it. */
    goOn() {
      drain();
    },
    /** A stop is on its way: the Stop button stands down until the turn ends (BUG-09); `compacts` when it is Stop and
     *  compact's. @param {boolean} on @param {boolean} [compacts] */
    setStopping(on, compacts = false) { setStopping(!!on, !!compacts); },
    /** Another tab writes the session (decision 22): the quiet line, in `words` — where it is open; typing here takes it over. @param {boolean} on @param {string} [words] */
    setReadOnly(on, words) { setReadOnly(!!on, words); },
    /** The page is a view-only device's (p4-view-ui): the box says it reads only and sends nothing, and offers nothing
     *  that acts. @param {boolean} on */
    setViewOnly(on) { setViewOnly(!!on); },
    /**
     * Who answers (HarnessV3-Views VW-D8): a team's lead takes the messages; the box's words say so, naming its team
     * (`name`, team_v2_plan §10 O4).
     * @param {{ lead: boolean, name?: string }} s
     */
    setTeam(s) {
      lead = !!s.lead;
      leadName = lead ? String(s.name || "") : "";
      paintPlaceholder();
    },
    /**
     * The team in charge changes no file (lib/team.js `readingTeam`): the chat only reads while it leads, whatever its
     * mode, and the mode chip says so — null while none does. `own`: the chat is that team's own.
     * @param {{ name: string, own?: boolean } | null} by
     */
    setReading(by) { mode.setReading(by); },
    /** Offer Force stop (or take the offer back): the stop sent a while ago has not ended the turn. @param {boolean} on */
    offerForce(on) { offerForce(!!on); },
    /** The shown chat's turn record settled how it ended (`turnSettled`, BUG-07's reconciliation): a stop the loop
     *  never read makes a done turn, and the queue that stop paused goes on. @param {string} status */
    settled(status) {
      if (live || !queue.settled(status)) return;
      paintQueue();
      drain();
    },
    /** @param {string} v */
    setModel(v) {
      const m = String(v || "");
      // A stored name that carries the suffix (D6): the display splits it, the effort shows the level with its
      // source "from the model name", and any choice writes the split form.
      const lane = effortLane(m);
      model.set(lane ? lane.base : m);
      effort.setNote(lane ? "from the model name" : null);
      markModel();
      repaintTuning();
    },
    /** The model a send or a create call names: the base name — the effort is the `model.effort` setting (D6). */
    modelName() {
      return model.name().trim();
    },
    /** The model as its chip names it ("Opus 5.5"): its family's name, else its id made readable; "" for none. */
    modelWords() {
      const f = model.family();
      return f ? familyName(f) : model.name().trim() ? prettyModel(shownName(model.name().trim())) : "";
    },
    /** The effort to join the create call's held choice (D6): "" = Auto, never a suffix — and never for a family
     *  whose ids carry the effort (the member's own name says it; a setting would re-suffix it). */
    effortValue() {
      return effort.family()?.effort?.via === "setting" ? effort.value() : "";
    },
    /** The rest of a new chat's held tuning, as the create call's flat settings: only what differs from the defaults. */
    heldSettings() {
      const now = tuningNow();
      return now ? heldFlat(now.at.family, now.tuning) : {};
    },
    permissionMode() {
      return mode.mode();
    },
    /** The mode the chip shows: the open session's, or what a new chat stands on, held but not picked. @param {string} id */
    setPermissionMode(id) { mode.set(id); },
    /** Whose mode the chip is showing (your defaults' standing), for its title. @param {string | null} note */
    setPermissionNote(note) { mode.setNote(note); },
    /** Whose effort the control is showing ("from the model name"), for its title. @param {string | null} note */
    setEffortNote(note) { effort.setNote(note); },
    /** The controls' faces from the session view (D6), and the pills' visibility before a session exists (D9). */
    setSessionView,
    /** @param {any[]} models */
    setModels(models) {
      modelRows = models.map((m) => (typeof m === "string" ? { id: m } : m));
      model.setModels(modelRows);
      markModel();
    },
    /** The coding agents' accounts (HarnessV3-ACP AC3-6): the picker's agents' tabs carry their plans. @param {import("../../lib/accounts.js").AgentRow[]} rows */
    setAccounts(rows) { model.setAccounts(rows); },
    /** The machines whose models this Filament keeps (model.js `machinesOf`): the picker's tab for each, listed or not yet. @param {ReturnType<typeof import("./model.js").machinesOf>} list */
    setMachines(list) { model.setMachines(list); },
    /** The plan's notice over the box, or none (`noticeOf` in lib/accounts.js): shown unless put away in this browser. @param {{ key: string, tone: "warn" | "error", text: string } | null} n */
    setPlanNotice(n) {
      planNotice = n;
      paintPlan();
    },
    /** The server's model families (the catalogue's `families`): the picker's rows and the tuning's offers. @param {any[]} list */
    setFamilies(list) {
      families = Array.isArray(list) ? list : [];
      model.setFamilies(families);
      repaintTuning();
    },
    /**
     * A card's Overrule (HarnessV4_Tasks E15 step 3): the shown chat's next message to the main agent overrules this
     * answer too. False where the draft is saved agents' — it is not for the main agent.
     * @param {import("./overrule-line.js").Overruling} o
     */
    overrule(o) {
      if (asking || !cb.getChat()) return false;
      setOverruling(withOverruled(overruling(), o));
      ta.focus();
      return true;
    },
    /** @param {string} text */
    fill(text) { ta.value = text; slash.close(); refresh(); ta.focus(); },
    /**
     * An attachment the page made (team_v2_plan §10 O3: a team's result, Send to your agent…): in the box beside what
     * it holds, the caret in the box for the person's words. Nothing is sent. @param {any} item
     */
    attach(item) {
      atts.put(item);
      refresh();
      ta.focus();
    },
    /**
     * Files the page hands the box (a board task's, sent to a chat: the owner's of 11-02), each taken as a dropped one
     * is — read, a picture drawn smaller where it must be, refused in words past what the box takes. Nothing is sent.
     * @param {File[]} files
     */
    attachFiles: (files) => atts.add(files),
    /**
     * Words a visual asked for, or its failure for the agent (HarnessV4_Visuals_Plan VS-D7, VS-D8): below what the box
     * holds, selected, so the person reads exactly what would be sent. Nothing is sent. @param {string} text
     */
    add(text) {
      cb.toBox?.();
      const had = ta.value.replace(/\s+$/, "");
      const from = had ? had.length + 2 : 0;
      ta.value = had ? `${had}\n\n${text}` : text;
      slash.close();
      refresh();
      ta.focus();
      ta.setSelectionRange(from, ta.value.length);
    },
    draft() { return ta.value; },
    /** The files in the box, as `draft()` is its words. */
    files() { return atts.list(); },
    /**
     * Another chat's draft, or words the page set: a panel opened over the last ones closes (the Hunter's of 10-28).
     * Another chat's box comes with its own files (`files`, state.js `draftFilesFor`): the files attached in one chat
     * never go with another's send. Without them, the files in the box stay.
     * @param {string} text @param {any[]} [files]
     */
    setDraft(text, files) { ta.value = text || ""; if (files) atts.handOver(files); slash.close(); refresh(); },
    /**
     * A message taken back from the running turn to change (HarnessV4_Tasks C34), or one a card stopped (its Not now):
     * its words and pictures in the box, before what the box held, the caret at the end of its words — with no words of
     * its own, the box's are left untouched —, and the saved agents' answers it overruled on the line over the box
     * again, beside any overruled since. Nothing is sent. Its turn is gone from the chat, so the box asks as the chat
     * is now: one it was the only message of, as a new chat's does (the drive of 11-01).
     * @param {string} text @param {any[]} [files] @param {readonly import("./overrule-line.js").Overruling[]} [overrules]
     */
    takeBack(text, files = [], overrules = []) {
      cb.toBox?.();
      backInBox(text, files, overrules);
      paintPlaceholder();
      ta.focus();
      if (text) ta.setSelectionRange(text.length, text.length);
    },
    focus() {
      cb.toBox?.();
      ta.focus();
    },
    /** The box itself: what holds the keys while the developer types a message (the dock's `dockKeys`). */
    box: ta,
    // A view-only device's page picks none of them: each writes the chat's settings.
    openModel() { if (!viewOnly) model.open(); },
    cycleMode() { if (!viewOnly) mode.cycle(); },
    openEffort() { if (!viewOnly) effort.open(); },
    /**
     * What Ctrl+K reads of the model and its tuning (the design pass of 10-24, UX7): the families to pick from, the one
     * in force, and the reasoning levels and windows it offers with those in force.
     */
    tuneFacts() {
      const f = effort.family();
      const t = effort.tuning();
      const name = shownName(model.name().trim());
      const at = name ? locate(families, name) : null;
      const std = Number(f?.window?.standard) || 0;
      return {
        model: at ? familyName(at.family) : name ? prettyModel(name) : "",
        modelId: at ? String(at.family.id) : "",
        families: families.map((x) => ({ id: String(x.id), name: familyName(x) })),
        effort: f?.effort ? { levels: [...(f.effort.levels || [])].map(String), now: t.effort || null, auto: f.effort.via === "setting" || !!f.effort.plain } : null,
        window: f?.window && (f.window.options || []).length > 1 ? { options: [...f.window.options].map(Number), now: t.window || std, standard: std } : null,
      };
    },
    /** A family picked from Ctrl+K, as the model chip picks it; false for one the catalogue no longer has. @param {string} id */
    pickFamilyById(id) {
      if (viewOnly) return false;
      const f = families.find((x) => String(x.id) === id);
      if (f) pickFamily(f);
      return !!f;
    },
    /** A reasoning level or a window chosen from Ctrl+K, as the tune popover chooses it. @param {"effort" | "window"} key @param {string | number | null} value */
    tune(key, value) { return viewOnly ? false : effort.pick(key, value); },
  };
}
