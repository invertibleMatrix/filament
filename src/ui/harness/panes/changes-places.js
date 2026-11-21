// @ts-check
// The Changes tab by place (the Designer's of 10-29, on the owner's words of 10-29: "what agents are writing where into
// which worktree and what branches and what uncommitted files are there sitting … Need a full revamp"), pure: GET
// /api/git/changes's answer, with the agents the page holds, as the tab draws it — a summary line, then a block a place
// (your folder, a sub-agent's copy, another place this chat wrote; then the other chats' worktrees), each with its
// branch and what sits uncommitted, the agents that wrote there, each with its files, and the files no agent's edit
// wrote. An agent that only read, a throwaway copy, one that changed nothing: none is listed.
import { appliedWhen, markedWords, nowWords, writingFile } from "../lib/apply-words.js";
import { LEADS_APPLY, leadApplies } from "../lib/side.js";

/** @typedef {import("../lib/subagents.js").SubagentRow} SubagentRow */
/**
 * @typedef {{ path: string, oldPath: string | null, status: string, added: number | null, removed: number | null,
 *   binary: boolean, untracked: boolean, also: string[] }} PlaceFile  a file as its row shows it: `also`, the other agents
 *   that wrote it since its last commit
 * @typedef {"asks" | "waits" | "works" | "done"} Tone
 * @typedef {{ key: string, chain: string, agent: string, name: string, about: string, model: string, at: number,
 *   tone: Tone, state: string, files: PlaceFile[], added: number, removed: number, sub: SubagentRow | null,
 *   mine: boolean }} AgentLine  one agent in one place: `mine`, this chat's own agent or one of its sub-agents
 * @typedef {{ key: string, kind: "folder" | "copy" | "wrote" | "other", path: string, name: string, tag: string,
 *   branch: string, ahead: number, behind: number, base: string | null, facts: string, agents: AgentLine[],
 *   others: PlaceFile[], sub: SubagentRow | null, error: string | null, waits: number, uncommitted: number, saved: boolean }} PlaceBlock
 *   `saved`: a copy whose folder went, its work kept on the repository's refs, which its Apply reads
 * @typedef {{ summary: string, waits: boolean, badge: number, mine: PlaceBlock[], theirs: PlaceBlock[], repo: string,
 *   error: string | null }} ChangesModel
 */

/** How many of an agent's files show before its "Show all N". */
export const FILES_SHOWN = 6;

/** "1 file", "3 files". @param {number} n @param {string} one */
const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** A folder's last part. @param {string} p */
export const folderName = (p) => String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p || "");
/** "+12 −3", or "" where nothing is counted. @param {number} a @param {number} r */
export const linesWords = (a, r) => (a || r ? `+${a} −${r}` : "");
/** Two spellings of one folder as one. @param {string} p */
const same = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Its branch as its chip says it: "main", "docs-pass", "no branch · from main".
 * @param {{ branch?: string | null, detached?: boolean, base?: string | null }} p
 */
export function branchWords(p) {
  if (p.detached || !p.branch) return p.base ? `no branch · from ${p.base}` : "no branch";
  return String(p.branch);
}

/** A sub-agent's name as its line says it: its card, then what it was asked. @param {SubagentRow | null} s */
const subName = (s) => {
  if (!s) return "A sub-agent";
  const card = s.card?.name || "Sub-agent";
  const ask = String(s.description || "").split("\n")[0].trim();
  return ask ? `${card}: ${ask}` : card;
};

/**
 * How a sub-agent stands: asks you, its work waits for you, at work, or done. `lead`: its change waits for its lead's
 * apply, which is its team at work, not you. @param {SubagentRow} s @param {boolean} [lead] @returns {Tone}
 */
export function subTone(s, lead = false) {
  if (s.status === "running" && s.progress?.asking) return "asks";
  if (s.status === "running" || s.rebaseDue || (lead && s.work?.pending)) return "works";
  if (s.work?.pending || s.work?.lastApplied?.marked?.length) return "waits";
  return "done";
}

const RANK = { asks: 0, waits: 1, works: 2, done: 3 };

/**
 * A sub-agent's line in a place: how it stands, its files counted by the line itself (the drive of 10-29: "applied
 * 06:45 by you · 4 files · 4 files"). `n`: the files the line holds.
 * @param {SubagentRow} s @param {number} n @param {(at: number) => string} clock @param {boolean} [lead]  its lead applies it
 */
