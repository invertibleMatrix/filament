// @ts-check
// An artifact's page in a frame (HarnessV4_Artifacts_Plan E18, step 2), for the side pane's tab and the full view: on
// its own address, which is never the harness's origin (AF-D2), drawn in the harness's look of the moment — its theme
// and Motion handed by the frame's name before it loads and by a message after (AF-D33) — with one line under it for
// what failed in it, with Tell the agent (AFC-25), or for a frame that left its page, with Back (AFC-74). A new
// version is shown as it is published (AF-D37), and an old one when asked (AFC-28); what its page keeps changing
// leaves it as it is — the page reads it, or follows it (AFC-92). Its page's ask is heard only right after a click in
// it (AF-D8, AFC-98). A page of Filament's own — a Doc, a deck, a Dashboard, a Design — may fill the screen on the
// person's click or key in it; a Doc or a deck shows the text being edited beside it as it is typed (steps 6 and 7,
// AFC-112, AFC-115, AFC-127). Where this page cannot frame it
// (AFC-67) the line says why instead. The Artifacts page's grid takes a still preview of each (`artifactPreview`),
// which asks nothing (AFC-99) and is named still (AFC-113). Each loads once the page knows where its artifacts are —
// /api/state says it (`artifactsPlaced`) — so another machine's browser frames the network's artifacts address, never
// an address of this machine's own it cannot reach (the owner's remote Filament of 11-06, Part 4).
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { ICONS } from "./lib/icons.js";
import { failureLine, failureOf } from "./lib/visuals.js";
import { askText, clickedIn } from "./lib/frame-ask.js";
import { whenShown } from "./lib/when-shown.js";
import { artifactAddress, artifactOrigin, frameableAt, hereArtifactOf, lookName, passless, portOf, sentTo, spokenOrigin, stillAddress, stillOrigin, titleOfName, useArtifactsAt, versionAddress, APP_FRAME_ALLOW, APP_FRAME_SANDBOX, FRAME_ALLOW, FRAME_SANDBOX } from "./lib/artifacts.js";
import { onPublished } from "./artifacts-live.js";
import { copyLink, openOut } from "./artifact-acts.js";
import { menu } from "./lib/ui.js";

/** Where this page reads its artifacts, as /api/state said it, once read. @type {Promise<void> | null} */
let placing = null;
/** How long a read of where this page reads its artifacts waits before it is tried again: doubled each time, to this. */
export const PLACE_RETRY_MAX_MS = 30_000;
/**
 * Where this page reads its artifacts, read from /api/state once (lib/artifacts.js `useArtifactsAt`): every address of
 * an artifact the page gives after it is the server's. A read that fails — no answer, or the server's own trouble — is
 * tried again, a second, then twice as long each time to `PLACE_RETRY_MAX_MS`, and what waits on it waits on: an
 * address of this machine's own given meanwhile would send another machine's browser where it cannot reach (the hunt of
 * p4-artifacts). One the server refuses (a device revoked, no such route) is asked no more: the page links none.
 * @param {(ms: number) => Promise<void>} [pause]  the wait between tries — the tests' stand-in
 * @returns {Promise<void>}
 */
export function artifactsPlaced(pause = (ms) => new Promise((r) => setTimeout(r, ms))) {
  placing ??= (async () => {
    for (let ms = 1000; ; ms = Math.min(ms * 2, PLACE_RETRY_MAX_MS)) {
      try {
        useArtifactsAt((await api("/state"))?.artifacts);
        return;
      } catch (e) {
        const status = Number(/** @type {any} */ (e)?.status) || 0;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) return void useArtifactsAt(null);
        await pause(ms);
      }
    }
  })();
  return placing;
}

/** Where every artifact's page and still preview are, as one artifact's say it: the same before and after a read, nothing moved. */
const placeNow = () => `${artifactAddress("x", 0)} ${stillAddress("x", 0, 1)}`;
/**
 * Where this page reads its artifacts, read again once a setting changed — `server.loopbackTrust` among them, which
 * makes this machine's addresses carry a pass or none (the review of x41: a page read under Any program framed every
 * artifact with none after the switch to the owner key) — and as the events feed comes back, Filament perhaps started
 * again under a pass of its new run (the hunt on x41). Where the addresses moved, every frame on the page loads its page
 * again at its address now: one loaded under a pass that is no more is refused each thing it asks. A read that fails
 * leaves the addresses as they were.
 * @returns {Promise<void>}
 */
