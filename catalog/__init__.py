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

# 2. Algorithms and renderers -- which JS file each lives in
from catalog.components import dsp_store, rendering_store   # noqa: E402

# 3. Contracts -- what each component needs and emits
from catalog import schemas                      # noqa: E402,F401

# 4. Recipes -- these reference everything above, so they come last
from catalog.journeys import ecg                 # noqa: E402,F401
from catalog.journeys import dwt                 # noqa: E402,F401
from catalog.journeys import aes                 # noqa: E402,F401
from catalog.journeys import test_journeys       # noqa: E402,F401

__all__ = ["journey_store", "dsp_store", "rendering_store"]
