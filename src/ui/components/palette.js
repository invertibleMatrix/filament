// @ts-check
// The Ctrl+K jump list. The command *catalogue* stays with the admin shell (it names every page);
// this module is the widget: filter, arrow keys, Enter, click-outside.

import { $, h } from "../lib/dom.js";

/**
 * @param {object} d
 * @param {() => void} d.closePops
 * @param {() => void} d.closePalette
 * @param {() => { id: string, label: string, hint?: string, run: () => void }[]} d.commands
 */
export function createPalette({ closePops, closePalette, commands }) {
  function openPalette() {
    closePops();
    const pal = $("#palette");
    const q = $("#palette-q");
    const list = $("#palette-list");
    pal.classList.remove("hidden");
    let items = commands();
    let active = 0;
    const draw = () => {
      const needle = q.value.trim().toLowerCase();
      items = commands().filter(
        (c) => !needle || `${c.label} ${c.hint} ${c.id}`.toLowerCase().includes(needle),
      );
      if (active >= items.length) active = Math.max(0, items.length - 1);
      list.replaceChildren(
        ...(items.length
          ? items.map((c, i) =>
              h(
                "button",
                {
                  class: `pal-item${i === active ? " active" : ""}`,
                  onclick: () => {
                    closePalette();
                    c.run();
                  },
                },
                c.label,
                c.hint ? h("span", { class: "muted" }, c.hint) : null,
              ),
            )
          : [h("div", { class: "cmdk-empty" }, "Nothing matches")]),
      );
    };
    q.oninput = () => {
      active = 0;
      draw();
    };
    q.onkeydown = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(items.length - 1, active + 1);
        draw();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        draw();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const c = items[active];
        if (c) {
          closePalette();
          c.run();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    };
    pal.onclick = (e) => {
      if (e.target === pal) closePalette();
    };
    q.value = "";
    draw();
    q.focus();
  }
  $("#btn-palette").onclick = (e) => {
    e.stopPropagation();
    openPalette();
  };
  return { openPalette };
}
