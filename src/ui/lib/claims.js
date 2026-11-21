// @ts-check
// A claim in words, for both apps (HarnessV3-Memory M6-5, M6-6): the harness's Memory widget and Settings → Memory, and
// the console's Memories and Projects pages, say what memory holds, how it is known, how sure memory is and what the
// owner may do to it the same way, through the same routes. Pure: no DOM, no fetch.

/** A claim no longer stands: retired by someone, or replaced by a correction. @param {string | null | undefined} status */
export const isRetired = (status) => status === "dismissed" || status === "superseded";
/** @param {number} n @param {string} one @param {string} [many] */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A quote on one line, cut at `n` characters. @param {unknown} s @param {number} [n] */
const clipWords = (s, n = 120) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Each kind of claim by the name a reader looks for. */
export const KIND_WORDS = Object.freeze({
  rule: "Rule",
  convention: "Convention",
  preference: "Preference",
  decision: "Decision",
  fact: "Fact",
  thread: "Open thread",
  procedure: "How to",
  words: "Past session",
});
/** @param {string} kind */
export const kindWord = (kind) => /** @type {Record<string, string>} */ (KIND_WORDS)[kind] || "Memory";

/** The claim browser's states, as its tabs say them (the server's `CLAIM_STATES`). */
export const MEMORY_STATES = Object.freeze([
  { value: "standing", label: "Standing" },
  { value: "review", label: "To review" },
  { value: "retired", label: "Retired" },
]);
/** Its kinds, as a reader looks for them (the server's `CLAIM_FILTER_KEYS`): a pitfall is any claim with a trigger. */
export const MEMORY_FILTERS = Object.freeze([
  { value: "rules", label: "Rules" },
  { value: "howto", label: "How to" },
  { value: "pitfalls", label: "Pitfalls" },
  { value: "decisions", label: "Decisions" },
  { value: "facts", label: "Facts" },
  { value: "threads", label: "Threads" },
]);
/** Under this, memory leaves a claim out of recall (the brain's `CONFIDENCE_GATE`, M3-D8); a search still finds it. */
export const SURE_LINE = 0.35;

/** The route of one claim, by its id (`i12`, or the bare number). @param {string | number} id */
export const itemPath = (id) => `/memory/items/${encodeURIComponent(String(id).replace(/^i/, ""))}`;
/**
 * The claim browser's read: a scope's claims in a state, of a kind, matching a search.
 * @param {{ project?: string | null, state?: string, kind?: string, q?: string }} o
 */
export const claimsPath = ({ project = null, state = "standing", kind = "", q = "" }) =>
  `/memory/claims?${[`state=${encodeURIComponent(state)}`, kind ? `kind=${encodeURIComponent(kind)}` : "", q.trim() ? `q=${encodeURIComponent(q.trim())}` : "", project ? `project=${encodeURIComponent(project)}` : ""].filter(Boolean).join("&")}`;

/** How a claim is known when it is the user's own word though not confirmed (brain `trustOf`): a Confirm adds nothing (M6-7). */
const USERS_WORD = new Set(["user said", "user corrected"]);
/**
 * Whether the owner's Confirm says something new of a standing claim: it is neither confirmed nor their own word yet (a
 * correction they typed is theirs already), or its file changed since (a Confirm checks it against its files as they are
 * and anchors it afresh, HarnessV3-Memory M6-D7). @param {any} c
 */
export const mayConfirm = (c) =>
  !isRetired(c.status) && ((c.status !== "confirmed" && !USERS_WORD.has(c.trust)) || (c.flags || []).some((/** @type {string} */ f) => f.startsWith("file ")));

/**
 * A memory card's words, as a reader is shown them: a claim's own text; a quote of a past session (`words`), which
 * the record never quotes, by where it was said; an engine memory by its id. The Memory pane's rows and the memory note over a reply say them alike.
 * @param {any} c
 */
