// @ts-check
// The press, row by row: what each row of the admin API asks of this computer's caller while the desktop app holds a
// key (guards.js `pressRefusal`). Every row the areas register is classed here, once — a row with no class is a press
// (`pressClass`), so a new row asks for the key until someone reads what it does and says otherwise, and
// test/ratchets.test.js fails on it. index.js's gate reads the class before the row acts.
//
// A press is a call that answers what the person is asked; that leaves an agent able to do more unasked from then on —
// a mode, a rule, an Always allow (made on its page or by the chat's `@mem` words), a folder — a Space of your own's
// reach among them —, a command a saved agent runs unasked, a saved agent or a team the main agent may start by
// itself, such a team made to change files, a way back into a service —; that runs unasked what acts with what the
// person granted — a routine switched on, a dashboard's button, an archived project brought back —; that starts a
// program as the person, or names one Filament starts by itself from then on — a terminal, a hook, an MCP server, a
// plugin switched on, a team's check (r-doors, 11-12), an upstream tested that is not one kept as it is kept —; that
// sends a key Filament keeps to an address it did not go to (s-rows, 11-12: a provider's address moved, a test of one
// under another address); that hands out or replaces what guards the door — the keys, a
// pairing, a device's grants —; or that puts state in place which may hold any of these — a backup restored, the
// config read again from its file.
import { asksLess, namesMode } from "../../services/session-settings.js";
import { startsServer } from "../../services/mcp-servers.js";
import { MODE_HEADER } from "../../services/house.js";

/**
 * A row's class. `always`: a press whatever it carries. `body`: a press where `when` says so of its parsed body — and of
 * the request's headers (`h`, lower-cased), for the row that hands them on to a turn.
 * `kept`: a press by what the row finds kept — the config it would replace, the memory it names, the pull it saves over
 * —, weighed in its own handler (`by` names where), which answers it as the gate does. `door`: a pairing or a grant
 * (guards.js `doorRefused`), where `when` says so. `no`: no press, and `why` says which kind (`NO_PRESS`).
 * @typedef {{ press: "always" } | { press: "body", when: (b: any, h: Record<string, string>) => boolean } | { press: "kept", by: string }
 *   | { press: "door", when?: (b: any) => boolean } | { press: "no", why: string }} PressClass
 */

/**
 * Why a row is no press, in a few words each. `reads`: it changes nothing an agent runs by. `chat`: a message, a turn,
 * a sub-agent or a team started, a chat's own state — the chat's mode and rules judge every call made then. `narrows`:
 * it stops, removes, pauses or signs out. `agent`: another machine's agents call it, and their fence and this machine's
 * rules judge it. `setting`: a setting, a sign-in or a job that leaves every ask as it was. `words`: text or a page
 * kept, which allows no call. `own`: it starts what a program on this computer starts by itself as the person, and
 * nothing of its caller's choosing — a folder's dialog, a firewall's rule, a catalogue's installer. `proof`: the row
 * checks what its caller holds itself — a pairing's code, a
 * full device's token, a house call's secret, a sign-in's state.
 */
export const NO_PRESS = Object.freeze({
  reads: "reads",
  chat: "the person's chat",
  narrows: "undoes or narrows",
  agent: "an agent may",
  setting: "a setting that asks no less",
  words: "words kept",
  own: "the caller's own reach",
  proof: "its own proof",
});

/** @type {PressClass} */
const ALWAYS = Object.freeze({ press: "always" });
/** @type {PressClass} */
const DOOR = Object.freeze({ press: "door" });
/** @param {(b: any, h: Record<string, string>) => boolean} when @returns {PressClass} */
const body = (when) => Object.freeze({ press: "body", when });
/** @param {string} by @returns {PressClass} */
const kept = (by) => Object.freeze({ press: "kept", by });
/** @param {(b: any) => boolean} when @returns {PressClass} */
const door = (when) => Object.freeze({ press: "door", when });
/** @param {string} why @returns {PressClass} */
const no = (why) => Object.freeze({ press: "no", why });
const READS = no(NO_PRESS.reads);
const CHAT = no(NO_PRESS.chat);
const NARROWS = no(NO_PRESS.narrows);
const AGENT = no(NO_PRESS.agent);
const SETTING = no(NO_PRESS.setting);
const WORDS = no(NO_PRESS.words);
const OWN = no(NO_PRESS.own);
const PROOF = no(NO_PRESS.proof);

/**
 * A turn that is a press: the card's Allow or Deny (`allow`), the permission switch answering a waiting call, or a mode
 * the turn runs in (`permissions`, the xd-key hunt's: Auto named so ran the turn's later calls unasked) — named by the
 * body, or by the request's own header for it (house.js `MODE_HEADER`, read as `sessionMode` reads it; the second read
 * of 11-12: the body alone was weighed, and `x-filament-permissions: auto` ran the turn in Auto all the same). Of the
 * headers a client may send with a turn it is the one that says how a turn asks: its folder and its chat are the
 * service's own (sessions/service.js sets them over a client's), memory's (`x-filament-memory`, `-memory-load`) and a
 * conversation's name change no ask. @param {any} b @param {Record<string, string>} [h]  the request's headers, lower-cased
 */
