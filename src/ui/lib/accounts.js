// @ts-check
// The coding agents' accounts and their plans' windows in the words every page says alike (HarnessV3-ACP AC3-6). The
// state is the server's (`GET /api/agent-accounts`, followed through the events feed's `accounts`): each enabled agent
// upstream, the agent it runs, and its account as that agent said it — who it runs as, each window of its plan with
// its state and pace, its extra usage or credits, and when that was heard. DOM-free: the harness's Account
// instrument, its notice and its limit card, the model picker's gauges and the console's subscriptions read it.

/**
 * Who an agent runs as, as it said, and how its login pays (`billing`: a plan's, by use, or unsaid); `held`, the words
 * for what keeps it so whatever is signed in here (HarnessV3-ACP AF1).
 * @typedef {{ kind: "account" | "api-key" | "gateway" | "external" | "none", label: string, plan: string | null,
 *   email: string | null, organization: string | null, detail: string | null,
 *   billing: "plan" | "metered" | null, held?: string }} Identity
 */
/**
 * One of a plan's windows as the store reads it out: the agent's figures, when they were heard, its state now and the
 * pace its readings show (when it runs out, ≈).
 * @typedef {{ id: string, kind: string, label: string, usedPercent: number | null, resetsAt: number | null,
 *   windowMins: number | null, status: string | null, at: number, source: string,
 *   state: "ok" | "warning" | "spent" | "reset", pace: number | null }} WindowView
 */
/**
 * A plan's extra usage as Claude's channels said it, each its own part: its rate-limit info — in use, its word, its
 * reset, why it is off; its `/usage` report — whether it can cover sends, what it spent this month and its monthly
 * limit, in its currency's minor units.
 * @typedef {{ using?: boolean, status?: string | null, resetsAt?: number | null, off?: string | null, enabled?: boolean,
 *   spent?: number | null, limit?: number | null, currency?: string | null }} ExtraView
 */
/**
 * An account as the store reads it out. `identitySource`: where the word on who is signed in came from — with no
 * identity, someone is signed in as nobody said whom (`signedInUnnamed`).
 * @typedef {{ identity: Identity | null, signedOut: boolean, identityAt: number | null, identitySource?: string | null,
 *   windows: WindowView[],
 *   fullest: string | null, spent: boolean, extraCovers?: boolean, freeAt: number | null,
 *   extra: ExtraView | null,
 *   credits: { has: boolean, unlimited: boolean, balance: string | null } | null,
 *   resetCredits: { available: number, nextExpiresAt: number | null } | null, reached: string | null,
 *   noWindows: string | null, at: number }} AccountView
 */
/**
 * A way an agent signs in, in its own words (HarnessV3-ACP AC3-7); a key's way says so, with its field's label; a
 * page's way that finishes from a browser on another computer says that (`far`), which the command line sorts by.
 * @typedef {{ id: string, name: string, description: string, kind?: "key", label?: string, far?: true }} Way
 */
/**
 * A sign-in under way: in a terminal (the terminal's id), on a page in the browser (its address, and the code to type
 * there where the agent gave one; none where the agent opens its page itself), or with a key, being checked; `line`:
 * the same sign-in as a line to run in a terminal.
 * @typedef {{ kind: "terminal", way: string, name: string, terminal: string, line: string | null, at: number }
 *   | { kind: "browser", way: string, name: string, url: string | null, code: string | null, line: string | null,
 *       at: number }
 *   | { kind: "key", way: string, name: string, at: number }} SignIn
 */
/**
 * How an account's last sign-in or sign-out ended, until the next one starts. `key-kept`: a pasted key is kept, and
 * nothing could check it — its next turn tries it.
 * @typedef {{ outcome: "signed-in" | "key-kept" | "signed-out" | "failed" | "cancelled", error: string | null,
 *   at: number }} SignInEnd
 */
