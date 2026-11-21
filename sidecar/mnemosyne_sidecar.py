#!/usr/bin/env python3
"""Filament memory sidecar: Mnemosyne behind newline-delimited JSON on stdin/stdout.

Filament spawns this file with the Python of its managed engine (see src/memory-engine.js). One request per line on
stdin, one response per line on stdout, logs on stderr as "level<TAB>message". Quick operations run on the main
thread, in order; long ones (import, backup, reindex, hygiene clean, export, diagnose) run one at a time on a worker
thread with their own Mnemosyne instance (SQLite connections are thread-local in Mnemosyne), so a long job never
blocks recall. Stdin is read on a thread of its own, which answers a `ping` at once, whatever the other two are
working on: Filament pings an engine it waits on, and takes one that answers nothing, not even a ping, as stalled.

Protocol (docs/memory-architecture.md §4):
  -> {"id": 7, "op": "recall", "args": {"query": "tray restart", "top_k": 8}}
  <- {"id": 7, "ok": true, "result": [...], "ms": 6}
  <- {"id": 7, "ok": false, "error": "...", "kind": "mnemosyne|args|internal"}
"""
import json
import logging
import os
import queue
import sqlite3
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

PROTOCOL = 1
# Filament owns what is true (HarnessV3-Memory MD-0): what the engine wrote by itself (sleep summaries, model-refresh
# guesses) is marked superseded with this mark, so recall skips it. Nothing is deleted; Filament records the ids.
FENCE_MARK = "filament:engine-written"
ENGINE_WRITTEN = "substr(source, 1, 6) = 'sleep_'"
# The embedding model is most of the engine's RAM (the multilingual one about 530 MB), and a batch of vectors leaves
# ONNX Runtime holding what its biggest step asked for (about 440 MB more) until the process ends: the model is let go
# after the vectors are made again, and once no embed has asked for it this many seconds (0: never). The next embed
# loads it again, in under a second.
EMBEDDING_IDLE_S = float(os.environ.get("FILAMENT_EMBEDDING_IDLE_S") or 600)
_model_used = [0.0]
_out_lock = threading.Lock()


def emit(obj):
    line = json.dumps(obj, ensure_ascii=False, default=str)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


class StderrFormatter(logging.Formatter):
    def format(self, record):
        return f"{record.levelname.lower()}\t{record.name}: {record.getMessage()}"


def setup_logging():
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(StderrFormatter())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(logging.WARNING)
    logging.getLogger("mnemosyne").setLevel(logging.WARNING)


def log(level, msg):
    with _out_lock:
        sys.stderr.write(f"{level}\t{msg}\n")
        sys.stderr.flush()


def _embeddings():
    try:
        from mnemosyne.core import embeddings
        return embeddings
    except Exception:
        return None


def watch_model():
    """Each embed asks Mnemosyne's `_get_model` for the model: wrapped, it stamps when the model was last used, so the
    idle clock counts embeds alone, not the status reads between them."""
    emb = _embeddings()
    get = getattr(emb, "_get_model", None)
    _model_used[0] = time.time()  # a model the engine's start loaded counts as used then
    if get is None or getattr(get, "filament_watched", False):
        return
    def watched():
        _model_used[0] = time.time()
        return get()
    watched.filament_watched = True
    emb._get_model = watched


def model_loaded():
    return getattr(_embeddings(), "_embedding_model", None) is not None


def let_model_go(why):
    """Drops the embedding model and what ONNX Runtime holds for it; the next embed loads it again. A call embedding on
    the other thread keeps its own hold until it ends. → whether one was loaded."""
    emb = _embeddings()
    if getattr(emb, "_embedding_model", None) is None:
        return False
    emb._embedding_model = None
    import gc
    gc.collect()
    log("info", f"embedding model let go: {why}")
    return True


