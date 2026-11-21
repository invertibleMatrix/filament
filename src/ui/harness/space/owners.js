// @ts-check
// What each lane changes (proposal_ux §4.14, mock-space; U5 phase 8 v2) and the merge order (v3), as the Overlap
// banner's Compare… opens them in a sheet (HarnessV4_Space_Plan S1, SG-D5): each lane's changed files — committed or
// not, as git says them — by name, with the lane's chip; a file two lanes both change is said once in orange. Below, for
// the worktrees with commits their base lacks, the order that merges them with the fewest meetings — read-only:
// Filament merges nothing. Drawn from the files read of each lane's place.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { mergeOrder, ownersOf, pathLabel } from "../lib/space-view.js";

/** How many of a lane's files show by name before the rest are counted. */
const SHOWN = 8;

export function ownersPanel() {
  const list = h("div", { class: "so-list" });
  const merge = h("div", { class: "so-merge", hidden: "" });
  // The sheet's head names it: the panel says only where its files come from.
  const el = h("section", { class: "so-panel", "aria-label": "What each lane changes" },
    h("div", { class: "so-head" }, h("span", { class: "sp-quiet" }, "Each lane's changed files, committed or not, as git says them.")),
    list,
    merge);
  let drawn = "";

  /** @param {import("../lib/space-view.js").LaneRef} lane */
  const chip = (lane) => h("span", { class: `sp-branch${lane.main ? " is-main" : ""}` }, lane.chip);
  /** @param {string[]} paths */
  const names = (paths) => {
    const shown = paths.slice(0, SHOWN);
    const more = paths.length - shown.length;
    return h("span", { class: "so-paths", title: paths.join("\n") }, shown.map(pathLabel).join(" · ") + (more > 0 ? ` · +${more} more` : ""));
  };

  return {
    el,
    /**
     * @param {import("../lib/space-view.js").LaneRef[]} lanes
     * @param {ReadonlyMap<string, import("../lib/space-view.js").PlaceFiles>} files  by place key
     * @param {boolean} read  whether the places' files have been read at all
     * @param {string} [error]  why the newest read could not read every lane's place: said first, so what shows is
     *   never taken for all there is (the Hunter on S1)
     */
    paint(lanes, files, read, error = "") {
      const o = ownersOf(lanes, files);
      const order = mergeOrder(lanes, files);
      const key = JSON.stringify([o.own.map((x) => [x.lane.path, x.paths]), o.shared.map((s) => [s.path, s.lanes.map((l) => l.path)]), order.map((m) => [m.lane.path, m.commits, m.meets.length]), read, error]);
      if (key === drawn) return;
      drawn = key;
      list.replaceChildren(
        ...(error ? [h("span", { class: "sp-quiet so-error", role: "alert" }, `Some lanes' files could not be read: ${error}`)] : []),
        ...o.shared.map((s) => h("span", { class: "so-own is-shared", title: `${s.path}\n${s.lanes.map((l) => l.chip).join(" and ")}` },
          h("span", { class: "so-paths" }, pathLabel(s.path)),
          h("span", { class: "so-both" }, `${s.lanes.length > 2 ? `${s.lanes.length} lanes change it` : `${s.lanes.map((l) => l.chip).join(" and ")} both change it`}`))),
        ...o.own.map((x) => h("span", { class: "so-own", "data-place": x.lane.path }, names(x.paths), chip(x.lane))),
        ...(!o.own.length && !o.shared.length && !error ? [h("span", { class: "sp-quiet" }, read ? "No lane has changed a file yet." : "Reading what each lane changed…")] : []),
      );
      merge.hidden = !order.length;
      merge.replaceChildren(
        h("div", { class: "so-merge-head" }, h("span", { class: "so-ic", html: ICONS.gitMerge }), h("b", {}, "Merge order"), h("span", { class: "sp-quiet" }, "read-only: the order that meets the fewest files. Filament merges nothing.")),
        h("ol", { class: "so-order" }, ...order.map((m) =>
          h("li", { class: `so-step${m.meets.length ? " is-meets" : ""}` },
            chip(m.lane),
            h("span", {}, `${m.commits} commit${m.commits === 1 ? "" : "s"}${m.base ? ` not on ${m.base}` : ""}`),
            h("span", { class: "sp-quiet", title: m.meets.map((x) => `${x.path} (${x.lane.chip})`).join("\n") },
              m.meets.length ? `meets ${m.meets.length} file${m.meets.length === 1 ? "" : "s"} another lane changed: ${[...new Set(m.meets.map((x) => pathLabel(x.path)))].slice(0, 3).join(", ")}` : "meets no file another lane changed")))),
      );
    },
  };
}
