// @ts-check
// An agent's question in one shape (HarnessV3-ACP AC2-4). Each agent asks in its own terms: ACP's elicitation (a form,
// or a link to open), Cursor's questions and the plan it proposes, Codex's questions and its MCP servers' elicitations,
// and the plan an agent proposes through a permission (Claude's). Each is read here into one form, which the page draws
// and an outside client's question tool carries, and the person's answer is written back in the asking agent's terms.
// In a harness session the switch answers every other permission, and one it asks about is the loop's own question
// (HarnessV3-ACP AC3-2). Pure: no I/O.
import { headChars } from "../../core/text.js";

/**
 * @typedef {{ id: string, label: string, description: string, kind?: string }} AskChoice  `kind`: a permission's choice
 *   as its agent marks it (allow_once, allow_always, reject_once, reject_always): a plan's way on that keeps it
 *   planning takes the person's words for their next message
 * @typedef {{
 *   id: string, header: string, prompt: string, choices: AskChoice[], several: boolean,
 *   words: "" | "text" | "number" | "integer" | "secret", wants: "string" | "number" | "integer" | "boolean" | "array",
 *   other: string | null, required: boolean, preset: string[], presetWords: string,
 * }} AskQuestion  `id`: the agent's own (a form's field, Cursor's or Codex's id); `choices` empty when it takes words
 *   only; `several`: more than one may be chosen; `words`: what the person may write instead of choosing ("" nothing);
 *   `wants`: the value the agent reads back (a form's field type); `other`: the form's field that takes the words
 *   written beside this one's choices (Claude's "Other"); `preset`/`presetWords`: the form's defaults
 * @typedef {{ tool: string, command: string, reason: string, changes: import("../../core/types.js").FileChange[],
 *   changesLeft: number, offer: { itemId: number, tool: string, shape: string } | null, review?: string,
 *   look?: import("../../core/second-look.js").LookRef | null, always?: true,
 *   keeps?: { hand: "bash" | "powershell", folder: string, commands: string[] } }} JudgedAsk
 *   a permission the session's switch asks about (HarnessV3-ACP AC3-2), as the loop's permission card draws it: the
 *   loop's tool the request reads as, the command whole, why it asks apart from it, each file it changes as its diff
 *   and how many more past those (AC3's drive D5), and the project's always-allow waiting for the call's shape — or,
 *   where a review rule asks (HarnessV4_Space_Plan SG-D13), the rule and its second look; `always`: the agent offers
 *   only to always allow it; `keeps`: what "Always allow in this chat" would keep of the command, where the project
 *   offers no always-allow for it (d-allow, app/agent/chat-always.js)
 * @typedef {{
 *   kind: "question" | "plan" | "link" | "permission",
 *   from: "elicitation" | "cursor-question" | "cursor-plan" | "codex-question" | "agent-plan" | "switch",
 *   agent: string, title: string, detail: string, call: string | null, questions: AskQuestion[],
 *   plan: { name: string, overview: string, text: string, todos: { text: string, status: string }[] } | null,
 *   link: { url: string, id: string } | null, judged: JudgedAsk | null,
 * }} AskForm  `title`: the words over the questions; `detail`: more beside them — the MCP server that asks; `call`: the
 *   agent's tool call the question belongs to, where it names one; `questions`: a plan's, its agent's own ways on
 *   (`fromAgentPlan`), else none; `judged`: a permission the switch asks about, answered allow or deny (`fromJudged`)
 * @typedef {{ chosen: string[], words?: string }} AskReply  one question's answer: the choices' ids, the person's words
 * @typedef {{
 *   outcome: "answered" | "skipped" | "accepted" | "rejected" | "declined" | "cancelled" | "switched",
 *   answers?: Record<string, AskReply>, reason?: string,
 * }} AskAnswer  answered or skipped: a question; accepted or rejected (with its reason): a plan; accepted or
 *   declined: a link; answered: a permission, or a plan with its agent's own ways on, its option the one question's
 *   choice; cancelled: a stop, a hang-up, the run's end; switched: the session's switch moved while a permission it
 *   asks about waited, which is judged again (its `reason`, once the switch settles it, says how)
 */

/** Claude's adapter marks the field that takes the person's own words beside a question's choices with this key. */
const OTHER_KEY = "_askUserQuestionCustomAnswer";
/**
 * The end of that field's name, after its question's (`question_0` → `question_0_custom`): since 0.93.0 the adapter
 * marks the field for a JetBrains AIR client alone, so a form of Filament's is read by the field's place.
 */