def idle_wait():
    """How long the main thread waits for a request before it looks whether the model went unused long enough."""
    if EMBEDDING_IDLE_S <= 0:
        return None
    if not model_loaded():
        return EMBEDDING_IDLE_S
    return max(0.05, EMBEDDING_IDLE_S - (time.time() - _model_used[0]))


# ---------------------------------------------------------------------------------------------------
# Engine wrapper
# ---------------------------------------------------------------------------------------------------
class Engine:
    def __init__(self):
        from mnemosyne import Mnemosyne  # heavy import: creates the database on first construction
        self.Mnemosyne = Mnemosyne
        self.session_id = os.environ.get("FILAMENT_MEMORY_SESSION", "filament")
        bank = os.environ.get("MNEMOSYNE_BANK", "") or None
        if bank == "default":
            bank = None
        self.bank = bank
        self.m = self._instance()
        self.db_path = str(self.m.db_path)
        self._canonical = None
        import inspect
        try:
            self._remember_params = set(inspect.signature(self.m.remember).parameters)
        except Exception:
            self._remember_params = None  # unknown: pass everything and let Mnemosyne complain

    def _instance(self):
        return self.Mnemosyne(session_id=self.session_id, bank=self.bank)

    @property
    def canonical(self):
        if self._canonical is None:
            from mnemosyne.core.canonical import CanonicalStore
            conn = getattr(self.m, "conn", None) or getattr(self.m.beam, "conn", None)
            self._canonical = CanonicalStore(db_path=self.db_path, conn=conn)
        return self._canonical

    # ---- quick ops ----
    def op_hello(self, a):
        from mnemosyne.core import embeddings
        try:
            import mnemosyne as pkg
            version = getattr(pkg, "__version__", "?")
        except Exception:
            version = "?"
        conn = getattr(self.m, "conn", None) or getattr(self.m.beam, "conn", None)
        vec = None
        if conn is not None:
            try:
                conn.execute("SELECT vec_version()").fetchone(); vec = True
            except Exception:
                vec = bool(getattr(conn, "_mnemosyne_vec_loaded", False))
        try:
            emb = bool(embeddings.available())
        except Exception:
            emb = False
        return {
            "protocol": PROTOCOL,
            "version": version,
            "python": sys.version.split()[0],
            "sqlite": sqlite3.sqlite_version,
            "embeddings": emb,
            # The model the engine embeds with, as it reads it: Filament makes the store's vectors again when it changes.
            "embeddingModel": getattr(embeddings, "_DEFAULT_MODEL", None) or os.environ.get("MNEMOSYNE_EMBEDDING_MODEL", ""),
            "vec": vec,
            "dbPath": self.db_path,
            "bank": self.bank or "default",
            "sessionId": self.session_id,
            "counts": self._counts(),
        }

    def _counts(self):
        out = {}
        try:
            st = self.m.get_stats() or {}
            beam = st.get("beam") or {}
            out = {
                "working": (beam.get("working_memory") or {}).get("total", st.get("working_total")),
                "episodic": (beam.get("episodic_memory") or {}).get("total"),
                "triples": (beam.get("triples") or {}).get("total"),
                "legacy": st.get("total_memories"),
                "lastMemory": st.get("last_memory"),
            }
        except Exception as e:  # stats must never break hello
            out["error"] = str(e)[:200]
        try:
            conn = getattr(self.m, "conn", None) or self.m.beam.conn
            out["canonical"] = conn.execute("SELECT count(*) FROM canonical_facts WHERE valid_until IS NULL").fetchone()[0]
        except Exception:
            pass
        return out

    def op_dense(self, a):
        """The working memories nearest a text by meaning alone (Filament's memory plan, c2): recall keeps a row only
        where it shares words with the query, so a memory in another language, or worded otherwise, never comes. Each
        hit hydrated, its cosine similarity as its score, those under `min_sim` left out; none without embeddings, or,
        `strict` (the curator's lookups, the memory plan's f6), an error: a lookup that searched nothing is not "nothing near"."""
        text = str(a.get("text") or "").strip()
        if not text:
            raise ArgsError("text is required")
        from mnemosyne.core import embeddings
        from mnemosyne.core import beam
        if not embeddings.available():
            if a.get("strict"):
                raise RuntimeError("no embeddings: nothing can be looked up by meaning")
            return []
        q = embeddings.embed_query(text)
        if q is None:
            if a.get("strict"):
                raise RuntimeError("the text could not be embedded")
            return []
        import numpy as np
        conn = getattr(self.m, "conn", None) or getattr(self.m.beam, "conn", None)
        floor = float(a.get("min_sim") or 0.0)
        model = getattr(embeddings, "_DEFAULT_MODEL", None)
        qn = np.asarray(q, dtype=np.float32)
        qn = qn / (float(np.linalg.norm(qn)) or 1.0)
        out = []
        # The vector table finds the nearest; its own figure is no cosine (int8 or binary vectors squeeze every row into a
        # narrow band, an unrelated one too), so each hit's similarity is the cosine of its float vector, the active
        # model's (memory_embeddings), else of its text embedded now.
        for hit in beam._wm_vec_search(conn, q, k=int(a.get("top_k") or 8)):
            row = self.m.get(hit["id"])
            if not row or not row.get("content"):
                continue
            vec = None
            try:
                got = conn.execute("SELECT embedding_json, model FROM memory_embeddings WHERE memory_id = ?", (hit["id"],)).fetchone()
                if got and got[0] and (not got[1] or got[1] == model):
                    vec = np.asarray(json.loads(got[0]), dtype=np.float32)
            except Exception:
                vec = None
            if vec is None or vec.shape != qn.shape:
                made = embeddings.embed([row["content"]])
                if made is None:
                    continue
                vec = np.asarray(made[0], dtype=np.float32)
            sim = float(np.dot(qn, vec / (float(np.linalg.norm(vec)) or 1.0)))
            if sim < floor:
                continue
            item = dict(row)
            item["id"] = hit["id"]
            item["score"] = sim
            item["dense"] = True
            out.append(item)
        out.sort(key=lambda x: -x["score"])
        return out

    def op_recall(self, a):
        query = str(a.get("query") or "").strip()
        if not query:
            raise ArgsError("query is required")
        kw = {"temporal_weight": float(a.get("temporal_weight") or 0.0)}
        for k in ("source", "from_date", "to_date", "author_id", "author_type", "channel_id"):
            if a.get(k):
                kw[k] = a[k]
        rows = self.m.recall(query, top_k=int(a.get("top_k") or 8), **kw) or []
        if isinstance(rows, dict):  # explain shape
            rows = rows.get("results") or []
        hydrate = a.get("hydrate", True)
        out = []
        for r in rows:
            item = dict(r)
            if hydrate and item.get("id") and len(item.get("content") or "") >= 500:
                try:
                    full = self.m.get(item["id"])
                    if full and full.get("content"):
                        item["content"] = full["content"]
                        if full.get("metadata") is not None and "metadata" not in item:
                            item["metadata"] = full.get("metadata")
                except Exception:
                    pass
            md = item.get("metadata")
            if isinstance(md, str):
                try:
                    item["metadata"] = json.loads(md)
                except Exception:
                    pass
            if item.get("metadata") is None and item.get("metadata_json"):
                try:
                    item["metadata"] = json.loads(item.pop("metadata_json"))
                except Exception:
                    pass
            out.append(item)
        return out

    def op_remember(self, a):
        content = str(a.get("content") or "").strip()
        if not content:
            raise ArgsError("content is required")
        kw = {
            "source": a.get("source") or "filament",
            "importance": float(a.get("importance") if a.get("importance") is not None else 0.6),
            "scope": a.get("scope") or "global",
            "veracity": a.get("veracity") or "stated",
        }
        if a.get("metadata") is not None:
            kw["metadata"] = a["metadata"]
        if a.get("memory_type"):
            kw["memory_type"] = a["memory_type"]
        if a.get("valid_until"):
            kw["valid_until"] = a["valid_until"]
        if a.get("dedupe") is False:
            kw["dedupe"] = False
        if a.get("extract_entities") is not None:
            kw["extract_entities"] = bool(a["extract_entities"])
        if self._remember_params is not None:  # 3.15.x has no memory_type/trust_tier on the facade; 4.x does
            kw = {k: v for k, v in kw.items() if k in self._remember_params}
        mid = self.m.remember(content, **kw)
        if not mid:
            return {"id": None, "filtered": True}
        if a.get("pin"):
            self._set_pinned(mid, True)
        if a.get("valid"):
            # Mnemosyne dedupes on exact content whether or not the row is still valid, and its dedup-update keeps
            # valid_until: Filament's copy of a claim that stands must be served, so the row it landed on is made valid.
            conn = self._conn()
            with conn:
                n = conn.execute(
                    "UPDATE working_memory SET valid_until = NULL, superseded_by = NULL WHERE id = ? AND (valid_until IS NOT NULL OR superseded_by IS NOT NULL)",
                    (mid,),
                ).rowcount
            if n:
                self._changed()
                return {"id": mid, "revived": True}
        return {"id": mid}

    def _set_pinned(self, mid, on):
        conn = self._conn()
        with conn:
            conn.execute("UPDATE working_memory SET pinned = ? WHERE id = ?", (1 if on else 0, mid))

    def op_get(self, a):
        row = self.m.get(str(a.get("id") or ""))
        if row and isinstance(row.get("metadata_json"), str):
            try:
                row["metadata"] = json.loads(row.pop("metadata_json"))
            except Exception:
                pass
        return row

    def op_update(self, a):
        mid = str(a.get("id") or "")
        if not mid:
            raise ArgsError("id is required")
        ok = self.m.update(mid, content=a.get("content"), importance=a.get("importance"))
        return {"ok": bool(ok)}

    def op_forget(self, a):
        mid = str(a.get("id") or "")
        if not mid:
            raise ArgsError("id is required")
        return {"ok": bool(self.m.forget(mid))}

    def op_pin(self, a):
        mid = str(a.get("id") or "")
        if not mid:
            raise ArgsError("id is required")
        self._set_pinned(mid, bool(a.get("on", True)))
        return {"ok": True}

    def op_canonical_list(self, a):
        owner = a.get("owner") or "user"
        if owner == "*":  # every owner (an imported database may use another owner id than Filament does)
            conn = getattr(self.m, "conn", None) or self.m.beam.conn
            sql = "SELECT id, owner_id, category, name, body, source, confidence, version, valid_from, created_at FROM canonical_facts WHERE valid_until IS NULL"
            params = []
            if a.get("category"):
                sql += " AND category = ?"; params.append(a["category"])
            rows = conn.execute(sql + " ORDER BY category, name", params).fetchall()
            keys = ["id", "owner_id", "category", "name", "body", "source", "confidence", "version", "valid_from", "created_at"]
            return [dict(zip(keys, r)) for r in rows]
        return self.canonical.list(owner, category=a.get("category"))

    def op_canonical_set(self, a):
        for k in ("category", "name", "body"):
            if not a.get(k):
                raise ArgsError(f"{k} is required")
        return self.canonical.remember(a.get("owner") or "user", a["category"], a["name"], str(a["body"]),
                                       source=a.get("source") or "filament", confidence=float(a.get("confidence") or 1.0))

    def op_canonical_forget(self, a):
        for k in ("category", "name"):
            if not a.get(k):
                raise ArgsError(f"{k} is required")
        return {"ok": bool(self.canonical.forget(a.get("owner") or "user", a["category"], a["name"]))}

    def op_stats(self, a):
        return self.m.get_stats()

    def op_hygiene_audit(self, a):
        from mnemosyne.core.hygiene import audit_noise
        conn = getattr(self.m, "conn", None) or self.m.beam.conn
        rep = audit_noise(Path(self.db_path), limit=int(a.get("limit") or 200), min_score=float(a.get("min_score") or 0.3), conn=conn)
        return rep.to_dict() if hasattr(rep, "to_dict") else rep

    def op_tool(self, a):
        from mnemosyne.mcp_tools import handle_tool_call
        name = str(a.get("name") or "")
        if not name:
            raise ArgsError("name is required")
        return handle_tool_call(name, a.get("arguments") or {})

    # ---- truth: invalidate instead of delete, and fence off what the engine wrote by itself ----
    # Every write of the sidecar's own ends its transaction (`with conn:`), whatever it changed: Python's sqlite3 opens
    # one for an UPDATE that matches nothing, and one left open holds SQLite's write lock, so every write on the
    # engine's other connection waited out its busy timeout and failed, "database is locked" (the bug report's X2).
    def _conn(self):
        return getattr(self.m, "conn", None) or self.m.beam.conn

    def _changed(self):
        clear = getattr(self.m.beam, "_invalidate_query_cache", None)
        if clear:
            clear()

    def op_invalidate(self, a):
        mid = str(a.get("id") or "")
        if not mid:
            raise ArgsError("id is required")
        return {"ok": bool(self.m.invalidate(mid, replacement_id=a.get("replacement_id") or None))}

    def op_restore(self, a):
        """Undo an invalidation: the row is valid again (Filament keeps the history of why)."""
        mid = str(a.get("id") or "")
        if not mid:
            raise ArgsError("id is required")
        conn = self._conn()
        n = 0
        with conn:
            for t in ("working_memory", "episodic_memory"):
                n += conn.execute(f"UPDATE {t} SET valid_until = NULL, superseded_by = NULL WHERE id = ?", (mid,)).rowcount
        self._changed()
        return {"ok": n > 0}

    def op_fence(self, a):
        """Mark every row the engine wrote by itself, and not yet fenced, as superseded. Idempotent. Returns the ids,
        which Filament records: undoing a fence is clearing these two columns on exactly these rows."""
        conn = self._conn()
        now = datetime.now().isoformat()
        out = {}
        with conn:
            for key, t in (("working", "working_memory"), ("episodic", "episodic_memory")):
                ids = [r[0] for r in conn.execute(f"SELECT id FROM {t} WHERE {ENGINE_WRITTEN} AND superseded_by IS NULL").fetchall()]
                for i in ids:
                    conn.execute(f"UPDATE {t} SET valid_until = ?, superseded_by = ? WHERE id = ?", (now, FENCE_MARK, i))
                out[key] = ids
            ids = [r[0] for r in conn.execute(f"SELECT id FROM canonical_facts WHERE {ENGINE_WRITTEN} AND valid_until IS NULL").fetchall()]
            for i in ids:
                conn.execute("UPDATE canonical_facts SET valid_until = ? WHERE id = ?", (now, i))
            out["canonical"] = ids
        self._changed()
        return out

    def op_rows(self, a):
        """A page of the rows recall can serve (valid, not superseded), oldest first, for Filament's adoption pass: every
        one of them gets a claim. `next` is the cursor for the following page, or None after the last."""
        table = {"working": "working_memory", "episodic": "episodic_memory"}.get(a.get("table") or "working")
        if not table:
            raise ArgsError("table is working or episodic")
        after = int(a.get("after") or 0)
        limit = max(1, min(int(a.get("limit") or 500), 2000))
        got = self._conn().execute(
            f"SELECT rowid, id, content, source, importance, memory_type, veracity, timestamp, metadata_json FROM {table} "
            "WHERE rowid > ? AND superseded_by IS NULL AND (valid_until IS NULL OR valid_until > ?) ORDER BY rowid LIMIT ?",
            (after, datetime.now().isoformat(), limit),
        ).fetchall()
        rows = []
        for r in got:
            try:
                md = json.loads(r[8]) if r[8] else None
            except Exception:
                md = None
            rows.append({"id": r[1], "content": r[2], "source": r[3], "importance": r[4], "memory_type": r[5],
                         "veracity": r[6], "timestamp": r[7], "metadata": md})
        return {"rows": rows, "next": got[-1][0] if len(got) == limit else None}

    def settle(self, m, op, ok):
        """A request ends with no transaction open on the instance's connections (the bug report's X2): one left open
        holds SQLite's write lock, and every write on the other connection waits out its busy timeout and fails. One
        left open is a fault in the engine: logged, and ended as `with conn:` ends one, kept when the request
        succeeded and undone when it failed."""
        conns = {id(c): c for c in (getattr(m, "conn", None), getattr(getattr(m, "beam", None), "conn", None)) if c is not None}
        for conn in conns.values():
            if not conn.in_transaction:
                continue
            log("warn", f"{op} left a transaction open on the engine's connection; it was {'committed' if ok else 'rolled back'}")
            try:
                conn.commit() if ok else conn.rollback()
            except Exception as e:
                log("warn", f"ending what {op} left open failed: {e.__class__.__name__}: {e}")

    # ---- long ops: each gets a fresh instance on the worker thread ----
    def long_export(self, m, a):
        path = a.get("path")
        if not path:
            raise ArgsError("path is required")
        return m.export_to_file(path, include_sync_events=bool(a.get("include_sync_events")))

    def long_import(self, m, a):
        path = a.get("path")
        if not path:
            raise ArgsError("path is required")
        return m.import_from_file(path, force=bool(a.get("force")), dry_run=bool(a.get("dry_run")))

    def long_backup(self, m, a):
        from mnemosyne.dr.recovery import create_backup
        d = a.get("dir")
        if not d:
            raise ArgsError("dir is required")
        return create_backup(Path(m.db_path), Path(d))

    def long_reindex(self, m, a):
        try:
            return m.reindex_vectors(batch_size=int(a.get("batch_size") or 64), dry_run=bool(a.get("dry_run")))
        finally:
            if not a.get("dry_run"):
                let_model_go("the vectors were made again")

    def long_diagnose(self, m, a):
        from mnemosyne.mcp_tools import handle_tool_call
        return handle_tool_call("mnemosyne_diagnose", {})

    def long_hygiene_clean(self, m, a):
        from mnemosyne.core.hygiene import audit_noise, clean_noise
        conn = getattr(m, "conn", None) or m.beam.conn
        rep = audit_noise(Path(m.db_path), limit=int(a.get("limit") or 200), min_score=float(a.get("min_score") or 0.3), conn=conn)
        cands = list(getattr(rep, "candidates", []) or [])
        ids = set(a.get("ids") or [])
        if ids:
            cands = [c for c in cands if str(getattr(c, "memory_id", getattr(c, "id", ""))) in ids]
        res = clean_noise(Path(m.db_path), cands, action=a.get("action") or "", confirm=True, dry_run=bool(a.get("dry_run", False)))
        return res.to_dict() if hasattr(res, "to_dict") else res


