// @ts-check
// The config diff the audit trail stores: what changed between two configurations, leaf by leaf, with credentials
// masked by path (never shown, but a change to one is visible in a review). Pure — no I/O, no config store.
// The composition root re-exports it for the tests that import it from server.js.

export function describeDiff(a, b) {
  const out = [];
  const walk = (x, y, path) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    // an added or removed subtree is reported leaf by leaf, so a credential inside it is still masked by its path
    if ((isObj(x) || isObj(y)) && (x == null || isObj(x)) && (y == null || isObj(y))) {
      for (const k of new Set([...Object.keys(x || {}), ...Object.keys(y || {})]))
        walk(x?.[k], y?.[k], path ? `${path}.${k}` : k);
      return;
    }
    out.push({ path, from: x, to: y });
  };
  // Every section but the two lists below, whatever its name: a section left off a hand-kept list was a change the
  // audit trail and the assistant's pending changes never showed.
  const sections = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => k !== "upstreams" && k !== "routes"));
  walk(sections(a), sections(b), "");
  // Upstreams by id, routes by match+upstream: added, removed, and every field that changed inside an existing one.
  const ua = new Map((a.upstreams || []).map((u) => [u.id, u])),
    ub = new Map((b.upstreams || []).map((u) => [u.id, u]));
  for (const [id, u] of ub) {
    if (!ua.has(id)) out.push({ path: `upstreams.${id}`, from: null, to: "added" });
    else walk(ua.get(id), u, `upstreams.${id}`);
  }
  for (const id of ua.keys())
    if (!ub.has(id)) out.push({ path: `upstreams.${id}`, from: "present", to: "removed" });
  const rk = (r) => `${r.match}->${r.upstream}`;
  const ra = new Map((a.routes || []).map((r) => [rk(r), r])),
    rb = new Map((b.routes || []).map((r) => [rk(r), r]));
  for (const [k, r] of rb) {
    if (!ra.has(k))
      out.push({ path: `routes.${r.match}`, from: null, to: `-> ${r.upstream} as ${r.upstreamModel}` });
    else walk(ra.get(k), r, `routes.${r.match}`);
  }
  for (const [k, r] of ra)
    if (!rb.has(k)) out.push({ path: `routes.${r.match}`, from: `-> ${r.upstream}`, to: "removed" });
  if (
    JSON.stringify((a.routes || []).map(rk)) !== JSON.stringify((b.routes || []).map(rk)) &&
    ra.size === rb.size &&
    [...ra.keys()].every((k) => rb.has(k))
  )
    out.push({ path: "routes", from: "order", to: (b.routes || []).map((r) => r.match).join(" › ") });
  // Secrets are never shown, but a change to them must still be visible in a review: mask instead of dropping.
  // A path holds a credential if ANY segment is credential-shaped, if it is inside a header map, or if it is inside an
  // `env` map. Segment-matching rather than one substring regex: the old pattern knew only `headers.set.` and so let
  // `upstreams.<id>.headers.Authorization` through — a Basic-auth blob landed verbatim in ops.jsonl, over SSE and on
  // screen, because redactSecrets recognises value SHAPES and a base64 blob or a raw hex PAT has none. Segment matching
  // also stops the over-masking a bare /token/ would cause (`rules.maxTokens` is a number, not a credential).
  const SECRET_SEGMENT =
    /^(\w*api[_-]?key|apikey|admintoken|inboundkeys|accesstoken|refreshtoken|tokens?|secrets?|password|passwd|credentials?|authorization|auth|cookie|bearer|privatekey|key)$/i;
  const isSecretPath = (path) => {
    const p = String(path || "").toLowerCase();
    if (/(^|\.)env(\.|$)/.test(p)) return true;
    if (/(^|\.)headers(\.|$)/.test(p)) return true;
    return p
      .split(/[.[]|\/|\]/)
      .filter(Boolean)
      .some((seg) => SECRET_SEGMENT.test(seg.replace(/\]$/, "")));
  };
  const mask = (v) =>
    v == null || v === "" ? v : Array.isArray(v) ? `[${v.length} secret value(s)]` : "••••••";
  return out
    .filter((d) => d.path)
    .map((d) => (isSecretPath(d.path) ? { ...d, from: mask(d.from), to: mask(d.to), secret: true } : d));
}
