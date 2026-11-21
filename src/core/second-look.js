// @ts-check
// A second look (HarnessV4_Space_Plan S3b, SG-D12, SG-D13): the Reviewer, read-only, reads a move before the person
// answers it — a call a review rule covers, or a dashboard's button that says `secondLook` — and answers in five lines.
// It informs the answer and never takes it: the card's buttons work from the first moment, and no clock cuts it.
// Here: the commands the switch "Second look before risky commands" covers (`loop.secondLook`, off by default), and the
// words the Reviewer is asked in. A command Filament can tell only reads is no risky move, whatever it names.

/**
 * The commands the switch covers (SG-D13), as globs over a command and each of its segments — `*` any run, `?` one
 * character, case aside — judged as review rules on bash, which speak for every spelling of a command (powershell, in
 * the background). After the session's own rules: their deny still refuses.
 */
export const RISKY = Object.freeze([
  // Deploys and rollbacks
  "*wrangler deploy*", "*wrangler rollback*", "*wrangler versions deploy*", "*vercel*--prod*", "*netlify deploy*--prod*",
  "*fly deploy*", "*flyctl deploy*", "*firebase deploy*", "*serverless deploy*", "*sls deploy*", "*cdk deploy*",
  "*pulumi up*", "*eb deploy*", "gcloud * deploy*", "*heroku releases:rollback*", "*kubectl rollout*",
  "*helm install*", "*helm upgrade*", "*helm uninstall*",
  // Migrations
  "*migrate deploy*", "*d1 migrations apply*", "*db:migrate*", "*manage.py migrate*", "*alembic upgrade*",
  "*flyway migrate*", "*liquibase update*", "*knex migrate:latest*", "*supabase db push*", "*prisma db push*",
  // Infrastructure
  "*terraform apply*", "*terraform destroy*", "*tofu apply*", "*tofu destroy*", "*kubectl apply*", "*kubectl delete*",
  // Pushes that rewrite, delete or publish
  "git push*--force*", "git push* -f", "git push* -f *", "git push*--mirror*", "git push*--delete*", "git push * :*",
  "git push*--tags*", "git push*refs/tags/*", "git push * v?.*", "git push * v??.*",
  // Data
  "*drop table*", "*drop database*", "*drop schema*", "*truncate table*", "*delete from*",
  // Cloud resources
  "aws * delete*", "aws * terminate*", "aws s3 rm*", "aws s3 rb*", "gcloud * delete*", "az * delete*", "doctl * delete*",
  "*wrangler delete*", "*wrangler * delete*", "gh repo delete*", "gh release delete*",
]);

/** The review rules the switch stands for, as `loop.rules` holds rules: marked `shipped`, so their words say so. */
export const RISKY_RULES = Object.freeze(RISKY.map((pattern) => Object.freeze({ tool: "bash", pattern, verdict: /** @type {const} */ ("review"), shipped: true })));

/** The five lines a second look answers in, in order. */
export const LOOK_LINES = Object.freeze(["What it does", "Production", "What can go wrong", "Way back", "Verdict"]);

/**
 * What a second look is about: the command whole, where it runs and why Filament asks; for a dashboard's button, its
 * label, the dashboard, its sentence with the row's values, that row and the source's other rows, each as columns.
 * `tool`: the command is a connection's tool call (HarnessV4_Space_Plan S4a), through the MCP server of that name.
 * @typedef {{ command: string, folder: string, why: string, tool?: string,
 *   button?: { label: string, dashboard: string, says: string, row: Record<string, string>, rows: Record<string, string>[] } }} LookAbout
 */

/**
 * Where a second look is, for the page: the chat it runs in and its agent there; or why there is none, in words.
 * @typedef {{ chain: string, agent: string } | { error: string }} LookRef
 */

/** How many of the source's other rows the Reviewer is shown beside the one a button acts on. */
export const LOOK_ROWS = 20;

/** A row as one line of columns. @param {Record<string, string>} r */
const rowLine = (r) => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(" · ");

/**
 * The Reviewer's task. It reads; it changes nothing and runs nothing that changes anything — the command least of all.
 * @param {LookAbout} a
 */
export function lookWords(a) {
  const b = a.button || null;
  const others = b ? b.rows.slice(0, LOOK_ROWS) : [];
  return [
    "This is a second look, for Filament: the person is about to say whether the command below runs, and reads your answer first. You read and change nothing: do not run the command, nor anything else that changes a file, a branch, a service or data.",
    "",
    `The command: ${a.command}`,
    ...(a.tool
      ? [`It calls a tool of the MCP server ${a.tool}, which this project's chats have: the server, then the tool's name, then its args as JSON. The project's folder: ${a.folder || "unknown"}`]
      : [`Where it runs: ${a.folder || "the project's folder"}`]),
    `Why Filament asks: ${a.why}`,
    ...(b
      ? [
          "",
          `It is the button “${b.label}” of the dashboard “${b.dashboard}”, on one of its rows. What the button says: ${b.says || "(nothing)"}`,
          `The row it acts on: ${rowLine(b.row)}`,
          ...(others.length ? [`The other rows of that table, as Filament last read them:`, ...others.map((r) => `- ${rowLine(r)}`)] : []),
        ]
      : []),
    "",
    "Look at what it would change — the files, the history, the configuration it touches; run only commands that read — then answer in exactly five numbered lines, each a few words to two sentences:",
    "1. What it does: what running it changes, and where.",
    "2. Production: whether it reaches production, shared data or other people, and how.",
    "3. What can go wrong: the likeliest harm, from what you saw.",
    "4. Way back: how to undo it, or that there is none.",
    "5. Verdict: safe, wait, or don't — with the one reason.",
    "Say only what you checked or can see, and where you could not tell, say so. Nothing before or after the five lines.",
  ].join("\n");
}

