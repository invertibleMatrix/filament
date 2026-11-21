"""The memory sidecar with leaks planted where a fault in Mnemosyne would leave them (the bug report's X2), each an
UPDATE's write transaction left open: `stats` on the legacy connection, after setting every working memory's
importance to 0.99; `hygiene_audit` on BEAM's, setting it to 0.01, and then it fails; `diagnose` on the worker
thread's instance, changing nothing. Run as: python leaky-sidecar.py <sidecar.py>."""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("mnemosyne_sidecar", sys.argv[1])
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
Engine = sidecar.Engine
stats = Engine.op_stats


def leaky_stats(self, a):
    self.m.conn.execute("UPDATE working_memory SET importance = 0.99")
    return stats(self, a)


def leaky_audit(self, a):
    self.m.beam.conn.execute("UPDATE working_memory SET importance = 0.01")
    raise RuntimeError("planted")


def leaky_diagnose(self, m, a):
    m.conn.execute("UPDATE working_memory SET pinned = pinned WHERE id = ?", ("no-such-memory",))
    return {"planted": True}


Engine.op_stats = leaky_stats
Engine.op_hygiene_audit = leaky_audit
Engine.long_diagnose = leaky_diagnose
sidecar.main()