const turnPresses = (b, h) => typeof b?.allow === "boolean" || b?.modeSwitch === true || b?.permissions != null || !!String(h?.[MODE_HEADER] ?? "").trim();
/** A settings row's body as the change it writes: `{ patch?, unset? }`, or the patch itself (sessions.js `changeOf`). @param {any} b */
const changeIn = (b) => (b && typeof b === "object" && ("patch" in b || "unset" in b) ? b : { patch: b });
/**
 * A saved agent's body that names commands it runs without asking (agent-cards.js `mayRun`): a sub-agent launched as
 * it runs each unasked from then on, in every chat. A list emptied, and any other field, is no press. @param {any} b
 */
const runsUnasked = (b) => Array.isArray(b?.mayRun) && b.mayRun.some((/** @type {unknown} */ c) => String(c ?? "").trim());
/**
 * A body that makes a Space of your own reading past its own folder (app/own-spaces.js `reachList`: `folder` where it
 * names none): the folders it lists are its layer's added folders, where the agent reads without asking (s-rows,
 * 11-12). One made reading its own folder alone is no press. @param {any} b
 */
const reachesPast = (b) => b?.reach != null && String(b.reach) !== "folder";
/**
 * The project archive's body that brings an archived project back (memory.js: `archived: false`, anything else
 * archives): its routines run at their times again and its watchers listen and wake, as a routine resumed and Pause
 * all off do (s-rows, 11-12). Archiving one stops all of that, and is no press. @param {any} b
 */
const bringsBack = (b) => b?.archived === false;

/**
 * Each row with its class, in the order the areas register them (index.js). The settings rows press where their body
 * lets the agent do more unasked (session-settings.js `asksLess`; the swarm's review of 11-10): a chat's, your
 * defaults', a project's, a new chat's (its model too, `namesMode`), a fork's, a replay's copy's, a turn's own — whose
 * `/set` the service weighs besides —, and a rule forgotten that is no allow. A Space's press where they let more run
 * than the person pressed for (the plan of 11-11, its w0): a routine switched on, run now, resumed or put back, Pause
 * all off, a draft sent, a dashboard's grant kept or put back, its reads resumed, its button run or let to agents, a
 * card moved back in its service or always so, a pull saved with a way back, a deleted Space brought back, an app's
 * asks run without asking first, and a model named with its coding agent's mode. A pause, a removal, a move on the
 * board alone and a plain model are no press. The keys other apps call Filament with are read and replaced by a press;
 * so is the address a program posts to a watcher at, which an agent that read it could wake itself with;
 * a backup restored and the config read again from its file put in place whatever they hold, so both are one.
 * What starts a program as the person, or names one Filament starts by itself, is a press too (r-doors, 11-12; the
 * settings rows weigh a hook, an MCP server, a plugin and a language server with the rest, `asksLess`): a terminal
 * opened, typed into, or its stream's ticket; an MCP server tested, brought in from another app, written or switched
 * on (`startsServer`); a connector added, a plugin switched on; the Cursor SDK installed into Filament's own process;
 * a team's check named. So is what takes more than the person gave: a chat filed under another project, whose rules,
 * folders, hooks and servers it takes for its own project's; a Codex account's reset credit spent. One switched off,
 * removed, or picked an account for is no press.
 * And what a second read found answering with no press (s-rows, 11-12), each weighed where its row finds what is kept:
 * an upstream tested that is not one kept, or that starts or reaches what the kept one does not (upstream-test.js
 * `testsMore`: the row started any program its body named, and sent a kept key to the address it named); the rows that
 * write the configuration a piece at a time — a provider added or changed, a model's backups — by the configuration's
 * own weigher (config.js `pressNeeded`), which reads a kept key sent to an address it did not go to
 * (session-settings.js `keysMove`); a Space of your own made reading past its folder, or its reach widened
 * (own-spaces.js `widens`); a team a chat's main agent may start by itself made to change files, or seated with a card
 * it had not, and one that changes files made or renamed under a name that agent's list holds (services/teams.js
 * `writesMore`); an archived project brought back, which arms its routines and watchers again.
 * An Always allow typed as chat words (`@mem confirm`, `@mem correct`) is the turn's service's to weigh, as
 * `/set` is (commands/mem.js `memAsksLess`). The kept upstream tested as it is kept, a provider with a key of its own,
 * a reach narrowed, a team made read-only or not on the agent's list, and a project archived are no press.
 * @type {[string, PressClass][]}
 */
