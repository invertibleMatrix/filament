// @ts-check
// A team's tools (HarnessV3-AtHome P2): the handlers behind its lead's agent and worker calls. They take plain JSON —
// the session, the lead's turn and call, the team, the call's input — and answer plain JSON, never reaching into the
// loop's turn state (AH-O10): the loop's wrappers in turn.js build the call and read the answer, and the registry finds
// the lead's turn by its run. A lead launches a worker from a brief's parts, which Filament lays out as its task; a
// member that reviews may be handed another's change, not applied yet, to read ahead of its brief. A worker is one of
// the team's members, named by its tag (core/roster.js). The lead watches its workers
// run (`watch`, which its wait answers with), messages or stops a running one, and follows up on one that reported —
// saying, when its work fell short, that the follow-up corrects it (AH-O5).
//
// A lead that reads along with its workers (HarnessV3-TaskGraph-v2 §12, `engine.supervise`) has three reads of one more
// — a running one's rounds whole (`show_trail`), its change so far (`show_changes`), and its brief and reports whole
// (`show_report`, TG2-D56). A call says whether its lead reads along (`reads`); without it every answer here is the
// same, but one: every lead answers the questions its workers ask it, by their numbers (TG2-D58). A coding agent that
// compacted its own context while it leads hears its team as it stands (`teamNow`, TG2-D56).
import { memberOf, reviewerOf, reviews, workerOf } from "../../core/roster.js";
import { SUBAGENT_EFFORTS } from "../../core/schema.js";
import { aOrAn, aboutTokens, clip, durationWords, listed, sentence } from "../../core/text.js";
import { ASK_LEAD_SECONDS, appliedResult, noSuchSubagent } from "./subagents.js";
import { grantsOf, grantsProblem, launchWords, uncheckedWords, withTeamCheck } from "./grants.js";
import { checkingWords, sentBackWords } from "./check.js";
import { MCP_PATIENCE_MS, heldFor } from "../agent-inbox.js";

/**
 * @typedef {object} TeamCall  one call of a lead's
 * @property {string} chainId  the session
 * @property {import("./subagents.js").LeadCall} lead  the lead's turn and the call
 * @property {string} cwd  the session's folder
 * @property {import("./prompt.js").PermissionMode | null} mode  a mode the lead's request fixed, else null
 * @property {string} model  the lead's model: its workers' too, where they take the row of the session's workers' list that
 *   names none
 * @property {any} thinking  the lead's thinking parameter
 * @property {{ key: string, name: string, members: readonly import("../../core/roster.js").Member[], models?: readonly string[] | null, check?: string | null }} team
 *   the team, with its members: each a worker card by its tag, and the team's words for it; the models its workers run
 *   on, in order (team_v2_plan TV2-D8); its check, given to each member that changes files (the plan's p6).
 * @property {any} input  the call's input, as the model wrote it
 * @property {boolean} [reads]  the lead reads along with its workers (`engine.supervise`): worker has its reads, and its
 *   answer to a worker that waits for the developer's; agent has plan_review (TG2-D50)
 * @property {number} [patienceMs]  how long the lead's agent lets this call run (a coding agent's, over MCP): an apply
 *   waits for the folder's check that long, less a margin, then answers that it runs (TG2-D55). Missing: Filament's
 *   default, in both seats — a worker's question never waits behind a long check
 */
/**
 * @typedef {object} TeamResult  what the call answers — no field is ever undefined, so it crosses a wire unchanged
 * @property {boolean} ok
 * @property {string} text  the tool result the lead reads
 * @property {string} note  the record's sentence
 * @property {string} [agentId]  the worker it launched or reached
 * @property {boolean} wrote
 * @property {import("../turn-tree.js").Writes} [writes]  the files that went into the session's folder: the worker's in
 *   the folder it shares, or its applied change
 * @property {number} spentUsd
 * @property {number} toolCalls
 * @property {string[]} roundIds
 */

/**
 * Whether a lead's agent call asks a saved agent by its tag (HarnessV4_Tasks E15 step 3): its role names no member
 * of its team (`tags`, the members' tags). Whether that word is an agent the session names, the launch says.
 * @param {string} name @param {any} input @param {readonly string[]} tags
 */
export const isAsk = (name, input, tags) => name === "agent" && typeof input?.role === "string" && !!input.role.trim() && !tags.includes(input.role);
/** A value the model gave: not missing, and not only blanks. @param {unknown} v */
const given = (v) => v != null && String(v).trim() !== "";
/** A list of non-empty strings. @param {unknown} v */
const textList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.trim() !== "");
/** A call that did nothing, in the words the lead reads. @param {string} text @param {string} note @returns {TeamResult} */
const nothing = (text, note) => ({ ok: false, text, note, wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] });
/** A launch refused. @param {string} why */
const refused = (why) => nothing(`Not launched: ${sentence(why)}`, `agent: a launch refused — ${why}`);
/** A worker's role, or what else a sub-agent is, as the lead's words name it. @param {any} sa */
const roleOf = (sa) => sa.team?.role || "sub-agent";
/**
 * Whose a sub-agent that is no worker is: the developer's own, or one the session's agent launched before a team led
 * the session. A lead messages and stops only its workers. @param {any} sa
 */
const whose = (sa) => (sa.origin === "agent" ? "a sub-agent the session's agent launched before you led it" : "the developer's sub-agent");
/** Why a lead may not message or stop a running sub-agent that is no worker of the team's. @param {any} sa */
const notYours = (sa) => `${sa.id} is ${whose(sa)}, not one of your workers — ${sa.origin === "agent" ? "the developer's" : "theirs"} to message or stop; you can follow up on it once it reports`;
/** A count in words, the way the watch says a compaction's. @param {number} n */
const times = (n) => (n === 1 ? "once" : `${n} times`);
/**
 * What a worker waits on, as the watch and an answer's refusal say it: a call's question, or its question to its lead
 * (HarnessV3-TaskGraph-v2 TG2-D49). @param {NonNullable<import("./subagents.js").Progress["asking"]>} q
 */
const waitsOn = (q) => ("to" in q ? `${q.plan ? "it sent you its plan" : "it asks you"}: "${q.question}"` : `may it run ${q.tool} \`${q.args}\`?`);
/**
 * A worker's question to its lead, as its look's head line and the watch say it: its number, how long it has waited —
 * with no clock (TG2-D58) — its words and its options, its pick first; or its plan, which waits for its lead's go, of
 * its 3 minutes (TG2-D50).
 * @param {import("./subagents.js").LeadAsking} q @param {number} at
 */
const leadAskWords = (q, at) => {
  if (q.plan) return `its plan waits for your go (ask ${q.n}), ${durationWords(at - q.at)} of ${durationWords(ASK_LEAD_SECONDS * 1000)} — "${q.question}"`;
  return `waiting for your answer (ask ${q.n}), ${durationWords(at - q.at)} so far — "${q.question}"${q.options.length ? ` — its options: ${q.options.map((o, i) => (i ? o : `${o} (its pick)`)).join(", ")}` : ""}`;
};
/**
 * The question a lead's answer names (HarnessV3-TaskGraph-v2 TG2-D42): a whole number from 1 — as the model wrote it, or
 * as its digits, the look's own "ask 2" included — else null. @param {unknown} v @returns {number | null}
 */
const askOf = (v) => {
  const n = typeof v === "string" ? Number(/^\s*(?:ask\s*)?(\d+)\s*$/i.exec(v)?.[1] ?? NaN) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : null;
};
/** A worker call of a lead that reads along that names every worker of its running now (TG2-D46). @param {any} input */
const toEveryone = (input) => String(input?.agent_id ?? "").trim().toLowerCase() === "all";
/** The reads of a worker, as the model names them: each goes alone in its call. */
const READS = Object.freeze(["show_trail", "show_changes", "show_report"]);
/** The parts a message to all never takes, as the model names them. */
const NOT_TO_ALL = Object.freeze(["stop", "apply_changes", "correction", ...READS]);

/**
 * A worker's running model call in the watch's words (HarnessV3-FailurePoints §5.1 item 1): how long it has run, what
 * has streamed, and how long since its newest byte — "model call 6 min · about 9,800 tokens of thinking so far · last
 * byte 1 s ago". A stuck call reads as one: its last byte long ago.
 * @param {import("./subagents.js").RunningCall} c @param {number} at  the clock that stamped it, now
 */
