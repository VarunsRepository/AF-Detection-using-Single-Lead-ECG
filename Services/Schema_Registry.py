# ---------------------------------------------------------------------------
# Services/Schema_Registry.py
#
# Validates the contracts between every producer and consumer in a
# pipeline, ONCE, at recipe registration time -- not per request.
#
#     DATA SOURCE  -> DSPE      does the source provide what the algo needs?
#     DSPE         -> DSPE      can stage 2 consume stage 1's output?
#     DSPE         -> RENDERER  does the renderer get the fields it reads?
#
# WHY THIS EXISTS
#
#   Wiring planet data (fs = None) into Pan-Tompkins (needs fs) produces
#   no error. The bandpass filter divides by None, NaN propagates through
#   derivative, squaring and integration, findPeaks returns an empty
#   array, and the chart renders blank. Nothing in that chain complains.
#
#   The alternative to this registry is a hand-written guard at the top of
#   every DSPE -- which is what aes128_encrypt currently has. That works
#   but it is per-algorithm duplication of one rule, and it fires in the
#   browser after a wasted round trip rather than on the server at startup.
#
# WHY IT IS NOT A FULL TYPE SYSTEM
#
#   Deliberately shallow. It checks that named fields exist and that
#   sample-rate expectations line up. It does NOT check array lengths,
#   value ranges, or units -- those are runtime facts, not registration
#   facts, and pretending otherwise would give false confidence.
#
#   Specifically it cannot catch: a 16-byte key that is all zeros, a
#   signal shorter than the filter window, or millivolts supplied where
#   microvolts were expected. Those still need runtime guards.
#
# ADOPTION IS GRADUAL
#
#   Anything without a declared schema is skipped, not failed. So sources
#   and algorithms can gain schemas one at a time, and an unannotated
#   pipeline behaves exactly as it does today.
# ---------------------------------------------------------------------------