export const claimWords = (c) =>
  c.kind === "words" ? `Words from ${c.title ? `“${c.title}”` : "a past session"}, turn ${c.turn}`
  : c.kind === "engine" ? `An engine memory (${c.id})`
  : String(c.text);

/**
 * What memory knows of a claim, in one quiet line: who said it (a sub-agent's finding names it, HarnessV3-Memory
 * M7-D19), how many sessions, how sure, and its flags.
 * @param {any} c @param {readonly (string | null | false | undefined)[]} [lead]
 */
export function claimLine(c, lead = []) {
  return [
    ...lead,
    c.trust,
    c.finder?.agent ? `${c.finder.agent}${c.finder.type ? ` (${c.finder.type})` : ""}` : null,
    c.backed > 1 ? `✓${c.backed}` : null,
    c.sure != null ? `${Math.round(c.sure * 100)}% sure` : null,
    // Held off while the user is asked whether it replaces their word (M6-D16): not retired, waiting on them.
    isRetired(c.status) ? (c.asked ? "held for your answer" : c.status === "superseded" ? "replaced since" : "retired since") : null,
    ...(c.flags || []),
  ].filter(Boolean).join(" · ");
}

/** A question in words: what memory would do. @param {any} q */
export function questionWords(q) {
  const p = q.proposal || {};
  const said = (/** @type {number} */ id) => q.claims?.find((/** @type {any} */ c) => c.id === `i${id}`)?.text;
  if (p.action === "restore") return `Bring back: “${p.text}”`;
  // The same correction across sessions (the memory plan's f4): its lesson, kept as the user's rule if they accept.
  if (p.action === "adopt") return `Keep as your rule: “${p.text}”`;
  // Your word the same correction across sessions says is out of date (f4): its words changed, if they accept.
  if (p.action === "correct" && p.replacement == null) return `Change “${said(p.id) ?? `i${p.id}`}” to “${p.text}”`;
  // What projects learned about you (the memory plan's f5): kept in every project, if you accept.
  if (p.action === "everywhere") return `Keep about you in every project: “${p.text}”`;
  // The user's word a model corrected or retired (HarnessV3-Launch RD-D3).
  if (p.action === "bring-back") return `Bring back your word “${said(p.replacement) ?? `i${p.replacement}`}”${p.id != null ? ` in place of “${said(p.id) ?? `i${p.id}`}”` : ""}`;
  if (p.replacement) return `Replace “${said(p.id) ?? `i${p.id}`}” with “${said(p.replacement) ?? `i${p.replacement}`}”`;
  return `Retire “${said(p.id) ?? `i${p.id}`}”`;
}

/**
 * A question's two answers as its buttons say them, in each view (HarnessV3-Launch RD-D3): the user's word a model took
 * away is brought back, or the change kept (its correction, or its retirement); any other question is accepted, or
 * rejected for good. `aria`: what the button does, for a screen reader.
 * @param {any} q @returns {{ accept: { label: string, aria: string }, reject: { label: string, aria: string } }}
 */
export function questionAnswers(q) {
  const p = q.proposal || {};
  if (p.action !== "bring-back")
    return {
      accept: { label: "Accept", aria: `Accept ${q.id}: ${questionWords(q)}` },
      reject: { label: "Reject", aria: `Reject ${q.id}: memory will not ask it again` },
    };
  const keep = p.id != null ? "Keep the correction" : "Keep it retired";
  return {
    accept: { label: "Bring mine back", aria: `Bring mine back ${q.id}: ${questionWords(q)}` },
    reject: { label: keep, aria: `${keep} ${q.id}: ${p.id != null ? "the correction stands" : "your word stays retired"}` },
  };
}

/** Who did something to a claim, as its history says it. @type {Record<string, string>} */
const WHO = { person: "you", owner: "you", correction: "your correction", capture: "your words", model: "a model", agent: "an agent", learner: "the learner", curator: "the curator", filament: "Filament", import: "an import", subagent: "a sub-agent" };
/** @param {string | null | undefined} by */
export const whoWords = (by) => (by ? WHO[by] || String(by) : "");

