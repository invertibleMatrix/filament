// Backups of the memory folder (docs/memory-architecture.md §2, §11): a consistent copy of archive.db and the
// Mnemosyne database through SQLite's online backup API (a plain file copy is wrong under WAL), plus memory.json,
// gzipped with SHA-256 checksums, into `<destination>/filament-memory-<timestamp>/`. Daily at the configured hour,
// rotation keeps the newest N. Restore stops the engine, replaces the two databases and restarts it.
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import * as sqlite from "node:sqlite";

/** A backup's folder name, before its time. */
const BACKUP_PREFIX = "filament-memory-";
const DAY_MS = 24 * 60 * 60 * 1000;

const stamp = (t) => new Date(t).toISOString().replace(/[:.]/g, "-").slice(0, 19);
// A file's SHA-256, read as a stream: a backup's databases may be large, and a whole read held each in memory and
// blocked the server while it read. The digest is the one a whole read gives.
const fileSha256 = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};
// The gzipped copy and its SHA-256, hashed as it is written: the digest of the file's bytes, a chunk at a time between
// the reads and writes. Read back whole and hashed in one go, a database of hundreds of MB would hold the event loop
// for most of a second, all of it in memory.
const gzip = async (src, dst) => {
  const hash = createHash("sha256");
  await pipeline(
    createReadStream(src),
    createGzip({ level: 6 }),
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(dst),
  );
  return { bytes: statSync(dst).size, sha256: hash.digest("hex") };
};
const gunzip = async (src, dst) => {
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dst));
};
/** A name and nothing more: no folder of its own, no way up out of the one it is in. @param {string} name */
const plainName = (name) => !!name && name === basename(name) && name !== "." && name !== "..";
/** A backup's bank database, `bank-<bank>.db.gz`. */
const BANK_FILE = /^bank-(.+)\.db\.gz$/;

// Consistent copy of a SQLite file that may be open elsewhere (WAL): open read-only, online backup to `dest`.
export async function consistentCopy(srcFile, dest) {
  const db = new sqlite.DatabaseSync(srcFile, { readOnly: true });
  try {
    if (typeof sqlite.backup === "function") await sqlite.backup(db, dest);
    else if (typeof db.backup === "function") await db.backup(dest);
    else {
      if (existsSync(dest)) rmSync(dest);
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    }
  } finally {
    db.close();
  }
  return statSync(dest).size;
}

export class BackupManager {
  // service: MemoryService (folder, archive, store); getConfig: () => memory config group
  constructor({ service, getConfig = () => ({}), log = () => {}, now = () => Date.now() } = {}) {
    Object.assign(this, { service, getConfig, log, now });
    this.timer = null;
    this.running = null;
    this.lastRunDay = null;
  }
  cfg() {
    const b = (this.getConfig() || {}).backups || {};
    return {
      enabled: b.enabled === true,
      folder: String(b.folder || "").trim(),
      hour: Number.isFinite(Number(b.hour)) ? Number(b.hour) : 3,
      keep: Math.max(1, Number(b.keep) || 14),
    };
  }
  start(intervalMs = 60_000) {
    this.stop();
    this.timer = setInterval(
      () => this.tick().catch((e) => this.log("warn", `memory backup tick failed: ${e.message}`)),
      intervalMs,
    );
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    const c = this.cfg();
    if (!c.enabled || !c.folder || !this.service?.folder) return;
    const d = new Date(this.now());
    const day = d.toISOString().slice(0, 10);
    if (d.getHours() !== c.hour || this.lastRunDay === day) return;
    // The newest backup written: a folder with no manifest is one a run never finished (Filament quit during it), no
    // backup, and it has no time.
    const last = this.list().find((b) => b.at);
    if (last && last.at.slice(0, 10) === day) {
      this.lastRunDay = day;
      return;
    }
    // The day is done once its backup is written: one that failed (its drive not there yet, a database busy) is tried
    // again at the next tick of the hour.
    await this.run({ reason: "scheduled" });
    this.lastRunDay = day;
  }