class SchemaRegistry:

    def __init__(self):
        # producerId -> output schema, consumerId -> input schema.
        # Algorithms and renderers register here; data sources carry their
        # schema on their own registration and are passed in directly.
        self._provides: dict[str, dict] = {}
        self._requires: dict[str, dict] = {}
        # Cache of validated pairings, so repeated recipe registrations
        # do not re-derive the same answer. Keyed (producer, consumer).
        self._cache: dict[tuple, list] = {}

    # ── Registration ────────────────────────────────────────────────────

    def declare(self, component_id: str,
                requires: dict | None = None,
                provides: dict | None = None) -> None:
        """
        Declare what a component needs and what it emits.

        requires = {
            "fields":      ["arrays.plaintext", "arrays.key"],
            "fs_required": False,
            "domains":     ["crypto.aes"],     # optional, "*" = any
        }
        provides = {
            "fields": ["interimOutputs", "finalOutput.ciphertext"],
            "fs":     None,
            "domain": "crypto.aes",
        }

        Dotted paths are matched literally against the declared field
        list -- this is a name check, not a structural walk of live data.
        """
        if requires is not None:
            self._requires[component_id] = requires
        if provides is not None:
            self._provides[component_id] = provides
        self._cache.clear()   # any declaration invalidates prior verdicts

    # ── Validation ──────────────────────────────────────────────────────

    def validate_pairing(self, producer_id: str, consumer_id: str,
                         producer_schema: dict | None = None) -> list:
        """
        Returns a list of error strings; empty means the pairing is valid.

        producer_schema lets a DATA SOURCE pass its schema in directly,
        since sources carry theirs on their own registration rather than
        declaring here.
        """
        key = (producer_id, consumer_id)
        if key in self._cache:
            return self._cache[key]

        provides = producer_schema or self._provides.get(producer_id)
        requires = self._requires.get(consumer_id)

        # Either side unannotated -> skip. Gradual adoption: an
        # unannotated pipeline behaves exactly as it does today.
        if not provides or not requires:
            self._cache[key] = []
            return []

        errors: list[str] = []
        available = set(provides.get("fields", []))

        # 1. Required fields present?
        for field in requires.get("fields", []):
            if field not in available:
                errors.append(
                    f'"{consumer_id}" requires "{field}" but "{producer_id}" '
                    f'provides only [{", ".join(sorted(available)) or "nothing"}]')

        # 2. Sample rate. The single most common silent failure -- a
        #    time-series algorithm fed data with no time axis divides by
        #    None and produces NaN all the way down.
        if requires.get("fs_required") and provides.get("fs") is None:
            errors.append(
                f'"{consumer_id}" needs a sample rate but "{producer_id}" '
                f'has fs = None (not time-series data)')

        # 3. Domain compatibility. A warning-level check expressed as an
        #    error, because a domain mismatch is nearly always a wiring
        #    mistake rather than an intentional cross-domain experiment.
        domains = requires.get("domains", ["*"])
        if "*" not in domains:
            producer_domain = provides.get("domain")
            if producer_domain and producer_domain not in domains:
                errors.append(
                    f'"{consumer_id}" expects domain in {domains} but '
                    f'"{producer_id}" is "{producer_domain}"')

        self._cache[key] = errors
        return errors

    def validate_stage(self, stage: dict, data_source_store) -> list:
        """
        Validate one recipe stage: its data source into its algorithm,
        and its algorithm into its renderer.
        """
        errors: list[str] = []
        stage_id = stage.get("stageId", "<unnamed stage>")

        algo_id = (stage.get("dspEngine", {})
                        .get("availableAlgorithms", [{}])[0].get("id"))
        renderers = stage.get("renderingEngine", {}).get("availableRenderers", [{}])
        renderer_id = renderers[0].get("id") if renderers else None

        # source -> algorithm
        source_id = stage.get("dataSource", {}).get("sourceId")
        if source_id and algo_id:
            schema = data_source_store.get_schema(source_id)
            for e in self.validate_pairing(source_id, algo_id, schema):
                errors.append(f"[{stage_id}] {e}")

        # algorithm -> renderer
        if algo_id and renderer_id:
            for e in self.validate_pairing(algo_id, renderer_id):
                errors.append(f"[{stage_id}] {e}")

        return errors

    def validate_journey(self, journey_name: str, stages: list,
                         data_source_store) -> list:
        """
        Validate every stage of a journey, plus stage-to-stage chaining
        where a stage consumes a previous one's output.
        """
        errors: list[str] = []
        for i, stage in enumerate(stages):
            errors.extend(
                f"{journey_name}: {e}"
                for e in self.validate_stage(stage, data_source_store))

            # PREVIOUS_STAGE_PIPELINE -- the consumed field must actually
            # be exported by the stage being referenced. Catching this is
            # the difference between "undefined" at runtime and a named
            # error at startup.
            ds = stage.get("dataSource", {})
            if ds.get("mode") == "PREVIOUS_STAGE_PIPELINE":
                wanted = ds.get("consumedField")
                key    = ds.get("outputKey")
                exported = {
                    f
                    for s in stages[:i]
                    if s.get("stageOutput", {}).get("exportKey") == key
                    for f in s.get("stageOutput", {}).get("exportedFields", [])
                }
                if wanted and exported and wanted not in exported:
                    errors.append(
                        f'{journey_name}: [{stage.get("stageId")}] consumes '
                        f'"{wanted}" from "{key}", which exports only '
                        f'[{", ".join(sorted(exported))}]')
        return errors

    # ── Introspection ───────────────────────────────────────────────────

    def compatible_consumers(self, producer_id: str,
                             producer_schema: dict | None = None) -> list:
        """
        Everything that can legally consume this producer. Powers recipe
        autocomplete: "I have planet data -- which algorithms can use it?"
        """
        return [cid for cid in self._requires
                if not self.validate_pairing(producer_id, cid, producer_schema)]

    def declared(self) -> dict:
        return {"requires": sorted(self._requires), "provides": sorted(self._provides)}


# ── The one shared instance ──────────────────────────────────────────────
schema_registry = SchemaRegistry()
