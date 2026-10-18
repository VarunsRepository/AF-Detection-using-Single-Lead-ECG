# ---------------------------------------------------------------------------
# catalog/sources/
#
# Data sources, ONE MODULE PER DOMAIN -- the same split as catalog/packs.
#
# Previously every source lived in a single sources.py, so adding a cipher
# meant editing the file that also held the ECG provider and its PhysioNet
# label cache. Unrelated domains sharing a file is how an edit to one
# breaks another.
#
# Import order does not matter here: sources depend on nothing but the
# store itself.
# ---------------------------------------------------------------------------

from catalog.sources import ecg     # noqa: F401
from catalog.sources import crypto  # noqa: F401
from catalog.sources import compute # noqa: F401
from catalog.sources import biology
from catalog.sources import protocols   # noqa: F401
from catalog.sources import silicon     # noqa: F401
from catalog.sources import aero 