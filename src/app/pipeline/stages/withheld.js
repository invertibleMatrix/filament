// @ts-check
// Memory's withheld exchanges put back on the wire (BUG-11): the last stage before the request is planned and sent.
// Everything before it — memory's archive and re-attached blocks, the view's folds, autofit — works on the
// conversation as the client holds it; only what goes upstream changes. A merged assistant message the store knows is
// replaced by the model's true sequence (its memory call, Filament's results, its own reply), so a signed thinking
// block is never rearranged (Anthropic refuses that) and the provider's cached prefix stays byte-identical to what it
// saw. An unknown or edited message goes out exactly as the client sent it.
import { restoreMessages } from "../../../core/withheld.js";
import { withheldStoreFor } from "../../../services/memory/withheld-store.js";
import { modelsLentTo } from "../../../services/devices.js";

/** @type {import("../context.js").Stage} */
export async function withheld(ctx, { memory, log }) {
  const { format, body, pre, rec } = ctx;
  // The Responses API front door sends its own body upstream (a passthrough continues by previous_response_id). Another
  // machine's chat's call (services/devices.js `modelsLentTo`) goes as it sent it: this machine's memory exchanges are
  // none of its own.
  if (pre?.responsesBody || modelsLentTo(ctx.req)) return "continue";
  if (format !== "anthropic" && format !== "openai") return "continue";
  if (!Array.isArray(body?.messages) || body.messages.length < 2) return "continue";
  const store = withheldStoreFor(/** @type {any} */ (memory)?.archive);
  if (!store) return "continue";
  try {
    const r = restoreMessages(format, body.messages, (anchors) => store.lookup(anchors));
    if (r.restored) {
      body.messages = r.messages;
      if (rec)
        (rec.priorChanges ||= []).push(
          `memory: put back ${r.restored} memory exchange${r.restored === 1 ? "" : "s"} withheld from the client (${r.rounds} round${r.rounds === 1 ? "" : "s"}), so the model sees exactly what it wrote — its thinking unmodified, the provider's cached prefix intact`,
        );
    }
  } catch (/** @type {any} */ e) {
    log("warn", `${rec?.id || "?"} withheld memory exchanges not put back: ${e.message}`);
  }
  return "continue";
}
