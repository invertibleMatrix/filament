// @ts-check
// A fetch pinned to one certificate: moved to services/machines/pinned.js, where this Filament's own calls to its
// machines read it too (src/app never imports the command line); said here still for the command line and the desktop
// app, which import it from here.
export { certificateAt, pinnedFetch } from "../services/machines/pinned.js";