const OTHER_SUFFIX = "_custom";
/** The longest title, question or choice kept, in characters. */
const MAX_WORDS = 2000;
/**
 * What a proposed plan keeps: its text, its to-dos and the words of each. It rides the run's `ask` event, which the
 * run log keeps whole only under 256 KB a line.
 */
const PLAN_KEPT = Object.freeze({ text: 60_000, todos: 100, todo: 300 });
/** The words a permission's choice kind says beside its label. */
const KIND_WORDS = Object.freeze({
  allow_once: "only this time",
  allow_always: "from now on",
  reject_once: "refuse it this time",
  reject_always: "refuse it from now on",
});
/** How each kind of form may end, as the person answers it. */
const OUTCOMES = Object.freeze({
  question: ["answered", "skipped"],
  plan: ["accepted", "rejected"],
  link: ["accepted", "declined"],
  permission: ["answered"],
});
/**
 * A yes to Claude's plan in a fresh context, in words: it starts over with only the plan, and how full its context is
 * now says what that saves.
 * @param {string} who @param {string} used  the percent of its context used now, as its adapter says it, or ""
 * @returns {[string, string]}
 */
const freshStart = (who, used) => ["Yes, in a fresh context", `${who} starts on it with only the plan in its context${used ? ` — ${used}% of it is used now` : ""}`];
/**
 * Claude's ways on from the plan it proposes (claude-agent-acp's `ExitPlanMode` options, HarnessV3-ACP AC3-3), by
 * option id, as the card says them and in the order it lists them. Its plain yes leaves plan mode for the mode in which
 * it asks; its yes in a fresh context starts it over with only the plan, in its own mode that decides by itself, which
 * Filament turns back to the asking one as it starts; its reject keeps it planning.
 * @type {Readonly<Record<string, { order: number, says: (who: string, used: string) => [string, string] }>>}
 */
const PLAN_WAYS = Object.freeze({
  "exit-plan-default": { order: 0, says: (who) => ["Yes, build it", `${who} leaves plan mode and starts on it`] },
  "exit-plan-clear-auto": { order: 1, says: freshStart },
  "exit-plan-clear-bypass": { order: 1, says: freshStart },
  "exit-plan-clear-accept-edits": { order: 1, says: freshStart },
  reject: { order: 3, says: (who) => ["No, keep planning", `${who} stays in plan mode: say what to change`] },
});
/**
 * Claude's yeses straight into its own modes that decide by themselves (auto, bypass permissions, accept edits): left
 * out where its plain yes is offered, as in a harness session the switch answers what it asks to do (AC3-2).
 */
const PLAN_UNASKED = Object.freeze(["exit-plan-auto", "exit-plan-bypass", "exit-plan-accept-edits"]);

/**
 * The words kept of a field: trimmed, and cut at `max` characters, never inside one.
 * @param {unknown} v @param {number} [max]
 */
const keep = (v, max = MAX_WORDS) => headChars(String(v ?? "").trim(), max);

/**
 * A question with nothing set: the readers fill what their agent gives.
 * @param {string} id @param {Partial<AskQuestion>} q @returns {AskQuestion}
 */
const question = (id, q) => ({ id, header: "", prompt: "", choices: [], several: false, words: "", wants: "string", other: null, required: false, preset: [], presetWords: "", ...q });

/**
 * A form with nothing set but its kind and who asks.
 * @param {AskForm["kind"]} kind @param {AskForm["from"]} from @param {Partial<AskForm>} f @returns {AskForm}
 */
const form = (kind, from, f) => ({ kind, from, agent: "", title: "", detail: "", call: null, questions: [], plan: null, link: null, judged: null, ...f });

/**
 * An enum's choices: titled (`oneOf` or `anyOf`, each a `const` with its `title` and `description`) or plain (`enum`,
 * labelled by the older `enumNames` where it has them).
 * @param {any} f @returns {AskChoice[]}
 */
function enumChoices(f) {
  const titled = Array.isArray(f?.oneOf) ? f.oneOf : Array.isArray(f?.anyOf) ? f.anyOf : null;
  if (titled)
    return titled
      .filter((/** @type {any} */ o) => o && o.const != null)
      .map((/** @type {any} */ o) => ({ id: String(o.const), label: keep(o.title ?? o.const), description: keep(o.description) }));
  if (Array.isArray(f?.enum))
    return f.enum.map((/** @type {any} */ v, /** @type {number} */ i) => ({
      id: String(v),
      label: keep(Array.isArray(f.enumNames) && f.enumNames[i] != null ? f.enumNames[i] : v),
      description: "",
    }));
  return [];
}

