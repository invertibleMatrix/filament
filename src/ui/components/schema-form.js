// @ts-check
// Schema-driven form controls for the admin dashboard. The harness page does not import this —
// its settings, if any, are its own. `createSchemaForm` takes `toast` because invalid JSON in a
// map/array field is an operator error, not a thrown exception.

import { h } from "../lib/dom.js";
import { md } from "../lib/md.js";
import { keyWords, keyBeside } from "../lib/format.js";

/** @param {any} obj @param {string} path */
export const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * @param {any} obj
 * @param {string} path
 * @param {any} value
 */
export function setPath(obj, path, value) {
  const ks = path.split(".");
  const last = ks[ks.length - 1];
  let o = obj;
  for (const k of ks.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  if (value === undefined) delete o[last];
  else o[last] = value;
}

/**
 * A field's label or a group's heading (HarnessV3-Launch LD-D10): the key in words, then the key itself in small mono
 * when it says something the words don't, with the full path as its tooltip.
 * @param {"label" | "h3"} tag @param {string} key @param {string} path @param {typeof h} [mk]
 */
export function keyLabel(tag, key, path, mk = h) {
  const beside = keyBeside(key);
  return mk(tag, {}, keyWords(key), beside ? mk("span", { class: "field-key", title: path }, beside) : null);
}

/** A schema leaf is an object with a `type` string and a `description`. */
export const isLeaf = (node) =>
  node && typeof node === "object" && typeof node.type === "string" && "description" in node;

/**
 * Flatten a nested object to dotted paths.
 * @param {any} o
 * @param {string} [p]
 * @param {Record<string, any>} [out]
 */
export function flatten(o, p = "", out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const path = p ? `${p}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

/** Default values for a schema group. */
export function defaultsOf(node) {
  if (isLeaf(node)) return structuredClone(node.default);
  const o = {};
  for (const [k, v] of Object.entries(node)) if (k !== "_doc") o[k] = defaultsOf(v);
  return o;
}

/**
 * Overlay rule layers on the schema defaults. The dashboard's `mergedRules(...layers)` is this
 * with `state.schema.rules` as the first argument.
 * @param {any} schemaRules
 * @param {...any} layers
 */
export function mergedRules(schemaRules, ...layers) {
  const out = {};
  const deep = (d, s) => {
    for (const [k, v] of Object.entries(s || {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        d[k] = d[k] && typeof d[k] === "object" ? d[k] : {};
        deep(d[k], v);
      } else d[k] = v;
    }
  };
  deep(out, defaultsOf(schemaRules));
  for (const l of layers) deep(out, l);
  return out;
}

/**
 * @param {object} deps
 * @param {(msg: string, kind?: string) => void} deps.toast
 */
export function createSchemaForm({ toast }) {
  /**
   * @param {any} leaf
   * @param {any} value
   * @param {(v: any) => void} onChange
   */
  function control(leaf, value, onChange) {
    const t = leaf.type;
    if (t === "boolean") {
      const el = h("input", { type: "checkbox", class: "toggle" });
      el.checked = !!value;
      el.onchange = () => onChange(el.checked);
      return h("label", { class: "switch" }, el, h("span"));
    }
    if (t === "enum") {
      const opts = leaf.options || leaf.values || [];
      const s = h(
        "select",
        {},
        ...opts.map((o) => h("option", { value: o, selected: o === value ? "" : null }, o)),
      );
      s.onchange = () => onChange(s.value);
      return s;
    }
    if (t === "number") {
      const i = h("input", { type: "number", value: value ?? "", placeholder: "empty = not set" });
      i.onchange = () => onChange(i.value === "" ? null : Number(i.value));
      return i;
    }
    if (t === "secret") {
      let stored = value === "__SECRET__";
      const i = h("input", {
        type: "password",
        value: stored ? "" : (value ?? ""),
        placeholder: stored ? "a value is stored; type here to replace it" : "",
        autocomplete: "off",
      });
      i.onchange = () => onChange(i.value === "" && stored ? "__SECRET__" : i.value);
      if (!stored) return i;
      const clear = h(
        "button",
        {
          class: "sm ghost",
          title: "Forget the stored value. Takes effect when you press Save changes.",
          onclick: () => {
            stored = false;
            onChange("");
            i.value = "";
            i.placeholder = "removed; save to apply";
            clear.remove();
          },
        },
        "Remove",
      );
      return h("div", { class: "secret-ctl" }, i, clear);
    }
    if (t === "string" || t === "regex") {
      // A long editable text — the steering prompt, say — is unusable in a one-line input: you cannot
      // see what you are changing, so "every knob playable live" would be satisfied in name only.
      // `multiline` in the schema asks for a textarea instead.
      if (leaf.multiline) {
        const ta = h("textarea", { rows: Number(leaf.rows) > 0 ? Number(leaf.rows) : 4 }, value ?? "");
        ta.onchange = () => onChange(ta.value);
        return ta;
      }
      const i = h("input", { type: "text", value: value ?? "", class: t === "regex" ? "mono" : "" });
      i.onchange = () => onChange(i.value);
      return i;
    }
    if (t === "array" && leaf.itemType === "enum") {
      const wrap = h("div", { class: "checks" });
      let cur = Array.isArray(value) ? [...value] : [];
      const ordered = leaf.description.includes("priority order");
      const orderLbl = ordered ? h("small", { class: "muted" }) : null;
      const showOrder = () => {
        if (orderLbl) orderLbl.textContent = `order: ${cur.join(" → ") || "(none)"}`;
      };
      for (const o of leaf.options || leaf.values || []) {
        const cb = h("input", { type: "checkbox" });
        cb.checked = cur.includes(o);
        cb.onchange = () => {
          cur = ordered
            ? cb.checked
              ? [...cur.filter((x) => x !== o), o]
              : cur.filter((x) => x !== o)
            : leaf.options.filter((x) => (x === o ? cb.checked : cur.includes(x)));
          showOrder();
          onChange([...cur]);
        };
        wrap.append(h("label", { class: "check" }, cb, o));
      }
      if (orderLbl) {
        showOrder();
        wrap.append(orderLbl);
      }
      return wrap;
    }
    if (t === "array") {
      const i = h("input", {
        type: "text",
        value: (value || []).join(", "),
        placeholder: "comma separated",
      });
      i.onchange = () =>
        onChange(
          i.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      return i;
    }
    const ta = h(
      "textarea",
      { class: "mono", rows: 4 },
      JSON.stringify(value ?? (t === "map" ? {} : []), null, 2),
    );
    ta.onchange = () => {
      try {
        onChange(JSON.parse(ta.value));
        ta.classList.remove("bad");
      } catch {
        ta.classList.add("bad");
        toast("Invalid JSON", "err");
      }
    };
    return ta;
  }

  function schemaMatch(key, node, q) {
    if (!q) return true;
    const blob = `${key} ${keyWords(key)} ${node._doc || ""} ${node.description || ""} ${node.effect || ""}`.toLowerCase();
    if (blob.includes(q)) return true;
    if (!isLeaf(node))
      for (const [k, v] of Object.entries(node)) if (k !== "_doc" && schemaMatch(k, v, q)) return true;
    return false;
  }

  /**
   * Render a schema group as a form. `values` is the object being edited; `inheritFrom` (optional)
   * makes every field an override with an "inherit" checkbox showing the inherited value.
   * @param {any} schema
   * @param {any} values
   * @param {() => void} onChange
   * @param {object} [opts]
   */
  function schemaForm(schema, values, onChange, opts = {}) {
    const {
      inheritFrom = null,
      pathPrefix = "",
      compact = false,
      filter = "",
      teach = true,
      group = null,
      skip = [],
    } = opts;
    const q = String(filter || "")
      .trim()
      .toLowerCase();
    const wrap = h("div", { class: `form${compact ? " compact" : ""}` });
    for (const [key, node] of Object.entries(schema)) {
      if (key === "_doc") continue;
      if (group && !pathPrefix && key !== group) continue;
      if (q && !schemaMatch(key, node, q)) continue;
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      // `skip` hides a setting that owns an editor of its own elsewhere (the agent loop's prompt overlay lives on the
      // Prompts tab; ui/lib/agent-loop-rows.js names the rest, the owner's of 11-09), by its path under the form's
      // group, so a nested leaf of the same name is untouched.
      if (skip.includes(path)) continue;
      if (!isLeaf(node)) {
        const inner = schemaForm(node, values, onChange, {
          inheritFrom,
          pathPrefix: path,
          compact,
          filter,
          teach,
          skip,
        });
        // A group whose every setting is set elsewhere draws no heading either.
        if (!inner.childElementCount) continue;
        if (compact) {
          const openFirst = !q && !group && !pathPrefix && wrap.childElementCount === 0;
          const det = h(
            "details",
            { class: "group", open: q || group || openFirst ? "" : null },
            h("summary", {}, keyLabel("h3", key, path), h("p", { class: "muted", html: md(node._doc || "") })),
            inner,
          );
          wrap.append(det);
        } else
          wrap.append(
            h(
              "section",
              { class: "group" },
              keyLabel("h3", key, path),
              h("p", { class: "muted", html: md(node._doc || "") }),
              inner,
            ),
          );
        continue;
      }
      // Skipped leaves own an editor of their own elsewhere: inbound keys live on the keys panel above.
      if (path === "server.inboundKeys" || path === "inboundKeys") continue;
      const current = getPath(values, path);
      const inherited = inheritFrom ? getPath(inheritFrom, path) : undefined;
      const row = h("div", {
        class: "field",
        title: compact ? `${node.description || ""} ${node.effect ? "Effect: " + node.effect : ""}` : null,
      });
      const head = h(
        "div",
        { class: "field-head" },
        keyLabel("label", key, path),
        compact
          ? null
          : h(
              "span",
              { class: "muted small" },
              node.default == null ? "no default" : `default: ${JSON.stringify(node.default)}`,
            ),
      );
      const body = h("div", { class: "field-body" });
      const desc = h(
        "div",
        { class: "desc" },
        h("div", { html: md(node.description) }),
        h("div", { class: "effect", html: `<b>Effect:</b> ${md(node.effect || "")}` }),
      );
      if (inheritFrom) {
        const isSet = current !== undefined;
        const cb = h("input", { type: "checkbox" });
        cb.checked = !isSet;
        const holder = h("div", { class: "override" });
        const draw = () => {
          holder.replaceChildren(
            cb.checked
              ? h("span", { class: "muted" }, `inherits ${JSON.stringify(inherited)}`)
              : control(node, current ?? inherited, (v) => {
                  setPath(values, path, v);
                  onChange();
                }),
          );
        };
        cb.onchange = () => {
          if (cb.checked) setPath(values, path, undefined);
          else setPath(values, path, structuredClone(inherited ?? node.default));
          onChange();
          draw();
        };
        body.append(h("label", { class: "check" }, cb, "inherit"), holder);
        draw();
      } else
        body.append(
          control(node, current, (v) => {
            setPath(values, path, v);
            onChange();
          }),
        );
      row.append(head, body);
      if (teach) row.append(desc);
      wrap.append(row);
    }
    return wrap;
  }

  return { control, schemaForm, schemaMatch };
}