  // What the dashboard shows: destination, last backup, list.
  status() {
    const c = this.cfg();
    const list = this.list();
    return {
      enabled: c.enabled,
      folder: c.folder,
      hour: c.hour,
      keep: c.keep,
      destinationExists: !!c.folder && existsSync(c.folder),
      count: list.length,
      last: list[0] || null,
      running: !!this.running,
    };
  }
  list(folder = this.cfg().folder) {
    if (!folder || !existsSync(folder)) return [];
    const out = [];
    for (const name of readdirSync(folder)) {
      if (!name.startsWith(BACKUP_PREFIX)) continue;
      const dir = join(folder, name);
      try {
        const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        out.push({
          dir,
          name,
          at: m.at,
          bytes: m.bytes,
          files: Object.keys(m.files || {}),
          counts: m.counts || null,
        });
      } catch {
        out.push({ dir, name, at: null, bytes: 0, files: [], broken: true });
      }
    }
    return out.sort((a, b) => String(b.at || b.name).localeCompare(String(a.at || a.name)));
  }
  /**
   * Since when, in ms, a backup kept here may hold memory as it was — what a restore could bring back, a chat deleted
   * since among it (the footprint plan): the oldest backup on the list; where daily backups run, `keep` days back at the
   * latest, so a destination that does not read (its drive away) still counts as holding that many. null: none is kept
   * and none is taken.
   * @returns {number | null}
   */
  heldSince() {
    const c = this.cfg();
    const times = this.list().map((b) => Date.parse(String(b.at || ""))).filter(Number.isFinite);
    if (c.enabled && c.folder) times.push(this.now() - c.keep * DAY_MS);
    return times.length ? Math.min(...times) : null;
  }

