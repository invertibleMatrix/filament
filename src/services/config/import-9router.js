// One-way import of provider connections from a local 9router install (its SQLite database), so a user can
// switch to Filament without re-entering keys or logging in again. Read-only; nothing in 9router is modified.
import { existsSync } from "node:fs";
import { join } from "node:path";

export function nineRouterDbPath() {
  const base =
    process.platform === "win32" ? process.env.APPDATA || "" : join(process.env.HOME || "", ".config");
  return join(base, "9router", "db", "data.sqlite");
}

export async function read9routerConnections(dbPath = nineRouterDbPath()) {
  if (!existsSync(dbPath)) return { found: false, path: dbPath, connections: [] };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return {
      found: true,
      path: dbPath,
      error: "this Node.js has no built-in sqlite (need Node 22.5+)",
      connections: [],
    };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "select id, provider, authType, name, email, isActive, data, updatedAt from providerConnections",
      )
      .all();
    return {
      found: true,
      path: dbPath,
      connections: rows.map((r) => {
        let data = {};
        try {
          data = JSON.parse(r.data || "{}");
        } catch {}
        return {
          id: r.id,
          provider: r.provider,
          authType: r.authType,
          name: r.name,
          email: r.email,
          active: r.isActive !== 0,
          updatedAt: r.updatedAt,
          data,
        };
      }),
    };
  } finally {
    try {
      db.close();
    } catch {}
  }
}

// Apply what we can to a Filament config. Returns { config, report[] }. Never overwrites an existing key/token
// unless `overwrite` is set.
export function applyImport(cfg, connections, { overwrite = false } = {}) {
  const next = structuredClone(cfg);
  const report = [];
  const findUp = (pred) => (next.upstreams || []).find(pred);
  for (const c of connections) {
    if (!c.active) {
      report.push({ provider: c.provider, action: "skipped", why: "inactive in 9router" });
      continue;
    }
    if (c.provider === "anthropic" && c.authType === "apikey" && c.data.apiKey) {
      let u = findUp((x) => x.type === "anthropic");
      if (!u) {
        u = {
          id: "anthropic",
          name: "Anthropic",
          type: "anthropic",
          baseUrl: "https://api.anthropic.com",
          apiKey: "",
          authStyle: "x-api-key",
          enabled: true,
          discoverModels: true,
          models: [],
          rules: {},
        };
        next.upstreams.push(u);
        report.push({ provider: "anthropic", action: "upstream added", id: u.id });
      }
      if (u.apiKey && !overwrite)
        report.push({ provider: "anthropic", action: "kept existing key", id: u.id });
      else {
        u.apiKey = c.data.apiKey;
        report.push({ provider: "anthropic", action: "API key imported", id: u.id });
      }
      if (!(next.routes || []).some((r) => r.upstream === u.id)) {
        next.routes.push({
          match: "direct/claude-*",
          upstream: u.id,
          upstreamModel: "claude-{1}",
          format: "anthropic",
          fallbacks: [],
          discoverPrefixes: [],
          enabled: true,
          rules: {},
        });
        report.push({ provider: "anthropic", action: "route direct/claude-* added" });
      }
      continue;
    }
    if (c.provider === "qoder" && c.authType === "oauth" && c.data.accessToken) {
      let u = findUp((x) => x.type === "qoder");
      if (!u) {
        u = {
          id: "qoder-cloud",
          name: "Qoder cloud",
          type: "qoder",
          baseUrl: "",
          apiKey: "",
          authStyle: "auto",
          enabled: true,
          discoverModels: true,
          models: [],
          rules: {},
          qoder: {},
        };
        next.upstreams.push(u);
        report.push({ provider: "qoder", action: "upstream added", id: u.id });
      }
      if (u.qoder?.accessToken && !overwrite) {
        report.push({ provider: "qoder", action: "kept existing login", id: u.id });
      } else {
        const psd = c.data.providerSpecificData || {};
        u.qoder = {
          ...(u.qoder || {}),
          authMethod: "device",
          accessToken: c.data.accessToken,
          refreshToken: c.data.refreshToken || "",
          userId: psd.userId || "",
          machineId: psd.machineId || "",
          name: c.data.displayName || c.name || "",
          email: c.email || c.data.email || "",
          expiresAt: c.data.expiresAt ? Date.parse(c.data.expiresAt) || 0 : 0,
        };
        u.enabled = true;
        report.push({
          provider: "qoder",
          action: "login imported",
          id: u.id,
          email: u.qoder.email,
          expiresAt: u.qoder.expiresAt ? new Date(u.qoder.expiresAt).toISOString() : null,
        });
      }
      if (!(next.routes || []).some((r) => r.upstream === u.id)) {
        const star = next.routes.findIndex((r) => r.match === "*");
        next.routes.splice(star >= 0 ? star : next.routes.length, 0, {
          match: "qd/*",
          upstream: u.id,
          upstreamModel: "{1}",
          format: "auto",
          fallbacks: [],
          discoverPrefixes: [],
          enabled: true,
          rules: {},
        });
        report.push({ provider: "qoder", action: "route qd/* added" });
      }
      continue;
    }
    if (c.provider === "cursor") {
      report.push({
        provider: "cursor",
        action: "skipped",
        why: "Filament drives Cursor through its CLI (ACP) instead; see the Cursor upstream",
      });
      continue;
    }
    report.push({
      provider: c.provider,
      action: "skipped",
      why: `no Filament equivalent for ${c.provider} (${c.authType})`,
    });
  }
  return { config: next, report };
}