/**
 * An enabled agent upstream — one of its agent's accounts: the agent it runs (two upstreams of one agent are two of its
 * accounts) and its name, whether its program is on this computer, whether that agent says who it runs as (null: not
 * known until it first starts), the command that signs it in, and its account, or null before it said anything. Then
 * its sign-in (HarnessV3-ACP AC3-7): the account's name ("Default", or the one given), whether it was added here
 * (renamed and removed here) and its folder, how its agent keeps more than one account (`folder`, `key`) or why it keeps
 * one, its ways to sign in as known without starting it, whether its agent signs out, whether Filament keeps a pasted
 * key for it (`keyKept`: Sign out forgets it), the sign-in under way and how the
 * last one ended. `off`: turned off by itself in Settings › Coding agents — listed there to turn on again, its sign-in
 * kept; nothing runs on it, and no other place offers it. `keyModels`: on an account that runs on an Anthropic API key,
 * the models the key offers beyond its agent's own list, and why they could not be asked for.
 * @typedef {{ upstream: string, name: string, type: string, agent: string, agentName: string, here: boolean, off?: boolean,
 *   keyModels?: { names: string[], note: string | null },
 *   says: boolean | null, login: string | null, account: AccountView | null, label: string, added: boolean,
 *   home: string | null, style: "folder" | "key" | null, oneAccount: string | null, ways: Way[], signsOut: boolean,
 *   keyKept?: boolean, signingIn: SignIn | null, lastSignIn: SignInEnd | null }} AgentRow
 */
/**
 * The page's accounts as it keeps them (HarnessV3-ACP AC3-7): the rows, a hook on each new read of them (its undo
 * returned), Check now, and an account as a route answered it, in place of the page's copy.
 * @typedef {{ rows: () => AgentRow[], listen: (fn: () => void) => () => void, check: (upstream: string) => Promise<void>,
 *   keep: (row: AgentRow) => void }} AccountKeeper
 */
/**
 * What stopped a turn on its plan, as its facts keep it (core/turn-facts.js `planLimit`).
 * @typedef {{ windows: { id: string, label: string, resetsAt: number | null }[], freeAt: number | null,
 *   reached: string | null, account: { kind: string, label: string, email: string | null },
 *   upstream: string | null }} PlanLimit
 */

const DAY = 86_400_000;
/** The longest a timer waits (2^31 − 1 ms, about 24.8 days): a reset further off is read toward in steps. */
const LONGEST_WAIT = 2_147_483_647;

/**
 * Follow the agents' accounts off the events fan-out a page holds already (the harness's `onBus`, the console's
 * `onEvents`): read on each (re)connect, on each change the server announces, on a save of the configuration (an
 * upstream added, removed or turned off), and a second after the soonest reset ahead — the server says each window's
 * state as of the read, so a spent window never reads spent past its reset. Reads never overlap: a change heard while
 * one runs reads once more after it. Returns the undo.
 * @param {(fn: (msg: any) => void) => (() => void)} subscribe
 * @param {{ read: () => Promise<any>, onSaid: (rows: AgentRow[]) => void }} o  `read`: `GET /api/agent-accounts`
 */
export function followAccounts(subscribe, { read, onSaid }) {
  let busy = false;
  let again = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** The next read, a second after the soonest reset ahead among every agent's windows. @param {AgentRow[]} rows */
  const wake = (rows) => {
    clearTimeout(timer);
    const now = Date.now();
    const next = Math.min(...rows.flatMap((r) => (r.account?.windows || []).map((w) => (w.resetsAt != null && w.resetsAt > now ? w.resetsAt : Infinity))));
    timer = Number.isFinite(next) ? setTimeout(pull, Math.min(LONGEST_WAIT, next - now + 1000)) : undefined;
  };
  const pull = () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    read()
      .then(
        (r) => {
          const rows = Array.isArray(r?.agents) ? r.agents : [];
          onSaid(rows);
          wake(rows);
        },
        () => {},
      )
      .finally(() => {
        busy = false;
        if (again) {
          again = false;
          pull();
        }
      });
  };
  const off = subscribe((msg) => {
    if (msg?.type === "hello" || msg?.type === "accounts" || msg?.type === "config-changed") pull();
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}

/** A stretch of time ahead, as a clock would say it: "45 s", "12 min", "1 h 12 m", "3 d 4 h". @param {number} ms */
export function untilWords(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/**
 * A moment in local time: "3:40 PM" today, "Thu 3:40 PM" within the week ahead, "Oct 30, 3:40 PM" further off.
 * @param {number} at @param {number} [now]
 */
export function whenWords(at, now = Date.now()) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  if (at > now && at - now < 6 * DAY) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * When a window resets: "resets in 1 h 12 m" within the day, else "resets Thu 3:40 PM"; "reset" once it has; "" with
 * no reset said.
 * @param {number | null | undefined} resetsAt @param {number} [now]
 */
export function resetWords(resetsAt, now = Date.now()) {
  if (resetsAt == null) return "";
  if (resetsAt <= now) return "reset";
  return resetsAt - now < DAY ? `resets in ${untilWords(resetsAt - now)}` : `resets ${whenWords(resetsAt, now)}`;
}

/**
 * An email masked until the person asks to see it: its first letter, the rest of the name hidden, the domain kept
 * ("d•••••@example.com").
 * @param {string | null | undefined} email
 */
export function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at < 1) return s ? "•••" : "";
  return `${s[0]}${"•".repeat(Math.min(6, Math.max(2, at - 1)))}${s.slice(at)}`;
}

