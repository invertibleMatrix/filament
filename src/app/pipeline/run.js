// @ts-check
// The model-request pipeline: the stages in order, each reading and extending one RequestContext and saying whether
// the request goes on or was answered. `handle` is what the router calls for /v1/messages, /v1/chat/completions and,
// through the Responses bridge, /v1/responses — and what a native session's turn row calls with its composed body.
import { parseAndAuthenticate } from "./stages/parse.js";
import { situate } from "./stages/situate.js";
import { chatCommand } from "./stages/chat-command.js";
import { engine } from "./stages/engine.js";
import { route } from "./stages/route.js";
import { composed } from "./stages/composed.js";
import { memoryPrepare } from "./stages/memory-prepare.js";
import { handed } from "./stages/handed.js";
import { agent } from "./stages/agent.js";
import { view } from "./stages/view.js";
import { autofit } from "./stages/autofit.js";
import { withheld } from "./stages/withheld.js";
import { dispatch } from "./stages/dispatch.js";

/** @typedef {import("./context.js").RequestContext} RequestContext */
/** @typedef {import("./context.js").Stage} Stage */
/** @typedef {import("../deps.js").AppDeps} AppDeps */

/**
 * @param {AppDeps} deps
 * @param {{ agentTurn: Parameters<typeof dispatch>[0], agentLoop: Parameters<typeof agent>[0] }} turns
 *   the two turn handlers built once per app: the ACP agent's and the agent loop's
 */
export function createPipeline(deps, { agentTurn, agentLoop }) {
  /** @type {Stage[]} */
  const stages = [
    parseAndAuthenticate,
    situate,
    chatCommand,
    engine,
    route,
    composed,
    memoryPrepare,
    handed,
    agent(agentLoop),
    view,
    autofit,
    withheld,
    dispatch(agentTurn),
  ];
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {import("./context.js").ClientFormat} format
   * @param {import("./context.js").PreParsed | null} [pre]  a body another front door (the Responses API) already read and translated
   */
  async function handle(req, res, format, pre = null) {
    // The stages fill in the rest; nothing reads a field before the stage that sets it.
    const ctx = /** @type {RequestContext} */ (
      /** @type {unknown} */ ({ req, res, format, pre, t0: performance.now() })
    );
    for (const stage of stages)
      try {
        if ((await stage(ctx, deps)) === "replied") return;
      } catch (e) {
        // A stage threw instead of answering: the front door writes its 500, but the record would stay pending
        // forever, and its turn would read as running. Close the record through the one seam (finish clears the
        // turn's running mark), then let the throw surface.
        if (ctx.rec && ctx.rec.status === "pending") {
          try {
            deps.finish(
              ctx.rec,
              {
                status: "error",
                httpStatus: 500,
                error: String(e && typeof e === "object" && "message" in e ? e.message : e).slice(0, 300),
              },
            );
          } catch (closeErr) {
            // The stage's own throw is what surfaces; the failed close is said, never allowed to replace it.
            deps.log("warn", `pipeline: closing request ${ctx.rec.id} after a stage threw failed: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`);
          }
        }
        throw e;
      }
  }
  return { handle };
}
