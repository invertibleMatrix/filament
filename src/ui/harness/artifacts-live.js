// @ts-check
// The artifacts as this page knows them (HarnessV4_Artifacts_Plan E18, step 2): each one's record, read once and read
// again after a new version of it is published, the developer renamed, pinned or deleted it, or what its page keeps
// changed — which the events stream says (AF-D37, AFC-83, AFC-97) — and who hears that: its cards, its frames, its
// full view and the Artifacts page follow it where they stand.
import { api } from "./lib/api.js";
import { onBus } from "./lib/bus.js";

/**
 * @typedef {import("./lib/artifacts.js").ArtifactSeen} ArtifactRecord  an artifact as the admin API gives it
 * @typedef {{ name: string, v: number, title: string, change: "" | "renamed" | "pinned" | "deleted" | "data" }} Published
 *   a version just published (`v`, `title`; `change` ""), the developer's change to one, or a change to what its page
 *   keeps (`change`; `v` 0)
 */

/** @type {Map<string, Promise<ArtifactRecord>>} */
const records = new Map();
/**
 * An artifact's record, read once until a new version of it is published. A failed read is not kept: the next ask
 * reads it again. @param {string} name @returns {Promise<ArtifactRecord>}
 */
export function artifactRecord(name) {
  let p = records.get(name);
  if (!p) {
    p = api(`/artifacts/${encodeURIComponent(name)}`);
    p.catch(() => records.delete(name));
    records.set(name, p);
  }
  return p;
}

/** What shows an artifact's record on the page: how it reads it again. @type {WeakMap<Element, () => void>} */
const showing = new WeakMap();
let following = false;
/**
 * Paint an element from an artifact's record now, and again after each new version of it for as long as the element
 * is on the page: an element taken out is forgotten with it.
 * @param {HTMLElement} el @param {string} name
 * @param {(a: ArtifactRecord) => void} ok @param {(e: unknown) => void} failed  why it could not be read
 */
export function followRecord(el, name, ok, failed) {
  if (!following) {
    following = true;
    onPublished((p) => {
      for (const at of Array.from(document.querySelectorAll("[data-follows]"))) if (at.getAttribute("data-follows") === p.name) showing.get(at)?.();
    });
  }
  const read = () => void artifactRecord(name).then(ok, failed);
  el.setAttribute("data-follows", name);
  showing.set(el, read);
  read();
}

/** @type {Set<(p: Published) => void>} */
const hearers = new Set();
let wired = false;
/**
 * Hear each version published and each change the developer made, of any artifact; returns the unsubscribe.
 * @param {(p: Published) => void} fn
 */
export function onPublished(fn) {
  if (!wired) {
    wired = true;
    onBus((m) => {
      if (m?.type !== "artifact" || typeof m.name !== "string") return;
      records.delete(m.name);
      const change = m.change === "renamed" || m.change === "pinned" || m.change === "deleted" || m.change === "data" ? m.change : "";
      /** @type {Published} */
      const p = { name: m.name, v: Number(m.v) || 0, title: String(m.title || ""), change };
      // One hearer's failure is said, never allowed to keep the others from the version.
      for (const f of [...hearers])
        try {
          f(p);
        } catch (e) {
          console.error(e);
        }
    });
  }
  hearers.add(fn);
  return () => void hearers.delete(fn);
}
