// The memory world the evals and the truth tests share: one memory service on a fresh folder, started on the fake
// engine through the service's own stand-in hook (so the fence on start and the learner run as in production), driven
// session by session the way a client drives Filament. Deterministic: no model is configured unless a test hands one in
// (`callModel`, scripted, with `models` naming the routes it answers for). `engine` starts a real engine in the fake's
// place, through the same hook (the golden recall eval's real variant): `engineRows`, `ops` and `failOps` are the fake's.
// Not a test file.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../../src/memory-service.js";
import { memoryRoutes } from "../../src/http/admin/memory.js";
import { createRouter } from "../../src/http/router.js";

const FAKE = fileURLToPath(new URL("./fake-sidecar.mjs", import.meta.url));
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };

/**
 * @param {{ engineRows?: any[], cwd?: string, models?: Record<string, string>, curator?: Record<string, any>, callModel?: ((a: any) => Promise<any>) | null, log?: (level: string, msg: string) => void, engine?: { command: string, args: string[], env?: Record<string, string> } | null }} o
 * @param {(w: any) => Promise<any>} body
 */
export async function world({ engineRows = [], cwd = "C:\\evals", models = {}, curator = {}, callModel = null, log = () => {}, engine = null } = {}, body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-evals-"));
  const state = join(dir, "fake-state.json");
  const opsLog = join(dir, "sidecar-ops.jsonl");
  const failFile = join(dir, "fail-ops");
  const nearFile = join(dir, "near.json");
  if (engineRows.length) writeFileSync(state, JSON.stringify({ memories: engineRows, canonical: [], seq: 0 }));
  const cfg = {
    server: { port: 20398, inboundKeys: ["k"] },
    memory: {
      enabled: true,
      folder: join(dir, "memory"),
      engine: { embeddings: true, bank: "default" },
      autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true, rewrite: false },
      capture: { turns: true, learn: true },
      commands: { enabled: true, prefix: "@mem" },
      privacy: { encryptArchive: false },
      models,
      curator,
    },
  };
  const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log, selfBase: () => "http://127.0.0.1:20398" });
  // A scripted model in place of Filament's front door: every memory call (learning, curation) reaches it.
  if (callModel) svc.callModel = callModel;
  // The service's own stand-in hook: it builds and starts the fake engine exactly as it would the real one (the fence
  // on start included), and the brain and the learner share it.
  const hook = JSON.stringify(engine || { command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: state, FAKE_SIDECAR_LOG: opsLog, FAKE_SIDECAR_FAIL_FILE: failFile, FAKE_SIDECAR_NEAR_FILE: nearFile } });
  process.env.FILAMENT_MEMORY_SIDECAR = hook;
  try {
    svc.start();
  } finally {
    delete process.env.FILAMENT_MEMORY_SIDECAR;
  }
  await svc.engineStart; // ready, fenced, adopted, drained (the service's own start)
  let n = 0;
  const w = {
    svc,
    dir,
    cfg,
    /** The fake engine's rows as it last persisted them (it writes the file on every change). */
    engineRows: () => JSON.parse(readFileSync(state, "utf8")).memories,
    /** Every op Filament sent the engine, oldest first. */
    ops: () => {
      try {
        return readFileSync(opsLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    /** Writes the fake engine's rows, as an import would have left them; it reads them when it next starts. */
    setEngineRows: (rows) => writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), memories: rows })),
    /** Runs `fn` with the stand-in hook set, so a restart inside it (an engine import's) starts the fake engine again. */
    withEngine: async (fn) => {
      process.env.FILAMENT_MEMORY_SIDECAR = hook;
      try {
        return await fn();
      } finally {
        delete process.env.FILAMENT_MEMORY_SIDECAR;
      }
    },
    /** What the fake engine finds near what by meaning (`dense`): each group's texts that near one another. @param {{ texts: string[], sim: number }[]} groups */
    near: (groups) => writeFileSync(nearFile, JSON.stringify(groups)),
    /** Makes the engine fail these ops (as the engine raising) until called again with others, or none. */
    failOps: (ops) => {
      if (ops.length) writeFileSync(failFile, ops.join("\n"));
      else if (existsSync(failFile)) rmSync(failFile);
    },
    /** Waits until every engine write queued so far has been sent through the outbox and answered. */
    settle: async () => {
      await new Promise((r) => setImmediate(r));
      await svc.brain?.outbox.drain();
      await svc.store.stats();
      await new Promise((r) => setImmediate(r));
    },
    /**
     * A conversation: each send() is one user turn with the history so far (and any `headers` of its own, and the
     * `settings` document the request runs under); the reply is archived and judged. A `cwd` of null is a session that
     * names no folder (the "none" project).
     * @param {string} id @param {{ cwd?: string | null }} [o]
     */
    session(id, { cwd: where = cwd } = {}) {
      const history = [];
      const system = where == null ? "You are Claude Code." : `You are Claude Code.\n<env>\nWorking directory: ${where}\nIs a git repo: yes\n</env>`;
      return {
        async send(text, { reply = "Done.", headers = {}, settings = null, confined = false } = {}) {
          const messages = [...history, { role: "user", content: text }];
          const r = {
            format: "anthropic",
            body: { model: "claude-x", max_tokens: 100, system, messages },
            headers: { ...CC_UA, "x-session-id": id, ...headers },
            model: "claude-x",
          };
          const sit = svc.situate(r);
          if (settings) sit.settings = settings;
          // A caller that reaches its own project's sessions alone (situate.js: `ctx.reads === false`).
          if (confined) sit.confined = true;
          const requestId = `ev-${++n}`;
          const prep = await svc.prepare(sit, { requestId, upstream: "anthropic" });
          const seen = [r.body.system, ...r.body.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))].join("\n");
          svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId, finalMessage: { role: "assistant", content: [{ type: "text", text: reply }] }, replyText: reply, injectedIds: prep.ids, outputChars: reply.length });
          // The request's record closes, as app/finish.js closes it: memory hears that its turn runs no more.
          svc.turnStopped({ id: requestId, memory: { turnId: prep.turn } });
          history.push({ role: "user", content: text }, { role: "assistant", content: reply });
          await w.settle();
          return { seen, prep, sit, r, requestId };
        },
        /**
         * The person's word, kept as they said it: `text` goes as their message, and the claim is filed on its turn by
         * their word, as `@mem remember` or the agent's quoted remember files it — nothing files a claim from a message
         * by its words (the memory plan's d3). `kind`: fact, rule, preference, decision or procedure. → the send's, and
         * `item` the remember's answer.
         * @param {string} text @param {{ kind?: string, reply?: string, headers?: Record<string, string>, settings?: any }} [o]
         */
        async remember(text, { kind = "fact", ...o } = {}) {
          const out = await this.send(text, o);
          const item = await svc.brain.remember(text, { kind, importance: 0.85, projectId: out.prep.project, chainId: out.prep.chain, turnId: out.prep.turn, by: "person" });
          await w.settle();
          return { ...out, item };
        },
        /**
         * The person's correction, kept as they said it: `text` goes as their message, and the standing claim whose words
         * hold `of` gets new words — `claim`, else the message — by their word on its turn, as `@mem correct` or the
         * agent's quoted correct gives them (the memory plan's d3). → the send's, and `item` the correct's answer.
         * @param {string} text @param {{ of: string | RegExp, claim?: string, reply?: string, headers?: Record<string, string>, settings?: any }} o
         */
        async correct(text, { of, claim = text, ...o }) {
          const out = await this.send(text, o);
          const old = svc.archive.items.list({}).find((/** @type {any} */ it) => (typeof of === "string" ? it.text.includes(of) : of.test(it.text)) && !["dismissed", "superseded"].includes(it.status));
          if (!old) throw new Error(`no standing claim holds ${of}`);
          const item = await svc.brain.correct(`i${old.id}`, { text: claim, by: "person", chainId: out.prep.chain, turnId: out.prep.turn, reason: "the user corrected it" });
          await w.settle();
          return { ...out, item };
        },
      };
    },
    /**
     * A tool loop of Claude Code's in one session, as it reaches Filament: `start` sends the user's ask (`body`: the
     * request as it went upstream), then each `ran` is the next leg, carrying the call the model made and what the
     * client got back (`error`: a failed call's output, flagged `is_error`). When `ran` returns, the observers have
     * heard the leg; `back` is the result as the model reads it, memory's lines included, and `requestId` the leg's.
     * `headers` ride every request (a team's worker's lineage).
     * @param {string} id @param {string} [ask] @param {{ headers?: Record<string, string> }} [o]
     */
    claudeCode(id, ask = "run the tests in this repo", { headers = {} } = {}) {
      const messages = [{ role: "user", content: /** @type {any} */ (ask) }];
      const system = `You are Claude Code.\n<env>\nWorking directory: ${cwd}\nIs a git repo: yes\n</env>`;
      const leg = () => ({ format: "anthropic", body: { model: "claude-x", system, messages: structuredClone(messages) }, headers: { ...CC_UA, "x-session-id": id, ...headers }, model: "claude-x" });
      let k = 0;
      /** The request whose reply was the call a leg answers: its record closes before the leg goes, as the pipeline's does. @type {{ requestId: string, turn: any } | null} */
      let open = null;
      return {
        async start() {
          const body = leg();
          const sit = svc.situate(body);
          const requestId = `ev-${++n}`;
          const prep = await svc.prepare(sit, { requestId });
          open = { requestId, turn: prep?.turn };
          return { sit, prep, body, requestId };
        },
        /** @param {string} tool @param {any} input @param {{ result?: string, error?: string }} [o] */
        async ran(tool, input, { result = "12 passing", error = "" } = {}) {
          const use = `${id}-t${++k}`;
          messages.push({ role: "assistant", content: [{ type: "tool_use", id: use, name: tool, input }] });
          messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: use, content: error || result, ...(error ? { is_error: true } : {}) }] });
          if (open) svc.turnStopped({ id: open.requestId, memory: { turnId: open.turn } });
          const body = leg();
          const requestId = `ev-${++n}`;
          const p = await svc.prepare(svc.situate(body), { requestId });
          open = { requestId, turn: p?.turn };
          await svc.observations.settled();
          return { p, body, requestId, back: JSON.stringify(body.body.messages.at(-1).content) };
        },
      };
    },
  };
  try {
    return await body(w);
  } finally {
    await svc.store?.stop?.();
    svc.stop();
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
}