class ArgsError(Exception):
    pass


QUICK = {
    "hello": "op_hello", "recall": "op_recall", "dense": "op_dense", "remember": "op_remember", "get": "op_get", "update": "op_update",
    "forget": "op_forget", "pin": "op_pin", "canonical_list": "op_canonical_list", "canonical_set": "op_canonical_set",
    "canonical_forget": "op_canonical_forget", "stats": "op_stats", "hygiene_audit": "op_hygiene_audit", "tool": "op_tool",
    "invalidate": "op_invalidate", "restore": "op_restore", "fence": "op_fence", "rows": "op_rows",
}
LONG = {
    "export": "long_export", "import": "long_import", "backup": "long_backup",
    "reindex": "long_reindex", "diagnose": "long_diagnose", "hygiene_clean": "long_hygiene_clean",
}


class Worker:
    """One background thread; long operations queue behind each other and never block the main loop."""

    def __init__(self, engine):
        self.engine = engine
        self.jobs = []
        self.cv = threading.Condition()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def submit(self, rid, op, args):
        with self.cv:
            self.jobs.append((rid, op, args))
            self.cv.notify()

    def _run(self):
        inst = None
        while True:
            with self.cv:
                while not self.jobs:
                    self.cv.wait()
                rid, op, args = self.jobs.pop(0)
            t0 = time.time()
            ok = False
            try:
                if inst is None:
                    inst = self.engine._instance()
                result = getattr(self.engine, LONG[op])(inst, args)
                ok = True
                emit({"id": rid, "ok": True, "result": result, "ms": int((time.time() - t0) * 1000)})
            except ArgsError as e:
                emit({"id": rid, "ok": False, "error": str(e), "kind": "args"})
            except Exception as e:
                log("warn", f"{op} failed: {e.__class__.__name__}: {e}")
                emit({"id": rid, "ok": False, "error": f"{e.__class__.__name__}: {e}"[:600], "kind": "mnemosyne"})
            finally:
                if inst is not None:
                    self.engine.settle(inst, op, ok)


