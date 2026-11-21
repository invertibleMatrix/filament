// @ts-check
// The flows a chat keeps (HarnessV4_Flow_Plan §4.9, FL-D19): one file a chat under Filament's data folder,
// `flows/<chat>.json` — each flow's steps, boxes and states, each box's sub-agent or team chat, and its result whole,
// which the boxes after it are handed — apart from the chat's own record, whose meta every read of the chat parses. A
// chat keeps its open flows and its newest FLOW_LIMITS.kept closed ones. Each flow is held once, in memory, as it was
// last written: its runner changes it there and writes it back. Without a folder (tests) nothing goes to disk.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLOW_LIMITS } from "../core/flow.js";

/** A chat's id as a file's name: nothing but letters, digits, dashes and underscores. @param {string} chainId */
const fileName = (chainId) => `${String(chainId).replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
/** Whether a flow is closed: it runs no more, and is let go past the newest kept. @param {any} f */
const closed = (f) => f?.state === "done" || f?.state === "stopped";

/**
 * @param {{ dir: string | null, log?: (level: string, msg: string) => void }} o  `dir`: Filament's data folder's `flows`
 */
export function createFlowStore({ dir, log = () => {} }) {
  /** Each chat's flows, oldest first, as last written. @type {Map<string, import("../core/flow.js").Flow[]>} */
  const held = new Map();

  /** @param {string} chainId @returns {import("../core/flow.js").Flow[]} */
  function read(chainId) {
    const id = String(chainId || "");
    const had = held.get(id);
    if (had) return had;
    /** @type {import("../core/flow.js").Flow[]} */
    let flows = [];
    if (dir)
      try {
        const j = JSON.parse(readFileSync(join(dir, fileName(id)), "utf8"));
        flows = Array.isArray(j?.flows) ? j.flows.filter((/** @type {any} */ f) => f && typeof f.id === "string" && Array.isArray(f.steps)) : [];
      } catch (/** @type {any} */ e) {
        if (e?.code !== "ENOENT") log("warn", `flows: ${id}'s flows could not be read (${e?.message || e}); it starts with none`);
      }
    held.set(id, flows);
    return flows;
  }

  /** @param {string} chainId */
  function write(chainId) {
    const flows = held.get(chainId) || [];
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, fileName(chainId));
      if (!flows.length) return rmSync(file, { force: true });
      // Whole or not at all: a stop mid-write leaves the last good file.
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, flows }));
      renameSync(`${file}.tmp`, file);
    } catch (/** @type {any} */ e) {
      log("warn", `flows: ${chainId}'s flows could not be written (${e?.message || e})`);
    }
  }

  return {
    /** A chat's flows, oldest first. @param {string} chainId */
    list: (chainId) => read(chainId),
    /** One flow of a chat, or null. @param {string} chainId @param {string} id */
    get: (chainId, id) => read(chainId).find((f) => f.id === String(id || "")) || null,
    /**
     * A flow written: in its place, or after the others. Past the newest kept closed flows, the oldest closed go.
     * @param {string} chainId @param {import("../core/flow.js").Flow} flow
     */
    put(chainId, flow) {
      const flows = read(chainId);
      const at = flows.findIndex((f) => f.id === flow.id);
      if (at >= 0) flows[at] = flow;
      else flows.push(flow);
      const shut = flows.filter(closed);
      for (const f of shut.slice(0, Math.max(0, shut.length - FLOW_LIMITS.kept))) flows.splice(flows.indexOf(f), 1);
      write(String(chainId));
      return flow;
    },
    /** A flow taken out. @param {string} chainId @param {string} id */
    remove(chainId, id) {
      const flows = read(chainId);
      const at = flows.findIndex((f) => f.id === String(id || ""));
      if (at < 0) return false;
      flows.splice(at, 1);
      write(String(chainId));
      return true;
    },
    /** A chat's flows let go with it. @param {string} chainId */
    drop(chainId) {
      held.set(String(chainId || ""), []);
      write(String(chainId || ""));
    },
    /** The chats that keep a flow on disk: a start looks at each. @returns {string[]} */
    chats() {
      if (!dir) return [...held.keys()].filter((k) => held.get(k)?.length);
      try {
        return readdirSync(dir)
          .filter((n) => n.endsWith(".json"))
          .map((n) => n.slice(0, -5));
      } catch {
        return [];
      }
    },
  };
}

/** @typedef {ReturnType<typeof createFlowStore>} FlowStore */