/**
 * One field of an elicitation's form as a question, or why the card can't draw it.
 * @param {string} key @param {any} f @param {boolean} required @param {string} lone  the form's words, for its only field
 * @returns {AskQuestion | string}
 */
function fieldQuestion(key, f, required, lone) {
  const type = String(f?.type || "");
  const base = { header: keep(f?.title), prompt: keep(f?.description || lone || f?.title || key), required };
  if (type === "boolean")
    return question(key, {
      ...base,
      wants: "boolean",
      choices: [{ id: "true", label: "Yes", description: "" }, { id: "false", label: "No", description: "" }],
      preset: typeof f.default === "boolean" ? [String(f.default)] : [],
    });
  if (type === "string") {
    const choices = enumChoices(f);
    if (choices.length) return question(key, { ...base, choices, preset: choices.some((c) => c.id === f.default) ? [String(f.default)] : [] });
    return question(key, { ...base, words: "text", presetWords: typeof f.default === "string" ? f.default : "" });
  }
  if (type === "number" || type === "integer")
    return question(key, { ...base, words: type, wants: type, presetWords: Number.isFinite(f.default) ? String(f.default) : "" });
  if (type === "array") {
    const choices = enumChoices(f.items);
    if (!choices.length) return `its field “${key}” is a list with nothing to choose from`;
    const preset = Array.isArray(f.default) ? f.default.map(String).filter((/** @type {string} */ v) => choices.some((c) => c.id === v)) : [];
    return question(key, { ...base, choices, several: true, wants: "array", preset });
  }
  return `its field “${key}” is of a kind the card doesn't draw (${type || "no type"})`;
}

/**
 * An elicitation as a form: ACP's `elicitation/create`, or one Codex relays from an MCP server, which share MCP's form
 * shape. A form is its fields as questions — a field Claude's adapter marks as the words written beside another
 * field's choices, or one it names for that field unmarked, joins that question as its "Other" — and a link is its
 * address. Returns why it can't be drawn
 * instead: a field of a kind the card doesn't draw, a mode it doesn't know, an address that isn't the web's.
 * @param {any} params @param {{ agent?: string }} [o] @returns {AskForm | string}
 */
export function fromElicitation(params, { agent = "" } = {}) {
  const mode = String(params?.mode || "");
  const title = keep(params?.message);
  const call = params?.toolCallId ? String(params.toolCallId) : null;
  if (mode === "url") {
    const url = String(params?.url || "");
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return `its link isn't a web address (${url.slice(0, 80) || "none"})`;
    return form("link", "elicitation", { agent, title, call, link: { url, id: String(params?.elicitationId || "") } });
  }
  // Codex relays OpenAI's own form modes too; their schema is MCP's where the card can read it.
  if (mode !== "form" && mode !== "openai/form" && mode !== "openaiForm") return `it asks in a way the card doesn't draw (${mode || "no mode"})`;
  const schema = params?.requestedSchema && typeof params.requestedSchema === "object" ? params.requestedSchema : {};
  const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  /** The words-only fields, by the question whose choices they stand beside. @type {Map<string, string>} */
  const others = new Map();
  for (const [k, f] of Object.entries(props)) {
    const m = f?._meta?.[OTHER_KEY];
    if (m?.isCustomAnswer && typeof m.questionId === "string" && m.questionId !== k && props[m.questionId]) others.set(m.questionId, k);
  }
  // Unmarked (the owner's of 10-30: it was a step of its own after Next): a field of words alone named for a field
  // beside it that has choices, `question_0_custom` beside `question_0`, as the adapter names them.
  const choosing = (/** @type {any} */ f) => enumChoices(f?.type === "array" ? f.items : f).length > 0;
  for (const [k, f] of Object.entries(props)) {
    const of = k.endsWith(OTHER_SUFFIX) ? k.slice(0, -OTHER_SUFFIX.length) : "";
    if (!of || others.has(of) || [...others.values()].includes(k) || f?.type !== "string" || choosing(f) || !choosing(props[of])) continue;
    others.set(of, k);
  }
  const words = new Set(others.values());
  const asked = Object.keys(props).filter((k) => !words.has(k));
  /** @type {AskQuestion[]} */
  const questions = [];
  for (const k of asked) {
    const q = fieldQuestion(k, props[k], required.has(k), asked.length === 1 ? title : "");
    if (typeof q === "string") return q;
    const other = others.get(k);
    if (other) Object.assign(q, { other, words: q.words || "text" });
    questions.push(q);
  }
  if (!questions.length) return "its form asks nothing";
  return form("question", "elicitation", { agent, title, call, questions });
}