export function callWords(c, at) {
  const streamed = [c.thinking > 0 ? `${aboutTokens(c.thinking)} of thinking` : "", c.text > 0 ? `${aboutTokens(c.text)} of text` : ""].filter(Boolean).join(" and ");
  return `model call ${durationWords(at - c.began)}${streamed ? ` · ${streamed} so far` : ""} · ${c.lastAt != null ? `last byte ${durationWords(at - c.lastAt)} ago` : "nothing streamed yet"}`;
}

/**
 * How a running worker stands now, part by part: its round (or that it is starting), that Filament sent it back, its
 * check having failed, and Filament's check of its report while that runs (TG2-D45), the developer's answer it waits
 * for — by its question's number, which an answer names (HarnessV3-TaskGraph-v2 TG2-D42) — or its lead's to its
 * question (TG2-D49), and its changes waiting for its lead's review of a plan not sent yet (TG2-D50), the wait it is in
 * or its running model call, its newest tool, how full its context window is, its
 * compactions and its newest words — each part only when there is something to say. `look`: the parts a look's head
 * line gives (§12.6) — none of its newest tool and words, which the look's rounds show whole.
 * @param {{ progress: import("./subagents.js").Progress }} sa  the registry's view of it, with its progress
 * @param {number} at  the registry's now @param {{ look?: boolean }} [o]
 * @returns {string[]}
 */