/** The three lines a check answers in, in order (S5d). */
export const CHECK_LINES = Object.freeze(["What it did", "What I checked", "Verdict"]);
/** How much of what a button said a check is shown: its last characters. */
export const CHECK_SAID_CHARS = 2000;

/**
 * What a check is about (HarnessV4_Space_Plan S5d, SG-D25): a dashboard's button that ran and ended done — its label,
 * the dashboard, its sentence with the row's values, what ran (the command, or the tool call), what it said, the row
 * before, the same row read again after (null: no longer there) and the source's rows after; `verify`, what its author
 * said to look for; `unread`, why its source could not be read again after — then there are no rows after.
 * @typedef {{ label: string, dashboard: string, says: string, ran: string, tool?: string, folder: string, said: string,
 *   verify: string, before: Record<string, string>, after: Record<string, string> | null, rows: Record<string, string>[],
 *   unread?: string }} CheckAbout
 */

/**
 * A check's task (S5d): a button ran, with no AI, and ended done; the agent reads whether it did what it was for. It
 * reads; it changes nothing — and runs the button again least of all.
 * @param {CheckAbout} a
 */
export function checkWords(a) {
  const said = a.said.length > CHECK_SAID_CHARS ? `…${a.said.slice(-CHECK_SAID_CHARS)}` : a.said;
  return [
    "This is a check, for Filament: a button of a dashboard just ran, with no AI, and ended without an error. The person wants to know whether it did what it was for. You read and change nothing: do not run it again, nor anything else that changes a file, a branch, a service or data.",
    "",
    `The button “${a.label}” of the dashboard “${a.dashboard}”. What it says: ${a.says || "(nothing)"}`,
    `What ran: ${a.ran}`,
    ...(a.tool
      ? [`It called a tool of the MCP server ${a.tool}, which this project's chats have. The project's folder: ${a.folder || "unknown"}`]
      : [`Where it ran: ${a.folder || "the project's folder"}`]),
    `What it said: ${said.trim() || "(nothing)"}`,
    `The row it acted on, before: ${rowLine(a.before)}`,
    ...(a.unread
      ? [`Its source could not be read again after it ran (${a.unread}): look for yourself, and where you cannot, say can't tell.`]
      : [
          a.after ? `The same row, read again after: ${rowLine(a.after)}` : "The same row, read again after: it is no longer there.",
          ...(a.rows.length ? ["The source's rows, read again after:", ...a.rows.slice(0, LOOK_ROWS).map((r) => `- ${rowLine(r)}`)] : []),
        ]),
    ...(a.verify ? ["", `What to look for, as the dashboard's author said: ${a.verify}`] : []),
    "",
    "Look at what it should have changed — the rows, the files, the service's state, with commands and tools that only read — then answer in exactly three numbered lines, each a few words to two sentences:",
    "1. What it did: what changed, from what you saw.",
    "2. What I checked: where you looked.",
    "3. Verdict: it worked, it did not work, or can't tell — with the one reason.",
    "Say only what you checked or can see. Nothing before or after the three lines.",
  ].join("\n");
}

/**
 * A check's verdict, from its answer's Verdict line: "worked", "failed" (it did not work) or "unclear" (can't tell, or
 * no Verdict line), and its reason — the words after the verdict. "It did not succeed", "it didn't finish" are failed,
 * their words kept whole as the reason; "it did not fail", "didn't break anything" are no failure — but no "worked"
 * either: unclear (found by the Hunter on S5d: any "did not …" read as failed, and a Needs you row followed).
 * @param {string} report
 * @returns {{ verdict: "worked" | "failed" | "unclear", reason: string }}
 */
export function verdictOf(report) {
  const line = String(report || "").split(/\r?\n/).map((l) => l.replace(/\*\*|__|`/g, "").trim()).reverse().find((l) => /^(?:\d+[.)]\s*)?verdict\s*:/i.test(l));
  if (!line) return { verdict: "unclear", reason: "" };
  const said = line.replace(/^(?:\d+[.)]\s*)?verdict\s*:\s*/i, "");
  const m = /^(it\s+)?(did\s+not\s+work|didn['’]t\s+work|did\s+not|didn['’]t|failed|worked|can['’]t\s+tell|cannot\s+tell|unclear)\b[\s.,;:—–-]*/i.exec(said);
  const word = (m?.[2] || "").toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
  if (m && (word === "did not" || word === "didn't")) {
    const rest = said.slice((m[1] || "").length).trim();
    // What it did not do: a harm ("fail", "break", "go wrong") is no failure; anything else it was for is.
    const harm = /^(?:did\s+not|didn['’]t)\s+(?:fail|break|error|go\s+wrong|harm|hurt|lose|drop|crash)/i.test(rest);
    return { verdict: harm ? "unclear" : "failed", reason: rest };
  }
  const verdict = !m ? "unclear" : /^(did not work|didn't work|failed)$/.test(word) ? "failed" : word === "worked" ? "worked" : "unclear";
  return { verdict, reason: (m ? said.slice(m[0].length) : said).trim() };
}