/**
 * Cursor's `cursor/ask_question`: its questions, each with its choices, one or several. Cursor reads back only the
 * choices' ids, so a question takes no words of the person's, and one with nothing to choose isn't asked.
 * @param {any} params @param {{ agent?: string }} [o] @returns {AskForm | string}
 */
export function fromCursorQuestion(params, { agent = "" } = {}) {
  const questions = (Array.isArray(params?.questions) ? params.questions : [])
    .filter((/** @type {any} */ q) => q && q.id != null)
    .map((/** @type {any} */ q) =>
      question(String(q.id), {
        prompt: keep(q.prompt),
        choices: (Array.isArray(q.options) ? q.options : [])
          .filter((/** @type {any} */ o) => o && o.id != null)
          .map((/** @type {any} */ o) => ({ id: String(o.id), label: keep(o.label ?? o.id), description: "" })),
        several: q.allowMultiple === true,
      }),
    )
    .filter((/** @type {AskQuestion} */ q) => q.choices.length);
  if (!questions.length) return "it asks nothing to choose from";
  return form("question", "cursor-question", { agent, title: keep(params?.title), call: params?.toolCallId ? String(params.toolCallId) : null, questions });
}

/**
 * Cursor's `cursor/create_plan`: the plan it proposes, with its name, its overview and its to-dos (a phase's too).
 * @param {any} params @param {{ agent?: string }} [o] @returns {AskForm}
 */
export function fromCursorPlan(params, { agent = "" } = {}) {
  const phases = Array.isArray(params?.phases) ? params.phases : [];
  const todos = [...(Array.isArray(params?.todos) ? params.todos : []), ...phases.flatMap((/** @type {any} */ p) => (Array.isArray(p?.todos) ? p.todos : []))]
    .map((/** @type {any} */ t) => ({ text: keep(t?.content || t?.id, PLAN_KEPT.todo), status: String(t?.status || "pending") }))
    .filter((t) => t.text)
    .slice(0, PLAN_KEPT.todos);
  const name = keep(params?.name);
  return form("plan", "cursor-plan", {
    agent,
    title: name,
    call: params?.toolCallId ? String(params.toolCallId) : null,
    plan: { name, overview: keep(params?.overview), text: headChars(String(params?.plan ?? ""), PLAN_KEPT.text), todos },
  });
}

/**
 * Codex's `item/tool/requestUserInput`: its questions, each with its choices (Codex reads back their labels) and, where
 * it allows, the person's own words (`isOther`), masked where it asks for a secret (`isSecret`). A question with
 * nothing to choose takes words.
 * @param {any} params @param {{ agent?: string }} [o] @returns {AskForm | string}
 */
export function fromCodexQuestion(params, { agent = "" } = {}) {
  const questions = (Array.isArray(params?.questions) ? params.questions : [])
    .filter((/** @type {any} */ q) => q && q.id != null)
    .map((/** @type {any} */ q) => {
      const choices = (Array.isArray(q.options) ? q.options : [])
        .map((/** @type {any} */ o) => ({ id: String(o?.label ?? ""), label: keep(o?.label), description: keep(o?.description) }))
        .filter((/** @type {AskChoice} */ c) => c.id);
      /** @type {AskQuestion["words"]} */
      const words = q.isSecret ? "secret" : q.isOther || !choices.length ? "text" : "";
      return question(String(q.id), { header: keep(q.header), prompt: keep(q.question), choices, words });
    });
  if (!questions.length) return "it asks nothing";
  return form("question", "codex-question", { agent, call: params?.itemId ? String(params.itemId) : null, questions });
}

/**
 * The plan an agent proposes through a permission request — Claude's `ExitPlanMode`, which the session's switch never
 * answers (HarnessV3-ACP AC3-2) — as a plan whose answer is one of the agent's own ways on (HarnessV3-ACP AC3-3): the
 * plan whole, and one question whose choices are its options. Claude's are said in the card's words (`PLAN_WAYS`), its
 * yeses that would decide by themselves left out (`PLAN_UNASKED`); another agent's are said by their own words, else by
 * their kind's, and kept in its order, a way to keep planning last.
 * @param {{ title: string, plan: string, call?: string | null, agent?: string,
 *   options: ReadonlyArray<{ optionId: string, name?: string, kind?: string, description?: string }> }} p
 * @returns {AskForm}
 */
