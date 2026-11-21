// @ts-check
// An app's hooks, kept (the Space Apps plan of 10-29, phase 4): each hook's token — the random part of its address,
// `/hook/<app>/<token>` — by the app's name and the hook's, in `<dataDir>/app-hooks.json`. A token is made when a Keep
// first grants its hook and stays across later Keeps, so an address the person copied into a script keeps working;
// New address makes another, and the old one stops. A hook no Keep grants any longer is forgotten, and so is every one
// of a deleted app. What a token lets in is a POST from this computer alone (http/hooks.js).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const APP_HOOKS_FILE = "app-hooks.json";

/**
 * @typedef {{ token: string, at: number }} Hook  a hook's token and when it was made
 * @typedef {ReturnType<typeof createAppHooks>} AppHooks
 */

/** A new token: 128 random bits, in hex. */
const newToken = () => randomBytes(16).toString("hex");
/** Whether a token given is this one, in the same time whatever it is. @param {string} kept @param {unknown} given */
const same = (kept, given) => {
  const a = Buffer.from(kept);
  const b = Buffer.from(String(given ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * @param {{ dataDir: string | null, now?: () => number, log?: (level: string, msg: string) => void }} o
 *   `dataDir`: where the file is (none: kept in memory alone, for the tests)
 */
export function createAppHooks({ dataDir, now = Date.now, log = () => {} }) {
  const file = dataDir ? join(dataDir, APP_HOOKS_FILE) : null;
  /** Each app's hooks, by its name, then the hook's. @type {Map<string, Map<string, Hook>>} */
  const apps = new Map();

  if (file)
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      for (const [app, hooks] of Object.entries(raw?.apps || {})) {
        /** @type {Map<string, Hook>} */
        const m = new Map();
        for (const [name, rec] of Object.entries(/** @type {Record<string, any>} */ (hooks || {})))
          if (typeof rec?.token === "string" && /^[0-9a-f]{32}$/.test(rec.token)) m.set(name, { token: rec.token, at: Number(rec.at) || 0 });
        if (m.size) apps.set(app, m);
      }
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `app hooks: ${APP_HOOKS_FILE} could not be read (${e?.message || e}); every app's hooks get new addresses at their next Keep`);
    }

  /** Every app's hooks written; a write the disk refuses throws, and changes nothing. */
  const save = () => {
    if (!file || !dataDir) return;
    mkdirSync(dataDir, { recursive: true });
    const body = { version: 1, apps: Object.fromEntries([...apps].map(([app, m]) => [app, Object.fromEntries(m)])) };
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  };
  /** An app's hooks replaced, then written; the disk refusing it puts them back. @param {string} app @param {Map<string, Hook> | null} next */
  const put = (app, next) => {
    const before = apps.get(app);
    if (next && next.size) apps.set(app, next);
    else apps.delete(app);
    try {
      save();
    } catch (e) {
      if (before) apps.set(app, before);
      else apps.delete(app);
      throw e;
    }
  };

  /** An app's hooks, each with its token and when it was made. @param {string} app @returns {Record<string, Hook>} */
  const list = (app) => Object.fromEntries(apps.get(app) || []);

  return {
    list,
    /**
     * The hooks a Keep grants, each with a token — one it had kept, else a new one —; those it no longer grants forgotten.
     * @param {string} app @param {string[]} names
     */
    ensure(app, names) {
      const had = apps.get(app) || new Map();
      const next = new Map(names.map((n) => [n, had.get(n) || { token: newToken(), at: now() }]));
      if (next.size !== had.size || [...next].some(([n, h]) => had.get(n) !== h)) put(app, next);
      return list(app);
    },
    /** A hook's new token, the old one let go; null where the app has no such hook. @param {string} app @param {string} hook */
    renew(app, hook) {
      const had = apps.get(app);
      if (!had?.has(hook)) return null;
      const h = { token: newToken(), at: now() };
      put(app, new Map([...had, [hook, h]]));
      return h;
    },
    /** The hook a token opens, or null: every one of the app's compared, in the same time. @param {string} app @param {string} token */
    find(app, token) {
      let found = null;
      for (const [name, h] of apps.get(app) || []) if (same(h.token, token)) found = name;
      return found;
    },
    /** Every hook of an app forgotten: the app deleted. @param {string} app */
    drop(app) {
      if (apps.has(app)) put(app, null);
    },
  };
}