  // One backup now. Returns the manifest.
  async run({ reason = "manual", folder = this.cfg().folder } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      const src = this.service?.folder;
      if (!src) throw new Error(`no archive: ${this.service.archiveWhy()}`);
      if (!folder) throw new Error("no backup destination: set memory.backups.folder");
      mkdirSync(folder, { recursive: true });
      const name = `${BACKUP_PREFIX}${stamp(this.now())}`;
      const dir = join(folder, name);
      // A run that fails takes the folder it made with it: one with no manifest stands on the list as a broken backup.
      const fresh = !existsSync(dir);
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, ".tmp");
      mkdirSync(tmp, { recursive: true });
      const files = {};
      let bytes = 0;
      let manifest;
      const add = async (label, plain) => {
        const gz = join(dir, `${label}.gz`);
        const written = await gzip(plain, gz);
        files[`${label}.gz`] = { bytes: written.bytes, sha256: written.sha256, plainBytes: statSync(plain).size };
        bytes += written.bytes;
      };
      try {
        const arch = join(src, "archive.db");
        if (existsSync(arch)) {
          const copy = join(tmp, "archive.db");
          if (this.service.archive?.backupTo) await this.service.archive.backupTo(copy);
          else await consistentCopy(arch, copy);
          await add("archive.db", copy);
        }
        const mn = join(src, "mnemosyne", "mnemosyne.db");
        if (existsSync(mn)) {
          const copy = join(tmp, "mnemosyne.db");
          await consistentCopy(mn, copy);
          await add("mnemosyne.db", copy);
        }
        const banks = join(src, "mnemosyne", "banks");
        if (existsSync(banks))
          for (const b of readdirSync(banks)) {
            const f = join(banks, b, "mnemosyne.db");
            if (existsSync(f)) {
              const copy = join(tmp, `bank-${b}.db`);
              await consistentCopy(f, copy);
              await add(`bank-${b}.db`, copy);
            }
          }
        const man = join(src, "memory.json");
        if (existsSync(man)) {
          copyFileSync(man, join(dir, "memory.json"));
          // The copy's bytes are hashed — the file's as it was copied, whatever writes it while the hash reads.
          files["memory.json"] = { bytes: statSync(man).size, sha256: await fileSha256(join(dir, "memory.json")) };
        }
        const cfgFile = join(src, "mnemosyne", "config.yaml");
        if (existsSync(cfgFile)) {
          copyFileSync(cfgFile, join(dir, "config.yaml"));
          files["config.yaml"] = { bytes: statSync(cfgFile).size, sha256: await fileSha256(join(dir, "config.yaml")) };
        }
        manifest = {
          version: 1,
          at: new Date(this.now()).toISOString(),
          reason,
          source: src,
          bytes,
          files,
          counts: this.service.archive?.counts?.() || null,
        };
        writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
      } catch (e) {
        if (fresh)
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {}
        throw e;
      } finally {
        try {
          rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
      this.rotate(folder);
      this.service.noteBackup?.(manifest);
      this.log("info", `memory: backup written to ${dir} (${Math.round(bytes / 1024)} KB, ${reason})`);
      return { ...manifest, dir, name };
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  rotate(folder = this.cfg().folder) {
    const keep = this.cfg().keep;
    const list = this.list(folder);
    for (const b of list.slice(keep)) {
      try {
        rmSync(b.dir, { recursive: true, force: true });
      } catch {}
    }
    return Math.max(0, list.length - keep);
  }

  // Verify a backup's checksums. Every file a manifest lists is one of the backup's own folder, as a backup writes them:
  // a name that is a path, or a bank named as one, would be read and restored outside the folders it belongs in.
  async verify(dir) {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const problems = [];
    for (const [f, info] of Object.entries(m.files || {})) {
      const bank = BANK_FILE.exec(f)?.[1];
      if (!plainName(f) || (bank != null && !plainName(bank))) {
        problems.push(`${f}: names a path, not a file of its own`);
        continue;
      }
      const p = join(dir, f);
      if (!existsSync(p)) {
        problems.push(`${f}: missing`);
        continue;
      }
      if (info.sha256 && (await fileSha256(p)) !== info.sha256) problems.push(`${f}: checksum differs`);
    }
    return { ok: !problems.length, problems, manifest: m };
  }

  // Replace the live databases with a backup's. The caller stops the engine and closes the archive around this, and
  // memory is replaced whole or not at all: every database is copied in beside the one it replaces first, then the live
  // ones are set aside with their -wal and -shm (SQLite would read a WAL left beside a copy into it), then the copies
  // take their places. A copy that fails (a damaged backup, a full disk), or a database something still holds, stops
  // the restore with memory as it was.
  async restoreFiles(dir, memoryFolder) {
    const v = await this.verify(dir);
    if (!v.ok) throw new Error(`backup failed verification: ${v.problems.join("; ")}`);
    mkdirSync(join(memoryFolder, "mnemosyne"), { recursive: true });
    /** @type {[string, string][]} each database of the backup, and the live one it replaces */
    const puts = [
      ["archive.db.gz", join(memoryFolder, "archive.db")],
      ["mnemosyne.db.gz", join(memoryFolder, "mnemosyne", "mnemosyne.db")],
    ];
    for (const f of Object.keys(v.manifest.files || {})) {
      const bank = BANK_FILE.exec(f)?.[1];
      if (bank) puts.push([f, join(memoryFolder, "mnemosyne", "banks", bank, "mnemosyne.db")]);
    }
    const todo = puts.filter(([gz]) => existsSync(join(dir, gz)));
    /** The live files set aside, and the copies in their places: undone if the restore stops. */
    const aside = [];
    const placed = [];
    try {
      for (const [gz, dest] of todo) {
        mkdirSync(dirname(dest), { recursive: true });
        await gunzip(join(dir, gz), `${dest}.restoring`);
      }
      for (const [, dest] of todo)
        for (const f of [dest, `${dest}-wal`, `${dest}-shm`])
          if (existsSync(f)) {
            renameSync(f, `${f}.replaced`);
            aside.push(f);
          }
      for (const [, dest] of todo) {
        renameSync(`${dest}.restoring`, dest);
        placed.push(dest);
      }
    } catch (e) {
      for (const f of placed)
        try {
          rmSync(f, { force: true });
        } catch {}
      for (const f of aside)
        try {
          renameSync(`${f}.replaced`, f);
        } catch {}
      for (const [, dest] of todo)
        try {
          rmSync(`${dest}.restoring`, { force: true });
        } catch {}
      throw e;
    }
    for (const f of aside)
      try {
        rmSync(`${f}.replaced`, { force: true });
      } catch {}
    const restored = todo.map(([, dest]) => basename(dest));
    if (existsSync(join(dir, "memory.json"))) {
      try {
        const cur = JSON.parse(readFileSync(join(memoryFolder, "memory.json"), "utf8"));
        const old = JSON.parse(readFileSync(join(dir, "memory.json"), "utf8"));
        writeFileSync(
          join(memoryFolder, "memory.json"),
          JSON.stringify(
            { ...old, ...cur, restoredFrom: dir, restoredAt: new Date(this.now()).toISOString() },
            null,
            2,
          ),
        );
      } catch {}
    }
    return { restored, from: dir };
  }
}