export function watchParts(sa, at, { look = false } = {}) {
  const p = sa.progress;
  const c = p.context;
  const last = p.compactions.at(-1);
  const parts = [
    p.round ? `round ${p.round}` : "starting",
    p.bounce && sentBackWords(p.bounce),
    p.check && checkingWords(p.check, at),
    p.asking && ("to" in p.asking ? leadAskWords(p.asking, at) : `waiting for the developer's answer (ask ${p.asking.n}) — ${waitsOn(p.asking)}`),
    // Its plan still to come (TG2-D50), beside a question it asks meanwhile; once sent, its plan's own words say it waits.
    p.held && !(p.asking && "to" in p.asking && p.asking.plan) && "its changes wait for your review of its plan, not sent yet",
    p.wait || (p.call && callWords(p.call, at)),
    !look && p.tool && `last tool ${p.tool.name}${p.tool.args ? ` \`${p.tool.args}\`` : ""}`,
    c && (c.window ? `context ≈${c.tokens.toLocaleString()} of ${c.window.toLocaleString()} tokens (${Math.round((c.tokens / c.window) * 100)}%)` : `context ≈${c.tokens.toLocaleString()} tokens`),
    last && `compacted ${times(p.compactions.length)}, ${p.compactions.length === 1 ? "at" : "the newest at"} round ${last.round} (${last.how})`,
    !look && p.words && `newest words: "${p.words}"`,
  ];
  return /** @type {string[]} */ (parts.filter(Boolean));
}
/**
 * One running worker in the watch's words: who it is, and how it stands (`watchParts`).
 * @param {any} sa  the registry's view of it, with its progress @param {number} at  the registry's now
 */
function watchLine(sa, at) {
  return `- ${roleOf(sa)} ${sa.id} ("${sa.description}"${attemptWords(sa)}): ${watchParts(sa, at).join(" · ")}`;
}
/** Which attempt at its brief a worker is, after its task's words (TG2-D53): ", attempt 2 of 3", else nothing. @param {any} sa */
export const attemptWords = (sa) => (sa?.attempt ? `, attempt ${sa.attempt.n} of ${sa.attempt.of}` : "");

/** Why plan_review holds nothing for one that changes nothing (HarnessV3-TaskGraph-v2 TG2-D50). @param {string} tag */
const planHeldNothing = (tag) => `plan_review holds a worker's changes until you say go, and ${tag} changes nothing: leave plan_review out`;
/**
 * How many workers a launch's brief goes to at once (HarnessV3-TaskGraph-v2 TG2-D53): 2 or 3 — else null, one worker, as
 * a launch without attempts (1 says the same). @param {any} input @returns {2 | 3 | null}
 */
export const attemptsOf = (input) => {
  const n = Number(input?.attempts);
  return n === 2 || n === 3 ? n : null;
};
/**
 * Why a brief cannot go to several workers at once, read from its words alone (TG2-D53) — or null. What the session
 * says of a check, its worktrees and its seats is the registry's to read (`attempts`).
 * @param {any} i  the brief @param {import("../../core/roster.js").Member} member
 */
const attemptsProblem = (i, member) => {
  if (!grantsOf(i)?.check.length) return "attempts needs check: Filament runs each one's check when it reports, and the first that passes wins";
  if (member.may === "read") return `attempts are for a worker that changes files, and ${member.tag} changes nothing`;
  if (i.plan_review === true) return "plan_review and attempts go apart: you would review each attempt's plan";
  return null;
};

/**
 * Why a launch's brief cannot launch a worker, in the words the lead reads — or null. A follow-up and an apply are
 * worker's; the role — one of the team's members, by its tag — the task's words, the goal, its steps and the acceptance
 * check are required; what to read first, the files and what not to touch are lists when given; its check and may_run
 * grant what the member can run (grants.js, HarnessV3-TaskGraph-v2 TG2-D44); only a member that reviews takes a change
 * to review; plan_review holds the changes of one that makes some (TG2-D50); attempts are 2 or 3, need a check and a
 * member that changes files, never with plan_review nor a saved agent's question (TG2-D53).
 * @param {any} input @param {readonly import("../../core/roster.js").Member[]} members  the team's
 * @returns {string | null}
 */
export function checkBrief(input, members) {
  const i = input && typeof input === "object" ? input : {};
  const tags = members.map((m) => m.tag);
  if (given(i.agent_id)) return `agent launches a new worker — to message, stop or follow up on ${String(i.agent_id).trim()}, or apply its changes, call worker with that agent_id`;
  if (!given(i.role)) return `role must be one of ${tags.join(", ")}`;
  // Two or three workers at once, or one (TG2-D53).
  const attempts = attemptsOf(i);
  if (given(i.attempts) && attempts == null && Number(i.attempts) !== 1) return "attempts is 2 or 3: that many workers take the brief at once — leave it out for one";
  // A role that is no member's asks a saved agent (HarnessV4_Tasks E15 step 3): its goal is the question, and nothing
  // else is needed. Whether the session names that agent, the launch says.
  if (isAsk("agent", i, tags))
    return !given(i.goal) ? "goal is required: your question to the agent you ask, whole" : attempts ? "attempts are for a worker's brief: a saved agent you ask answers once" : i.plan_review === true ? planHeldNothing(String(i.role).trim()) : null;
  const member = memberOf(members, i.role);
  if (!member) return `role must be one of ${tags.join(", ")}`;
  if (!given(i.description)) return "description is required: three to five words naming the task";
  if (!given(i.goal)) return "goal is required: what must be true when the task is done";
  if (!textList(i.steps) || !i.steps.length) return "steps is required: what to do, in order, one non-empty step per item";
  if (!given(i.acceptance)) return "acceptance is required: the check that proves the task done";
  if (given(i.effort) && !SUBAGENT_EFFORTS.includes(String(i.effort).trim().toLowerCase())) return `effort must be one of ${SUBAGENT_EFFORTS.join(", ")}`;
  for (const field of ["read_first", "files", "dont_touch"]) if (i[field] != null && !textList(i[field])) return `${field} must be a list of non-empty strings`;
  const several = attempts ? attemptsProblem(i, member) : null;
  if (several) return several;
  const grants = grantsProblem(i, member);
  if (grants) return grants;
  if (i.plan_review === true && member.may === "read") return planHeldNothing(member.tag);
  if (given(i.review) && !reviews(member, members)) {
    const reader = reviewerOf(members);
    return reader
      ? `review is ${aOrAn(reader.tag)}'s: it names the change ${aOrAn(reader.tag)} reads, and ${aOrAn(member.tag)} takes none`
      : "review names a change for a worker that reviews to read, and your team has none: leave review out";
  }
  return null;
}

/**
 * Why a lead's call can do nothing, read from its input alone — a brief that cannot launch a worker, a worker call
 * without an agent_id, or whose parts do not go together — as the answer the lead reads; null when only running it can
 * tell. Both handlers ask it first. Every lead's worker takes its answer to a worker that waits, which names the
 * question by its number and goes alone (TG2-D58). `reads`: the lead reads along with its workers, so worker has its
 * reads (`show_trail`, `show_changes`, `show_report`), each alone in its call, and agent_id all, a message to every
 * worker running now: a prompt alone (TG2-D46); and agent has plan_review, whose plan reaches only a lead that reads
 * along (TG2-D50). `members`: the team's, which an agent call's role is read against.
 * @param {string} name @param {any} input @param {{ reads?: boolean, members?: readonly import("../../core/roster.js").Member[] }} [o]
 * @returns {TeamResult | null}
 */
export function inputRefusal(name, input, { reads = false, members = [] } = {}) {
  const i = input && typeof input === "object" ? input : {};
  if (name === "agent") {
    const why = checkBrief(i, members) || (i.plan_review === true && !reads ? "plan_review needs a lead that reads along with its workers (engine.supervise is off): its plan would reach no one" : null);
    return why ? refused(why) : null;
  }
  if (name !== "worker") return null;
  const id = String(i.agent_id ?? "").trim();
  if (!id) return nothing("Nothing done: worker needs agent_id — the id the worker's launch answered with.", "agent: a worker call without agent_id did nothing");
  const stop = i.stop === true;
  const apply = i.apply_changes === true;
  const correction = i.correction === true;
  const words = given(i.prompt);
  // Its yes to a call, its go to a plan (TG2-D41, D50): fields of an answer, never read from words.
  if ((i.allow != null || i.go != null) && !given(i.answer)) return nothing("Nothing done: allow and go go with answer — allow: true runs the call a worker waits on, go: true lets its plan start.", `agent: allow or go to ${id} without an answer did nothing`);
  // One message to every worker running now (TG2-D46): a prompt, and nothing else.
  if (reads && toEveryone(i)) {
    const with_ = NOT_TO_ALL.find((k) => i[k] === true) || (given(i.answer) ? "answer" : i.ask != null ? "ask" : given(i.reason) ? "reason" : given(i.overlap) ? "overlap" : "");
    if (with_) return nothing(`Nothing sent: agent_id all sends a message, so it takes prompt alone — never ${with_}: stop, follow up on or answer each worker by its own agent_id.`, `agent: a message to all workers with ${with_} sent nothing`);
    if (!words) return nothing("Nothing sent: agent_id all needs prompt — the message every worker of yours running now reads.", "agent: a message to all workers without prompt sent nothing");
    return null;
  }
  // Why a change Filament's check saw fail goes in anyway (TG2-D45): an apply's alone.
  if (given(i.reason) && !apply) return nothing("Nothing done: reason goes with apply_changes, for a change whose check failed.", `agent: a reason for ${id} without apply_changes did nothing`);
  // Its word on a change that overlaps edits in the folder (the owner's of 11-09): an apply's alone, and a lead's apply,
  // which Filament checks, takes send_back alone.
  if (given(i.overlap) && !apply) return nothing("Nothing done: overlap goes with apply_changes, for a change that overlaps edits in your folder.", `agent: an overlap for ${id} without apply_changes did nothing`);
  if (given(i.overlap) && String(i.overlap).trim() !== "send_back")
    return nothing(
      "Nothing done: overlap takes send_back alone in a lead's apply — Filament checks the folder with each change you apply, so nothing goes in half-merged. Send it back, or apply it once the files it overlaps are as its change needs them.",
      `agent: an apply of ${id}'s changes with overlap ${JSON.stringify(String(i.overlap)).slice(0, 40)} did nothing`,
    );
  // Its answer to a worker that waits goes alone (TG2-D41), and names the question it answers (TG2-D42): a worker may
  // ask again before the answer lands. Every lead answers its workers' questions (TG2-D58).
  if (given(i.answer)) {
    const with_ = words ? "prompt" : stop ? "stop" : apply ? "apply_changes" : correction ? "correction" : (reads && readOf(i)) || "";
    if (with_) return nothing(`Nothing answered: answer and ask go alone, never with ${with_} — send that as its own worker call.`, `agent: an answer to ${id} with ${with_} answered nothing`);
    if (askOf(i.ask) == null) return nothing("Nothing answered: answer needs ask, the number the question came with (ask 2) — a worker may ask again before your answer lands, and the number keeps your answer on the question you read.", `agent: an answer to ${id} without its ask answered nothing`);
    return null;
  }
  if (i.ask != null) return nothing("Nothing done: ask names the question an answer is for, and goes with answer.", `agent: an ask to ${id} without an answer did nothing`);
  const read = reads ? readOf(i) : null;
  if (read) {
    const asked = READS.filter((k) => i[k] === true);
    const with_ = words ? "prompt" : stop ? "stop" : apply ? "apply_changes" : correction ? "correction" : "";
    if (asked.length > 1) return nothing(`Nothing shown: ${listed(asked)} are ${asked.length === 2 ? "two" : "three"} calls.`, `agent: a read of ${id} asking for ${listed(asked)} at once showed nothing`);
    const what = read === "show_report" ? "show_report reads a worker's brief and reports" : `${read} reads a running worker`;
    if (with_) return nothing(`Nothing shown: ${what} and goes alone, never with ${with_} — send that as its own worker call.`, `agent: a ${read} of ${id} with ${with_} showed nothing`);
    return null;
  }
  if (stop && words) return nothing("Nothing done: stop takes no prompt — stop the worker, then brief the task again once it reports.", `agent: a stop of ${id} with a prompt did nothing`);
  if (correction && (apply || stop)) return nothing(`Nothing done: correction goes with a follow-up's prompt, never with ${apply ? "apply_changes" : "stop"}.`, `agent: a correction to ${id} with ${apply ? "apply_changes" : "stop"} did nothing`);
  if (stop && apply) return nothing("Nothing done: stop and apply_changes are two calls — stop the worker now, and apply its changes once it reports.", `agent: a stop of ${id} with apply_changes did nothing`);
  if (!stop && !apply && !words)
    return correction
      ? nothing("Nothing sent: a correction needs prompt — what fell short, and what to do instead.", `agent: a correction to ${id} without prompt sent nothing`)
      : nothing("Nothing sent: worker needs prompt — your message or follow-up — or stop: true, or apply_changes: true.", `agent: a worker call to ${id} without prompt sent nothing`);
  return null;
}

/** Which read of a worker a worker call asks for, or null. @param {any} input @returns {"show_trail" | "show_changes" | "show_report" | null} */
const readOf = (input) => (input?.show_trail === true ? "show_trail" : input?.show_changes === true ? "show_changes" : input?.show_report === true ? "show_report" : null);

/** How a worker's exchange ended, in the words of the team as it stands (TG2-D56). */
const ENDED_AS = Object.freeze({ done: "reported", "budget-stopped": "stopped at its budget", stopped: "was stopped", aborted: "was cut off before it finished", failed: "failed" });
/**
 * How a sub-agent of the lead's ended, in those words: a saved agent the lead asked answered, and a failure says why.
 * @param {any} sa @param {string | null | undefined} error  its newest exchange's
 */
const endedAs = (sa, error) => {
  const word = sa.status === "done" && sa.asked ? "answered" : ENDED_AS[/** @type {keyof typeof ENDED_AS} */ (sa.status)] || sa.status;
  return sa.status === "failed" && error ? `${word} (${error})` : word;
};
/**
 * A report's first line that says something, for a line of the team as it stands (TG2-D56): markdown's marks off,
 * cut short. @param {string | null | undefined} text
 */
const firstLine = (text) =>
  clip(
    String(text || "")
      .split("\n")
      .map((l) => l.replace(/\*\*|__/g, "").replace(/^[#>*\-\s]+/, "").trim())
      .find((l) => l && !/^[-=*_]{3,}$/.test(l)) || "",
    200,
  );
/** The lead's sub-agent, as the team's words name it: a worker by its role, a saved agent it asked by its card. @param {any} sa */
const whoOf = (sa) => (sa.team ? `${sa.team.role} ${sa.id} ("${sa.description}")` : `${sa.card?.name || "sub-agent"} ${sa.id} ("${sa.description}"), whom you asked`);
/** One of the lead's own: a worker of its team, or a saved agent it asked. @param {any} sa */
const leads = (sa) => !!sa.team || (!!sa.asked && sa.origin === "agent");
/**
 * A worker's change that waits for its lead to apply it, in a line: its files and lines, and what Filament's check saw
 * of it (TG2-D45) — a red one goes in only with a reason.
 * @param {any} sa
 */
const waitingWords = (sa) => {
  const w = sa.work;
  const c = sa.checked;
  const f = sa.folderRed;
  const checked = f
    ? `; the folder's check \`${f.command}\` failed with it (${f.exit === null ? "no exit code" : `exit ${f.exit}`}), and Filament undid your apply: apply it only with a reason, or follow up on it`
    : !c
      ? ""
      : c.exit === 0
        ? `; Filament's check \`${c.command}\` passed`
        : `; Filament's check \`${c.command}\` failed (${c.exit === null ? "no exit code" : `exit ${c.exit}`}): apply it only with a reason, or follow up on it`;
  return `${w.pending} file${w.pending === 1 ? "" : "s"} (+${w.added} −${w.removed})${checked}`;
};
/**
 * The exchange a worker's newest one answers: Filament's returns — its check's (TG2-D45) and the folder's after its lead's
 * apply (TG2-D55) — are the task's still. @param {readonly any[]} xs @param {number} i
 */
const askAt = (xs, i) => {
  let at = i;
  while (at > 0 && (xs[at]?.bounce || xs[at]?.folder)) at -= xs[at].bounce || 1;
  return Math.max(0, at);
};
/** Whether a worker that ended has a change waiting for its lead. @param {any} sa */
const waits = (sa) => sa.status !== "running" && !sa.task && !!sa.work?.pending;
/**
 * How many of a lead's workers that ended the words after its compaction name, the most recent: the rest by count and id.
 */
export const ENDED_MOST = 8;
/**
 * Whether a lead's worker ended with nothing left for it: it reported, failed or was stopped, and no change of its waits
 * — a graph task's worker aside, whose end the graph's own words carry. @param {any} sa
 */
const endedFor = (sa) => sa.status !== "running" && !waits(sa) && !sa.task;
/**
 * A lead's worker that ended, in a line of the words after its compaction: who it is and what it was given, how it ended
 * — its change applied, where it was — and its report's first line. @param {any} sa @param {string | null} report
 */
const endedLine = (sa, report) => {
  const first = firstLine(report);
  return `- ${whoOf(sa)}: ${endedAs(sa, sa.exchanges.at(-1)?.error)}${!sa.task && sa.work?.applied ? ", and its change is applied" : ""}${first ? ` — "${first}"` : "."}`;
};
/**
 * The line that names how many more of a lead's workers ended before those said: every one by id up to ENDED_MOST of
 * them, past it the most recent ENDED_MOST by id. @param {readonly any[]} earlier  oldest first
 */
const endedEarlier = (earlier) =>
  earlier.length > ENDED_MOST
    ? `- and ${earlier.length} more that ended earlier, the latest ${ENDED_MOST} of them ${listed(earlier.slice(-ENDED_MOST).map((sa) => sa.id))}`
    : `- and ${earlier.length} more that ended earlier: ${listed(earlier.map((sa) => sa.id))}`;
/** How a lead reads what a worker that ended found: its brief and reports whole where it reads along, else a follow-up. @param {boolean} reads */
const readEnded = (reads) => (reads ? "worker with an agent_id and show_report: true gives that worker's brief and its reports whole." : "To read more of what one of them found, follow it up: worker with its agent_id and prompt.");
/**
 * A loop lead's workers of its turn that ended (`ids`, oldest first, its door's), for the block that comes back after
 * Filament's fold of its context (reattach.js): a line each, the most recent ENDED_MOST — the ones before them by count
 * and id — and how to read them: `show_report` where the lead reads along, as `teamNow` says it, else a follow-up. None
 * where none ended. Those still running, or whose change waits, are the still-open lines'.
 * @param {{ get: (id: string) => any, report: (id: string) => string | null }} registry
 * @param {{ chainId: string, ids: readonly string[], reads: boolean }} o
 * @returns {string[]}
 */
export function endedWorkers(registry, { chainId, ids, reads }) {
  const ended = ids.map((id) => registry.get(id)).filter((sa) => !!sa && sa.chainId === chainId && leads(sa) && endedFor(sa));
  if (!ended.length) return [];
  const earlier = ended.slice(0, -ENDED_MOST);
  return [...ended.slice(-ENDED_MOST).map((sa) => endedLine(sa, registry.report(sa.id))), ...(earlier.length ? [endedEarlier(earlier)] : []), readEnded(reads)];
}
/**
 * What a running worker works on, in a sentence: its brief's goal, or the first line of the follow-up its newest
 * exchange is — Filament's return after a failed check is its task's still (TG2-D45), as is its return after the
 * folder's (TG2-D55). A saved agent's is its question, which its line names already. @param {any} sa
 */
const workingOn = (sa) => {
  if (!sa.team) return "";
  const at = askAt(sa.exchanges, sa.exchanges.length - 1);
  const prompt = String(sa.exchanges[at]?.prompt || "");
  if (at > 0) return ` On your follow-up: "${firstLine(prompt)}"`;
  const goal = /^Goal: (.+)$/m.exec(prompt)?.[1] || firstLine(prompt);
  return goal ? ` Its goal: ${sentence(clip(goal, 300))}` : "";
};

/**
 * A worker's task, laid out from its brief's parts: the task, the goal, what to read before it plans, the files, the
 * steps in order, the acceptance check, the commands that check it, and what not to touch (HarnessV3-TaskGraph-v2
 * TG2-D46). A list the brief left empty is left out. What else it may run is Filament's note's to say, where its
 * worktree lets it (TG2-D44).
 * @param {any} input  a brief `checkBrief` passed
 */
export function briefText(input) {
  /** @param {unknown} v */
  const list = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()) : []);
  /** @param {string[]} items */
  const lines = (items) => items.map((f) => `- ${f}`).join("\n");
  const first = list(input.read_first);
  const files = list(input.files);
  const check = list(input.check);
  const dont = list(input.dont_touch);
  return [
    `Your task: ${String(input.description).trim()}`,
    `Goal: ${String(input.goal).trim()}`,
    first.length > 0 && `Read first, before you plan:\n${lines(first)}`,
    files.length > 0 && `Files:\n${lines(files)}`,
    `Steps:\n${list(input.steps).map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
    `Acceptance check: ${String(input.acceptance).trim()}`,
    check.length > 0 && `Check:\n${lines(check)}`,
    dont.length > 0 && `Do not touch:\n${lines(dont)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The team's handlers over the sub-agent registry.
 * @param {{ registry: import("./subagents.js").SubagentRegistry }} deps
 */
export function createTeamTools({ registry }) {
  /**
   * `agent`: a worker launched in the background from its brief, under the lead's turn, as the member its role names.
   * A reviewing member's `review` names the worker whose change it reads — one that reported and waits to be applied.
   * @param {TeamCall} call @returns {Promise<TeamResult>}
   */
  async function agent(call) {
    const input = call.input && typeof call.input === "object" ? call.input : {};
    const members = call.team.members;
    // The models a worker can run on (HarnessV4_Tasks E23-D4), as a call's answer: nothing is launched, and the brief's
    // fields are not read.
    if (input.list_models === true) return modelsListed(call, input);
    const no = inputRefusal("agent", input, { reads: !!call.reads, members });
    if (no) return no;
    // Its model as the lead names it — as a person says it, at the provider it names (E23-D1 to D3, D9) — and its
    // effort (D5): the launch's own fields, or why that model cannot run. One several accounts serve runs on the lead's
    // own account first, where it runs on a coding agent's (the owner's of 11-06).
    const chosen = await registry.choice(input, { model: call.model, chainId: call.chainId });
    if (!chosen.ok) return refused(chosen.error);
    if (isAsk("agent", input, members.map((m) => m.tag))) return ask(call, input, chosen.fields);
    const role = String(input.role);
    const n = attemptsOf(input);
    /** @type {{ of: string, files: number, diff: string } | null} */
    let review = null;
    if (given(input.review)) {
      const of = String(input.review).trim().toLowerCase();
      if (registry.get(of)?.status === "running") return refused(`${of} is still working: order its review once it reports`);
      const change = await registry.changes(of, call.chainId);
      if (!change.ok) return refused(`${change.error} — brief the reviewer on the files instead, and leave review out`);
      if (!change.files.length) return refused(`${of} has no change waiting to be applied (it changed nothing, or its work was applied) — brief the reviewer on the files instead, and leave review out`);
      review = { of, files: change.files.length, diff: change.diff };
    }
    const got = await placed(call, input, chosen.fields, role, n, review);
    if (!("r" in got)) return attempted(call, got.attempts, role, /** @type {2 | 3} */ (n));
    const { spec, r } = got;
    if (!r.ok) return refused(r.error);
    const sa = /** @type {any} */ (registry.get(r.id));
    // Launched with no room: it starts by itself once a slot frees, and its card says for what it waits.
    const waiting = sa.waiting ? ` There is no room for it now (${sa.waiting.words}): it waits, and starts by itself once there is.` : "";
    const again = sa.may === "edit" ? "follow up or apply its changes" : "ask it more";
    // What its grants do is known once its worktree is made, or found not to be: a moment, which only a brief with grants
    // waits. Its team's check (the plan's p6) is among them where its launch gave it — to a member that edits, in a session
    // that lets Filament run it — and said where it did not.
    const teamCheck = sa.may === "edit" && !r.unchecked ? spec.team?.check : null;
    const grants = withTeamCheck(grantsOf(input), teamCheck);
    const granted = `${grants ? launchWords(grants, await r.tree) : ""}${r.unchecked ? ` ${uncheckedWords(r.unchecked)}` : ""}`;
    // Said where its run started held, as the registry holds it.
    const planned = registry.planHeld(sa.id) ? " It sends you its plan with ask_lead before it changes anything: its changes and commands wait for your go, or 3 minutes after its plan with no answer." : "";
    const { on, chose } = registry.launchWords(sa.id);
    return {
      ok: true,
      text: `Launched ${role} ${sa.id} ("${sa.description}")${on} in the background.${chose}${waiting}${planned}${granted} Keep working: its report arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait. To message or stop it while it works, or to ${again} once it reports, call worker with agent_id "${sa.id}". ${registry.standing(call.chainId, "workers")}`,
      note: `agent: launched ${role} ${sa.id} (${sa.model}${sa.effort ? ` at ${sa.effort}` : ""}${sa.view !== "none" ? `, ${sa.view} view` : ""}${review ? `, reviewing ${review.of}` : ""}) for team ${call.team.name} in the background`,
      agentId: sa.id,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  /**
   * A worker's launch from its brief, or its attempts, as far as the registry holding them: the spec and the registry's
   * answer. @param {TeamCall} call @param {any} input @param {any} fields  its model and effort, as the call chose them
   * @param {string} role @param {2 | 3 | null} n @param {{ of: string, files: number, diff: string } | null} review
   * @returns {Promise<{ spec: import("./subagents.js").LaunchSpec, attempts: any } | { spec: import("./subagents.js").LaunchSpec, r: any }>}
   */
  async function placed(call, input, fields, role, n, review) {
    /** @type {import("./subagents.js").LaunchSpec} */
    const spec = {
      origin: "agent",
      chainId: call.chainId,
      prompt: briefText(input),
      description: String(input.description),
      view: input.context,
      background: true,
      cwd: call.cwd,
      mode: call.mode,
      parentModel: call.model,
      thinking: call.thinking,
      team: workerOf(call.team, role),
      review,
      lead: call.lead,
      // What its brief says of its files: a write outside them is a sign its lead's look names (TG2-D15).
      files: { files: Array.isArray(input.files) ? input.files.map(String) : [], dontTouch: Array.isArray(input.dont_touch) ? input.dont_touch.map(String) : [] },
      // What it may run without anyone's answer, in a worktree of its own (TG2-D44).
      grants: grantsOf(input),
      // Its changes wait for its lead's go on its plan (TG2-D50).
      planReview: input.plan_review === true,
      // Its team's own models, in order; with no room now it waits for some (team_v2_plan §5.7).
      rows: await registry.teamRows(call.team, call.chainId),
      waits: true,
      ...fields,
    };
    if (n) return { spec, attempts: await registry.attempts(spec, n) };
    return { spec, r: await registry.launch(spec) };
  }

  /**
   * `agent` with attempts (HarnessV3-TaskGraph-v2 TG2-D53): the brief launched as that many workers of its member at
   * once, each in a worktree of its own — or refused, nothing launched. The launch answers with the first one's id.
   * @param {TeamCall} call @param {any} r  the registry's answer to the attempts @param {string} role @param {2 | 3} n
   * @returns {Promise<TeamResult>}
   */
  async function attempted(call, r, role, n) {
    if (!r.ok) return refused(r.error);
    const first = /** @type {any} */ (registry.get(r.ids[0]));
    // A lead that reads along is told it reads none of these: their questions still reach it.
    const along = call.reads ? " You do not read along with them; a question of theirs reaches you as a message." : "";
    const { on, chose } = registry.launchWords(first.id);
    return {
      ok: true,
      text: `Launched ${n} attempts at "${first.description}"${on} in the background: ${role} ${listed(r.ids)}, each in a worktree of its own.${chose} Filament runs each one's check when it reports: the first that passes is your worker, and its report alone reaches you; the others are stopped and their work dropped. If none passes, each report reaches you.${along} To message or stop one, call worker with its agent_id. ${registry.standing(call.chainId, "workers")}`,
      note: `agent: launched ${n} attempts of ${role} (${r.ids.join(", ")}; ${first.model}${first.effort ? ` at ${first.effort}` : ""}) for team ${call.team.name} in the background`,
      agentId: first.id,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  /**
   * The lead asks a saved agent the session names by its tag (HarnessV4_Tasks E15 step 3, L-52), in the background
   * like a worker's launch (AG-52): the agent sees the session and works as its card says — at its level, in its own
   * copy where it may change files (OA1) — and its answer arrives as a message. The launch refuses, in words that list whom the lead may ask, one the session does not name.
   * `chosen`: the model and the effort the call names (E23), as the registry's choice read them.
   * @param {TeamCall} call @param {any} input @param {{ model?: string, chose?: string, effort?: string }} chosen
   * @returns {TeamResult}
   */
  function ask(call, input, chosen) {
    const r = registry.launch({
      origin: "agent",
      chainId: call.chainId,
      prompt: String(input.goal).trim(),
      description: given(input.description) ? String(input.description) : undefined,
      as: String(input.role).trim(),
      background: true,
      cwd: call.cwd,
      mode: call.mode,
      parentModel: call.model,
      thinking: call.thinking,
      lead: call.lead,
      roster: call.team.members,
      ...chosen,
    });
    if (!r.ok) return refused(r.error);
    const sa = /** @type {any} */ (registry.get(r.id));
    const name = sa.card?.name || String(input.role);
    const { on, chose } = registry.launchWords(sa.id);
    return {
      ok: true,
      text: `Asked ${name} (${sa.id})${on} in the background.${chose} Keep working: its answer arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait. ${registry.standing(call.chainId)}`,
      note: `agent: asked ${name}, a saved agent (${sa.id}, ${sa.model}${sa.view !== "none" ? `, ${sa.view} view` : ""}) for team ${call.team.name} in the background`,
      agentId: sa.id,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  /**
   * The models a lead's worker can run on (HarnessV4_Tasks E23-D4), each with its seats in the session's lists; model
   * and provider narrow them. It launches nothing.
   * @param {TeamCall} call @param {any} input @returns {Promise<TeamResult>}
   */
  async function modelsListed(call, input) {
    const text = await registry.models(call.chainId, { model: given(input.model) ? String(input.model) : null, provider: given(input.provider) ? String(input.provider) : null });
    return { ok: true, text, note: "agent: listed the models a worker can run on", wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] };
  }

  /**
   * The lead's watch: the workers running in the session now — a running one's view carries its progress — oldest
   * first, each with that progress: the words the lead's wait answers with, and the same as plain JSON (AH-O10).
   * @param {{ chainId: string }} o
   * @returns {{ text: string, workers: { id: string, role: string, description: string, model: string, progress: any }[] }}
   */
  function watch({ chainId }) {
    const running = registry.list(chainId).filter((s) => s.team && s.progress).reverse();
    return {
      text: running.length ? `Workers still running (${running.length}):\n${running.map((s) => watchLine(s, registry.now())).join("\n")}` : "No worker is running now.",
      workers: running.map((s) => ({ id: s.id, role: roleOf(s), description: s.description, model: s.model, progress: s.progress })),
    };
  }

  /**
   * A read of a running worker, for a lead that reads along (TG2-D14, TG2-D17): its rounds whole from the round named,
   * or what it has changed so far. The lead's conversation keeps the newest of each for a worker (looks.js
   * `tidyLooks`).
   * @param {TeamCall} call @param {string} id @param {"show_trail" | "show_changes"} read @param {any} input
   * @returns {Promise<TeamResult>}
   */
  async function shown(call, id, read, input) {
    const seen = registry.get(id);
    const sa = seen && seen.chainId === call.chainId ? seen : null;
    const what = read === "show_trail" ? "trail" : "change so far";
    const why = !sa
      ? noSuchSubagent(id)
      : !sa.team
        ? `${id} is ${whose(sa)}, not one of your workers`
        : sa.status !== "running" && read === "show_trail"
          ? `${roleOf(sa)} ${id} is not running: its report stands for its work — follow up on it to ask it more, or read what it changed with show_changes`
          : null;
    if (why || !sa) return nothing(`Nothing shown: ${why}.`, `agent: a ${what} of ${id} not shown — ${why}`);
    const r = read === "show_trail" ? registry.trail(id, call.chainId, { fromRound: Number(input.from_round) || 0 }) : await registry.changesSoFar(id, call.chainId);
    if (!r.ok) return nothing(`Nothing shown: ${r.error}.`, `agent: a ${what} of ${id} not shown — ${r.error}`);
    return { ok: true, text: r.text, note: `agent: the ${what} of ${roleOf(sa)} ${id}, shown to its lead (${r.note})`, agentId: id, wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] };
  }

  /**
   * A worker's brief and its reports whole, for a lead that reads along (`show_report`, HarnessV3-TaskGraph-v2 TG2-D56):
   * each thing it was asked — the brief, each follow-up — and the report the lead heard of it; Filament's return after a
   * failed check is the report's (TG2-D45), and a running one's newest ask has none yet. Last, its change where one
   * waits, or that it is applied. A saved agent the lead asked gives its questions and answers. After the lead's own
   * context was compacted, the way back to what its summary left out.
   * @param {TeamCall} call @param {string} id @returns {TeamResult}
   */
  function reported(call, id) {
    registry.recall(call.chainId);
    const seen = registry.detail(id);
    const sa = seen && seen.chainId === call.chainId ? seen : null;
    const why = !sa ? noSuchSubagent(id) : !leads(sa) ? `${id} is ${whose(sa)}, not one of your workers` : null;
    if (why || !sa) return nothing(`Nothing shown: ${why}.`, `agent: the brief and reports of ${id} not shown — ${why}`);
    // Each of its asks with the exchange that answered it: a return Filament made is the ask's still — after its check
    // failed (TG2-D45), or the folder's after your apply (TG2-D55).
    /** @type {{ ask: any, end: any, folder: number }[]} */
    const asks = [];
    for (const x of sa.exchanges) {
      const open = asks.at(-1);
      if ((x.bounce || x.folder) && open) {
        open.end = x;
        if (x.folder) open.folder = x.folder;
      } else asks.push({ ask: x, end: x, folder: 0 });
    }
    const [brief, report] = sa.asked ? ["question", "answer"] : ["brief", "report"];
    const progress = sa.progress;
    const parts = asks.map(({ ask, end, folder }, i) => {
      const asked = `${i === 0 ? `Your ${brief}` : ask.by === "agent" ? "Your follow-up" : "A follow-up of the developer's"}:\n${ask.prompt}`;
      if (end.status === "running") return `${asked}\n\nIt is still at work on it (${progress ? watchParts({ progress }, registry.now(), { look: true })[0] : "starting"}): show_trail: true reads its rounds.`;
      const back = [folder ? `${folder === 1 ? "once" : "twice"} for the folder's check after your apply` : "", end.bounce ? `${end.bounce === 1 ? "once" : "twice"} for its check` : ""].filter(Boolean);
      const how = back.length ? `, after Filament sent it back ${back.join(" and ")}` : end.status !== "done" ? `, after it ${endedAs({ ...sa, status: end.status }, end.error)}` : "";
      return `${asked}\n\nIts ${report}${how}:\n${end.report || `(no ${report})`}`;
    });
    const change = waits(sa) ? `Its change waits for you to apply it: ${waitingWords(sa)}.` : !sa.task && sa.work?.applied && !sa.work.pending ? "Its change is applied: it is in your folder." : "";
    const told = asks.filter((a) => a.end.status !== "running").length;
    const n = asks.length;
    const head = sa.asked ? `your question${n === 1 ? "" : "s"} to ${sa.card?.name || "sub-agent"} ${id} and its answer${n === 1 ? "" : "s"}, whole` : `the brief and reports of ${roleOf(sa)} ${id} ("${sa.description}"), whole`;
    return {
      ok: true,
      text: [`[Filament: ${head}.]`, ...parts, change].filter(Boolean).join("\n\n"),
      note: `agent: the ${sa.asked ? `questions to ${sa.card?.name || "sub-agent"} ${id} and its answers` : `brief and reports of ${roleOf(sa)} ${id}`}, shown to its lead (${told ? `${told} ${report}${told === 1 ? "" : "s"}` : `no ${report} yet`})`,
      agentId: id,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  /**
   * The lead's team as it stands now, for a lead whose agent just compacted its own context (HarnessV3-TaskGraph-v2
   * TG2-D56): a line for each of its sub-agents of the turn (`ids`, oldest first) — a running one's round and what it
   * works on, one whose change waits its files, Filament's check and its report whole after the lines, the others how they
   * ended and their report's first line — and how to read more: `show_report` where the lead reads along, else a
   * follow-up. Those that ended with nothing left for it are the most recent ENDED_MOST, the rest by count and id; a graph
   * task's that ended is the graph's to say. A report not delivered yet (`coming`) is said by the message that follows
   * these words, so they only say it comes — its envelope, where the lead takes it sealed (`sealed`,
   * HarnessV4_Envelopes_Plan EN3). Null where the turn has none of them: nothing of a team to say. Its words are a part
   * of the block that comes back after the compaction (sessions/reattach.js `team`), which says the compaction.
   * @param {{ chainId: string, ids: readonly string[], reads: boolean, coming?: readonly string[], sealed?: boolean }} o
   * @returns {{ text: string, workers: number } | null}
   */
  function teamNow({ chainId, ids, reads, coming = [], sealed = false }) {
    const at = registry.now();
    const next = new Set(coming);
    const team = /** @type {any[]} */ (ids.map((id) => registry.get(id)).filter((sa) => !!sa && sa.chainId === chainId && leads(sa) && !(sa.task && sa.status !== "running" && !next.has(sa.id))));
    if (!team.length) return null;
    const comes = sealed ? "its envelope comes right after these words" : "its report comes right after these words";
    const line = (/** @type {any} */ sa) => {
      const head = `- ${whoOf(sa)}:`;
      if (sa.status === "running") return `${head} running — ${watchParts(sa, at, { look: true }).join(" · ")}.${workingOn(sa)}`;
      const ended = endedAs(sa, sa.exchanges.at(-1)?.error);
      if (waits(sa)) return `${head} ${ended}, and its change waits for you to apply it — ${waitingWords(sa)}. ${next.has(sa.id) ? `${comes[0].toUpperCase()}${comes.slice(1)}.` : "Its report is below, whole."}`;
      if (next.has(sa.id)) return `${head} ${ended}${!sa.task && sa.work?.applied ? ", and its change is applied" : ""} — ${comes}.`;
      return endedLine(sa, registry.report(sa.id));
    };
    // Those that ended with nothing left for the lead: the most recent said, the ones before them by id.
    const ended = team.filter((sa) => endedFor(sa) && !next.has(sa.id));
    const earlier = new Set(ended.slice(0, -ENDED_MOST));
    const whole = team.filter((sa) => waits(sa) && !next.has(sa.id)).map((sa) => `The report of ${roleOf(sa)} ${sa.id} ("${sa.description}"):\n${registry.report(sa.id) || "(no report)"}`);
    const n = team.length;
    const reach = ended.length ? "To reach any of them, call worker with its agent_id: a follow-up to one that ended asks it for more of what it found." : "To reach any of them, call worker with its agent_id.";
    return {
      workers: n,
      text: [
        `Your team as it stands now — ${n === 1 ? "the one worker of this turn" : `the ${n} workers of this turn, oldest first`}:\n${[...team.filter((sa) => !earlier.has(sa)).map(line), ...(earlier.size ? [endedEarlier([...earlier])] : [])].join("\n")}`,
        ...whole,
        reads ? "worker with an agent_id and show_report: true gives that worker's brief and its reports whole, and show_trail: true a running one's rounds." : reach,
      ].join("\n\n"),
    };
  }

  /**
   * A lead's answer to a worker of its team that waits for the developer's answer on a call (HarnessV3-TaskGraph-v2
   * TG2-D41): as the developer's would, the call judged again by the session's switch. `allow: true` runs it; without
   * it, its words refuse it, and the worker hears them — never read for a yes (the owner's rule). Whichever answer
   * comes first settles the call. `n`: the question
   * it answers, by its number (TG2-D42) — one settled, or never asked, settles nothing, and the lead reads the question
   * that waits now, which it can answer in one call. A worker's question to its lead (TG2-D49) is the lead's own to
   * answer, in any words — every lead answers it, whether it reads along or not (TG2-D58); a call's question, only one
   * that reads along.
   * Its plan's go is `go: true` alone (TG2-D50); other words are its corrections.
   * @param {TeamCall} call @param {string} id @param {string} words @param {number} n
   * @param {{ allow?: boolean, go?: boolean }} [o] @returns {TeamResult}
   */
  function answered(call, id, words, n, { allow = false, go: gives = false } = {}) {
    const seen = registry.get(id);
    const sa = seen && seen.chainId === call.chainId ? seen : null;
    const asking = sa?.status === "running" ? sa.progress?.asking || null : null;
    const toLead = !!asking && "to" in asking;
    const yes = !toLead && allow;
    const who = sa ? `${roleOf(sa)} ${id}` : id;
    const why = !sa
      ? noSuchSubagent(id)
      : !sa.team
        ? `${id} is ${whose(sa)}, not one of your workers — its questions are the developer's to answer`
        : !asking
          ? `${who} is not waiting for an answer${n <= sa.questions ? `: ask ${n} is settled` : ""}`
          : !toLead && !call.reads
            ? `${who} waits for the developer's answer on its ${asking.tool} call (ask ${asking.n}) — that one is theirs to answer; you answer the questions your workers ask you`
            : n !== asking.n
              ? `${n < asking.n ? `${who}'s ask ${n} is settled: it waits on ask ${asking.n} now` : `${who} has asked no ask ${n}: it waits on ask ${asking.n}`} — ${waitsOn(asking)} Answer that one with ask ${asking.n}, if you mean to`
              : null;
    if (why || !sa || !asking) return nothing(`Nothing answered: ${why}.`, `agent: an answer to ${id} answered nothing — ${why}`);
    const r = registry.answer(id, call.chainId, words, { by: "lead", n, allow: yes, go: toLead && asking.plan && gives });
    if (!r.ok) return nothing(`Nothing answered: ${r.error}.`, `agent: an answer to ${id} answered nothing — ${r.error}`);
    const end = "Its report still arrives as a message when it finishes.";
    // Its plan (TG2-D50): its go (`go: true`) lets its changes run; other words are corrections, and the hold stays.
    // A question it asks while its plan is still to come is a question: its changes wait on, which the answer says.
    const plan = toLead && asking.plan;
    const go = plan && gives;
    const toCome = toLead && !plan && sa.progress?.held === true ? " — its changes still wait for its plan, which it has not sent yet" : "";
    return {
      ok: true,
      text: plan
        ? go
          ? `Answered ${who}'s ask ${n}: go — it may change files and run commands now. ${end}`
          : `Answered ${who}'s ask ${n}, as no go — only go: true lets it start — so its changes and commands still wait: it reads your words now and sends its plan again. ${end}`
        : toLead
          ? `Answered ${who}'s ask ${n}: it reads your answer now and goes on${toCome}. ${end}`
          : yes
            ? `Answered ${who}'s ask ${n}: yes — its ${asking.tool} call runs now, unless a rule or the session's mode refuses it. ${end}`
            : `Answered ${who}'s ask ${n}: no — its ${asking.tool} call is not run, and it reads your words at its next step. ${end}`,
      note: plan ? `agent: the lead answered ${who}'s ask ${n} (its plan: ${go ? "go" : "no go"})` : toLead ? `agent: the lead answered ${who}'s ask ${n} (its question to its lead)` : `agent: the lead answered ${who}'s ask ${n} (its ${asking.tool} call): ${yes ? "yes" : "no"}`,
      agentId: id,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  /**
   * What Filament's check saw of the change an apply names (HarnessV3-TaskGraph-v2 TG2-D45): where it failed, the command
   * and its exit in words — and why the apply does nothing as it stands: a change Filament saw fail goes in only with a
   * reason, and a reason only with such a change. So does a change the folder's check failed with once the lead applied
   * it, which Filament undid and which waits, not sent back (`folder`, TG2-D55); and a reason may carry a change the
   * folder's check undid since an apply of it last stood, back from its worker or not (`undone`). Null for a call that
   * applies nothing.
   * @param {string} chainId @param {any} input
   * @returns {{ failed: string, folder: boolean, refusal: TeamResult | null } | null}
   */
  const checkedWork = (chainId, input) => {
    if (input?.apply_changes !== true) return null;
    registry.recall(chainId);
    const id = String(input.agent_id ?? "").trim();
    const seen = registry.get(id);
    const sa = seen && seen.chainId === chainId ? seen : null;
    const folder = sa?.folderRed || null;
    const own = sa?.checked && sa.checked.exit !== 0 ? sa.checked : null;
    const undone = folder || own ? null : sa?.folderUndone || null;
    const red = folder || own || undone;
    const failed = red ? `\`${red.command}\`, ${red.exit === null ? "no exit code" : `exit ${red.exit}`}` : "";
    const who = sa ? `${roleOf(sa)} ${id}` : id;
    const refusal =
      folder && !given(input.reason)
        ? nothing(
            `Nothing applied: Filament's check of the folder failed with ${who}'s change (${failed}), and the apply was undone. Apply it anyway with reason — why it goes in though the folder's check fails — or follow up on it.`,
            `agent: an apply of ${id}'s changes did nothing — the folder's check failed with it (${failed}), and no reason came with it`,
          )
        : own && !given(input.reason)
          ? nothing(`Nothing applied: Filament's check of ${who}'s change failed (${failed}). Apply it anyway with reason — why it goes in failing — or follow up on it.`, `agent: an apply of ${id}'s changes did nothing — its check failed (${failed}), and no reason came with it`)
          : !red && given(input.reason)
            ? nothing(
                `Nothing applied: reason goes with a change whose check Filament saw fail, or one Filament's check of the folder undid after your apply, and neither happened to ${who}'s change — apply it without reason.`,
                `agent: an apply of ${id}'s changes with a reason did nothing — no check of it failed`,
              )
            : null;
    return { failed, folder: !!(folder || undone), refusal };
  };

  /**
   * The apply of a worker's change. One Filament's check saw fail (TG2-D45) goes in only with the lead's reason — why it
   * goes in failing — which the record keeps; without one nothing is applied, and the lead reads how to go on. So does
   * one the folder's check failed with after the lead's apply before (TG2-D55). Filament checks the folder with every
   * change its lead applies, and the call waits for the verdict as long as the lead's agent lets it, less a margin.
   * @param {TeamCall} call @param {string} id @param {any} input @returns {Promise<TeamResult>}
   */
  async function applied(call, id, input) {
    const c = checkedWork(call.chainId, input);
    if (c?.refusal) return c.refusal;
    // A change the folder's check undid and its worker brought back needs no reason: one given goes with it.
    const reason = c?.failed && given(input.reason) ? String(input.reason).trim() : null;
    const over = reason ? `over ${c?.folder ? "the folder's" : "its"} failed check (${c?.failed}), for this reason: ${reason}` : null;
    // Where its change overlaps edits in the folder, sent back to its worker to redo on the folder as it stands (11-09).
    const overlap = given(input.overlap) ? /** @type {const} */ ("send_back") : null;
    const r = await registry.apply(id, call.chainId, "agent", { reason, lead: call.lead, holdMs: heldFor(call.patienceMs ?? MCP_PATIENCE_MS), overlap });
    return { ...appliedResult(id, r, { over, tool: "worker", overlap }), agentId: id };
  }

  /**
   * One message of a lead that reads along to every worker of its team running now (HarnessV3-TaskGraph-v2 TG2-D46):
   * each reads it at its next step, as a message to one does — one that waits for an answer, after that answer. A
   * worker that cannot take one now is named, with why; the others still get it. The developer's own sub-agents are not
   * the lead's to message.
   * @param {TeamCall} call @param {string} text @returns {TeamResult}
   */
  function toAll(call, text) {
    const running = registry.list(call.chainId).filter((s) => s.team && s.status === "running").reverse();
    if (!running.length) return nothing("Nothing sent: no worker of yours is running now.", "agent: a message to all workers sent nothing — none was running");
    const who = (/** @type {any} */ s) => `${roleOf(s)} ${s.id}`;
    const tried = running.map((s) => ({ s, m: registry.message(s.id, { chainId: call.chainId, text, from: "lead" }) }));
    const sent = tried.flatMap((t) => (t.m.ok ? [{ s: t.s, m: t.m }] : []));
    const not = tried.flatMap((t) => (t.m.ok ? [] : [{ s: t.s, error: t.m.error }]));
    if (!sent.length) return nothing(`Nothing sent. ${not.map((t) => `To ${who(t.s)}: ${t.error}.`).join(" ")}`, `agent: a message to all workers sent nothing — ${not.map((t) => `${who(t.s)}: ${t.error}`).join("; ")}`);
    const one = sent.length === 1;
    const after = sent.flatMap((t) => (t.m.asking ? [`${one ? "" : `${who(t.s)} `}${t.m.lead ? "after your answer to its question" : `after the answer it waits for, on its ${t.m.asking} call`}: ask ${t.m.ask}`] : []));
    const all = running.length;
    return {
      ok: true,
      text: `Sent to ${sent.length} worker${one ? "" : "s"} running now — ${listed(sent.map((t) => who(t.s)))}: ${one ? "it reads" : "each reads"} it at its next step${after.length ? ` (${after.join("; ")})` : ""}.${not.map((t) => ` Not to ${who(t.s)}: ${t.error}.`).join("")} ${all === 1 ? "Its report still arrives as a message when it finishes." : "Their reports still arrive as messages when they finish."}`,
      note: `agent: one message to ${sent.length === all ? `the ${all} worker${all === 1 ? "" : "s"}` : `${sent.length} of the ${all} workers`} running now (${sent.map((t) => who(t.s)).join(", ")}), read at ${one ? "its" : "each one's"} next step${not.length ? ` — not to ${not.map((t) => `${who(t.s)}: ${t.error}`).join("; ")}` : ""}`,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  /**
   * `worker`: a worker reached by its agent_id. A running one takes a message, which its loop reads at its next step,
   * or a stop. One that reported takes a follow-up in the context it already has, in the background under the lead's
   * turn — with `correction`, the lead says its work fell short — or, with `apply_changes`, its worktree's changes are
   * applied to the session's folder (one Filament's check saw fail, with `reason`): a graph task's worker's go in through
   * the graph (HarnessV3-TaskGraph G3-4). The parts that do not go together are refused in words. Every lead answers a
   * worker's question by its number (TG2-D58); a lead that reads along names every worker of its running now with `all`
   * (TG2-D46).
   * @param {TeamCall} call @returns {Promise<TeamResult>}
   */
  async function worker(call) {
    const input = call.input && typeof call.input === "object" ? call.input : {};
    const no = inputRefusal("worker", input, { reads: !!call.reads });
    if (no) return no;
    if (call.reads && toEveryone(input)) return toAll(call, String(input.prompt).trim());
    const id = String(input.agent_id).trim();
    if (given(input.answer)) return answered(call, id, String(input.answer).trim(), /** @type {number} */ (askOf(input.ask)), { allow: input.allow === true, go: input.go === true });
    const read = call.reads ? readOf(input) : null;
    if (read === "show_report") return reported(call, id);
    if (read) return shown(call, id, read, input);
    const stop = input.stop === true;
    const correction = input.correction === true;
    // A worker the session kept from before a restart is named like any other.
    registry.recall(call.chainId);
    // A graph task's change is the lead's to apply too (the owner's of 11-02): the registry's apply takes it the graph's way.
    if (input.apply_changes === true) return applied(call, id, input);
    const seen = registry.get(id);
    const sa = seen && seen.chainId === call.chainId ? seen : null;
    const running = sa?.status === "running";
    if (stop) {
      const why = !sa ? noSuchSubagent(id) : !sa.team ? notYours(sa) : !running ? `${roleOf(sa)} ${id} is not running` : null;
      if (why) return nothing(`Nothing stopped: ${why}.`, `agent: a stop of ${id} stopped nothing — ${why}`);
      registry.stop(id, { from: "lead" });
      return { ok: true, text: `Stopping ${roleOf(sa)} ${id} now; its report so far arrives as a message.`, note: `agent: stopped ${roleOf(sa)} ${id}`, agentId: id, wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] };
    }
    if (sa && running) {
      const why = !sa.team
        ? notYours(sa)
        : correction
          ? `a correction marks work a worker reported, and ${roleOf(sa)} ${id} is still working — send your message without correction, or wait for its report`
          : null;
      if (why) return nothing(`Nothing sent: ${why}.`, `agent: a message to ${id} not sent — ${why}`);
      const m = registry.message(id, { chainId: call.chainId, text: String(input.prompt), from: "lead" });
      if (!m.ok) return nothing(`Nothing sent: ${m.error}.`, `agent: a message to ${id} not sent — ${m.error}`);
      // A lead that reads along may answer that call itself (TG2-D41). A question the worker asked it (TG2-D49) is its
      // own to answer.
      const waitsFor = !call.reads ? "the developer's answer" : "an answer — the developer's, or yours with answer —";
      const now = !m.asking
        ? "it reads your message at its next step, while it works"
        : m.lead
          ? `it waits for your answer to its question (ask ${m.ask}) now — give it with answer and ask — and reads your message at its next step after that`
          : `it waits for ${waitsFor} on a ${m.asking} call (ask ${m.ask}) now, and reads your message at its next step after that answer`;
      return {
        ok: true,
        text: `Sent to ${roleOf(sa)} ${id}: ${now}. Its report still arrives as a message when it finishes.`,
        note: `agent: a message to ${roleOf(sa)} ${id} (${sa.model}), read at its next step${!m.asking ? "" : m.lead ? ` — after its lead's answer to its question (ask ${m.ask})` : ` — after the developer's answer on the ${m.asking} call it waits for (ask ${m.ask})`}`,
        agentId: id,
        wrote: false,
        spentUsd: 0,
        toolCalls: 0,
        roundIds: [],
      };
    }
    if (correction && sa && !sa.team) {
      const why = `a correction marks your workers' work, and ${id} is ${whose(sa)} — follow up without correction`;
      return nothing(`Nothing sent: ${why}.`, `agent: a correction to ${id} not sent — ${why}`);
    }
    const r = registry.followUp(id, { prompt: String(input.prompt), chainId: call.chainId, lead: call.lead, background: true, correction });
    if (!r.ok) return nothing(`Nothing sent: ${sentence(r.error)}`, `agent: a follow-up to ${id} not sent — ${r.error}`);
    const done = /** @type {any} */ (registry.get(r.id));
    const role = roleOf(done);
    const what = correction ? "correction" : "follow-up";
    return {
      ok: true,
      text: `${role[0].toUpperCase()}${role.slice(1)} ${done.id} took your ${what} in the background. Keep working: its report arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait.`,
      note: `agent: a ${what} to ${role} ${done.id} (${done.model}) in the background${!correction ? "" : r.marked ? " — memory counts its last task as corrected" : " — memory marked no outcome of its last task"}`,
      agentId: done.id,
      wrote: false,
      spentUsd: 0,
      toolCalls: 0,
      roundIds: [],
    };
  }

  return { agent, worker, watch, teamNow };
}
