"""The memory sidecar over a stand-in for Mnemosyne whose embedding model is a count: each load, as Mnemosyne's
`_get_model` makes one, adds one, and a `get` embeds its id and answers how many loads there were. `reindex_vectors`
embeds in batches, as the real one does. Run as: python model-sidecar.py <sidecar.py>."""
import importlib.util
import os
import sys
import types

embeddings = types.ModuleType("mnemosyne.core.embeddings")
embeddings._embedding_model = None
embeddings.loads = 0
embeddings.available = lambda: True


def _get_model():
    if embeddings._embedding_model is None:
        embeddings.loads += 1
        embeddings._embedding_model = object()
    return embeddings._embedding_model


def embed(texts):
    # As Mnemosyne's: the model is asked for through the module, so a wrapped `_get_model` sees every embed.
    model = embeddings._get_model()
    return [[0.0] for _ in texts] if model is not None else None


embeddings._get_model = _get_model
embeddings.embed = embed


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
        embeddings.embed([mid])
        return {"id": mid, "content": f"loads={embeddings.loads}", "metadata_json": None}

    def reindex_vectors(self, batch_size=64, dry_run=False):
        if dry_run:
            return {"dry_run": True}
        for _ in range(3):
            embeddings.embed(["a"] * batch_size)
        return {"working_memory": 3 * batch_size}


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