/**
 * A trigger in words, its commands apart (`{ code }`, drawn as code): the call it is said on, the right way, how often
 * it was said and followed, and how often its right way was taken with no reminder (M7-D63).
 * @param {{ shape: string, args?: string, unless?: string, fired?: number, followed?: number, kept?: number }} t
 * @returns {(string | { code: string })[]}
 */
export function triggerParts(t) {
  return [
    "On ",
    { code: [t.shape, t.args].filter(Boolean).join(" ") },
    ...(t.unless ? [" · the right way: ", { code: t.unless }] : [" · said once a session"]),
    ` · ${t.fired ? `said ${plural(t.fired, "time")}` : "not said yet"}`,
    ...(t.unless && t.fired ? [` · ${t.followed ? `followed ${plural(t.followed, "time")}` : "not followed yet"}`] : []),
    ...(t.unless && t.kept ? [` · kept ${plural(t.kept, "time")} without a reminder`] : []),
  ];
}

/**
 * One event of a claim's history in words: what happened, and who did it.
 * @param {{ action: string, by?: string | null, detail?: any }} e  an event as the history route gives it
 */
export function eventWords(e) {
  const d = e.detail || {};
  const who = whoWords(e.by);
  const of = who ? ` by ${who}` : "";
  switch (e.action) {
    case "created":
      return `Filed${d.status ? ` ${d.status}` : ""}${of}${d.quote ? `, quoted by ${whoWords(d.filedBy) || "an agent"}: “${clipWords(d.quote)}”` : ""}`;
    case "heard":
      return `Now your words: ${whoWords(e.by) || "an agent"} quoted you saying it: “${clipWords(d.quote)}”`;
    case "status":
      if (d.to === "superseded") return d.replacement ? `Replaced by i${d.replacement}${of}` : `Replaced${of}`;
      if (d.to === "dismissed") return `Retired${of}`;
      if (isRetired(d.from)) return `Brought back${of}`;
      return d.to === "confirmed" ? `Confirmed${of}` : `Now ${d.to}${of}`;
    case "evidence":
      return `Said again${d.chain ? ` in session ${d.chain}` : ""}`;
    case "suspected":
      return d.why ? `Session ${d.chain ?? "?"} showed it wrong${d.n != null ? ` at turn ${d.n}` : ""}: ${clipWords(d.why)}` : `A correction pointed at it${d.chain ? ` in session ${d.chain}` : ""}`;
    case "fired":
      return d.file ? `Resurfaced at a call on ${d.file}` : `Said at a call: ${[d.shape, d.args].filter(Boolean).join(" ")}`;
    case "followed":
      return `The right way was taken: ${d.unless}`;
    case "kept":
      return `Kept without a reminder: ${d.unless}`;
    case "closed":
      return `Closed: the work was done${of}`;
    case "cleared":
      return `Cleared of a suspicion: ${d.retired ? "the correction was retired since" : "it was about something else"}${of}`;
    case "weighed":
      return d.verdict !== "wrong"
        ? `A suspicion weighed: not settled${of}`
        : d.asked
          ? `Judged wrong: the user is asked${of}`
          : `Judged wrong in one project: a claim of every project stands${of}`;
    case "verified":
      return `Checked against its files: it holds${of}`;
    case "checked":
      return `Checked against its files: ${d.verdict === "wrong" ? "they say otherwise" : d.verdict === "holds" ? "it holds" : "not sure"}${of}`;
    case "grounded":
      return `Checked against the turn it came from (session ${d.chain ?? "?"}, turn ${d.turn ?? "?"}): ${d.verdict === "holds" ? "it bears it out" : d.verdict === "wrong" ? "it says otherwise" : "not settled"}${of}`;
    case "anchor":
      return d.state === "gone" ? `Its file ${d.file} is gone` : d.state === "symbol" ? `${d.file} no longer has ${d.symbol}` : d.state === "ok" ? `${d.file} says it again` : `Its file ${d.file} changed`;
    case "slot":
      return d.to?.slot ? `Keyed: it gives ${d.to.slot}${of}` : `Unkeyed${of}`;
    case "unkeyed":
      return `Left unkeyed${of}`;
    case "distinct":
      return `Judged not the same as i${d.other}${of}`;
    case "kind":
      return `Filed as a ${d.to}, not a ${d.from}${of}`;
    case "contested":
      return `The environment says otherwise: ${d.says}`;
    case "undo":
      return `Undone${of}`;
    case "moved":
      return `Moved to ${d.to ? `project ${d.to}` : "everywhere"}${d.session ? ` with session ${d.session}` : ""}${of}`;
    case "skill":
      return `Added to the skill ${d.skill}${d.section ? `, under ${d.section}` : ""}${of}`;
    default:
      return `${e.action}${of}`;
  }
}

