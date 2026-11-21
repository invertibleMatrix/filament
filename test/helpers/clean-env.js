// @ts-check
// The environment the tests run in (HarnessV4_Tasks C1). The suite is routinely run from a coding agent's terminal —
// Claude Code's own, or an agent's inside Filament — and that agent's variables then reach every test: the markers an
// agent's environment is scrubbed of (`AGENT_ENV_SCRUB`), and the folder the agent was told to keep its login in
// (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`: an account's, which Filament itself sets for an agent it runs). The app a test
// starts runs in the test's own process and hands that environment on to the agents and login terminals it starts,
// so a test that reads what one of them was given met variables it never set: five tests failed on them, from
// inside Claude Code only. They are taken out here, once, as the module loads; a test that is about one of them
// sets it itself. Every test file that starts a coding agent's fake loads this first, by itself or through helpers/app.js
// (test/acp-env.test.js holds them to it): eleven did not, and failed from a chat's own terminal alone.
import { AGENT_ENV_SCRUB } from "../../src/adapters/agents/agent-process.js";
import { KNOWN_AGENTS } from "../../src/core/catalogues.js";

/** What a coding agent's terminal sets that no test inherits: the markers, and each agent's own folder variable. */
export const AGENT_SET = [...AGENT_ENV_SCRUB, ...new Set(KNOWN_AGENTS.map((/** @type {any} */ a) => a.home).filter(Boolean))];
/**
 * What Claude Code is started with for its model calls, which no test inherits either: the one model Filament names to
 * it for a name typed on its card (bridge.js `#customModel` — a chat on such a name runs the suite with it set, and every
 * fake Claude Code a test starts then offers it as its own), and an Anthropic key with where it is sent (key-models.js
 * asks that address with that key: a test names its own endpoint, never the person's).
 */
export const AGENT_GIVEN = ["ANTHROPIC_CUSTOM_MODEL_OPTION", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS"];
/**
 * What Claude Code sets for the programs it starts, by its names' head: its session's id, socket and token, its effort,
 * its switches (CLAUDE_CODE_DISABLE_…) — more with each of its versions, so they go by the head, not by a list.
 */
export const AGENT_OWN = /^CLAUDE_/i;
for (const name of [...AGENT_SET, ...AGENT_GIVEN, ...Object.keys(process.env).filter((k) => AGENT_OWN.test(k))]) delete process.env[name];
