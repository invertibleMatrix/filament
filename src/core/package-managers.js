// @ts-check
// The package managers Filament knows, in one place: the lockfile that names each, and the ecosystem it serves. The
// harness's frozen Environment says which one a project's scripts run with (app/agent/environment.js); memory's
// environment check says which one a claim about the project contradicts (services/memory/request-env.js).

/** Which lockfile names the package manager, in the order the Environment prefers them. */
export const LOCKFILES = Object.freeze([
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["Pipfile.lock", "pipenv"],
]);

/** The ecosystem each manager serves: two managers are alternatives only within one. */
export const ECOSYSTEM = Object.freeze({ npm: "node", pnpm: "node", yarn: "node", bun: "node", uv: "python", poetry: "python", pipenv: "python" });
