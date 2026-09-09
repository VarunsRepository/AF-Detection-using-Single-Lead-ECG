# ---------------------------------------------------------------------------
# dsp_store.py
# Server-side registry for DSP algorithms.
#
# Owns two things:
#   1. WHAT EXISTS: which algorithm IDs are registered and what JS file each one lives in
#   2. RESOLUTION: given a recipe's dspEngine config, which JS files actually need to be loaded
#
# The JS side (dsp_registry.js) becomes a thin execution layer -- an empty
# dict + registerDspAlgorithm() function. Each filter file self-registers
# into that dict when loaded. The server decides WHICH files get loaded per
# journey, so the browser never loads algorithms it doesn't need.
#
# Usage:
#   dsp_store = DspAlgorithmStore()
#   dsp_store.register(...)         # called once at app startup
#   urls = dsp_store.resolve(stage) # called per journey request
# ---------------------------------------------------------------------------

class DspAlgorithmStore:
    def __init__(self):
        # _registry: {algorithm_id → {entrypoint, label, description}}
        self._registry = {}

    def register(self, algorithm_id: str, entrypoint: str, label: str = "", description: str = "") -> None:
        """
        Register an algorithm at startup.
          algorithm_id: matches the recipe's availableAlgorithms[].id
          entrypoint:   static URL path the browser will load, e.g.
                        "/static/shorts/filters/pan_tompkins_filter.js"
        Safe to call multiple times -- silently skips if already registered,
        same pattern as JourneyStore.register_journey().
        """
        if algorithm_id in self._registry:
            return
        self._registry[algorithm_id] = {
            "entrypoint": entrypoint,
            "label": label or algorithm_id,
            "description": description,
        }

    def resolve(self, stages: list) -> list:
        """
        Given a journey's full stage list, return the UNIQUE set of JS
        entrypoint URLs needed -- deduplicated on BOTH algorithm ID and URL,
        in registration order. Deduplicating only by algorithm ID wasn't
        enough: if two algorithms share one file (e.g. poincare_standard and
        passthrough both in math_algorithms.js), the same URL would appear
        twice and the browser would load and execute it twice.
        """
        seen_ids = set()
        seen_urls = set()
        urls = []
        for stage in stages:
            dsp_config = stage.get("dspEngine", {})
            for algo in dsp_config.get("availableAlgorithms", []):
                algo_id = algo.get("id")
                if algo_id and algo_id not in seen_ids:
                    seen_ids.add(algo_id)
                    entry = self._registry.get(algo_id)
                    if entry and entry["entrypoint"] not in seen_urls:
                        urls.append(entry["entrypoint"])
                        seen_urls.add(entry["entrypoint"])
        return urls

    def list_all(self) -> dict:
        """Returns the full registry -- useful for admin/debug endpoints."""
        return dict(self._registry)
