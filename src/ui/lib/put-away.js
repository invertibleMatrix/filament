// @ts-check
// A page the browser puts away — navigated from, into the back/forward cache — sits there frozen with its connections
// open, and the browser gives a host six connections in all: a few pages put away, each with a stream open, starve
// every page of the app, their own loads included (HarnessV3-Views V3's drive). So a page lets go of each stream it
// holds as it is put away, and one brought back loads afresh: what it drew is out of date, and its own load is the one
// way back that draws all of it. Nothing listens before the first hold.

/** @type {Set<() => void>} */
const held = new Set();
let armed = false;
let letGo = false;

/**
 * Hold a stream while the page is shown: `close` runs when the browser puts the page away. Returns the release, for a
 * stream that ends or is closed first.
 * @param {() => void} close
 * @returns {() => void}
 */
export function holdWhileShown(close) {
  if (!armed) arm();
  held.add(close);
  return () => void held.delete(close);
}

function arm() {
  armed = true;
  addEventListener("pagehide", () => {
    for (const close of [...held]) {
      held.delete(close);
      letGo = true;
      try {
        close();
      } catch (err) {
        reportError(err);
      }
    }
  });
  // Shown again after letting go is only ever a page brought back from the cache.
  addEventListener("pageshow", () => {
    if (letGo) location.reload();
  });
}