export const PRESS_TABLE = [
  // remote.js
  ["POST /remote/pair", DOOR],
  ["GET /remote/pair", READS],
  ["DELETE /remote/pair", NARROWS],
  ["POST /remote/claim", PROOF],
  ["GET /remote/lan", READS],
  ["POST /remote/lan/firewall", OWN],
  ["POST /remote/lan/new-key", NARROWS],
  ["GET /remote/tailscale", READS],
  ["POST /remote/tailscale/retry", SETTING],
  ["GET /remote/me", READS],
  ["POST /remote/sign-out", NARROWS],
  ["POST /remote/agent-device", PROOF],
  ["GET /remote/devices", READS],
  ["POST /remote/devices/:id/copies/clear", NARROWS],
  ["PATCH /remote/devices/:id", door((b) => b?.grants !== undefined)],
  ["DELETE /remote/devices/:id", NARROWS],
  // system.js
  ["GET /state", READS],
  ["GET /start", READS],
  ["GET /clones", READS],
  ["GET /machine/caps", READS],
  ["GET /commands", READS],
  ["GET /token-calib", READS],
  ["DELETE /token-calib", SETTING],
  ["GET /prompts", READS],
  ["GET /features", READS],
  ["GET /alerts", READS],
  ["POST /alerts/ack", SETTING],
  ["GET /jobs", READS],
  ["GET /live", READS],
  ["POST /shutdown", NARROWS],
  ["GET /update", READS],
  // Another version of Filament installed and started as the person, the caller naming which.
  ["POST /update", ALWAYS],
  ["GET /events", READS],
  // traffic.js
  ["GET /requests", READS],
  ["GET /ops", READS],
  ["POST /requests/:id/replay", CHAT],
  ["GET /requests/:id/replays", READS],
  ["POST /requests/:id/cancel", NARROWS],
  ["GET /requests/:id/composition", READS],
  ["GET /requests/:id*", READS],
  ["GET /usage/summary", READS],
  ["GET /usage/daily", READS],
  ["GET /usage/days", READS],
  ["GET /usage/days.csv", READS],
  ["GET /usage/breakdown", READS],
  ["GET /usage/timeline", READS],
  ["GET /usage/upstreams", READS],
  ["POST /health/:id*/reset", SETTING],
  // config.js
  ["GET /schema", READS],
  ["GET /templates", READS],
  ["PUT /config", kept("config.js `pressNeeded`")],
  ["GET /config/changes", READS],
  ["PATCH /config/fields", kept("config.js `pressNeeded`")],
  ["POST /config/reload", ALWAYS],
  ["POST /keys/rotate", ALWAYS],
  ["GET /keys", ALWAYS],
  ["POST /templates/:id/:action", kept("config.js `pressNeeded`")],
  ["POST /dry-run", READS],
  ["GET /failover", READS],
  ["POST /failover", SETTING],
  ["GET /migrate/9router", READS],
  ["POST /migrate/9router", SETTING],
  ["GET /assistant/models", READS],
  ["GET /assistant/session", READS],
  ["POST /assistant/chat", CHAT],
  ["POST /assistant/apply", kept("config.js `pressNeeded`")],
  ["POST /assistant/discard", NARROWS],
  ["POST /assistant/reset", NARROWS],
  // upstreams.js
  ["POST /models/ping", READS],
  ["GET /models", READS],
  ["POST /models/caps", READS],
  ["GET /acp/status", READS],
  ["GET /acp/conversations/:key/raw", READS],
  ["GET /acp/profiles", READS],
  ["GET /agent-accounts", READS],
  ["POST /agent-accounts/:id/check", READS],
  ["POST /agent-accounts", SETTING],
  ["PATCH /agent-accounts/:id", SETTING],
  ["DELETE /agent-accounts/:id", NARROWS],
  ["POST /agent-accounts/:id/sign-in", SETTING],
  ["POST /agent-accounts/:id/sign-in/cancel", NARROWS],
  ["POST /agent-accounts/:id/sign-out", NARROWS],
  ["POST /agent-accounts/:id/off", NARROWS],
  ["POST /agent-accounts/:id/on", SETTING],
  ["POST /agent-accounts/:id/reset-credit", ALWAYS],
  ["GET /sdk/status", READS],
  ["POST /sdk/install", ALWAYS],
  ["POST /sdk/install/stop", NARROWS],
  ["POST /qoder/:id/login/start", SETTING],
  ["POST /qoder/:id/login/poll", SETTING],
  ["POST /qoder/:id/logout", NARROWS],
  ["GET /qoder/:id/status", READS],
  ["GET /acp/agents", READS],
  ["POST /acp/agents/:id/login", SETTING],
  ["POST /acp/detect", SETTING],
  ["GET /acp/:id/offer", READS],
  ["GET /acp/:id/sessions", READS],
  ["POST /acp/processes/:key*/kill", NARROWS],
  ["DELETE /acp/conversations/:key*", NARROWS],
  ["GET /providers", READS],
  ["POST /providers/probe", READS],
  ["GET /upstreams/:id/test", READS],
  // The form's values tested, saved or not: a press where they are not a kept upstream's as it is kept.
  ["POST /upstreams/test", kept("upstreams.js, app/upstream-test.js `testsMore`")],
  // coding-agents.js
  ["GET /coding-agents", READS],
  ["POST /coding-agents/registry/refresh", SETTING],
  ["GET /coding-agents/icons/:id", READS],
  // No press: the command line's `filament agents install <id>` calls it, and holds no key (cli/commands.js). It
  // installs what Filament's catalogue names under that id, nothing of its caller's choosing.
  ["POST /coding-agents/:id/install", OWN],
  ["POST /coding-agents/:id/install/cancel", NARROWS],
  ["POST /coding-agents/:id/connect", SETTING],
  ["POST /coding-agents/:id/off", NARROWS],
  ["POST /coding-agents/:id/models", READS],
  ["DELETE /coding-agents/:id", NARROWS],
  // memory.js
  ["GET /memory/status", READS],
  ["POST /memory/enabled", SETTING],
  ["GET /memory/engine", READS],
  ["POST /memory/engine/restart", SETTING],
  ["POST /memory/install", SETTING],
  ["POST /memory/uninstall", NARROWS],
  ["GET /memory/jobs/:id", READS],
  ["POST /memory/jobs/:id/stop", NARROWS],
  ["POST /memory/recall", READS],
  ["POST /memory/remember", WORDS],
  ["POST /memory/forget", NARROWS],
  ["GET /memory/items", READS],
  ["POST /memory/items/:id", kept("memory.js")],
  ["POST /memory/items/:id/correct", kept("memory.js")],
  ["GET /memory/items/:id/history", READS],
  ["GET /memory/sessions", READS],
  ["GET /memory/sessions/:id/turns/:n/memory", READS],
  ["GET /memory/sessions/:id/lineage", READS],
  ["GET /memory/sessions/:id/changes", READS],
  ["GET /memory/sessions/:id/outputs", READS],
  ["GET /memory/sessions/:id", READS],
  ["POST /memory/sessions/:id/move", ALWAYS],
  ["POST /memory/sessions/:id/delete", NARROWS],
  ["GET /memory/projects", READS],
  ["POST /memory/projects", SETTING],
  ["POST /memory/projects/of", READS],
  ["POST /memory/projects/everything", SETTING],
  ["POST /memory/projects/:id/archive", body(bringsBack)],
  ["POST /memory/projects/:id/delete", NARROWS],
  ["GET /memory/turns/:id", READS],
  ["POST /memory/injection-items", READS],
  ["GET /memory/activity", READS],
  ["GET /memory/benchmark", READS],
  ["GET /memory/traffic", READS],
  ["GET /memory/usage", READS],
  ["GET /memory/usage.csv", READS],
  ["GET /memory/identity", READS],
  ["POST /memory/identity", WORDS],
  ["DELETE /memory/identity", NARROWS],
  ["POST /memory/backup", SETTING],
  ["GET /memory/backups", READS],
  ["POST /memory/restore", ALWAYS],
  ["POST /memory/learn/:id", SETTING],
  ["GET /memory/inbox", READS],
  ["POST /memory/inbox/:id", WORDS],
  ["POST /memory/curator/run", SETTING],
  ["GET /memory/curator/runs", READS],
  ["GET /memory/models", READS],
  ["GET /memory/mcp", READS],
  ["POST /memory/models", SETTING],
  ["GET /memory/claims/scopes", READS],
  ["GET /memory/claims/stream", READS],
  ["GET /memory/claims", READS],
  ["GET /memory/claims/:id", READS],
  ["GET /memory/dossier", READS],
  ["GET /memory/pages", READS],
  ["GET /memory/outcomes", READS],
  ["GET /memory/metrics", READS],
  ["POST /memory/curator/runs/:id/undo", NARROWS],
  ["POST /memory/hygiene", SETTING],
  ["POST /memory/diagnose", READS],
  ["POST /memory/reindex", SETTING],
  ["GET /memory/sources", READS],
  ["GET /memory/import/overview", READS],
  ["GET /memory/import/chats", READS],
  ["PUT /memory/import/prefs", SETTING],
  ["POST /memory/import/chosen", SETTING],
  ["POST /memory/import/sync", SETTING],
  ["POST /memory/import", SETTING],
  ["POST /memory/mirror", SETTING],
  ["POST /memory/backfill", SETTING],
  // runs.js
  ["GET /runs/images/:ref", READS],
  ["GET /runs", READS],
  ["GET /runs/:id", READS],
  ["GET /runs/:id/changes", READS],
  ["GET /runs/:id/agent-commands", READS],
  ["POST /runs/:id/steer", CHAT],
  ["PATCH /runs/:id/steer/:sid", CHAT],
  ["DELETE /runs/:id/steer/:sid", NARROWS],
  ["POST /runs/:id/answer", ALWAYS],
  ["POST /runs/:id/calls/:call/background", CHAT],
  ["GET /runs/:id/events", READS],
  // sessions.js
  ["POST /sessions", body((b) => asksLess({ patch: b?.settings }) || namesMode(b?.model))],
  ["GET /sessions/holders", READS],
  ["GET /sessions/:id", READS],
  ["POST /sessions/:id/open/undismiss", CHAT],
  ["GET /sessions/:id/goal", READS],
  ["GET /sessions/:id/live-state", READS],
  ["GET /sessions/:id/requests", READS],
  ["GET /sessions/:id/subagents", READS],
  ["POST /sessions/:id/subagents", CHAT],
  ["GET /sessions/:id/subagents/views", READS],
  ["POST /sessions/:id/subagents/enhance", CHAT],
  ["GET /sessions/:id/subagents/:sid", READS],
  ["GET /sessions/:id/subagents/:sid/end", READS],
  ["GET /sessions/:id/second-looks/:sid", READS],
  ["POST /sessions/:id/second-looks/:sid/stop", NARROWS],
  ["DELETE /sessions/:id/subagents/:sid", NARROWS],
  ["POST /sessions/:id/subagents/:sid/stop", NARROWS],
  ["POST /sessions/:id/subagents/:sid/message", CHAT],
  ["POST /sessions/:id/subagents/:sid/answer", ALWAYS],
  ["GET /sessions/:id/asks", READS],
  ["POST /sessions/:id/asks/:ask/answer", ALWAYS],
  ["POST /sessions/:id/subagents/:sid/detach", CHAT],
  ["POST /sessions/:id/subagents/:sid/follow-up", CHAT],
  ["POST /sessions/:id/subagents/:sid/send", CHAT],
  ["POST /sessions/:id/graph/tasks/:task/start", CHAT],
  ["GET /sessions/:id/graph/side-run", READS],
  ["POST /sessions/:id/graph/side-offer/ignore", NARROWS],
  ["POST /sessions/:id/graph/side-run", CHAT],
  ["GET /sessions/:id/held-launches", READS],
  // The person's Accept or One at a time on the card for sub-agents that change files, in their chat; Always accept in
  // this chat presses, as the chat's own Parallelize tasks written does (session-settings.js `asksLess`).
  ["POST /sessions/:id/held-launches/:hold", body((b) => b?.answer === "always")],
  ["GET /sessions/:id/graph/kept", READS],
  ["GET /sessions/:id/subagents/:sid/changes", READS],
  ["POST /sessions/:id/subagents/:sid/apply", CHAT],
  ["POST /sessions/:id/subagents/:sid/mark-applied", CHAT],
  ["DELETE /sessions/:id/subagents/:sid/mark-applied", CHAT],
  ["GET /sessions/:id/subagents/:sid/apply-preview", READS],
  ["GET /sessions/:id/subagents/:sid/apply-compare", READS],
  ["POST /sessions/:id/subagents/:sid/rebase", CHAT],
  ["GET /sessions/:id/subagents/:sid/calls/:call/change", READS],
  ["GET /sessions/:id/transcript", READS],
  ["GET /sessions/:id/turns/:n/work", READS],
  ["GET /sessions/:id/turns/:n/calls/:call/change", READS],
  ["GET /sessions/:id/turns/:n/calls/:call/result", READS],
  ["GET /sessions/:id/turns/:n/visuals/:vid", READS],
  ["GET /sessions/:id/visuals/:vid", READS],
  ["GET /sessions/:id/settings", READS],
  ["PATCH /sessions/:id/settings", body((b) => asksLess(changeIn(b)))],
  ["PUT /sessions/:id/window", SETTING],
  ["POST /sessions/:id/rules/forget", body((b) => b?.verdict !== "allow")],
  ["POST /sessions/:id/rules/always", ALWAYS],
  ["POST /sessions/:id/agent-tasks/:task/stop", NARROWS],
  ["GET /sessions/:id/commands", READS],
  ["POST /sessions/:id/commands/:cmd/stop", NARROWS],
  ["POST /sessions/:id/come-back/cancel", NARROWS],
  ["GET /sessions/:id/settings/history", READS],
  ["GET /sessions/:id/compose", READS],
  ["POST /sessions/:id/turns", body((b, h) => turnPresses(b, h) || asksLess({ patch: b?.settingsPatch }))],
  ["POST /sessions/:id/own-turns", PROOF],
  ["PUT /tabs/open", CHAT],
  ["POST /sessions/:id/compact", CHAT],
  ["POST /sessions/:id/compact/stop", NARROWS],
  ["POST /sessions/:id/compactions/:cid/undo", CHAT],
  ["GET /sessions/:id/rewind", READS],
  ["POST /sessions/:id/rewind", CHAT],
  ["POST /sessions/:id/rewind/undo", CHAT],
  ["POST /sessions/:id/autofit", CHAT],
  ["POST /sessions/:id/fork", body((b) => asksLess({ patch: b?.settings }))],
  ["GET /sessions/:id/move", READS],
  ["POST /sessions/:id/move", CHAT],
  ["POST /sessions/:id/move/back", CHAT],
  ["POST /sessions/:id/replay-compare", body((b) => asksLess({ patch: b?.settings }))],
  ["POST /sessions/:id/recall", CHAT],
  ["GET /sessions/:id/instructions", READS],
  ["POST /sessions/draft-start", READS],
  ["GET /defaults/settings", READS],
  ["PATCH /defaults/settings", body((b) => asksLess(changeIn(b)))],
  ["GET /instructions/your-files", READS],
  ["GET /projects/:id/settings", READS],
  ["POST /projects/:id/settings", body((b) => asksLess(changeIn(b)))],
  ["POST /projects/:id/rules/forget", body((b) => b?.verdict !== "allow")],
  ["POST /sessions/:id/goal/hold", NARROWS],
  ["POST /sessions/:id/stop", NARROWS],
  ["POST /sessions/:id/wait/skip", CHAT],
  ["POST /sessions/:id/page", CHAT],
  ["POST /sessions/:id/lines/:line/fork", CHAT],
  // teams.js
  ["GET /teams", READS],
  // A press where the body names the team's check (services/teams.js `checksUnasked`), or where a team a chat's main
  // agent may start by itself would change files, or seat a card, as the one kept did not (`writesMore`).
  ["POST /teams", kept("teams.js, services/teams.js `checksUnasked`, `writesMore`")],
  ["PUT /teams/:key", kept("teams.js, services/teams.js `checksUnasked`, `writesMore`")],
  ["DELETE /teams/:key", NARROWS],
  ["GET /subagents/slots", READS],
  ["PUT /subagents/slots", SETTING],
  // A team the main agent could not send by itself, named (session-settings.js `namesMore`): one that builds changes files.
  ["PUT /subagents/teams", kept("teams.js")],
  // agents.js
  ["GET /agents", READS],
  ["POST /subagents/seats", READS],
  ["GET /subagents/model-problem", READS],
  // A saved agent the main agent could not ask by itself, named (`namesMore`): it runs the commands its card names unasked.
  ["PUT /subagents/ask", kept("agents.js")],
  ["POST /agents", body(runsUnasked)],
  ["PUT /agents/:tag", body(runsUnasked)],
  ["DELETE /agents/:tag", NARROWS],
  // files.js
  ["GET /files/tree", READS],
  ["GET /files/read", READS],
  ["GET /files/search", READS],
  ["GET /files/mentions", READS],
  ["GET /files/dirs", READS],
  ["POST /files/exists", READS],
  ["POST /files/pick-folder", OWN],
  ["POST /files/reveal", OWN],
  // git.js
  ["GET /git/status", READS],
  ["GET /git/log", READS],
  ["GET /git/place", READS],
  ["GET /git/where", READS],
  ["GET /git/changes", READS],
  ["GET /git/branch", READS],
  ["GET /git/places", READS],
  ["POST /git/places/remove", NARROWS],
  ["POST /git/places/put-back", SETTING],
  ["GET /git/footprint", READS],
  ["POST /git/footprint/clean", NARROWS],
  ["GET /git/places/new", READS],
  ["GET /git/places/template", READS],
  ["POST /git/places/template", SETTING],
  ["GET /git/branches", READS],
  // terminal.js
  ["POST /terminal", ALWAYS],
  ["GET /terminal", READS],
  ["POST /terminal/:id/ticket", ALWAYS],
  ["POST /terminal/:id/input", ALWAYS],
  ["POST /terminal/:id/resize", SETTING],
  ["POST /terminal/:id/kill", NARROWS],
  // mcp-servers.js
  ["GET /mcp-servers", READS],
  ["POST /mcp-servers/test", ALWAYS],
  ["POST /mcp-servers/look", READS],
  ["GET /mcp-servers/import", READS],
  ["POST /mcp-servers/import", ALWAYS],
  ["POST /mcp-servers/sign-in", SETTING],
  ["GET /mcp-servers/sign-in/back", PROOF],
  ["GET /mcp-servers/sign-in/:id", READS],
  ["DELETE /mcp-servers/sign-in/:id", NARROWS],
  ["POST /mcp-servers/sign-out", NARROWS],
  ["PUT /mcp-servers/:scope/:name", body(startsServer)],
  ["DELETE /mcp-servers/:scope/:name", NARROWS],
  ["DELETE /mcp-servers/:scope", NARROWS],
  // providers.js
  ["GET /upstreams", READS],
  // The rows that write the configuration a piece at a time weigh what they would leave as a save of the whole is: a
  // press where it sends a key the provider keeps to an address it was not — the address moved, the key kept.
  ["POST /upstreams", kept("config.js `pressNeeded`, from providers.js through app/providers.js `add`")],
  ["PATCH /upstreams/:id", kept("config.js `pressNeeded`, from providers.js through app/providers.js `change`")],
  ["GET /upstreams/:id/removal", READS],
  ["DELETE /upstreams/:id", NARROWS],
  // model-routes.js
  ["GET /model-routes", READS],
  ["PUT /model-routes", kept("config.js `pressNeeded`, from model-routes.js through app/model-routes.js `setBackups`")],
  // artifacts.js
  ["GET /artifacts", READS],
  // An artifact's address with a pass of its own: it changes nothing, and opens what the page frames already.
  ["POST /artifacts/:name/pass", READS],
  ["POST /artifacts", WORDS],
  ["GET /artifacts/:name", READS],
  ["PATCH /artifacts/:name", WORDS],
  ["DELETE /artifacts/:name", NARROWS],
  ["POST /artifacts/:name/newest", WORDS],
  ["GET /artifacts/:name/text", READS],
  ["POST /artifacts/:name/versions", WORDS],
  ["GET /artifacts/:name/download", READS],
  // spaces.js
  ["GET /spaces", READS],
  ["GET /spaces/machine-feed", READS],
  ["GET /your-space", READS],
  ["GET /spaces/own", READS],
  // What a Space of your own may read past its folder is its layer's added folders: made reading past it, or widened.
  ["POST /spaces/own", body(reachesPast)],
  ["PATCH /space/:project/own", kept("spaces.js, app/own-spaces.js `widens`")],
  ["DELETE /space/:project/own", NARROWS],
  ["POST /space/:project/own/shows", SETTING],
  ["GET /space/:project", READS],
  ["POST /space/:project", SETTING],
  ["DELETE /space/:project", NARROWS],
  ["POST /space/:project/back", ALWAYS],
  ["GET /space/:project/goes", READS],
  ["POST /space/:project/tasks", WORDS],
  ["PATCH /space/:project/tasks/:id", WORDS],
  ["DELETE /space/:project/tasks/:id", NARROWS],
  ["POST /space/:project/tasks/:id/files", WORDS],
  ["GET /space/:project/tasks/:id/files/:file", READS],
  ["DELETE /space/:project/tasks/:id/files/:file", NARROWS],
  ["GET /space/:project/pulls/presets", READS],
  ["GET /space/:project/pulls/tools", READS],
  ["POST /space/:project/pulls/try", READS],
  ["POST /space/:project/pulls", kept("spaces.js, core/space-pulls.js `pullAsksLess`")],
  ["DELETE /space/:project/pulls/:id", NARROWS],
  ["POST /space/:project/pulls/:id/read", READS],
  ["POST /space/:project/pulls/:id/move", body((b) => b?.back === true || b?.always === true)],
  ["POST /space/:project/pulls/:id/always", body((b) => b?.on === true)],
  ["POST /space/:project/needs/:id", WORDS],
  ["GET /space/:project/needs/:id/draft", READS],
  ["POST /space/:project/needs/:id/send", ALWAYS],
  ["POST /space/:project/needs/:id/send/stop", NARROWS],
  ["POST /space/:project/needs/:id/guide", ALWAYS],
  ["POST /space/:project/log", WORDS],
  ["POST /space/:project/sync", CHAT],
  ["GET /space/:project/files", READS],
  ["GET /space/:project/starters", READS],
  ["POST /space/:project/new-app", SETTING],
  ["GET /space/:project/folder-apps", READS],
  ["POST /space/:project/folder-apps", SETTING],
  ["POST /space/:project/import-app", SETTING],
  ["POST /space/:project/dashboards/:name/keep", ALWAYS],
  ["GET /space/:project/connections", READS],
  ["GET /space/:project/dashboards/:name/tools", READS],
  ["POST /space/:project/dashboards/:name/pause", body((b) => b?.paused === false)],
  ["POST /space/:project/dashboards/:name/glance", SETTING],
  ["POST /space/:project/dashboards/:name/allow", body((b) => b?.on === true)],
  ["GET /space/:project/dashboards/:name/secrets", READS],
  ["PUT /space/:project/dashboards/:name/secrets/:secret", SETTING],
  ["DELETE /space/:project/dashboards/:name/secrets/:secret", NARROWS],
  ["GET /space/:project/dashboards/:name/hooks", READS],
  ["POST /space/:project/dashboards/:name/hooks/:hook/renew", SETTING],
  ["DELETE /space/:project/dashboards/:name", NARROWS],
  ["POST /space/:project/dashboards/:name/actions/:action", READS],
  ["POST /space/:project/dashboards/:name/actions/:action/run", ALWAYS],
  ["POST /space/:project/dashboards/:name/actions/:action/look", body((b) => namesMode(b?.model))],
  ["POST /space/:project/dashboards/:name/actions/:action/stop", NARROWS],
  ["POST /space/:project/dashboards/:name/back", ALWAYS],
  ["POST /space/:project/dashboards/:name/read", READS],
  ["GET /space/:project/routines/:id", READS],
  ["POST /space/:project/routines/:id/on", ALWAYS],
  ["POST /space/:project/routines/:id/pause", body((b) => b?.paused === false)],
  ["POST /space/:project/routines/:id/model", body((b) => namesMode(b?.model))],
  ["POST /space/:project/routines/:id/run", ALWAYS],
  ["DELETE /space/:project/routines/:id", NARROWS],
  ["POST /space/:project/routines/:id/back", ALWAYS],
  ["GET /space/:project/routines/:id/script", READS],
  ["GET /space/:project/routines/:id/address", ALWAYS],
  ["POST /space/:project/routines/:id/address/renew", ALWAYS],
  ["POST /spaces/pause", body((b) => b?.on === false)],
  ["GET /spaces/settings", READS],
  ["PATCH /spaces/settings", body((b) => namesMode(b?.model) || b?.asks === "run")],
  ["PATCH /space/:project/settings", body((b) => namesMode(b?.model) || b?.asks === "run")],
  ["POST /space/:project/asks", body((b) => namesMode(b?.model))],
  ["GET /space/:project/procedures", READS],
  ["GET /space/:project/week.md", READS],
  // beside.js
  ["GET /sessions/:id/beside", READS],
  ["GET /sessions/:id/beside/runs-on", READS],
  ["GET /sessions/:id/beside/reads", READS],
  ["POST /sessions/:id/beside", CHAT],
  ["PATCH /sessions/:id/beside/:tid", CHAT],
  ["POST /sessions/:id/beside/:tid/notify", CHAT],
  ["GET /sessions/:id/beside/:tid/verify", READS],
  ["GET /sessions/:id/beside/:tid/lead", READS],
  ["GET /sessions/:id/beside/:tid/result", READS],
  ["POST /sessions/:id/beside/:tid/sent", CHAT],
  ["DELETE /sessions/:id/beside/:tid", NARROWS],
  ["POST /sessions/:id/beside/:tid/stop", NARROWS],
  // flows.js
  ["GET /sessions/:id/flows", READS],
  ["GET /sessions/:id/flows/uncommitted", READS],
  ["POST /sessions/:id/flows", CHAT],
  ["GET /sessions/:id/flows/:fid", READS],
  ["PUT /sessions/:id/flows/:fid", CHAT],
  ["DELETE /sessions/:id/flows/:fid", NARROWS],
  ["POST /sessions/:id/flows/:fid/start", CHAT],
  ["POST /sessions/:id/flows/:fid/decide", CHAT],
  ["POST /sessions/:id/flows/:fid/stop", NARROWS],
  ["POST /sessions/:id/flows/:fid/go-on", CHAT],
  ["POST /sessions/:id/flows/:fid/send", CHAT],
  ["POST /sessions/:id/flows/:fid/keep", CHAT],
  ["GET /sessions/:id/flows/:fid/boxes/:bid", READS],
  ["POST /sessions/:id/flows/:fid/boxes/:bid/:act", CHAT],
  ["GET /flows/saved", READS],
  ["DELETE /flows/saved/:key", NARROWS],
  // browser.js
  ["GET /browser", READS],
  ["GET /sessions/:id/browser", READS],
  ["POST /sessions/:id/browser", CHAT],
  ["GET /sessions/:id/browser/shot", READS],
  // plugins.js
  ["GET /plugins/connectors", READS],
  ["POST /plugins/connectors/add", ALWAYS],
  ["GET /plugins/connectors/setup", READS],
  ["POST /plugins/connectors/anthropic", SETTING],
  ["GET /plugins/sources", READS],
  ["GET /plugins/entries", READS],
  ["POST /plugins/marketplaces", SETTING],
  ["POST /plugins/marketplaces/:id/refresh", SETTING],
  ["DELETE /plugins/marketplaces/:id", NARROWS],
  ["GET /plugins/installed", READS],
  ["GET /plugins/installed/:id", READS],
  ["POST /plugins/preview", READS],
  ["POST /plugins/installed/:id/on", body((b) => b?.on !== false)],
  ["GET /plugins/installed/:id/on", READS],
  ["POST /plugins/install", SETTING],
  ["POST /plugins/installed/:id/check", READS],
  ["POST /plugins/installed/:id/update", SETTING],
  ["DELETE /plugins/installed/:id", NARROWS],
  ["GET /plugins/installed/:id/values", READS],
  ["POST /plugins/installed/:id/values", SETTING],
  // skills.js
  ["GET /skills", READS],
  ["GET /skills/found", READS],
  ["POST /skills", WORDS],
  ["POST /skills/craft", body((b) => namesMode(b?.model))],
  ["GET /skills/:name", READS],
  ["DELETE /skills/:name", NARROWS],
  ["GET /skills/:name/on", READS],
  ["POST /skills/:name/on", SETTING],
  ["POST /skills/:name/update", SETTING],
  ["POST /skills/:name/books", WORDS],
  ["DELETE /skills/:name/books/:id", NARROWS],
  ["GET /skills/:name/find", READS],
  ["GET /skills/:name/file", READS],
  ["PUT /skills/:name/file", WORDS],
  // lsp.js
  ["GET /lsp/symbols", READS],
  ["GET /lsp/servers", READS],
  // exec.js. A command started here is a program run as the person: a press, as answering its ask is. Another machine's
  // agents' device presses as the gate let it in (guards.js `pressRefusal`), and its fence judges the command.
  ["POST /exec", ALWAYS],
  ["GET /exec/:id", READS],
  ["POST /exec/:id/stop", NARROWS],
  ["POST /exec/:id/answer", ALWAYS],
  // transfers.js
  ["GET /transfers/haves", AGENT],
  ["POST /transfers", AGENT],
  ["POST /transfers/:id/part", AGENT],
  ["POST /transfers/place", AGENT],
  ["POST /transfers/back", AGENT],
  ["GET /transfers/back/:id", AGENT],
  ["POST /transfers/:id/commit", AGENT],
  // coach.js
  ["GET /coach", READS],
  ["POST /coach/seen", SETTING],
  ["POST /coach/reset", SETTING],
  // telemetry.js
  ["GET /telemetry", READS],
  ["POST /telemetry/notice-seen", SETTING],
  // star.js
  ["GET /star", READS],
  ["POST /star/seen", SETTING],
  // owner.js: the call proves the owner key itself.
  ["POST /owner/session", PROOF],
  // keys-copy.js: your providers' keys, open, for the app to hand another machine — a key Filament keeps, sent where it
  // did not go. A press whatever it carries; the row asks the app's key and the owner key itself besides.
  ["POST /key-copies", ALWAYS],
  // remote-work.js: Run on. A send carries the person's project to another machine, and a bring back writes into
  // their folder what a chat there changed: presses both. Naming the chat started there allows no call.
  ["GET /remote-work", READS],
  ["GET /remote-work/places", READS],
  ["POST /remote-work", ALWAYS],
  ["POST /remote-work/:id/chat", WORDS],
  ["POST /remote-work/:id/back", ALWAYS],
  ["POST /remote-work/:id/check", READS],
  ["DELETE /remote-work/:id", NARROWS],
];

/** The table by its rows, `METHOD /pattern` as the router names them. @type {Map<string, PressClass>} */
export const PRESS = new Map(PRESS_TABLE);

/**
 * A row's class: the table's, and a press always for a row it does not name — no row is let through because nobody
 * read it. @param {string} row  `METHOD /pattern` @returns {PressClass}
 */
export const pressClass = (row) => PRESS.get(row) ?? ALWAYS;
