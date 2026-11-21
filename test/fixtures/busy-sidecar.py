"""The memory sidecar over a stand-in for Mnemosyne, so its own loop runs on any Python 3, with no engine installed: a
`get` keeps the main thread at work, computing, until a file of that name exists, as a big embedding keeps it.
Run as: python busy-sidecar.py <sidecar.py>."""
import importlib.util
import os
import sys
import types


class Beam:
    conn = None


class Mnemosyne:
    def __init__(self, session_id=None, bank=None):
        self.db_path = os.path.join(os.environ.get("MNEMOSYNE_DATA_DIR") or ".", "stand-in.db")
        self.conn = None
        self.beam = Beam()

    def get_stats(self):
        return {"total_memories": 0}

    def remember(self, content, source="filament", importance=0.6, scope="global", veracity="stated"):
        return "m1"

    def get(self, mid):
        n = 0
        while not os.path.exists(mid):
            n += sum(range(2000))
        return {"id": mid, "content": "worked", "metadata_json": None}


embeddings = types.ModuleType("mnemosyne.core.embeddings")
embeddings.available = lambda: False
core = types.ModuleType("mnemosyne.core")
core.embeddings = embeddings
package = types.ModuleType("mnemosyne")
package.Mnemosyne = Mnemosyne
package.__version__ = "stand-in"
package.core = core
sys.modules.update({"mnemosyne": package, "mnemosyne.core": core, "mnemosyne.core.embeddings": embeddings})

spec = importlib.util.spec_from_file_location("mnemosyne_sidecar", sys.argv[1])
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
sidecar.main()