export function fromAgentPlan({ title, plan, call = null, options, agent = "" }) {
  const plain = options.some((o) => String(o.optionId) === "exit-plan-default");
  const who = agent || "The agent";
  const choices = options
    .filter((o) => !(plain && PLAN_UNASKED.includes(String(o.optionId))))
    .map((o) => {
      const id = String(o.optionId);
      const kind = String(o.kind || "");
      const way = PLAN_WAYS[id];
      const [label, description] = way
        ? way.says(who, /\((\d+)% used\)/.exec(String(o.name || ""))?.[1] || "")
        : [keep(o.name || id), keep(o.description) || /** @type {Record<string, string>} */ (KIND_WORDS)[kind] || ""];
      return { choice: { id, label, description, ...(kind ? { kind } : {}) }, order: way ? way.order : /^reject/.test(kind) ? 3 : 2 };
    })
    .sort((x, y) => x.order - y.order)
    .map((x) => x.choice);
  const words = keep(title);
  return form("plan", "agent-plan", {
    agent,
    title: words,
    call,
    plan: { name: "", overview: "", text: headChars(String(plan ?? ""), PLAN_KEPT.text), todos: [] },
    questions: [question("permission", { prompt: words, choices, required: true })],
  });
}

/** How much of a command a judged permission's card shows: a command on another machine longer than this is refused. */
export const JUDGED_COMMAND_CHARS = 20_000;

/** The two answers to a permission the session's switch asks about: the loop card's Allow and Deny. */
const JUDGED_CHOICES = Object.freeze([
  { id: "allow", label: "Allow", description: "only this time" },
  { id: "deny", label: "Deny", description: "reject it for now" },
]);

/** What Allow grants where the agent offers only to always allow it: calls like it unasked, for its session. */
export const ALWAYS_ALLOW_WORDS = "always: the agent runs calls like it without asking again this session";
/** Why a sub-agent's call asks where its agent offers only to always allow it, said where its ask is drawn (the Team card). */
export const ALWAYS_REASON = "its agent offers only to always allow it: once allowed, it runs calls like it without asking again for the rest of its session";

/**
 * A permission the session's switch asks the person about (HarnessV3-ACP AC3-2), in the loop's words: its question
 * (the gate's, or a rule's), the command whole and why it asks, the files it changes as their diffs, and the
 * always-allow waiting for the call's shape — or, where a review rule asks (HarnessV4_Space_Plan SG-D13), the rule and
 * its second look, with no always-allow. It is answered Allow or Deny — Deny with the person's words, which go to
 * the agent as their message — or judged again when the switch moves (`switched`). `always`: the agent offers only to
 * always allow it, so Allow grants that, as its card says. `keeps`: what "Always allow in this chat" would keep
 * (d-allow) — the page presses that first, on the session's route, and then answers Allow.
 * @param {{ agent: string, call?: string | null, tool: string, words: string, command?: string, reason?: string,
 *   changes?: import("../../core/types.js").FileChange[], changesLeft?: number,
 *   offer?: { itemId: number, tool: string, shape: string } | null, review?: string | null,
 *   look?: import("../../core/second-look.js").LookRef | null, always?: boolean,
 *   keeps?: { hand: "bash" | "powershell", folder: string, commands: string[] } | null }} o
 * @returns {AskForm}
 */
export function fromJudged({ agent, call = null, tool, words, command = "", reason = "", changes = [], changesLeft = 0, offer = null, review = null, look = null, always = false, keeps = null }) {
  const choices = JUDGED_CHOICES.map((c) => (always && c.id === "allow" ? { ...c, description: ALWAYS_ALLOW_WORDS } : { ...c }));
  return form("permission", "switch", {
    agent,
    title: keep(words),
    call,
    questions: [question("permission", { prompt: keep(words), choices, words: "text", required: true })],
    judged: { tool, command: keep(command, JUDGED_COMMAND_CHARS), reason: keep(reason), changes, changesLeft, offer, ...(review ? { review, look } : {}), ...(always ? { always: true } : {}), ...(keeps ? { keeps } : {}) },
  });
}

/**
 * What a form asks, in a few words: its title, else its first question, its plan's name or its link.
 * @param {AskForm} f
 */
export const askedOf = (f) => f.title || f.questions[0]?.prompt || f.plan?.name || f.link?.url || "a question";

/**
 * How a question ended that nobody answered: with the answer its signal was aborted with — the agent settled it itself,
 * as a link it saw completed — else cancelled.
 * @param {AbortSignal | null | undefined} signal @returns {AskAnswer}
 */
export const endedBy = (signal) => (signal?.aborted && typeof signal.reason?.outcome === "string" ? signal.reason : { outcome: "cancelled" });

