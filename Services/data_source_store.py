# ---------------------------------------------------------------------------
# Services/Data_Source_Store.py
#
# One registry for every data source in the app -- ECG, AES, planets,
# anything. A source declares WHERE its data comes from, HOW to parse it,
# and WHAT SHAPE it produces.
#
# WHAT CHANGED AND WHY
#
#   Before, a source declared an endpoint_template and someone had to
#   hand-write the Flask route it pointed at. Adding a source meant a new
#   route every time -- pure boilerplate differing only in which function
#   it called.
#
#   Now a source can declare a `provider` callable instead. One generic
#   route (/api/data/<source_id>/<sample_id> in journey_bp) serves every
#   source by looking up its provider and calling it. Adding a source is
#   one register() call -- no route, no blueprint, no template change.
#
#   endpoint_template is still supported for sources that genuinely live
#   behind an existing URL (the original ECG route, a third-party API).
#   Exactly one of provider or endpoint_template must be given.
#
# SCHEMA
#
#   `schema` declares what the source PROVIDES after its adapter has run.
#   Schema_Registry checks that against what a DSPE REQUIRES, at recipe
#   registration time. Without it, wiring planet data (fs=None) into
#   Pan-Tompkins (needs fs) produces silent NaN through the whole filter
#   and a blank chart -- no error, no clue.
#
#   Optional: a source without a schema is simply not validated, so this
#   can be adopted gradually rather than all at once.
#
# ONE INSTANCE, NOT SEVERAL
#
#   journey_bp and reels_bp each had their own DataSourceStore, so a
#   source registered in one was invisible to the other. There is now a
#   single module-level `data_source_store` at the bottom of this file;
#   both import it. Sources are global to the app, like routes.
# ---------------------------------------------------------------------------

import threading
from typing import Callable


class DataSourceStore:

    def __init__(self):
        self._registry: dict[str, dict] = {}
        self._providers: dict[str, Callable] = {}
        self._listers: dict[str, Callable] = {}
        self._statuses: dict[str, Callable] = {}
        self._savers: dict[str, Callable] = {}
        self._lock = threading.Lock()

    def register(self,
        source_id: str,
        provider: Callable[[str], dict] | None = None,
        lister: Callable[[int, int], dict] | None = None,
        status: Callable[[], dict] | None = None,
        saver: Callable[[dict, str], dict] | None = None,
        endpoint_template: str | None          = None,
        adapter: str                           = "single_to_arrays",
        primary_field: str                     = "signal",
        fs_field: str | None                   = "fs",
        schema: dict | None                    = None,
        label: str                             = "",
        description: str                       = "",
    ) -> None:
        """
        Register a data source.

        provider           fn(sample_id) -> dict, served by the generic
                           route. Use this for anything new.
        lister             fn(limit, offset) -> {samples, total, offset},
                           what the feed calls to know which cards to
                           build. Listing and fetching are genuinely
                           different operations -- one returns ids, the
                           other returns data -- so they are separate
                           callables rather than one overloaded provider.
        saver              fn(payload, author) -> dict. The WRITE half,
                           and the only place a source is allowed to
                           accept data from outside. It lives here rather
                           than in the route for the same reason provider
                           does: this store is already the one thing that
                           knows where a source's data lives. Put writing
                           in the blueprint and that knowledge is in two
                           places, and they drift the first time either is
                           changed.

                           A saver OWNS VALIDATION. Reading can be
                           permissive; writing cannot, because what it
                           accepts today it must still be able to serve
                           after the next engine change. Most sources have
                           no saver and are read-only, which is the right
                           default.
        endpoint_template  URL with an {id} placeholder, for sources that
                           already live behind their own route.
                           Exactly one of provider / endpoint_template.

        adapter            which JS adapter normalises the response:
                             single_to_arrays  one array + optional fs
                             multi_to_arrays   named arrays + optional fs
                           Adapters are per SHAPE, not per domain -- AES,
                           planets and 32-channel EEG all use
                           multi_to_arrays because all three return named
                           arrays of numbers.
        primary_field      which field becomes envelope.y (backward compat:
                           every existing DSP reads data.y)
        fs_field           which field is the sample rate; None for data
                           with no time axis (AES, planets, images)
        schema             {"provides": {...}, "fs": ...} -- see above
        """
        if (provider is None) == (endpoint_template is None):
            raise ValueError(
                f'Source "{source_id}": give exactly one of provider or '
                f'endpoint_template.')

        # Derive the URL for provider-backed sources so the client side
        # needs no special case -- it always just fills in {id}.
        if provider is not None:
            endpoint_template = f"/api/data/{source_id}/{{id}}"

        with self._lock:
            self._registry[source_id] = {
                "sourceId":         source_id,
                "endpointTemplate": endpoint_template,
                "adapter":          adapter,
                "primaryField":     primary_field,
                "fsField":          fs_field,
                "label":            label,
                "description":      description,
                "schema":           schema,
            }
            if provider is not None:
                self._providers[source_id] = provider
            if lister is not None:
                self._listers[source_id] = lister
            if status is not None:
                self._statuses[source_id] = status
            if saver is not None:
                self._savers[source_id] = saver

    def get(self, source_id: str) -> dict | None:
        return self._registry.get(source_id)

    def get_provider(self, source_id: str) -> Callable | None:
        """Used by the generic /api/data route. None for URL-backed sources."""
        return self._providers.get(source_id)

    def get_lister(self, source_id: str) -> Callable | None:
        """Used by the generic /api/data/<source>/samples route."""
        return self._listers.get(source_id)

    def get_status(self, source_id: str) -> Callable | None:
        """
        Optional self-diagnostic, served by /api/data/<source>/status.
        For anything a source builds lazily -- caches, lookup tables --
        whose failure would otherwise be invisible because the source
        keeps working with degraded data.
        """
        return self._statuses.get(source_id)

    def get_saver(self, source_id: str) -> Callable | None:
        """
        Used by the generic POST /api/data/<source>/save route. None for
        every read-only source, which is nearly all of them -- so the
        route answers 405 rather than 404, and "this source does not
        accept writes" is distinguishable from "no such source".
        """
        return self._savers.get(source_id)

    def is_writable(self, source_id: str) -> bool:
        return source_id in self._savers

    def get_schema(self, source_id: str) -> dict | None:
        cfg = self._registry.get(source_id)
        return cfg.get("schema") if cfg else None

    def resolve_for_stages(self, stages: list) -> list:
        """
        Collect the configs needed by a list of stages, deduplicated.
        The result is inlined into the page so data_registry.js knows
        which sources exist and how to reach them.

        `schema` is stripped -- it is a server-side validation concern and
        would only bloat the page.
        """
        seen: set[str] = set()
        configs: list[dict] = []
        for stage in stages:
            source_id = stage.get("dataSource", {}).get("sourceId")
            if not source_id or source_id in seen:
                continue
            config = self._registry.get(source_id)
            if config:
                configs.append({k: v for k, v in config.items() if k != "schema"})
                seen.add(source_id)
            else:
                print(f'[DATA SOURCE STORE] sourceId "{source_id}" is used '
                      f'in a recipe but not registered.')
        return configs

    def list_all(self) -> list:
        return list(self._registry.values())

    def list_ids(self) -> list:
        return list(self._registry.keys())


# ── The one shared instance ──────────────────────────────────────────────
# Imported by journey_bp, reels_bp and anything else. Previously each
# blueprint built its own, so a source registered in one was invisible to
# the other -- which meant duplicate registrations that could silently
# drift apart.
data_source_store = DataSourceStore()
