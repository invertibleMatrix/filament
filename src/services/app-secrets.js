// @ts-check
// An app's secrets, kept (the Space Apps plan of 10-29): each value the person typed in Filament's sheet, by the app's
// name and the secret's, in `<dataDir>/app-secrets.json` — sealed with the installation's secret.key as connector
// tokens are, unless `server.encryptSecrets` is off. Nothing here hands a value to a page or an agent: the runner takes
// them for an app's commands' environment (services/dashboard-runner.js), a script watcher's source for the program
// its person switched on (app/watchers/script.js), and the sheet learns only which are set.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSealed, loadKey, open, seal } from "./config/secrets.js";
import { secretValue } from "../core/app-secrets.js";

export const APP_SECRETS_FILE = "app-secrets.json";

/**
 * @typedef {{ value: string, at: number }} Kept  a value as the store holds it in memory, open, and when it was typed
 * @typedef {ReturnType<typeof createAppSecrets>} AppSecrets
 */

/**
 * @param {{ dataDir: string | null, encrypt?: () => boolean, now?: () => number, log?: (level: string, msg: string) => void }} o
 *   `dataDir`: where the file is (none: kept in memory alone, for the tests); `encrypt`: whether values are sealed on disk
 *   now (`server.encryptSecrets`)
 */
export function createAppSecrets({ dataDir, encrypt = () => true, now = Date.now, log = () => {} }) {
  const file = dataDir ? join(dataDir, APP_SECRETS_FILE) : null;
  /** Each app's values, by its name, then the secret's. @type {Map<string, Map<string, Kept>>} */
  const apps = new Map();

  if (file)
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const key = loadKey(/** @type {string} */ (dataDir), { create: false });
      /** @type {string[]} */
      const lost = [];
      for (const [app, secrets] of Object.entries(raw?.apps || {})) {
        /** @type {Map<string, Kept>} */
        const m = new Map();
        for (const [name, rec] of Object.entries(/** @type {Record<string, any>} */ (secrets || {}))) {
          if (typeof rec?.value !== "string") continue;
          try {
            if (isSealed(rec.value) && !key) throw new Error("no secret.key");
            m.set(name, { value: isSealed(rec.value) ? open(rec.value, /** @type {Buffer} */ (key)) : rec.value, at: Number(rec.at) || 0 });
          } catch {
            lost.push(`${app} ${name}`);
          }
        }
        if (m.size) apps.set(app, m);
      }
      if (lost.length) log("warn", `app secrets: ${lost.length} could not be opened (sealed with another secret.key?) and must be typed again: ${lost.join(", ")}`);
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `app secrets: ${APP_SECRETS_FILE} could not be read (${e?.message || e}); every app's secrets must be typed again`);
    }

  /** Write every app's values, sealed where secrets are sealed; a write the disk refuses throws, and changes nothing. */
  const save = () => {
    if (!file || !dataDir) return;
    mkdirSync(dataDir, { recursive: true });
    const key = encrypt() ? loadKey(dataDir) : null;
    const body = {
      version: 1,
      apps: Object.fromEntries([...apps].map(([app, m]) => [app, Object.fromEntries([...m].map(([name, k]) => [name, { value: key ? seal(k.value, key) : k.value, at: k.at }]))])),
    };
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  };
  /** A change made, then written; the disk refusing it puts it back. @param {() => () => void} change  returns its undo */
  const changed = (change) => {
    const undo = change();
    try {
      save();
    } catch (e) {
      undo();
      throw e;
    }
  };

  return {
    /** Which of an app's secrets are set, and when each was typed — never a value. @param {string} app @returns {Record<string, { at: number }>} */
    list(app) {
      return Object.fromEntries([...(apps.get(app) || [])].map(([name, k]) => [name, { at: k.at }]));
    },
    /**
     * A value typed in the sheet, kept in place of the one before. @param {string} app @param {string} name @param {unknown} value
     * @returns {{ ok: true, at: number } | { ok: false, error: string }}
     */
    set(app, name, value) {
      const v = secretValue(value);
      if (!v.ok) return v;
      const at = now();
      changed(() => {
        const had = apps.get(app);
        const before = had?.get(name);
        const m = had || new Map();
        m.set(name, { value: v.value, at });
        apps.set(app, m);
        return () => {
          if (before) m.set(name, before);
          else m.delete(name);
          if (!m.size) apps.delete(app);
        };
      });
      return { ok: true, at };
    },
    /** A value forgotten; whether there was one. @param {string} app @param {string} name */
    clear(app, name) {
      const m = apps.get(app);
      const before = m?.get(name);
      if (!m || !before) return false;
      changed(() => {
        m.delete(name);
        if (!m.size) apps.delete(app);
        return () => {
          m.set(name, before);
          apps.set(app, m);
        };
      });
      return true;
    },
    /** Every value of an app forgotten: the app deleted. @param {string} app */
    drop(app) {
      const m = apps.get(app);
      if (!m) return;
      changed(() => {
        apps.delete(app);
        return () => void apps.set(app, m);
      });
    },
    /**
     * An app's values, for its commands' environment and for hiding them in what those say: the runner's, and a
     * script watcher's source's for its program.
     * @param {string} app @returns {Record<string, string>}
     */
    values(app) {
      return Object.fromEntries([...(apps.get(app) || [])].map(([name, k]) => [name, k.value]));
    },
  };
}