/** A sentence's first letter in capitals. @param {string} s */
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** An account by its agent and its name: "Claude Code · Work"; the agent's name alone for its Default. @param {AgentRow} r */
export const accountName = (r) => (r.added ? `${r.agentName} · ${r.label}` : r.agentName);

/**
 * What an account's row says of the models its Anthropic API key offers beyond its agent's own list (`keyModels`): why
 * they could not be asked for, else which they are, the first four by name; null where there is nothing to say.
 * @param {AgentRow} r
 */
export function keyWords(r) {
  const k = r.keyModels;
  if (k?.note) return k.note;
  const names = k?.names || [];
  if (!names.length) return null;
  return `From its API key: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}. ${r.agentName} does not list ${names.length === 1 ? "it" : "them"} itself.`;
}

/**
 * An agent's other accounts beside one of them (HarnessV3-ACP AC3-7): the same agent on the same kind of upstream.
 * @param {AgentRow[]} rows @param {AgentRow} r
 */
export const othersOf = (rows, r) => rows.filter((x) => x.agent === r.agent && x.type === r.type && x.upstream !== r.upstream && !x.off);

/** An agent's words for a login it had and lost: its session expired and could not be refreshed. */
const EXPIRED = /\bexpired\b|could not be refreshed/i;

/**
 * A turn its agent's login refused, as its banner says it beside its Sign in (HarnessV3-ACP AC3-7): the account by
 * name and what to do — a login the agent says expired as one that did (AC3's drive D6), else nobody signed in; the
 * agent's own message, written for any client, goes under the details with the server's.
 * @param {string} error  the turn's message @param {string} detail  the server's body, or ""
 * @param {AgentRow | null | undefined} r  the account, where the page has it
 * @returns {{ message: string, detail: string }}
 */
export const signedOutBanner = (error, detail, r) => {
  const name = r ? accountName(r) : "the agent's account";
  return {
    message: EXPIRED.test(`${error} ${detail}`)
      ? `The sign-in to ${name} has expired. Sign in again, then send your message again.`
      : `Nobody is signed in to ${name}. Sign in, then send your message again.`,
    detail: [error, detail].filter(Boolean).join("\n\n"),
  };
};

/** A window's use, rounded: "42%"; "—" where only the agent's word on it came. @param {WindowView | null | undefined} w */
export const percentWords = (w) => (w?.usedPercent == null ? "—" : `${Math.round(w.usedPercent)}%`);

/**
 * A window named in a sentence: "5-hour window", "weekly window", "weekly Opus window", "extra usage".
 * @param {{ label: string }} w
 */
export function windowName(w) {
  const label = String(w?.label || "");
  if (label === "Extra usage") return "extra usage";
  const [length, model] = label.split(" · ");
  const len = /^\d/.test(length) ? length : length.toLowerCase();
  return `${len}${model ? ` ${model}` : ""} window`;
}

/**
 * A window as a pill tags it, in a word: "5h", "3d", "week", "month", "extra"; the model a weekly counts is the
 * popover's to say. "" where its length isn't known.
 * @param {{ kind?: string, label: string }} w
 */