export function subState(s, n, clock, lead = false) {
  const w = s.work || null;
  if (s.status === "running") {
    const file = writingFile(s.progress?.tool);
    if (file) return `writing ${file}`;
    if (!n && !w?.pending) return "at work · nothing written yet";
    return s.progress?.round ? `at work · round ${s.progress.round}` : "at work";
  }
  if (s.rebaseDue) return nowWords(s, clock);
  if (w?.pending) return lead ? LEADS_APPLY : "waits for your Apply";
  if (w?.lastApplied) {
    const a = w.lastApplied;
    const when = appliedWhen(a, clock);
    return a.marked?.length ? `${markedWords(a.marked)} · ${when}` : when;
  }
  return nowWords(s, clock);
}

/**
 * The tab's model from the read's answer and what the page holds.
 * @param {any} answer  GET /api/git/changes's
 * @param {{ chain: string, live: boolean, model: string, round?: number, tool?: { name: string, args: string } | null,
 *   subs: readonly SubagentRow[], clock: (at: number) => string }} o  `live`: this chat's agent works now; `round`,
 *   `tool`: its round and its newest call still open
 * @returns {ChangesModel}
 */
export function changesModel(answer, o) {
  const places = Array.isArray(answer?.places) ? answer.places : [];
  const repo = folderName(places[0]?.place || answer?.cwd || "");
  if (!answer?.ok) return { summary: "", waits: false, badge: 0, mine: [], theirs: [], repo, error: String(answer?.error || "the folder could not be read") };
  const chats = answer.chats || {};
  const atWork = new Set(Array.isArray(answer.atWork) ? answer.atWork : []);
  const subs = new Map(o.subs.map((s) => [String(s.id), s]));
  // The workers whose waiting change is their lead's to apply while it works: none of it waits for you.
  const leads = leadApplies(o.subs, o.live);
  const led = (/** @type {SubagentRow | null} */ s) => !!s && leads.has(String(s.id));
  /** One agent's name, what it is, and its model. @param {string} chain @param {string} agent */
  const who = (chain, agent) => {
    const title = String(chats[chain]?.title || "").trim();
    if (chain === o.chain) {
      if (!agent) return { name: "Your agent", about: "", model: o.model, sub: null, mine: true };
      const s = subs.get(agent) || null;
      return { name: subName(s), about: "sub-agent", model: String(s?.model || ""), sub: s, mine: true };
    }
    if (!agent) return { name: title || "Another chat", about: "another chat", model: String(chats[chain]?.model || ""), sub: null, mine: false };
    return { name: "A sub-agent", about: title ? `sub-agent of “${title}”` : "another chat's sub-agent", model: "", sub: null, mine: false };
  };
  /** What an agent does now, and how it stands. @param {string} chain @param {string} agent @param {SubagentRow | null} s @param {number} at @param {number} n */
  const stateOf = (chain, agent, s, at, n) => {
    if (s) return { tone: subTone(s, led(s)), state: subState(s, n, o.clock, led(s)) };
    if (chain === o.chain && !agent) {
      if (!o.live) return { tone: /** @type {Tone} */ ("done"), state: at ? `last wrote ${o.clock(at)}` : "idle" };
      const file = writingFile(o.tool);
      return { tone: /** @type {Tone} */ ("works"), state: file ? `writing ${file}` : `at work${o.round ? ` · round ${o.round}` : ""}` };
    }
    if (!agent && atWork.has(chain)) return { tone: /** @type {Tone} */ ("works"), state: "at work" };
    return { tone: /** @type {Tone} */ ("done"), state: at ? `last wrote ${o.clock(at)}` : "idle" };
  };

  /** @param {any} p @returns {PlaceBlock} */
  const blockOf = (p) => {
    const kind = /** @type {PlaceBlock["kind"]} */ (["folder", "copy", "wrote", "other"].includes(p.kind) ? p.kind : "other");
    const sub = kind === "copy" ? subs.get(String(p.sub || "")) || null : null;
    const path = String(p.place || p.cwd || "");
    // A copy whose work came in by its Apply, nothing waiting since: its files are in your folder now, listed there under
    // its name — the copy's own status still shows them (the drive of 10-29: the same four files twice).
    const cameIn = !!sub && sub.status !== "running" && !sub.rebaseDue && !sub.work?.pending && !!sub.work?.lastApplied;
    const files = /** @type {any[]} */ (Array.isArray(p.files) && !cameIn ? p.files : []);
    /** @type {Map<string, AgentLine>} */
    const lines = new Map();
    /** @type {PlaceFile[]} */
    const others = [];
    for (const f of files) {
      const by = /** @type {{ chain: string, agent: string, at: number }[]} */ (Array.isArray(f.by) ? f.by : []);
      const row = { path: String(f.path), oldPath: f.oldPath || null, status: String(f.status || "M"), added: f.added ?? null, removed: f.removed ?? null, binary: !!f.binary, untracked: !!f.untracked };
      if (!by.length) {
        others.push({ ...row, also: [] });
        continue;
      }
      for (const w of by) {
        const key = `${w.chain}\n${w.agent || ""}`;
        let line = lines.get(key);
        if (!line) {
          const id = who(w.chain, w.agent || "");
          line = { key: `${path}\n${key}`, chain: w.chain, agent: w.agent || "", ...id, at: 0, tone: "done", state: "", files: [], added: 0, removed: 0 };
          lines.set(key, line);
        }
        line.at = Math.max(line.at, Number(w.at) || 0);
        line.files.push({ ...row, also: by.filter((x) => x !== w).map((x) => who(x.chain, x.agent || "").name) });
        line.added += f.added || 0;
        line.removed += f.removed || 0;
      }
    }
    // A copy's sub-agent is its writer from its launch, before its first write.
    if (sub && ![...lines.values()].some((l) => l.sub === sub)) {
      const key = `${o.chain}\n${sub.id}`;
      lines.set(key, { key: `${path}\n${key}`, chain: o.chain, agent: String(sub.id), ...who(o.chain, String(sub.id)), at: Number(sub.endedAt || sub.startedAt) || 0, tone: "done", state: "", files: [], added: 0, removed: 0 });
    }
    // What waits in its copy, as the sub-agent's work says it, where the copy's own status shows none of it.
    const own = sub ? [...lines.values()].find((l) => l.sub === sub) : null;
    if (own && !own.files.length && sub?.work?.pending)
      for (const f of sub.work.files || []) {
        own.files.push({ path: String(f.path), oldPath: null, status: String(f.status || "M").slice(0, 1).toUpperCase(), added: f.added ?? null, removed: f.removed ?? null, binary: !!f.binary, untracked: false, also: [] });
        own.added += f.added || 0;
        own.removed += f.removed || 0;
      }
    const agents = [...lines.values()].map((l) => ({ ...l, ...stateOf(l.chain, l.agent, l.sub, l.at, l.files.length) }));
    // Who needs you, then who works; within that this chat's own first, then the newest write.
    agents.sort((a, b) => RANK[a.tone] - RANK[b.tone] || Number(b.mine) - Number(a.mine) || b.at - a.at);
    const uncommitted = files.length;
    const added = files.reduce((n, f) => n + (f.added || 0), 0);
    const removed = files.reduce((n, f) => n + (f.removed || 0), 0);
    const ahead = Number(p.ahead) || 0;
    const behind = Number(p.behind) || 0;
    const waits = sub?.work?.pending && sub.status !== "running" && !sub.rebaseDue && !led(sub) ? Number(sub.work.pending) : 0;
    const chains = new Set(agents.map((a) => a.chain));
    const tag = kind === "folder" ? (p.worktree ? "your folder · worktree" : "your folder") : kind === "copy" ? String(p.sub || "its copy") : p.worktree ? "worktree" : "folder";
    const saved = kind === "copy" && p.saved === true;
    return {
      key: kind === "copy" ? `copy:${p.sub}` : same(path),
      kind,
      path,
      name: kind === "copy" ? `${sub?.card?.name || "A sub-agent"}'s copy` : folderName(path),
      tag,
      branch: saved ? "its folder is gone" : branchWords(p),
      ahead,
      behind,
      base: p.base ? String(p.base) : null,
      facts: !p.ok ? "" : kind === "copy" ? [copyFacts(sub, uncommitted, added, removed, o.clock, led(sub)), saved ? "kept in git, so Apply still brings it in" : ""].filter(Boolean).join(" · ") : placeFacts({ ahead, behind, base: p.base || null, uncommitted, added, removed, chats: chains.size }),
      agents,
      others,
      sub,
      error: p.ok ? null : String(p.error || "it could not be read"),
      waits,
      uncommitted,
      saved,
    };
  };

  const blocks = places.map(blockOf);
  /** @type {PlaceBlock[]} */
  const mine = [];
  /** @type {PlaceBlock[]} */
  const theirs = [];
  for (const b of blocks) (b.kind === "other" ? theirs : mine).push(b);
  // Your folder first; then a copy, its Apply writing into your folder — one whose work waits for it before the rest, so
  // the tab's dot says what the top of it shows (the owner's of 11-10) —; then the other places this chat wrote.
  const order = { folder: 0, copy: 1, wrote: 2, other: 3 };
  mine.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.waits > 0) - Number(a.waits > 0));
  // The other chats' places: one that needs you or is at work first, then the newest write.
  const top = (/** @type {PlaceBlock} */ b) => Math.min(...b.agents.map((a) => RANK[a.tone]), 9);
  const newest = (/** @type {PlaceBlock} */ b) => Math.max(0, ...b.agents.map((a) => a.at));
  theirs.sort((a, b) => top(a) - top(b) || newest(b) - newest(a));

  const writing = new Set([...mine, ...theirs].flatMap((b) => b.agents.filter((a) => a.files.length || (a.sub && a.sub.status === "running")).map((a) => `${a.chain}\n${a.agent}`))).size;
  const files = mine.filter((b) => b.kind !== "copy").reduce((n, b) => n + b.uncommitted, 0);
  const waits = mine.reduce((n, b) => n + b.waits, 0);
  const parts = [writing ? `${count(writing, "agent")} writing` : "", files ? `${count(files, "file")} uncommitted` : "", waits ? `${count(waits, "file")} wait${waits === 1 ? "s" : ""} for your Apply` : ""].filter(Boolean);
  return { summary: parts.length ? parts.join(" · ") : `No agent is writing in ${repo}`, waits: waits > 0, badge: files + waits, mine, theirs, repo, error: null };
}