/**
 * A page's claim changes, off the events fan-out it holds already (HarnessV3-Memory M7-D36): `subscribe` hands it every
 * message there and returns the undo (the harness's `onBus`, the console's `onEvents`). `onChanges` gets the changes
 * collected over `wait` ms. `onReadAll` is told to read everything the page shows again instead when a message was
 * missed (its `prev` is not the last `last` heard: the fan-out skips one on a congested socket), on a reset (memory
 * opened another store), and on the fan-out's `hello` (a reconnect, which may have missed any). A page that is gone
 * (`alive` false) lets go at the next message. Returns the undo.
 * @param {(fn: (msg: any) => void) => () => void} subscribe
 * @param {{ onChanges: (changes: any[]) => void, onReadAll: () => void, alive?: () => boolean, wait?: number }} o
 */
export function followClaims(subscribe, { onChanges, onReadAll, alive = () => true, wait = 250 }) {
  /** The `last` of the newest message heard. @type {string | null} */
  let heard = null;
  /** @type {any[]} */
  let held = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const drop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    held = [];
  };
  /** @type {() => void} */
  let off = () => {};
  const stop = () => {
    drop();
    off();
  };
  const readAll = () => {
    drop();
    onReadAll();
  };
  off = subscribe((msg) => {
    if (!alive()) return stop();
    if (msg?.type === "hello") {
      heard = null;
      return readAll();
    }
    if (msg?.type !== "claims") return;
    const missed = msg.reset || (heard != null && msg.prev !== heard);
    heard = msg.last ?? null;
    if (missed) return readAll();
    held.push(...(msg.changes || []));
    timer ||= setTimeout(() => {
      const changes = held;
      drop();
      if (!alive()) return stop();
      onChanges(changes);
    }, wait);
  });
  return stop;
}

/**
 * The scope a claim browser opens on: the project with the most claims, or everywhere (null) when none has any. Also
 * where it goes when the project it showed is gone (M7-D37). @param {any[]} scopes  as `GET /memory/claims/scopes` lists them
 * @returns {string | null}
 */
export function firstScope(scopes) {
  const first = scopes.filter((s) => s.project !== null).sort((a, b) => (b.claims || 0) - (a.claims || 0))[0];
  return first?.claims ? first.project : null;
}

/** The changes that move a scope's count of standing claims, or its dossier's version (M7-D37). */
const MOVES_SCOPES = new Set(["created", "status", "deleted", "moved", "dossier"]);
/** @param {any} c */
const isQuestion = (c) => c.action === "asked" || c.action === "decided";

/**
 * What a claim browser reads again for a batch of changes (HarnessV3-Memory M7-D37), and nothing else:
 * - `scopes`, on a change that moves a count or a dossier's version;
 * - `list`, on a change to a claim in the scope picked (the global ones for Everywhere; one moved out of it too), or to
 *   one the list shows;
 * - `questions`, on a question asked or settled in that scope or for the global claims;
 * - `histories`, the open histories whose claim changed;
 * - `dossier`, the dossier shown, on a change in its project.
 * @param {any[]} changes
 * @param {{ scope: string | null, shown?: Iterable<string>, histories?: Iterable<string>, dossier?: string | null }} view
 *   `scope`: the project picked, null for Everywhere; `shown`: the ids the list shows; `histories`: the ids whose history
 *   is open; `dossier`: the project whose dossier is shown, if one is
 * @returns {{ scopes: boolean, list: boolean, questions: boolean, histories: string[], dossier: boolean }}
 */