export function windowTag(w) {
  const label = String(w?.label || "");
  if (label === "Extra usage") return "extra";
  const n = /^(\d+)-(hour|day)/.exec(label);
  if (n) return `${n[1]}${n[2] === "hour" ? "h" : "d"}`;
  return w?.kind === "weekly" ? "week" : w?.kind === "monthly" ? "month" : "";
}

/**
 * How a window of an account reads, on every page (the Fable 5.2 re-read's finding 10: the pill said amber "extra
 * usage" of a window the notice, the popover, the gauges and the tray's card said red "spent" and "free again at"): its
 * state as the store says it, save that one spent which extra usage pays past (`extraCovers`) is `covered` — amber
 * wherever it shows, said as `COVERED`, never red and never "free again": the account has room.
 * @param {{ extraCovers?: boolean } | null | undefined} a @param {{ state?: string | null } | null | undefined} w
 * @returns {string}  "ok", "warning", "spent", "reset" or "covered"; "" with no window
 */
export const readsAs = (a, w) => (!w ? "" : w.state === "spent" && a?.extraCovers === true ? "covered" : String(w.state || ""));
/** What a covered window is said to be (`readsAs`), in the same words wherever it is said. */
export const COVERED = "extra usage covers it";

/**
 * The tone a window's reading is in (`readsAs`): red when spent, amber when it warns or extra usage covers it.
 * @param {string | null | undefined} state
 * @returns {"" | "warn" | "error"}
 */
export const toneOf = (state) => (state === "spent" ? "error" : state === "warning" || state === "covered" ? "warn" : "");

/** The window that decides how an account reads: the fullest one that hasn't reset, as the store picked it. @param {AccountView | null | undefined} a */
export const fullestOf = (a) => (a?.fullest ? a.windows.find((w) => w.id === a.fullest) || null : null);

/**
 * How an account reads at a glance — on a pill, a picker's tab: the fullest window's tag and its figure ("5h",
 * "42%"), "spent" when it is, why the plan stopped where no window shows it, "Signed out"; and the tone it reads in.
 * Empty words where there is nothing to read yet.
 * @param {AccountView | null | undefined} a
 * @returns {{ tag: string, figure: string, tone: "" | "warn" | "error" }}
 */
export function glanceOf(a) {
  if (!a?.identity) return { tag: "", figure: "", tone: "" };
  if (a.signedOut) return { tag: "", figure: "Signed out", tone: "error" };
  const w = fullestOf(a);
  if (w && readsAs(a, w) === "covered") return { tag: windowTag(w), figure: "extra usage", tone: "warn" };
  if (w?.state === "spent") return windowTag(w) ? { tag: windowTag(w), figure: "spent", tone: "error" } : { tag: "", figure: "Spent", tone: "error" };
  if (a.spent) return { tag: "", figure: /credits_depleted$/.test(String(a.reached)) ? "No credits" : "At limit", tone: "error" };
  const tone = w?.state === "warning" ? "warn" : "";
  return w && w.usedPercent != null ? { tag: windowTag(w), figure: percentWords(w), tone } : { tag: "", figure: "", tone };
}

/**
 * The plan an account is on, in a word or two: "Max", "Team", "Pro" — the plan the agent named, its words
 * capitalised; "" where it named none.
 * @param {Identity | null | undefined} id
 */
export function planTag(id) {
  const s = String(id?.plan || "");
  return s && s !== "unknown" ? s.split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "";
}

/**
 * The share a gauge shows for an account, 0..1: its fullest window's, full once spent; null with nothing to read —
 * signed out, no window, or a window whose share wasn't said.
 * @param {AccountView | null | undefined} a
 */
export function gaugeOf(a) {
  const w = fullestOf(a);
  if (!a || a.signedOut || !w) return null;
  return w.state === "spent" ? 1 : w.usedPercent == null ? null : w.usedPercent / 100;
}

/**
 * What Check now does, by agent: its tooltip. Claude's throwaway agent says who it runs as and reads its plan's windows
 * with `/usage`, and goes. @param {AgentRow} r
 */
