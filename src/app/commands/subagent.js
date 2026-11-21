// @ts-check
// `/subagent …` (HarnessV3 §15 item 86): launch a sub-agent from a chat Filament runs, optionally with a view of the
// session's conversation composed locally (no model call), and follow it: list, status, stop, ask again. The report
// goes to the session's agent, at its next round or with the next turn, or stays with the developer as the command's
// answer (`wait=on`, a start, an agent called by its tag) until they send it on.
import { answerWith, answerAfter, commandChain, openCommandRecord } from "./answer.js";
import { SUBAGENT_VIEWS } from "../../services/session-settings.js";
import { sentence } from "../../core/text.js";
import { startFields } from "../../services/subagent-starts.js";
import { BTW_WORD } from "./parse.js";
import { agentsPage } from "../../core/teams-on.js";

/** @typedef {import("../pipeline/context.js").RequestContext} RequestContext */
/** @typedef {import("../deps.js").AppDeps} AppDeps */
/** @typedef {import("./parse.js").SubagentCommand} SubagentCommand */

/**
 * The command's forms, the Library's page of saved agents named as Settings › Experimental's Teams switch has it.
 * @param {any} cfg
 */
const usageOf = (cfg) => [
  "**/subagent** — a fresh agent on one task, with this session's tools and settings.",
  "- `/subagent <task>` — launch one. Options go before the task, each as `key=value`, a value with spaces in quotes: `model=<name>` (as Filament lists it or as you'd say it — `model=\"Kimi K3\"`; else the first with room of the session's Default models for sub-agents, `subagents.pool`), `provider=<name>` (who runs that model where several serve it: a provider or a coding agent — `provider=openrouter`, `provider=codex`), `effort=<low|medium|high|xhigh|max|model>` (how hard it thinks, lowered to the highest its model takes; else the main agent's; `model` sends none, the model's own default), `view=<none|folded|window|fork>` (what it sees of this conversation; else nothing, its task alone, which keeps its answer its own: `folded` is every completed turn folded to its words, one line per tool call; `window` the agent's context window as it stands; `fork` copies the agent's newest request whole, on the agent's model, while a turn runs or for the cache's lifetime after it), `may=<read|copy|edit>` (what it may do, where lower than its card says: `read` only reads; `copy` works in its own copy of the project, under the session's permission mode, and nothing it changes there is kept; `edit` changes files), `changes=<running|turn|uncommitted|since:<ref>>` (hand it a change as a patch, ahead of the task: what the turn running now has changed so far, what the last finished turn changed, everything uncommitted in the folder, or everything since a commit, tag or branch — `changes=since:v1.2`), `worktree=on|off` (a writing sub-agent works in its own git worktree, and its changes wait for `apply`; else the session's `subagents.worktree`), `workspace=<auto|patch|worktree|folder>` (where a writing sub-agent works, over `worktree=`: `patch` holds only the files it reads or writes, moved to a git worktree at the same folder once it runs a command; `worktree` a full git worktree; `folder` this session's folder; `auto` picks; else the session's `subagents.workspace`), `pause=on` (the agent's turn running now waits for the report — with no turn running there is nothing to pause), `inform=on` (the running agent hears at once what you launched). `pause` and `inform` need the report to go to the agent.",
  "- `start=ask|job|review` — one of the three starts, each filling the options above; one you name beside it wins. `ask`: the Reviewer, who only reads, shown this conversation folded and the turn running now. `job`: the Builder, in its own git worktree, shown the conversation folded and the turn running now. `review`: the Reviewer, who only reads, shown what the last finished turn changed, as a patch, and nothing of the conversation. Each keeps its report with you, as `wait=on` does.",
  "- `as=<tag>` — call one of your saved agents by its tag (" + agentsPage(cfg) + ": `product`, `enduser`, `builder`, `reviewer`, and yours): it sees and may do what its card says, runs on its card's model (else as any sub-agent), and its answer comes back to you as this command's answer. `model=`, `view=`, `may=` and `wait=off` beside it win over the card.",
  "- `wait=on|off` — where the report goes. By default the session's agent gets it in its loop (next round, or with its next turn); `wait=on` keeps it with you instead, as this command's answer — `/subagent send <id>` passes it on later.",
  "- `/subagent` or `/subagent list` — this session's sub-agents.",
  "- `/subagent <id>` — one sub-agent: its state and its newest report.",
  "- `/subagent stop <id>` — stop it now (its running command or model call is cut); what it finished is kept as its report.",
  "- `/subagent send <id>` — pass a report you kept (`wait=on`, or the harness's launch with its report kept aside) on to the agent.",
  "- `/subagent changes <id>` — what a sub-agent changed in its own worktree: the files and the diff.",
  "- `/subagent apply <id>` — bring those changes into this session's folder. A file changed here meanwhile is merged with them; if any change overlaps, nothing is applied and you hear which files. Works after a restart too.",
  "- `/btw <question>` — a side question, the `ask` start by its shorter name: the Reviewer reads this conversation, changes nothing and answers here; nothing goes to the session's agent.",
  "- `/subagent ask <id> <follow-up>` — continue its conversation (\"check again\") in the context it already has; `changes=…` before the follow-up hands it a change again, as a patch. Its report goes where the sub-agent's went: one whose reports you keep answers here; `wait=on|off` decides otherwise.",
].join("\n");

