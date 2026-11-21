// @ts-check
// What a framed page — an agent's visual or an artifact's page — may ask of the harness (HarnessV4_Visuals_Plan VS-D7,
// HarnessV4_Artifacts_Plan AF-D8): words for the message box, taken only right after the person's own click in that
// frame, and no longer than a visual's ask. Nothing it asks is ever sent: the person sends.
import { ASK_MAX } from "./visuals.js";

/**
 * Whether a message from a frame came from the person's own click in it (VC-25, VC-45): their click lands the page's
 * focus on that frame and lends the page a moment of their activation. An ask a timer makes, or one made after they
 * clicked elsewhere, is neither.
 * @param {HTMLIFrameElement} frame
 */
export const clickedIn = (frame) => document.activeElement === frame && !!(/** @type {any} */ (navigator).userActivation?.isActive);

/** An ask's words as the message box takes them; "" where there are none. @param {unknown} text */
export const askText = (text) => String(text ?? "").trim().slice(0, ASK_MAX);
