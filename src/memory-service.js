// Moved to services/memory/index.js. The composition root hands the service its sidecar (adapters/sidecar); this path
// supplies it, so the tests and scripts that construct the service directly keep working unchanged.
import { MemoryService as Service } from "./services/memory/index.js";
import { sidecar } from "./adapters/sidecar/index.js";
export * from "./services/memory/index.js";
export class MemoryService extends Service {
  constructor(opts = {}) {
    super({ sidecar, ...opts });
  }
}
