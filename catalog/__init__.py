# ---------------------------------------------------------------------------
# catalog/__init__.py
#
# Everything the app knows about: data sources, algorithms, renderers,
# schemas and journey recipes. All of it DATA -- no routes, no request
# handling.
#
# WHY THIS PACKAGE EXISTS
#
#   journey_bp.py had grown to ~1160 lines of which roughly 85% was
#   registration data and recipes. Every new journey meant editing the
#   blueprint, which is how a careless edit once deleted 500 lines of
#   recipes in one go. Routes and content had no business sharing a file.
#
#   Now journey_bp.py holds routes only and never changes to add content.
#   Adding a journey is a new file in journeys/ plus one import below.
#
# IMPORT ORDER MATTERS
#
#   Stores must exist before anything registers into them, and components
#   must be registered before recipes reference them. The order below is
#   deliberate; the imports at the bottom are not alphabetical by accident.
# ---------------------------------------------------------------------------

from Services.journey_store import JourneyStore

# The one journey store. Recipe modules import this by name.
journey_store = JourneyStore(cache_dir="data_cache")

# 1. Data sources -- providers and their schemas
from catalog import sources                      # noqa: E402,F401

# 2. Components, BY DOMAIN. Each pack registers its algorithms and
#    renderers together with their contracts -- one call per component
#    instead of an entry in a components file plus a matching one in a
#    schemas file, with nothing keeping the two ids in sync.
from catalog.registry import dsp_store, rendering_store, undeclared  # noqa: E402
from catalog.packs import ecg      as _pack_ecg      # noqa: E402,F401
from catalog.packs import crypto   as _pack_crypto   # noqa: E402,F401
from catalog.packs import testing  as _pack_testing  # noqa: E402,F401
from catalog.packs import compute  as _pack_compute  # noqa: E402,F401
from catalog.packs import biology  as _pack_biology  # noqa: E402,F401
from catalog.packs import protocols as _pack_protocols # noqa: E402,F401
from catalog.packs import silicon 
from catalog.packs import aero as _pack_aero 

# 4. Recipes -- these reference everything above, so they come last
from catalog.journeys import ecg                 # noqa: E402,F401
from catalog.journeys import dwt                 # noqa: E402,F401
from catalog.journeys import aes                 # noqa: E402,F401
from catalog.journeys import beats               # noqa: E402,F401
from catalog.journeys import spectrum            # noqa: E402,F401
from catalog.journeys import spn                 # noqa: E402,F401
from catalog.journeys import sha1                # noqa: E402,F401
from catalog.journeys import simd                # noqa: E402,F401
from catalog.journeys import ets                 # noqa: E402,F401
from catalog.journeys import photosynthesis      # noqa: E402,F401
from catalog.journeys import pathway             # noqa: E402,F401
from catalog.journeys import test_journeys       # noqa: E402,F401
from catalog.journeys import protocols as _j_protocols # noqa: E402,F401
from catalog.journeys import silicon  
from catalog.journeys import aero as _j_aero 

# Components registered without a contract. Reported at startup because
# "all contracts valid" reads identically whether a pipeline was checked
# and passed, or was never checked at all.
_undeclared = undeclared()
if _undeclared:
    print(f"[SCHEMA] {len(_undeclared)} component(s) have no declared "
          f"contract and are UNVALIDATED: {', '.join(_undeclared)}")

__all__ = ["journey_store", "dsp_store", "rendering_store"]