export function claimsTouched(changes, { scope, shown = [], histories = [], dossier = null }) {
  const listed = new Set(shown);
  const open = new Set(histories);
  const inScope = (/** @type {any} */ c) => (c.project ?? null) === scope || (c.from != null && c.from === scope);
  return {
    scopes: changes.some((c) => MOVES_SCOPES.has(c.action)),
    list: changes.some((c) => c.claim != null && (inScope(c) || listed.has(c.claim))),
    questions: changes.some((c) => isQuestion(c) && (c.project == null || c.project === scope)),
    histories: [...new Set(changes.filter((c) => c.claim != null && open.has(c.claim)).map((c) => c.claim))],
    dossier: dossier != null && changes.some((c) => c.project === dossier || c.from === dossier),
  };
}

/**
 * Whether a turn's memory (`GET /memory/sessions/:id/turns/:n/memory`) reads again for a batch of changes (M7-D37): a
 * change to a claim it shows (shown, reminded, said or replaced by what was said, asked about), a claim filed in its
 * session, or a question asked or settled in its project or for the global claims.
 * @param {any[]} changes @param {any} mem  the turn's memory as the route gives it, or null
 */
export function turnTouched(changes, mem) {
  if (!mem) return false;
  const ids = new Set([
    ...(mem.shown || []).map((/** @type {any} */ c) => c.id),
    ...(mem.reminders || []).map((/** @type {any} */ r) => r.claim?.id),
    ...(mem.said || []).flatMap((/** @type {any} */ c) => [c.id, ...(c.replaces || []).map((/** @type {any} */ o) => o.id)]),
    ...(mem.asks?.first || []).flatMap((/** @type {any} */ q) => (q.claims || []).map((/** @type {any} */ c) => c.id)),
  ]);
  return changes.some(
    (c) => (c.claim != null && ids.has(c.claim)) || (c.action === "created" && c.session === mem.session) || (isQuestion(c) && (c.project == null || c.project === mem.project)),
  );
}

/**
 * The turn memory a page shows, read again when a change touches it (`turnTouched`), and on anything missed (M7-D37).
 * @param {(fn: (msg: any) => void) => () => void} subscribe  as `followClaims` takes it
 * @param {{ shown: () => any, read: () => void, wait?: number }} o  `shown`: the turn's memory on screen now, or null;
 *   `read`: read it again
 */
export const followTurnMemory = (subscribe, { shown, read, wait }) =>
  followClaims(subscribe, { wait, onReadAll: read, onChanges: (changes) => void (turnTouched(changes, shown()) && read()) });

/** A stored ISO time as a short local date and time ("" when there is none). @param {string | null | undefined} iso */
export const shortWhen = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
};

/**
 * What memory learns with, for a sentence (the memory plan's m1): the model set for it, else what it calls where no chat
 * is named (`now`; `chosen` says it was not set: each chat's own then), or why there is none — memory's model is off,
 * or nothing a provider serves is set or started on.
 * @param {any} ms  `/memory/models`' answer (the memory status carries it as `models`)
 * @returns {{ model: string | null, chosen: boolean, off: boolean, why: string }}  `why` is "" while there is a model
 */
export function learnsWith(ms) {
  const off = ms?.summarizer === "off";
  if (!off && ms?.summarizer && ms.summarizer !== "auto") return { model: String(ms.summarizer), chosen: false, off: false, why: "" };
  if (!off && ms?.now) return { model: String(ms.now), chosen: true, off: false, why: "" };
  return { model: null, chosen: false, off, why: off ? "memory's model is off" : String(ms?.whyNone || "no model memory can call") };
}