/** `/btw` with nothing after it: what to type. */
const BTW_USAGE = "`/btw` needs your question after it: `/btw <question>`. The Reviewer reads this conversation, changes nothing and answers here; nothing goes to the session's agent. It is `/subagent start=ask <question>` by its shorter name.";

/** @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
/** A diff in a chat answer stops here; the harness's viewer shows it whole. */
const DIFF_CHARS = 20_000;
/** @param {readonly { added: number, removed: number }[]} files */
const counted = (files) => `${files.length} file${files.length === 1 ? "" : "s"} (+${files.reduce((n, f) => n + f.added, 0)} −${files.reduce((n, f) => n + f.removed, 0)})`;
/**
 * Where a sub-agent's work stands, in a line: waiting in its own worktree, applied, or in the session's folder.
 * @param {any} sa  the registry's public form
 */
const workLine = (sa) => {
  if (sa?.work?.error) return `Its work could not be captured (${sa.work.error}).`;
  if (sa?.work?.pending) return `Its changes wait in its own worktree: ${counted(sa.work.files)} — \`/subagent changes ${sa.id}\` shows them, \`/subagent apply ${sa.id}\` applies them.`;
  if (sa?.work?.applied) return "Its changes were applied to this session's folder.";
  if (sa?.shares) return `It worked in this session's folder (no worktree: ${sa.shares}).`;
  return "";
};

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {SubagentCommand & { raw: string, command: string }} cmd
 */
