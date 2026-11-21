"""The memory sidecar over the real Mnemosyne with its clocks held still, for an eval that pins what recall serves (the
golden recall eval's real engine). Mnemosyne names a memory by a hash of its words and the moment it was filed, and
ranks by a score rounded to four places: memories that score alike tie, and keep the order of their names, so the
same corpus filed again ties the other way at the cut of `top_k` - another line in a brief, run to run. Here a memory
is named by its words and how many memories of the same words were named before it, so a corpus filed the same way is
named the same every run. And every memory is as recent as one filed the moment it is asked (`_recency_decay` and
`_temporal_boost` 1.0): a score read against the clock moves by a ten-thousandth every few minutes, past the rounding
on a slow run, and with the machine's time zone (Mnemosyne reads its own local timestamps as UTC). The rest is the
engine as installed. Run as: python steady-sidecar.py <sidecar.py>."""
import hashlib
import importlib.util
import sys
from collections import Counter

spec = importlib.util.spec_from_file_location("mnemosyne_sidecar", sys.argv[1])
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
named = Counter()


def steady_id(content):
    named[content] += 1
    return hashlib.sha256(f"{content}\0{named[content]}".encode()).hexdigest()[:16]


start = sidecar.Engine.__init__


def steady_start(self):
    # Mnemosyne is imported where the sidecar imports it, once its logging is set up.
    from mnemosyne.core import beam
    # An engine that names or dates its memories elsewhere would run unheld, and tie as it likes: it does not start.
    for name in ("_generate_id", "_recency_decay", "_temporal_boost"):
        if not callable(getattr(beam, name, None)):
            raise RuntimeError(f"mnemosyne.core.beam has no {name}: the steady sidecar cannot hold its clocks")
    beam._generate_id = steady_id
    beam._recency_decay = lambda *a, **k: 1.0
    beam._temporal_boost = lambda *a, **k: 1.0
    start(self)


sidecar.Engine.__init__ = steady_start
sidecar.main()
