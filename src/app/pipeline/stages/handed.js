// @ts-check
// The end of memory's work before the call: whether the client asked its model to summarize the conversation — the
// reply paths name a summary cut at the output cap, which the client would adopt as its whole context — and the
// trace's mark where the request is handed to the upstream. A client's compaction goes to its own model as it sent
// it, with what memory adds to any request.
import { isCompactionRequest } from "../../../core/trim.js";

/** @type {import("../context.js").Stage} */
export async function handed(ctx) {
  const { format, body, candidates } = ctx;
  const { sit, prep, trace, housekeeping } = ctx.memory;
  // Memory's own signal, the request's shape where memory's prepare pass stopped early (a muted chain, an agent
  // route), or the client's summary probe (situate's one detection, Step 3 D12) — never in a chat Filament composes,
  // which Filament compacts itself.
  ctx.flags.askedToCompact = !!(
    prep?.signals?.compactionRequest ||
    (sit && !sit.composed && (isCompactionRequest(format, body) || housekeeping?.kind === "summary"))
  );
  if (trace) {
    trace.setPhase("upstream");
    trace.mark("handed");
    trace.step("handed to the upstream", {
      upstream: candidates[0]?.upstream || "?",
      note: "memory's work before the call ends here; what follows happens while the reply is produced",
    });
  }
  return "continue";
}