export async function answerSubagentCommand(ctx, deps, cmd) {
  const { memory } = deps;
  const registry = deps.subagents || null;
  const { headers } = ctx;
  const sit = ctx.memory.sit;
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream, cwd: true });
  const chainId = commandChain(ctx, deps);
  rec.memory = { chain: chainId || undefined, command: true, client: sit?.client, subagent: cmd.action };
  const changes = [`/subagent ${cmd.action} answered by Filament`];
  const say = (/** @type {string} */ text) => answerWith(ctx, deps, rec, text, { changes, local: true });
  const usage = usageOf(deps.config());
  if (cmd.action === "help") return say(usage);
  if (cmd.action === "unknown") return say(cmd.command === BTW_WORD ? BTW_USAGE : `I did not understand \`${cmd.arg}\`.\n\n${usage}`);
  if (!registry) return say("Sub-agents are not available in this Filament.");
  if (!chainId)
    return say(
      memory.archive
        ? "This chat has no session yet (Filament could not identify it), so there is nothing to launch a sub-agent from. Send a normal message first."
        : `No archive, so this chat has no session to launch a sub-agent from. ${memory.archiveWhy()}`,
    );
  if (cmd.action === "list") {
    const all = registry.list(chainId);
    if (!all.length) return say(`No sub-agents in this session yet. \`/subagent <task>\` launches one.\n\n${usage}`);
    const now = Date.now();
    return say(
      [
        `**Sub-agents of this session** (${all.length}, newest first):`,
        ...all.map((s) => `- \`${s.id}\` — ${s.status === "running" ? `running for ${ago(now - s.startedAt)}` : s.status} · ${s.card.name} · ${s.model} · “${s.description}”`),
        "",
        "`/subagent <id>` shows one; `/subagent ask <id> <follow-up>` continues it.",
      ].join("\n"),
    );
  }
  // Its worktree's changes outlive the registry's memory of it (the repository keeps them): apply and changes work
  // on an id the registry has forgotten, and the registry says whether this session may reach it.
  if (cmd.action === "changes") {
    const c = await registry.changes(cmd.id, chainId);
    if (!c.ok) return say(`No changes to show: ${c.error}.`);
    if (!c.files.length) return say(c.applied ? `\`${cmd.id}\`'s changes were applied; nothing new waits.` : `\`${cmd.id}\` changed nothing in its worktree.`);
    const diff = c.diff.length > DIFF_CHARS ? `${c.diff.slice(0, DIFF_CHARS)}\n… (cut here — the harness's viewer shows the whole diff)` : c.diff;
    return say(
      [
        `**Changes of \`${cmd.id}\`** — ${counted(c.files)}, waiting to be applied:`,
        ...c.files.slice(0, 50).map((f) => `- ${f.status} \`${f.path}\`${f.binary ? " (binary)" : ` (+${f.added} −${f.removed})`}`),
        ...(c.files.length > 50 ? [`- … and ${c.files.length - 50} more`] : []),
        "",
        "```diff",
        diff.replace(/```/g, "`\u200b``"),
        "```",
        `\`/subagent apply ${cmd.id}\` applies them.`,
      ].join("\n"),
    );
  }
  if (cmd.action === "apply") {
    const a = await registry.apply(cmd.id, chainId, "command");
    changes.push(`subagent: changes of ${cmd.id} ${a.ok ? `applied (${a.files.length} file${a.files.length === 1 ? "" : "s"})` : a.partial ? "applied only in part" : "not applied"}`);
    if (!a.ok) return say(a.partial ? `${a.error}.` : `Nothing applied: ${a.error}. This session's folder is as it was.`);
    return say(`Applied the changes of \`${cmd.id}\` to this session's folder: ${counted(a.files)} — ${a.files.slice(0, 12).map((f) => `\`${f.path}\``).join(", ")}${a.files.length > 12 ? `, and ${a.files.length - 12} more` : ""}.`);
  }
  const named = cmd.action === "show" || cmd.action === "stop" || cmd.action === "ask" || cmd.action === "send";
  // One the session kept from before a restart is named like any other.
  registry.recall(chainId);
  const current = named ? registry.get(cmd.id) : null;
  if (named && (!current || current.chainId !== chainId))
    return say(`No sub-agent \`${cmd.id}\` in this session. \`/subagent list\` shows the ones it has.`);
  if (cmd.action === "show" && current) {
    const last = current.exchanges.at(-1);
    const report = registry.report(current.id);
    const work = workLine(current);
    return say(
      [
        `**Sub-agent \`${current.id}\`** — “${current.description}” · ${current.card.name} · ${current.model}${current.view !== "none" ? ` · ${current.view} view` : ""}`,
        `State: ${current.status}${last?.rounds != null ? ` after ${last.rounds} round${last.rounds === 1 ? "" : "s"}, ${last.toolCalls} tool call${last.toolCalls === 1 ? "" : "s"}` : ""}${last?.error ? ` — ${last.error}` : ""}`,
        ...(last?.delivery === "held" ? [`Its report is kept with you: \`/subagent send ${current.id}\` passes it to the agent.`] : []),
        ...(work && current.status !== "running" ? [work] : []),
        "",
        current.status === "running" ? "Still working; its report comes when it finishes." : report ? `Its report:\n\n${report}` : "(no report)",
      ].join("\n"),
    );
  }
  if (cmd.action === "stop" && current) {
    const r = registry.stop(current.id);
    changes.push(`subagent: stop ${r.ok ? "sent to" : "refused for"} ${current.id}`);
    return say(r.ok ? `Stopping \`${current.id}\` now; what it finished is kept as its report.` : `\`${current.id}\` is not running (${current.status}).`);
  }
  if (cmd.action !== "launch" && cmd.action !== "ask" && cmd.action !== "send") return say(usage);
  if (cmd.action === "send") {
    const r = registry.send(cmd.id, chainId);
    changes.push(`subagent: report of ${cmd.id} ${r.ok ? "sent on" : "not sent"}`);
    return say(r.ok ? `Sent the report of \`${cmd.id}\` to this session's agent — ${r.into === "turn" ? "its running turn reads it at its next step" : "it opens the agent's next turn"}.` : `Nothing sent: ${r.error}.`);
  }
  // A follow-up keeps its sub-agent's standing unless `wait=` says otherwise: one whose reports the developer keeps
  // answers here, as its launch did.
  // A start (HarnessV4_Tasks E13-1, BW-4) fills what the command does not name, and keeps the report with the developer.
  const started = cmd.action === "launch" ? startFields(cmd.start, { view: cmd.view ?? undefined, may: cmd.may ?? undefined, worktree: cmd.worktree ?? undefined }) : null;
  if (started && !started.ok) return say(`\`start=${cmd.action === "launch" ? cmd.start : ""}\` is not a start: ${started.error}.`);
  const row = started?.ok && started.start ? started.fields : null;
  // A start that brings its own question (Catch me up) is asked it where the command brings no words.
  const own = started?.ok ? started.row : null;
  if (cmd.action === "launch" && !cmd.prompt && !own?.task) return say(`\`start=${cmd.start}\` needs a task after it: \`/subagent start=${cmd.start} <task>\`.`);
  const task = cmd.action === "launch" && !cmd.prompt && own?.task ? own.task : cmd.prompt;
  // An agent the command calls by its tag answers the one who called (HarnessV4_Tasks E15), as a start does.
  const wait = cmd.wait ?? ((cmd.action === "launch" && cmd.as) || row ? row?.deliver !== true : cmd.action === "ask" && !!current?.aside);
  // Its model as named — as Filament lists it or as a person says it, at the provider named — and its effort
  // (HarnessV4_Tasks E23-D1 to D5): the launch's own fields, or why that model cannot run. One several accounts serve
  // runs on the account the chat's coding agent runs on first (the owner's of 11-06).
  const chosen = cmd.action === "launch" ? await registry.choice({ model: cmd.model, provider: cmd.provider, effort: cmd.effort }, { chainId }) : null;
  if (chosen && !chosen.ok) return say(`${cmd.action === "launch" && cmd.as ? `\`@${cmd.as}\` was not asked` : "The sub-agent was not launched"}: ${sentence(chosen.error)}`);
  if (cmd.action === "launch") {
    if (cmd.view && !(cmd.view in SUBAGENT_VIEWS)) return say(`\`view=${cmd.view}\` is not a view. Pick one of ${Object.keys(SUBAGENT_VIEWS).map((v) => `\`${v}\``).join(", ")}.`);
    // Holding the agent, or telling it now, is for a report that will reach it.
    const needs = [cmd.pause ? "`pause=on`" : "", cmd.inform ? "`inform=on`" : ""].filter(Boolean).join(" and ");
    if (needs && wait)
      return say(`${needs} ${cmd.pause && cmd.inform ? "need" : "needs"} the report to go to this session's agent, and here it comes back to you as this command's answer (\`wait=on\`). Drop \`wait=on\`, or ${cmd.pause && cmd.inform ? "them" : "it"} out.`);
  }
  const r =
    cmd.action === "ask"
      ? registry.followUp(cmd.id, { prompt: cmd.prompt, chainId, by: "command", deliver: !wait, changes: cmd.changes })
      : await registry.launch({
          origin: "command",
          chainId,
          prompt: task,
          ...(cmd.as ? { as: cmd.as } : {}),
          ...(own?.since ? { since: own.since } : {}),
          ...(chosen?.ok ? chosen.fields : {}),
          ...(row ? { start: String(started?.ok ? started.start : ""), view: row.view, worker: row.worker, may: row.may, worktree: row.worktree, running: row.running, changes: row.changes } : {}),
          ...(!row && cmd.view ? { view: cmd.view } : {}),
          // Catch me up starts as a live copy while the cache is warm, where the command names no view, model or effort.
          ...(own?.fork === "warm" && !cmd.view && !cmd.model && !cmd.effort ? { warm: true } : {}),
          ...(!row && cmd.may ? { may: cmd.may } : {}),
          ...(cmd.changes ? { changes: cmd.changes } : {}),
          ...(!row && cmd.worktree != null ? { worktree: cmd.worktree } : {}),
          ...(cmd.workspace ? { workspace: cmd.workspace } : {}),
          pause: cmd.pause,
          inform: cmd.inform,
          deliver: !wait,
          ...(headers["x-filament-cwd"] ? { cwd: String(headers["x-filament-cwd"]) } : {}),
          requestId: rec.id,
        });
  if (!r.ok) return say(`${cmd.action === "ask" ? "The follow-up was not sent" : cmd.as ? `\`@${cmd.as}\` was not asked` : "The sub-agent was not launched"}: ${sentence(r.error)}`);
  const sa = registry.get(r.id);
  // An agent called by its tag is named wherever the command speaks of it: whoever reads the answer weighs it as that
  // agent's (one kind of agent, HarnessV4_OneAgent_Plan OA1: it does what its card's level lets it).
  const card = sa?.asked ? sa.card : null;
  const what =
    cmd.action === "ask" ? `Your follow-up went to ${card ? `${card.name} (\`${r.id}\`)` : `\`${r.id}\``}`
    : card ? `Asked ${card.name} (\`${r.id}\`, on ${sa?.model})`
    : `Launched sub-agent \`${r.id}\` (“${sa?.description}”, ${sa?.card.name}, on ${sa?.model}${sa && sa.view !== "none" ? `, with the ${sa.view} view` : ""})`;
  changes.push(`subagent: ${cmd.action === "ask" ? "follow-up to" : "launched"} ${r.id}${wait ? ", waited for" : ""}`);
  if (!wait) {
    const held = cmd.action === "launch" && cmd.pause ? (sa?.pause ? " — the agent's running turn waits for it" : " — no turn is running, so there was nothing to pause; it opens the agent's next turn") : "";
    return say(`${what}. Its ${card ? "answer" : "report"} goes to this session's agent${held}; \`/subagent ${r.id}\` shows it here any time.`);
  }
  // A waited-for report is the developer's: the session's agent reads no command's answer, until they send it on.
  return answerAfter(
    ctx,
    deps,
    rec,
    async () => {
      const o = await r.done;
      const after = `${o.error ? `: ${o.error}` : ""} after ${o.rounds} round${o.rounds === 1 ? "" : "s"}`;
      // Another model than the one it was launched on answered (its outcome's `otherModel`): the head names both.
      const by = o.otherModel ? ` — answered by ${o.otherModel.answered}, not ${o.otherModel.chosen}` : "";
      const head = card
        ? `(Filament: ${card.name}, one of your saved agents (${r.id}, on ${sa?.model}${by}) — ${o.ok ? "answered" : o.status}${after}; ask it again with /subagent ask ${r.id} <more>, or pass the answer to the agent with /subagent send ${r.id})`
        : `(Filament: sub-agent ${r.id} — “${sa?.description}”, ${sa?.model}${by} — ${o.ok ? "finished" : o.status}${after}; ask it more with /subagent ask ${r.id} <follow-up>, or pass the report to the agent with /subagent send ${r.id})`;
      const work = workLine(registry.get(r.id));
      return `${head}\n\n${o.report || "(no report)"}${work ? `\n\n(Filament: ${work})` : ""}`;
    },
    { changes, local: true, noLocalText: true },
  );
}