export function artifactsPlacedAgain() {
  if (!placing) return artifactsPlaced();
  placing = placing.then(async () => {
    try {
      const st = await api("/state");
      if (!st || !("artifacts" in st)) return;
      const was = placeNow();
      useArtifactsAt(st.artifacts);
      if (placeNow() !== was) for (const f of framesNow()) framed.get(f)?.moved?.();
    } catch {
      // As they were: the next change reads them again.
    }
  });
  return placing;
}

/**
 * A link to an artifact of this machine's, pressed anywhere on this page — a chat's words, a card's arrow, Info — where
 * its addresses carry this page's pass (lib/artifacts.js `hereArtifactOf`): opened in a tab of its own under a pass of
 * that artifact's alone (artifact-acts.js `openOut`), never as written, which no pass or the page's for every artifact
 * would carry out. Once, as the page starts. @param {Document} doc
 */
export function passArtifactLinks(doc) {
  const out = (/** @type {MouseEvent} */ e) => {
    if (e.type === "auxclick" && e.button !== 1) return;
    const a = /** @type {any} */ (e.target)?.closest?.("a[href]");
    if (!a || typeof a.href !== "string" || !a.href.startsWith("http://") || !hereArtifactOf(a.href)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void openOut(a.href);
  };
  doc.addEventListener("click", out, true);
  doc.addEventListener("auxclick", out, true);
  // Its right-click too: the browser's own menu, the app's among them, would open or copy the link as written, which
  // no pass opens (the hunt on x41). Open in browser and Copy link go under a pass of the artifact's own.
  doc.addEventListener(
    "contextmenu",
    (e) => {
      const a = /** @type {any} */ (e.target)?.closest?.("a[href]");
      const here = a && typeof a.href === "string" && a.href.startsWith("http://") ? hereArtifactOf(a.href) : null;
      if (!here) return;
      e.preventDefault();
      const href = a.href;
      menu(
        [
          { label: "Open in browser", icon: "externalLink", onClick: () => void openOut(href) },
          { label: "Copy link", icon: "link", onClick: () => void copyLink(/** @type {any} */ ({ title: titleOfName(here.name) }), href) },
        ],
        { anchor: a },
      );
    },
    true,
  );
}

/**
 * A link out to an artifact's address, once this page knows where it reads them: none, hidden, where its Filament
 * serves them to this page nowhere (`artifactAddress` ""). Written without this page's pass, which a press takes on to
 * one of the artifact's own (`passArtifactLinks`).
 * @param {Element} a @param {string} address
 */
export function linkOut(a, address) {
  if (address) a.setAttribute("href", String(passless(address)));
  else a.removeAttribute("href");
  a.classList.toggle("hidden", !address);
}

/** @typedef {import("./lib/visuals.js").Failure} Failure */

/** The harness's theme and Motion now. @returns {{ theme: "light" | "dark", motion: string }} */
function lookNow() {
  const root = document.documentElement;
  return { theme: root.classList.contains("theme-zai-light") ? "light" : "dark", motion: root.dataset.motion || "full" };
}

/** The artifacts' frames on the page now. @returns {HTMLIFrameElement[]} */
const framesNow = () => Array.from(document.querySelectorAll("iframe.artifact-frame"));
/**
 * What each frame is: the origin its messages must come from, how its card hears one, how it is drawn again — told
 * the version published, where one was —, and whether it is a still preview, which keeps no motion whatever the
 * harness's Motion (AFC-81), and how it loads its page again at its address now, where the addresses moved
 * (`artifactsPlacedAgain`).
 * @type {WeakMap<HTMLIFrameElement, { origin: string, hear: (m: any) => void, again: (v?: number) => void, still?: boolean, moved?: () => void }>}
 */
const framed = new WeakMap();
let wired = false;
/**
 * The page's ears, once: a message counts only from an artifact's own frame and its own origin (AFC-72); a switch of
 * theme or Motion goes to every frame at once (AFC-68); a new version, or its delete, draws its frames again.
 */
function wire() {
  if (wired) return;
  wired = true;
  window.addEventListener("message", (e) => {
    if (e.data?.filament !== "artifact" || !e.source) return;
    const from = framesNow().find((f) => f.contentWindow === e.source);
    const at = from ? framed.get(from) : null;
    if (at && e.origin === spokenOrigin(at.origin)) at.hear(e.data);
  });
  let key = "";
  const keyNow = () => `${document.documentElement.className}|${document.documentElement.dataset.motion || ""}`;
  new MutationObserver(() => {
    if (keyNow() === key) return;
    key = keyNow();
    const look = lookNow();
    for (const f of framesNow()) {
      const at = framed.get(f);
      if (!at) continue;
      // Its name is what a page loaded later reads; the message is what the page shown now follows.
      const motion = at.still ? "off" : look.motion;
      f.name = lookName(look.theme, motion, at.still);
      f.contentWindow?.postMessage({ filament: "look", theme: look.theme, motion }, sentTo(spokenOrigin(at.origin)));
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-motion"] });
  key = keyNow();
  // A frame that fills the screen, or leaves it, tells its page (AFC-112).
  document.addEventListener("fullscreenchange", () => {
    for (const f of framesNow()) {
      const at = framed.get(f);
      if (at && !at.still) f.contentWindow?.postMessage({ filament: "fullscreen", on: document.fullscreenElement === f }, sentTo(spokenOrigin(at.origin)));
    }
  });
  onPublished((p) => {
    // A rename, a pin or a change to what it keeps leaves its page as it is.
    if (p.change === "renamed" || p.change === "pinned" || p.change === "data") return;
    for (const f of framesNow()) if (f.dataset.artifact === p.name) framed.get(f)?.again(p.v);
  });
}

/**
 * An artifact's frame, and the line under it.
 * @param {string} name
 * @param {{ title: string, onTell: (text: string) => void, onAsk: (text: string) => void, mayFill?: () => boolean,
 *   onReady?: () => void, within?: "space", onAct?: (m: { action: string, key: string }) => void, onStop?: () => void,
 *   app?: boolean, back?: (heard: number | null) => { v: number, go: () => void } | null }} o
 *   its title, for the frame and the words told; `onAsk`: the words its
 *   page asked, into a message box; `mayFill`: whether its page may ask Filament to fill the screen — Filament's own
 *   pages alone (AFC-112, AFC-114); `onReady`: a Doc's or a deck's page, loaded again or at first, listens for a draft
 *   (AFC-115); `within`: a Space's tab, whose bar says what a dashboard's own sources did (`?in=space`,
 *   HarnessV4_Space_Plan S2); `onAct`: a dashboard's button pressed on a row in it — heard, as an ask is, right after a
 *   click in it (S3); `onStop`: an app's page asked its running button stopped, heard the same way; `app`: an app's
 *   page, which may also lock the pointer, fill the screen itself and read a gamepad (the Space Apps plan of 10-29);
 *   `back`: the version before the one shown, which the failure's line offers to make the newest again — "Back to v4" —,
 *   asked with the newest version the frame was told was published, if any: none while its Space has not read that one
 * @returns {{ el: HTMLElement, readonly address: string, setTitle: (t: string) => void,
 *   showVersion: (v: number | null) => void, draft: (markdown: string, at: number) => void, repaint: () => void }}
 *   `address`: its address as this page reads it now — the server's once it said where (`artifactsPlaced`);
 *   `showVersion`: an old version, or the newest (null), from its start; `draft`: the text being edited beside a Doc
 *   or a deck, and where its caret is, which the page shows as it is typed (AFC-115); `repaint`: its line drawn again,
 *   as what `back` says moves — a new version's page can fail before its Space has read that it is there
 */
export function artifactFrame(name, o) {
  wire();
  const port = portOf(location);
  // Its newest page, as the frame asks for it: told where it stands, if anywhere.
  const newestOf = () => (o.within ? `${artifactAddress(name, port)}?in=${o.within}` : artifactAddress(name, port));
  /** An old version's page, as the frame asks for it. @param {number} v */
  const versionOf = (v) => `${versionAddress(name, port, v)}${o.within ? `?in=${o.within}` : ""}`;
  let title = o.title;
  const note = h("div", { class: "artifact-note hidden", role: "status" });
  /** @type {Failure[]} */
  let failures = [];
  // Whether its page said it is there since the frame last loaded, and whether the frame left it.
  let here = false;
  let left = false;
  // Whether the page knows where its artifacts are, and frames this one: until then the frame loads nothing.
  let placed = false;
  // Its origin, once placed: what its messages come from.
  let origin = "";
  // What it shows: the newest, or an old version asked for — at its address as it stands at each load, so one drawn
  // before a switch of the owner key or a restart loads under the pass this page holds now (the hunt on x41).
  /** @type {number | null} */
  let shownV = null;
  const targetNow = () => (shownV ? versionOf(shownV) : newestOf());
  const look = lookNow();
  const frame = /** @type {HTMLIFrameElement} */ (h("iframe", { class: "artifact-frame", sandbox: o.app ? APP_FRAME_SANDBOX : FRAME_SANDBOX, allow: o.app ? APP_FRAME_ALLOW : FRAME_ALLOW, referrerpolicy: "no-referrer", title: `Artifact: ${title}`, "data-artifact": name }));
  // Named before it loads: its page reads the look from its name as it starts (AF-D33).
  frame.name = lookName(look.theme, look.motion);
  // The frame goes in once it has its address: one put in before would load an empty page, which reads as having left it.
  const el = h("div", { class: "artifact-stage" }, note);

  const paint = () => {
    /** @type {(string | HTMLElement)[]} */
    const parts = [];
    const failed = left ? null : failureLine(`${title} (${name})`, failures, { thing: "artifact", own: origin });
    if (left) {
      parts.push(h("span", { class: "artifact-note-text" }, "The frame left this artifact's page."),
        h("button", { class: "visual-tell", type: "button", title: "Open the artifact's page again", onclick: () => show() }, "Back"));
    } else if (failed) {
      parts.push(h("span", { class: "visual-note-ic", html: ICONS.shieldAlert }), h("span", { class: "artifact-note-text", title: failed.more.join("\n") }, failed.line),
        h("button", { class: "visual-tell", type: "button", title: "Write this into your message box; nothing is sent until you send it", onclick: () => o.onTell(failed.tell) }, "Tell the agent"));
      // A version that broke: the one before it, made the newest again — this one stays among its versions.
      const back = o.back?.(heardV || null);
      if (back) parts.push(h("button", { class: "visual-tell artifact-back", type: "button", title: `Publish v${back.v} again as the newest; this version stays among its versions`, onclick: () => back.go() }, `Back to v${back.v}`));
    }
    note.replaceChildren(...parts);
    note.classList.toggle("hidden", !parts.length);
  };
  /** Its page from the start, at the version it shows. */
  const show = () => {
    here = false;
    left = false;
    failures = [];
    paint();
    frame.src = targetNow();
  };
  /** @param {any} m */
  const hear = (m) => {
    if (m.kind === "here") {
      // A new page of it: what failed in the one before is gone with it.
      here = true;
      failures = [];
      left = false;
      paint();
      return;
    }
    if (m.kind === "ready") return o.onReady?.();
    if (m.kind === "ask") {
      const text = clickedIn(frame) ? askText(m.text) : "";
      if (text) o.onAsk(text);
      return;
    }
    if (m.kind === "act") {
      // A dashboard's button: the page only asks; the harness's sheet says what runs (HarnessV4_Space_Plan S3).
      if (o.onAct && clickedIn(frame) && typeof m.action === "string" && typeof m.key === "string") o.onAct({ action: m.action.slice(0, 40), key: m.key.slice(0, 1000) });
      return;
    }
    if (m.kind === "stop") {
      // An app's run stopped from its page: asked, as a button is, right after a click in it.
      if (o.onStop && clickedIn(frame)) o.onStop();
      return;
    }
    if (m.kind === "fullscreen") {
      // Only Filament's own pages, on the person's own click or key in them (AFC-114).
      if (!o.mayFill?.() || !clickedIn(frame)) return;
      if (m.on && document.fullscreenElement !== frame) void frame.requestFullscreen?.().catch(() => {});
      else if (!m.on && document.fullscreenElement === frame) void document.exitFullscreen();
      return;
    }
    if (m.kind !== "fail") return;
    const f = failureOf({ ...m, url: passless(m.url), message: passless(m.message) });
    if (f && failures.length < 50) {
      failures = [...failures, f];
      paint();
    }
  };
  frame.addEventListener("load", () => {
    // A page of it says it is there as it starts, before it has loaded; one that did not is not its page (AFC-74).
    left = !here;
    here = false;
    if (left) failures = [];
    paint();
  });
  // The newest version a publish told it of: its page can load, and fail, before its Space reads that one is there.
  let heardV = 0;
  // Loaded once the page knows where its artifacts are: from the location alone, another machine's browser would be
  // sent to an address of this machine's own, which it cannot reach. Where it cannot frame it (AFC-67), the line says why.
  void artifactsPlaced().then(() => {
    const can = frameableAt(location.hostname, port);
    if (!can.ok) {
      el.prepend(h("div", { class: "artifact-unframed" }));
      note.replaceChildren(h("span", { class: "artifact-note-text" }, can.why));
      note.classList.remove("hidden");
      return;
    }
    origin = artifactOrigin(name, port);
    /** @type {NonNullable<ReturnType<typeof framed.get>>} */
    const at = {
      origin,
      hear,
      again: (v) => {
        if (v) heardV = Math.max(heardV, v);
        show();
      },
      moved: () => {
        if (!frameableAt(location.hostname, port).ok) return;
        at.origin = origin = artifactOrigin(name, port);
        show();
      },
    };
    framed.set(frame, at);
    placed = true;
    if (shownV) show();
    else frame.src = targetNow();
    el.prepend(frame);
  });
  return {
    el,
    get address() {
      return artifactAddress(name, port);
    },
    setTitle(t) {
      if (!t || t === title) return;
      title = t;
      frame.title = `Artifact: ${t}`;
    },
    showVersion(v) {
      shownV = v;
      if (placed) show();
    },
    draft(markdown, at) {
      if (placed) frame.contentWindow?.postMessage({ filament: "draft", markdown, at }, sentTo(spokenOrigin(origin)));
    },
    repaint: paint,
  };
}

/**
 * A still preview of a version, for the Artifacts page's grid (AFC-81): its page in a small frame, loaded only as it
 * nears the screen, with no motion and nothing to click — on the version's own address, so it is never counted as a
 * view, at the artifact's still origin, so what its code sends reads and changes nothing (`stillAddress`) — once the
 * page knows where its artifacts are. Where this page cannot frame it (AFC-67), an empty box.
 * @param {string} name @param {number} v @param {string} title
 */
export function artifactPreview(name, v, title) {
  wire();
  const port = portOf(location);
  const box = h("div", { class: "artifact-peek", "aria-hidden": "true" });
  whenShown(box, () => {
    void artifactsPlaced().then(() => {
      if (!frameableAt(location.hostname, port).ok) return;
      const frame = /** @type {HTMLIFrameElement} */ (h("iframe", { class: "artifact-frame artifact-peek-frame", sandbox: "allow-scripts allow-same-origin", referrerpolicy: "no-referrer", tabindex: "-1", title: `Preview: ${title}`, "data-peek": name }));
      frame.name = lookName(lookNow().theme, "off", true);
      const at = {
        origin: stillOrigin(name, port),
        hear: () => {},
        again: () => {},
        still: true,
        moved: () => {
          if (!frameableAt(location.hostname, port).ok) return;
          at.origin = stillOrigin(name, port);
          frame.src = stillAddress(name, port, v);
        },
      };
      framed.set(frame, at);
      frame.src = stillAddress(name, port, v);
      box.append(frame);
    });
  });
  return box;
}
