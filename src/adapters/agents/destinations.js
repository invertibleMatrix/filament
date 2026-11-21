// @ts-check
// The agent bridges as destinations (core/ports.js `Destination`): the bridge runs the upstream's turns; its models
// and the connection test come from the agent itself.

/** @typedef {import("../../core/ports.js").Destination} Destination */
/** @typedef {import("../../core/ports.js").AgentBridge} AgentBridge */

/**
 * @param {AgentBridge} bridge
 * @param {any} upstream
 * @param {{ label: string, transport: string }} how
 * @returns {Destination}
 */
function agentDestination(bridge, upstream, { label, transport }) {
  return {
    id: upstream.id,
    type: upstream.type,
    label,
    transport,
    agent: bridge,
    answers: null,
    listModels: (opts = {}) => bridge.listModels(upstream, opts),
    test: async () => {
      const r = await bridge.test(upstream);
      return { ...r, status: r.ok ? 200 : 0 };
    },
  };
}

/** An ACP agent process, driven by `bridge`. */
export const acpDestination = (bridge, upstream) =>
  agentDestination(bridge, upstream, {
    label: "ACP agent",
    transport: `acp://${upstream.acp?.command || "agent"}`,
  });

/** The Cursor SDK inside Filament's process, driven by `bridge`. */
export const cursorDestination = (bridge, upstream) =>
  agentDestination(bridge, upstream, { label: "Cursor SDK upstream", transport: "sdk://cursor" });

/** Codex's app-server, driven by `bridge` (HarnessV3-ACP AC2-1). */
export const codexDestination = (bridge, upstream) =>
  agentDestination(bridge, upstream, {
    label: "Codex",
    transport: `codex://${upstream.acp?.command || "codex"}`,
  });
