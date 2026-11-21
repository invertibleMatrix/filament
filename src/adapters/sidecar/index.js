// @ts-check
// The sidecar as one object for the composition root to hand the memory service: the client that runs Mnemosyne as a
// child process and the installer that puts it on disk. The service names neither module.
import { MemoryEngine, sidecarEnv } from "./client.js";
import { engineDir, engineState, installEngine, uninstallEngine, bundleRoot, bundleFor, engineIsBundles } from "./install.js";

export const sidecar = {
  MemoryEngine,
  sidecarEnv,
  engineDir,
  engineState,
  installEngine,
  uninstallEngine,
  bundleRoot,
  bundleFor,
  engineIsBundles,
};
