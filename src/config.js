// The config store is services/config/store.js. The first-run seed — which coding agents this machine has — is the
// adapters' knowledge; the composition root hands it to the store, and this file does the same for the callers that
// import from here (bin, the desktop app, scripts, tests).
import { detectedAgentSeed as seed } from "./adapters/agents/acp/detect.js";
import { defaultConfig as defaults, loadConfig as load } from "./services/config/store.js";
export * from "./services/config/store.js";
export const defaultConfig = ({ withAgents = false } = {}) => defaults({ agents: withAgents ? seed : [] });
export const loadConfig = (dataDir) => load(dataDir, { agents: seed });
