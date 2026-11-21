// @ts-check
// The page's tests of teams run with Settings › Experimental's Teams switch on (src/ui/lib/teams-on.js), as a page whose
// configuration has it on: imported for its effect, before the test's own. A test of the switch turns it off itself.
import { state } from "../../src/ui/harness/state.js";

state.config = { ...(state.config || {}), experimental: { ...(state.config?.experimental || {}), teams: true } };