def read_requests(inbox):
    """Stdin, read on a thread of its own from the start, the engine's own start included: a ping is answered at once,
    so Filament can tell an engine at work on a long call from one that answers nothing; every other request goes to
    the main thread, in order. The end of stdin is said with None."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            req = None
        if not isinstance(req, dict):
            emit({"id": None, "ok": False, "error": "not JSON", "kind": "args"})
            continue
        if req.get("op") == "ping":
            emit({"id": req.get("id"), "ok": True, "result": {}})
            continue
        inbox.put(req)
    inbox.put(None)


def main():
    setup_logging()
    t0 = time.time()
    inbox = queue.Queue()
    threading.Thread(target=read_requests, args=(inbox,), daemon=True).start()
    try:
        engine = Engine()
    except Exception as e:
        emit({"id": None, "ok": False, "error": f"engine failed to start: {e.__class__.__name__}: {e}"[:600], "kind": "internal",
              "trace": traceback.format_exc()[-1500:]})
        sys.exit(3)
    watch_model()
    worker = Worker(engine)
    log("info", f"sidecar ready in {int((time.time() - t0) * 1000)} ms, db {engine.db_path}")
    while True:
        try:
            req = inbox.get(timeout=idle_wait())
        except queue.Empty:
            if model_loaded() and time.time() - _model_used[0] >= EMBEDDING_IDLE_S:
                let_model_go(f"unused for {EMBEDDING_IDLE_S:g} s")
            continue
        if req is None:
            break
        rid = req.get("id")
        op = str(req.get("op") or "")
        args = req.get("args") or {}
        if op == "shutdown":
            emit({"id": rid, "ok": True, "result": {"bye": True}})
            break
        if op in LONG:
            worker.submit(rid, op, args)
            continue
        if op not in QUICK:
            emit({"id": rid, "ok": False, "error": f"unknown op {op!r}", "kind": "args"})
            continue
        t1 = time.time()
        ok = False
        try:
            result = getattr(engine, QUICK[op])(args)
            ok = True
            emit({"id": rid, "ok": True, "result": result, "ms": int((time.time() - t1) * 1000)})
        except ArgsError as e:
            emit({"id": rid, "ok": False, "error": str(e), "kind": "args"})
        except Exception as e:
            log("warn", f"{op} failed: {e.__class__.__name__}: {e}")
            emit({"id": rid, "ok": False, "error": f"{e.__class__.__name__}: {e}"[:600], "kind": "mnemosyne"})
        finally:
            engine.settle(engine.m, op, ok)


if __name__ == "__main__":
    main()