/** The memory lines the model was shown (briefing and turn blocks): `- [...] text`. */
export const memoryLines = (seen) => seen.split("\n").filter((l) => /^- \[/.test(l));
export const lineWith = (seen, needle) => memoryLines(seen).find((l) => l.includes(needle)) || null;
/** A line served as a claim of this kind (`- [i12 rule · user said · …]`), not as words from a past session. */
export const servedAs = (seen, kind, needle) => memoryLines(seen).find((l) => l.includes(needle) && new RegExp(String.raw`^- \[(?:\S+ )?${kind}\b`).test(l)) || null;

/**
 * One admin route called through the router the server uses: the first row that matches wins, its params arrive
 * undecoded (the route decodes its own), the query is read, the body given.
 * @param {any} memory @param {string} method @param {string} path @param {any} [body]
 * @param {Record<string, any>} [more]  the rest of the admin context a route reads (`config`, `dryRun`, `ops`)
 */
export async function adminCall(memory, method, path, body, more = {}) {
  const url = new URL(`http://x/api${path}`);
  const hit = createRouter(memoryRoutes({ memory, usage: {}, ...more }))(method, url.pathname.slice(4));
  if (!hit) throw new Error(`no route for ${method} ${path}`);
  /** @type {{ status: number, body: any }} */
  const out = { status: 0, body: null };
  const res = {
    writableEnded: false,
    destroyed: false,
    writeHead: (/** @type {number} */ s) => (out.status = s),
    end: (/** @type {string} */ b) => (out.body = JSON.parse(b)),
  };
  await hit.handler({ res, url, path: url.pathname, params: hit.params, json: async () => body ?? null }, {});
  return out;
}