/**
 * Whether an answer fits its form: what the page sends is checked before it reaches the agent. Returns why not, or "".
 * @param {AskForm} f @param {any} a @returns {string}
 */
export function checkAnswer(f, a) {
  const outcome = String(a?.outcome || "");
  // A permission the switch asks about is judged again when the switch moves (AC3-2); a plan with its agent's own ways
  // on is answered with one of them, as a permission is (AC3-3).
  const allowed = f.judged ? [...OUTCOMES.permission, "switched"] : f.kind === "plan" && f.questions.length ? OUTCOMES.permission : OUTCOMES[f.kind];
  if (!allowed.includes(outcome)) return `the answer to ${f.kind === "plan" ? "a plan" : f.kind === "link" ? "a link" : `a ${f.kind}`} is ${allowed.join(" or ")}; this was ${outcome || "none"}`;
  if (outcome === "switched") return "";
  if (outcome !== "answered") return a.reason != null && typeof a.reason !== "string" ? "a reason is words" : "";
  const answers = a.answers && typeof a.answers === "object" ? a.answers : {};
  for (const id of Object.keys(answers)) if (!f.questions.some((q) => q.id === id)) return `the form asks no question “${id}”`;
  for (const q of f.questions) {
    const r = answers[q.id];
    const chosen = Array.isArray(r?.chosen) ? r.chosen.map(String) : [];
    const words = typeof r?.words === "string" ? r.words.trim() : "";
    const unknown = chosen.find((id) => !q.choices.some((c) => c.id === id));
    if (unknown != null) return `“${unknown}” isn't one of the choices for “${q.prompt || q.id}”`;
    if (chosen.length > 1 && !q.several) return `“${q.prompt || q.id}” takes one choice`;
    if (words && !q.words) return `“${q.prompt || q.id}” takes no words, only its choices`;
    if (words && (q.words === "number" || q.words === "integer") && !(q.words === "integer" ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(words))
      return `“${q.prompt || q.id}” takes ${q.words === "integer" ? "a whole number" : "a number"}`;
    if (q.required && !chosen.length && !words) return `“${q.prompt || q.id}” needs an answer`;
  }
  return "";
}

/**
 * The answer when nobody can be asked (no page, no question tool): a question is skipped, a link declined, a plan
 * accepted, as Cursor accepts its own when its client can't ask. A permission has none: its policy decides. Nor has a
 * plan with its agent's own ways on: its agent hears it cancelled.
 * @param {AskForm} f @returns {AskAnswer | null}
 */
export function nobodyAnswer(f) {
  if (f.kind === "question") return { outcome: "skipped", reason: "nobody could be asked here" };
  if (f.kind === "link") return { outcome: "declined" };
  if (f.kind === "plan" && !f.questions.length) return { outcome: "accepted" };
  return null;
}

/**
 * What the person answered, in words, a line a question — for the transcript's card, the record and a later reload. A
 * secret is never said.
 * @param {AskForm} f @param {AskAnswer | null} a @returns {string[]}
 */
export function answerWords(f, a) {
  if (!a || a.outcome === "cancelled") return ["Cancelled"];
  if (f.kind === "plan" && !f.questions.length) return [a.outcome === "accepted" ? "Accepted" : `Rejected${a.reason ? `: ${keep(a.reason, 400)}` : ""}`];
  if (f.kind === "link") return [a.outcome === "accepted" ? "Opened" : "Declined"];
  if (a.outcome === "skipped") return ["Skipped"];
  return f.questions.map((q) => {
    const r = a.answers?.[q.id];
    const labels = (r?.chosen || []).map((id) => q.choices.find((c) => c.id === id)?.label || id);
    const words = r?.words?.trim() ? (q.words === "secret" ? "(hidden)" : r.words.trim()) : "";
    const said = [...labels, ...(words ? [words] : [])].join(", ") || "skipped";
    if (f.kind === "plan") return said;
    if (f.kind === "permission") return a.reason ? `${said} — ${keep(a.reason, 400)}` : said;
    // A question that ends in its own mark takes its answer after a space: "Which database? Postgres".
    const asked = q.header || q.prompt || q.id;
    return /[?:？：]$/.test(asked) ? `${asked} ${said}` : `${asked}: ${said}`;
  });
}

/**
 * A number the person wrote, as the form's field wants it.
 * @param {string} words @param {AskQuestion["wants"]} wants
 */
const asValue = (words, wants) => (wants === "number" || wants === "integer" ? Number(words) : words);

/**
 * The answer to an elicitation (ACP's, or one Codex relays): accepted with the form's content, each field as its type
 * wants it — the words written beside a question's choices in the field that takes them — declined, or cancelled.
 * @param {AskForm} f @param {AskAnswer} a @returns {{ action: "accept" | "decline" | "cancel", content?: Record<string, unknown> }}
 */
export function toElicitation(f, a) {
  if (a.outcome === "cancelled") return { action: "cancel" };
  if (f.kind === "link") return a.outcome === "accepted" ? { action: "accept" } : { action: "decline" };
  if (a.outcome !== "answered") return { action: "decline" };
  /** @type {Record<string, unknown>} */
  const content = {};
  for (const q of f.questions) {
    const r = a.answers?.[q.id];
    const words = r?.words?.trim() || "";
    const chosen = r?.chosen || [];
    if (words && q.other) content[q.other] = words;
    else if (words) content[q.id] = asValue(words, q.wants);
    if (!chosen.length || (words && !q.other)) continue;
    content[q.id] = q.wants === "array" ? chosen : q.wants === "boolean" ? chosen[0] === "true" : chosen[0];
  }
  return { action: "accept", content };
}

/**
 * The answer to Cursor's `cursor/ask_question`: the questions answered with their choices' ids, skipped with why, or
 * cancelled. An answer that chose nothing is a skip.
 * @param {AskForm} f @param {AskAnswer} a
 */
export function toCursorQuestion(f, a) {
  if (a.outcome === "cancelled") return { outcome: { outcome: "cancelled" } };
  const answers = a.outcome === "answered"
    ? f.questions.map((q) => ({ questionId: q.id, selectedOptionIds: a.answers?.[q.id]?.chosen || [] })).filter((x) => x.selectedOptionIds.length)
    : [];
  if (answers.length) return { outcome: { outcome: "answered", answers } };
  return { outcome: { outcome: "skipped", reason: a.reason || "The person skipped the questions" } };
}

/**
 * The answer to Cursor's `cursor/create_plan`: accepted (Cursor then saves the plan itself), rejected with the person's
 * words, or cancelled.
 * @param {AskAnswer} a
 */
export function toCursorPlan(a) {
  if (a.outcome === "accepted") return { outcome: { outcome: "accepted" } };
  if (a.outcome === "rejected") return { outcome: { outcome: "rejected", ...(a.reason?.trim() ? { reason: a.reason.trim() } : {}) } };
  return { outcome: { outcome: "cancelled" } };
}

/**
 * The answer to Codex's `requestUserInput`: each answered question's chosen labels and the person's words, by its id.
 * A skip, or a stop, answers none.
 * @param {AskForm} f @param {AskAnswer} a
 * @returns {{ answers: Record<string, { answers: string[] }> }}
 */
export function toCodexQuestion(f, a) {
  /** @type {Record<string, { answers: string[] }>} */
  const answers = {};
  if (a.outcome === "answered")
    for (const q of f.questions) {
      const r = a.answers?.[q.id];
      const said = [...(r?.chosen || []), ...(r?.words?.trim() ? [r.words.trim()] : [])];
      if (said.length) answers[q.id] = { answers: said };
    }
  return { answers };
}

/**
 * The answer to an ACP permission request: the option the person chose, or cancelled.
 * @param {AskAnswer | null} a
 * @returns {{ outcome: { outcome: "selected", optionId: string } | { outcome: "cancelled" } }}
 */
export function toPermission(a) {
  const id = a?.outcome === "answered" ? a.answers?.permission?.chosen?.[0] : null;
  return id ? { outcome: { outcome: "selected", optionId: String(id) } } : { outcome: { outcome: "cancelled" } };
}

/**
 * The questions an outside client's question tool is asked: a form's own (a plan's ways on, where its agent offers
 * them), and a plan or a link as one question with its two answers (and the person's words, a plan's reason to reject
 * it).
 * @param {AskForm} f @returns {AskQuestion[]}
 */
export function clientQuestions(f) {
  if (f.kind === "plan" && !f.questions.length)
    return [
      question("plan", {
        header: "Plan",
        prompt: `Accept the plan “${f.plan?.name || f.agent || "proposed"}”?${f.plan?.overview ? ` ${f.plan.overview}` : ""}`,
        choices: [
          { id: "accepted", label: "Accept", description: "the agent goes on with this plan" },
          { id: "rejected", label: "Reject", description: "the agent plans again" },
        ],
        words: "text",
      }),
    ];
  if (f.kind === "link")
    return [
      question("link", {
        header: "Link",
        prompt: `${f.title ? `${f.title} ` : ""}Open ${f.link?.url || "the link"}?`,
        choices: [
          { id: "accepted", label: "Open it", description: "you open the link yourself" },
          { id: "declined", label: "Decline", description: "the agent goes on without it" },
        ],
      }),
    ];
  return f.questions;
}

/**
 * What an outside client's question tool says each question was answered, in its machine format, as it was written:
 * a JSON object of question to answer (beside the tool's input, under `answers`, or not), the answer a string or a list
 * of them; else Claude Code's `"<question>"="<answer>"` pairs (`User has answered your questions: "Q1"="A1", "Q2"="A2".
 * You can now continue…`), each answer running to the last quote before the next pair, or before the end. Where the
 * tool asked one question, its one answer or one pair is that question's though its words aren't echoed, and else the
 * result whole is (a client that returns what was chosen). Null for a question it says nothing of. Only these say
 * what was chosen: words are never searched for a choice's name.
 * @param {string} text @param {string[]} asked  the questions' words, as the tool was given them
 * @returns {(string | string[] | null)[]}
 */
export function clientSaid(text, asked) {
  const t = String(text || "");
  /** @type {any} */
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  if (j && typeof j === "object" && !Array.isArray(j)) {
    const said = j.answers && typeof j.answers === "object" && !Array.isArray(j.answers) ? j.answers : j;
    const keys = Object.keys(said);
    return asked.map((w) => {
      const v = Object.hasOwn(said, w) ? said[w] : asked.length === 1 && keys.length === 1 ? said[keys[0]] : null;
      return typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
    });
  }
  const at = asked.map((w) => (w ? t.indexOf(`"${w}"="`) : -1));
  return asked.map((w, i) => {
    let from = at[i] < 0 ? -1 : at[i] + w.length + 4;
    if (from < 0 && asked.length === 1) {
      const pair = t.indexOf('"="');
      if (pair < 0) return t.trim() || null;
      from = pair + 3;
    }
    if (from < 0) return null;
    const next = at.filter((x) => x >= from).sort((x, y) => x - y)[0];
    const part = t.slice(from, next ?? t.length);
    const end = part.lastIndexOf('"');
    return end < 0 ? null : part.slice(0, end);
  });
}

/**
 * One question's answer, from what the client said of it (`clientSaid`): a choice's label exactly as it was shown, or
 * — where several may be chosen — each of the labels joined by commas (or listed) as Claude Code joins them; what names
 * no choice is the person's own words, where the question takes them.
 * @param {AskQuestion} q @param {string | string[] | null} said @returns {AskReply | null}
 */
function replyIn(q, said) {
  if (said == null) return null;
  /** @param {string} w */
  const label = (w) => q.choices.find((c) => c.label === w.trim())?.id;
  const pieces = Array.isArray(said) ? said : label(said) != null || !q.several ? [said] : said.split(", ");
  const chosen = pieces.map(label).filter((id) => id != null).map(String);
  const words = pieces.filter((p) => label(p) == null).join(", ").trim();
  if (!chosen.length && !(q.words && words)) return null;
  return { chosen: q.several ? chosen : chosen.slice(0, 1), ...(q.words && words ? { words: words.slice(0, MAX_WORDS) } : {}) };
}

/**
 * The answer an outside client's question tool gave (to `clientQuestions`), read back per question from its machine
 * format (`clientSaid`), a choice by its exact label alone. A result that is an error, or that answers nothing, is a
 * skip; a plan's is a rejection, with the person's words as its reason.
 * @param {AskForm} f @param {string} text @param {boolean} [isError] @returns {AskAnswer}
 */
export function answerFromText(f, text, isError = false) {
  const qs = clientQuestions(f);
  // As `buildQuestions` asks them.
  const said = clientSaid(isError ? "" : text, qs.map((q) => q.prompt || f.title));
  /** @type {Record<string, AskReply>} */
  const answers = {};
  qs.forEach((q, i) => {
    const r = replyIn(q, said[i]);
    if (r) answers[q.id] = r;
  });
  if (f.kind === "plan" && !f.questions.length) {
    const r = answers.plan;
    return r?.chosen[0] === "accepted" ? { outcome: "accepted" } : { outcome: "rejected", ...(r?.words ? { reason: r.words } : {}) };
  }
  if (f.kind === "link") return { outcome: answers.link?.chosen[0] === "accepted" ? "accepted" : "declined" };
  return Object.keys(answers).length ? { outcome: "answered", answers } : { outcome: "skipped" };
}