/**
 * A place's second line: "↑2 ↓1 on main · 5 uncommitted · +120 −8 · 2 chats write here", "nothing uncommitted".
 * @param {{ ahead: number, behind: number, base: string | null, uncommitted: number, added: number, removed: number, chats: number }} p
 */
export function placeFacts(p) {
  const moved = p.ahead || p.behind ? `${[p.ahead ? `↑${p.ahead}` : "", p.behind ? `↓${p.behind}` : ""].filter(Boolean).join(" ")}${p.base ? ` on ${p.base}` : ""}` : "";
  const loose = p.uncommitted ? [`${p.uncommitted} uncommitted`, linesWords(p.added, p.removed)].filter(Boolean).join(" · ") : "nothing uncommitted";
  return [moved, loose, p.chats > 1 ? `${p.chats} chats write here` : ""].filter(Boolean).join(" · ");
}

/**
 * A copy's second line: what waits for your Apply (or its lead's, `lead`), what it wrote so far, nothing yet, or its Apply.
 * @param {SubagentRow | null} s @param {number} n @param {number} added @param {number} removed @param {(at: number) => string} clock
 * @param {boolean} [lead]
 */
export function copyFacts(s, n, added, removed, clock, lead = false) {
  const w = s?.work || null;
  if (w?.pending && s?.status !== "running") return [lead ? `${count(w.pending, "file")} ${LEADS_APPLY}` : `${count(w.pending, "file")} wait${w.pending === 1 ? "s" : ""} for your Apply`, linesWords(w.added, w.removed)].filter(Boolean).join(" · ");
  const so = n || w?.pending || 0;
  if (s?.status === "running") return so ? [`${count(so, "file")} so far`, linesWords(added || w?.added || 0, removed || w?.removed || 0)].filter(Boolean).join(" · ") : "nothing written yet";
  if (w?.lastApplied) return appliedWhen(w.lastApplied, clock, { who: false });
  return n ? [`${n} uncommitted`, linesWords(added, removed)].filter(Boolean).join(" · ") : "nothing written";
}

/**
 * The tab's words where there is nothing to draw: no folder, not git, git missing, reading.
 * @param {{ folder: string | null, error?: string | null, reading?: boolean }} o
 * @returns {{ title: string, line: string } | null}
 */
export function emptyOf(o) {
  if (!o.folder) return { title: "This chat has no folder yet", line: "Changes shows what agents write in a folder: choose one for this chat." };
  if (o.reading) return { title: "Reading what sits here…", line: "" };
  const e = String(o.error || "");
  if (!e) return null;
  if (/not a git repository|no repository|not in a git/i.test(e))
    return { title: "Not in a git repository", line: "Changes follows what git tracks. What the agents write in this folder is listed in Outputs." };
  if (/ENOENT|not found|spawn git|is not recognized/i.test(e)) return { title: "git is not on this computer's PATH", line: "Install git, or put it on the PATH, and Changes reads again." };
  return { title: "Changes can't be read now", line: e };
}
