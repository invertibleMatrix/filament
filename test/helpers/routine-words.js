// @ts-check
// What Filament says of a routine beside its row's line (core/routines.js `rowWords`), for the tests that hand a page a
// Space's read with words of their own: what each press does, in core's own words, and the parts a watcher's row draws
// — none here: a test of them says its own (watch-ui.test.js).
import { pressWords } from "../../src/core/routines.js";

/**
 * @param {{ trigger?: any, wakes?: any, madeIn?: string, madeBy?: string }} [r]  what it is: a routine at times, or a
 *   watcher by whom it wakes — the chat that proposed it named as it names itself (`madeBy`)
 */
export const moreWords = (r = {}) => ({
  idle: r.trigger ? "listening" : "not now",
  heard: "",
  watches: null,
  wakes: null,
  guides: null,
  lastParts: null,
  press: pressWords({ madeIn: "", ...r }),
});
