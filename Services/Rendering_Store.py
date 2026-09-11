# ---------------------------------------------------------------------------
# rendering_store.py
# Server-side registry for rendering engines.
#
# Exact same pattern as dsp_store.py -- owns what renderers exist and which
# JS files they need, resolves per-journey entrypoints so the browser only
# loads what a specific journey actually uses.
#
# Plotly.js itself is NOT registered here -- it's a runtime dependency
# loaded from CDN unconditionally, since every renderer uses it. What IS
# registered here is each renderer module (chart_v1, scatter_density, etc.)
# that sits on top of Plotly.
#
# Usage:
#   rendering_store = RenderingStore()
#   rendering_store.register(...)       # called once at app startup
#   urls = rendering_store.resolve(stages) # called per journey request
# ---------------------------------------------------------------------------

class RenderingStore:
    def __init__(self):
        # _registry: {renderer_id → {entrypoint, label, description}}
        self._registry = {}

    def register(self, renderer_id: str, entrypoint: str, label: str = "", description: str = "") -> None:
        """
        Register a renderer at startup.
          renderer_id: matches the recipe's availableRenderers[].id
          entrypoint:  static URL path, e.g.
                       "/static/shorts/renderers/chart_v1.js"
        Safe to call multiple times -- silently skips if already registered.
        """
        if renderer_id in self._registry:
            return
        self._registry[renderer_id] = {
            "entrypoint": entrypoint,
            "label": label or renderer_id,
            "description": description,
        }

    def resolve(self, stages: list) -> list:
        """
        Given a journey's full stage list, return the UNIQUE set of JS
        entrypoint URLs for renderers actually referenced -- deduplicated on
        both renderer ID and URL.
        """
        seen_ids = set()
        seen_urls = set()
        urls = []
        for stage in stages:
            rendering_config = stage.get("renderingEngine", {})
            for renderer in rendering_config.get("availableRenderers", []):
                renderer_id = renderer.get("id")
                if renderer_id and renderer_id not in seen_ids:
                    seen_ids.add(renderer_id)
                    entry = self._registry.get(renderer_id)
                    if entry and entry["entrypoint"] not in seen_urls:
                        urls.append(entry["entrypoint"])
                        seen_urls.add(entry["entrypoint"])
        return urls

    def list_all(self) -> dict:
        """Returns the full registry -- useful for admin/debug endpoints."""
        return dict(self._registry)