export const checkWords = (r) =>
  r.type === "codex"
    ? "Ask Codex for its account, its plan's windows and its models now"
    : r.type === "cursor-sdk"
      ? "Ask Cursor who owns the key, and for its models, now"
      : r.agent === "claude-code"
        ? "Ask Claude who it runs as, how much of its plan is used and its models now"
        : r.agent === "antigravity-acp"
          ? "Ask Google how much of Antigravity's plan is left, with Antigravity's own sign-in, now"
          : "Ask the agent who it runs as, and for its models, now — it starts if it isn't running; its plan's windows come with its turns";

/**
 * Why no window shows yet: Codex is asked; Antigravity's are Google's, read after its turns; any other agent reports
 * them as it works. @param {AgentRow} r
 */
export const notYetWords = (r) =>
  r.type === "codex" ? "Codex hasn't reported its plan's windows yet: Check now asks it."
  : r.agent === "antigravity-acp" ? "Antigravity's plan's quota is read from Google after its turns: Check now reads it."
  : "The agent reports its plan's windows as it works: they show after its next turn.";

/**
 * Whether someone is signed in to an account as nobody said whom (services/agent-accounts.js `signedIn`: a sign-in
 * that ended well, a session its agent opened, a CLI that says only yes): no identity, and where the word came from.
 * @param {AccountView | null | undefined} a
 */
export const signedInUnnamed = (a) => !!a && !a.identity && !a.signedOut && !!a.identitySource;

/**
 * An agent's account in one sentence, for a tooltip: who it runs as and how its fullest window stands — or that it
 * hasn't said, that someone is signed in whom it doesn't name, that nobody is signed in, that its plan stopped it, or
 * why it has no windows.
 * @param {AgentRow} r @param {number} [now]
 */
export function summaryWords(r, now = Date.now()) {
  const a = r.account;
  const says = r.type === "acp" ? "it says when it starts" : "Check now asks it";
  if (signedInUnnamed(a)) return r.says === false ? `${r.name} is signed in — it doesn't say which account it runs on` : `${r.name} is signed in, and hasn't said which account it runs on yet — ${says}`;
  if (!a?.identity) return `${r.name} hasn't said which account it runs on yet — ${says}`;
  if (a.signedOut) return `${r.name}: nobody is signed in${r.ways.length ? " — sign in under Settings → Coding agents" : r.login ? ` — run \`${r.login}\` in a terminal` : ""}`;
  const who = a.identity.label;
  const w = fullestOf(a);
  const reset = w ? resetWords(w.resetsAt, now) : "";
  if (w?.state === "spent") return `${who}'s ${windowName(w)} is spent${readsAs(a, w) === "covered" ? `: ${COVERED}` : ""}${reset ? ` — it ${reset}` : ""}`;
  if (a.spent) return `${who}: ${reachedWords(a.reached) || "Codex says the plan has reached its limit."}`;
  if (w) {
    const used = w.usedPercent == null ? `its ${windowName(w)} ${w.state === "warning" ? "is near its limit" : "has room"}` : `${percentWords(w)} of its ${windowName(w)} used`;
    return `${who}: ${used}${reset ? `, ${reset}` : ""}`;
  }
  return `${who} — ${a.noWindows || notYetWords(r)}`;
}

/**
 * Whether an account can take a turn now, as far as its agent said: on, signed in — as someone it named, or as nobody
 * said whom (`signedInUnnamed`) —, and no window spent.
 * @param {AgentRow} r
 */
export const hasRoom = (r) => !r.off && !!r.account && (!!r.account.identity || signedInUnnamed(r.account)) && !r.account.signedOut && !r.account.spent;

/**
 * Whether a source's models are offered where a model is picked (the owner's of 10-30: "only the ones that are
 * available and connected"): never a coding agent nobody is signed in to, as it or its CLI said, nor one whose program
 * isn't on this computer. A source no account names (a provider's API) and an agent not heard from yet are offered; a
 * plan that is spent is not signed out.
 * @param {AgentRow[]} rows @param {string} upstream
 */
export function offered(rows, upstream) {
  const r = rows.find((x) => x.upstream === upstream);
  return !r || (r.here !== false && !r.account?.signedOut);
}

/**
 * When a window runs out at its pace, said with its ≈: "≈ runs out in 2 h 10 m at this pace".
 * @param {WindowView} w @param {number} [now]
 */
export const paceWords = (w, now = Date.now()) => (w.pace != null && w.pace > now ? `≈ runs out in ${untilWords(w.pace - now)} at this pace` : "");

/**
 * The plan notices put away in this browser, as its storage keeps them (a JSON list, oldest first); none where it
 * holds anything else.
 * @param {string | null | undefined} kept
 * @returns {string[]}
 */
export function awayKeys(kept) {
  try {
    const v = JSON.parse(kept || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The list once a notice is put away: its key last, once, and the newest `keep` only — a key names its window's
 * period, so an old one never matches again.
 * @param {string[]} away @param {string} key @param {number} [keep]
 */
export const putAway = (away, key, keep = 24) => [...away.filter((k) => k !== key), key].slice(-keep);

/**
 * Why Codex stopped, in words with what to do (its `rateLimitReachedType`); "" where the window says it all.
 * @param {string | null | undefined} reached
 */
export function reachedWords(reached) {
  if (reached === "workspace_owner_credits_depleted") return "The workspace has no credits left: add credits to it, or wait for the reset.";
  if (reached === "workspace_member_credits_depleted") return "The workspace has no credits left: ask its owner to add some, or wait for the reset.";
  if (reached === "workspace_owner_usage_limit_reached") return "The workspace's spend limit is reached: raise it, or wait for the reset.";
  if (reached === "workspace_member_usage_limit_reached") return "The workspace's spend limit is reached: ask its owner to raise it, or wait for the reset.";
  return "";
}

/**
 * A covered account in a sentence, for its popover: "Its 5-hour window is spent: extra usage covers it."; "" where no
 * window of it reads so (`readsAs`).
 * @param {AccountView | null | undefined} a
 */
export function coveredWords(a) {
  const ws = (a?.windows || []).filter((w) => readsAs(a, w) === "covered");
  if (!ws.length) return "";
  return `Its ${ws.map(windowName).join(" and ")} ${ws.length === 1 ? `is spent: ${COVERED}` : "are spent: extra usage covers them"}.`;
}

/**
 * The notice an account's plan calls for over the composer, or null: its fullest window spent, or four-fifths used,
 * and not reset — amber where extra usage covers the spent one (`readsAs`), which says so. The key names the window
 * and its period: a notice put away stays away until the next period.
 * @param {AgentRow | null | undefined} row @param {number} [now]
 * @returns {{ key: string, tone: "warn" | "error", text: string } | null}
 */
export function noticeOf(row, now = Date.now()) {
  const a = row?.account;
  if (!row || !a?.identity || a.signedOut) return null;
  const w = fullestOf(a);
  if (!w || (w.state !== "warning" && w.state !== "spent")) return null;
  const when = w.resetsAt != null && w.resetsAt > now ? ` It resets ${w.resetsAt - now < DAY ? "at " : ""}${whenWords(w.resetsAt, now)}.` : "";
  const who = a.identity.label;
  const reads = readsAs(a, w);
  return {
    key: `${row.upstream}|${w.id}|${w.resetsAt ?? ""}`,
    tone: reads === "spent" ? "error" : "warn",
    text:
      reads === "covered"
        ? `${who}'s ${windowName(w)} is spent: ${COVERED}.${when}`
        : w.state === "spent"
        ? `${who}'s ${windowName(w)} is spent.${when}`
        : w.usedPercent == null
          ? `${who}'s ${windowName(w)} is near its limit.${when}`
          : `${who} is at ${percentWords(w)} of its ${windowName(w)}.${when}`,
  };
}

/**
 * When a spent plan is free again, in a sentence: "It's free again at 3:40 PM, in 1 h 12 m." within the day, else its
 * day and time; "" where that isn't known or has passed.
 * @param {number | null | undefined} freeAt @param {number} [now]
 */
export function freeWords(freeAt, now = Date.now()) {
  if (freeAt == null || freeAt <= now) return "";
  return `It's free again ${freeAt - now < DAY ? `at ${whenWords(freeAt, now)}, in ${untilWords(freeAt - now)}` : whenWords(freeAt, now)}.`;
}

/**
 * What the limit card says of a turn its plan stopped: its title, when the plan is free again, and why where Codex
 * said more than the window does.
 * @param {PlanLimit} limit @param {number} [now]
 */
export function limitWords(limit, now = Date.now()) {
  const who = limit.account.label;
  const ws = limit.windows;
  const title = ws.length
    ? `${who}'s ${ws.map(windowName).join(" and ")} ${ws.length === 1 ? "is" : "are"} spent`
    : `${who} has reached its plan's limit`;
  const free = limit.freeAt != null && limit.freeAt <= now ? "It has reset since: the turn can go again." : freeWords(limit.freeAt, now);
  return { title, free, why: reachedWords(limit.reached) };
}

/**
 * What extra usage has spent this month, in its currency — `/usage` says it in the currency's minor units — and of its
 * monthly limit where it has one: "$222.48 spent this month", "€12.50 of €500.00 spent this month"; "" where unsaid.
 * @param {ExtraView} x
 */
function spentWords(x) {
  if (x.spent == null) return "";
  /** @type {Intl.NumberFormat} */
  let money;
  try {
    // No currency, or one that is none, is no sum.
    money = new Intl.NumberFormat("en-US", { style: "currency", currency: /** @type {string} */ (x.currency) });
  } catch {
    return "";
  }
  const unit = 10 ** /** @type {number} */ (money.resolvedOptions().maximumFractionDigits);
  return `${money.format(x.spent / unit)}${x.limit != null ? ` of ${money.format(x.limit / unit)}` : ""} spent this month`;
}

/**
 * Claude's extra usage in a word and a line: off (and why), spent, in use, near its limit, or there to draw on — its
 * rate-limit info's word, else its `/usage` report's — with what it has spent this month and its reset.
 * @param {ExtraView} x @param {number} [now]
 * @returns {[string, string]}
 */
export function extraWords(x, now = Date.now()) {
  const reset = x.resetsAt != null ? cap(resetWords(x.resetsAt, now)) : "";
  const spent = spentWords(x);
  /** @param {string[]} parts */
  const line = (...parts) => parts.filter(Boolean).join(" · ");
  if (x.off) return ["Off", line(cap(x.off.replace(/_/g, " ")), spent)];
  if (x.status === "rejected") return ["Spent", line(spent, reset)];
  if (x.using) return ["In use", line("The plan's windows are spent: turns draw on it", spent, reset)];
  if (x.enabled === false) return ["Off", spent];
  return [x.status === "warning" ? "Near its limit" : "Available", line(spent, reset)];
}

/**
 * Codex's word on a reset credit asked for, as a sentence (its `ConsumeAccountRateLimitResetCreditOutcome`).
 * @param {string | null | undefined} outcome
 */
export function resetOutcomeWords(outcome) {
  if (outcome === "reset") return "Done: the plan's windows are reset.";
  if (outcome === "alreadyRedeemed") return "Done: that credit had already reset the plan's windows.";
  if (outcome === "nothingToReset") return "Codex had no window to reset: no credit was used.";
  if (outcome === "noCredit") return "Codex says no reset credit is left.";
  return `Codex said: ${String(outcome || "nothing")}.`;
}

/**
 * Where a turn its plan stopped can go on now: another account of the same agent with room (*Continue on*) — never
 * another upstream signed in as the same person, whose plan is the one that stopped — and another agent that is
 * signed in with room (*Continue with*).
 * @param {PlanLimit} limit @param {AgentRow[]} rows
 */
export function alternativesOf(limit, rows) {
  const from = rows.find((r) => r.upstream === limit.upstream);
  const email = limit.account.email?.toLowerCase();
  /** Signed in as the person whose plan stopped, as both say it: one plan, whichever upstream runs it. @param {AgentRow} r */
  const samePlan = (r) => !!email && r.account?.identity?.kind === limit.account.kind && r.account.identity.email?.toLowerCase() === email;
  const others = rows.filter((r) => r.upstream !== limit.upstream && hasRoom(r));
  return {
    same: from ? others.filter((r) => r.agent === from.agent && !samePlan(r)) : [],
    other: others.filter((r) => !from || r.agent !== from.agent),
  };
}
