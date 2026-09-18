# ---------------------------------------------------------------------------
# journey_store.py (JourneyStore)
# Matches ECG_Signal_Feature_Manager's exact pattern: _ram_store as the
# live in-memory copy, a _disk_lock dedicated to this file's disk ops,
# fire-and-forget background writes via threading.Thread, load-on-init.
#
# Genuinely generic now -- starts EMPTY if journeystore.json doesn't
# exist, exactly like FeatureStore does, no hardcoded journey data baked
# in here at all. An earlier version seeded AFib/DWT defaults directly
# inside this file, which repeated the exact mistake already fixed once
# before (hardcoding recipe DATA inside class CODE) -- just under a
# different method name. Matching SpectralBandStore's own convention:
# it never hardcodes which CSV or class names to use either -- those get
# passed in by the caller (manager.register("full_length", SpectralBandStore(csv_path=...))).
# The actual ECG/DWT recipes belong in your app's own init code, calling
# register_journey() the same way you already call manager.register().
#
# Honest limitation, same as FeatureStore's own: no protection against
# read-during-write races beyond the disk_lock covering the WRITE itself.
# Fine for one JSON file; worth revisiting once this becomes a real
# database connection (swapping cache_dir/json_path for a connection
# string should only mean changing this file's internals, not any caller).
# ---------------------------------------------------------------------------

import os
import json
import threading


class JourneyStore:

    # default constructor to manage initialization
    def __init__(self, cache_dir: str = "data_cache"):
        self.cache_dir = cache_dir
        # Actual on-disk structure: data_cache/JourneyStore/journeystore.json
        self.store_dir = os.path.join(self.cache_dir, "JourneyStore")
        self.json_path = os.path.join(self.store_dir, "journeystore.json")

        # Initialize the isolated in-memory RAM cache
        self._ram_store = {}
        # Thread lock dedicated entirely to this JSON file's disk operations
        self._disk_lock = threading.Lock()

        os.makedirs(self.store_dir, exist_ok=True)
        # Automatically seed the RAM cache on instantiation
        self._load_database_into_ram()

    # standard CRUD operations below
    def _load_database_into_ram(self) -> None:
        """Private startup method: maps the disk dataset into active server memory."""
        if os.path.exists(self.json_path):
            try:
                with open(self.json_path, "r", encoding="utf-8") as f:
                    self._ram_store = json.load(f)
                print(f"🤖 [JOURNEY STORE] Loaded {len(self._ram_store)} journeys into active RAM.")
            except Exception as e:
                print(f"🚨 JOURNEY STORE Error reading disk file, starting empty: {e}")
                self._ram_store = {}
        else:
            print("📝 [JOURNEY STORE] No existing journeystore.json found. Initializing empty state.")
            self._ram_store = {}

    def get_journey_config(self, journey_name: str) -> dict | None:
        """Public reader: fetches a journey's raw config straight from RAM."""
        return self._ram_store.get(journey_name)

    def build_journey(self, journey_name: str) -> dict | None:
        """
        THE actual "create the journey" step -- looks up the recipe,
        VALIDATES it (catching a broken recipe on the SERVER before ever
        sending it to the client), and returns a clean package ready to
        hand to a template.
        """
        config = self.get_journey_config(journey_name)
        if not config:
            return None

        errors = self._validate_recipe(config.get("stages"))
        if errors:
            raise ValueError(f"Journey \"{journey_name}\" has an invalid recipe: {'; '.join(errors)}")

        return {
            "name": journey_name,
            "template": config["template"],
            "api_endpoint": config["api_endpoint"],
            "globalThemes": config.get("globalThemes"),
            "journeyRules": config.get("journeyRules"),
            "stages": config.get("stages"),
            "uiShell": config.get("uiShell"),
            "playbackConfig": config.get("playbackConfig"),
            "layout": config.get("layout"),
        }

    def _validate_recipe(self, stages) -> list:
        """
        Validates the CURRENT schema (dataSource/dspEngine/renderingEngine),
        not the old dependsOn-based one this used to check -- that
        validation had become a silent no-op, since "dependsOn" doesn't
        exist in this shape at all, meaning a genuinely broken recipe
        would never have been caught.
        """
        errors = []
        if stages is None:
            return errors

        stage_ids_seen = set()
        export_keys_available = {}  # exportKey -> set of exportedFields, populated as we walk forward

        for idx, stage in enumerate(stages):
            stage_id = stage.get("stageId")
            if not stage_id:
                errors.append(f"stage {idx} is missing \"stageId\"")
                continue
            stage_ids_seen.add(stage_id)

            for required in ("dataSource", "dspEngine", "renderingEngine", "uiFillers"):
                if required not in stage:
                    errors.append(f"stage \"{stage_id}\" is missing \"{required}\"")

            ds = stage.get("dataSource", {})
            mode = ds.get("mode")

            if mode == "PREVIOUS_STAGE_PIPELINE":
                ref_stage_id = ds.get("stageId")
                ref_output_key = ds.get("outputKey")
                ref_field = ds.get("consumedField")

                if ref_stage_id not in stage_ids_seen:
                    errors.append(f"stage \"{stage_id}\" references stage \"{ref_stage_id}\", which doesn't exist or comes AFTER it (forward reference)")
                elif ref_output_key not in export_keys_available:
                    errors.append(f"stage \"{stage_id}\" references outputKey \"{ref_output_key}\", which no earlier stage exports")
                # consumedField is OPTIONAL: omitting it means the stage
                # consumes the WHOLE export rather than one field, which a
                # multi-field consumer (stacked_beats needs filteredSignal,
                # peakIndices and wavePoints) has to do. Only validate the
                # field when one is actually named.
                elif ref_field is not None and \
                     ref_field not in export_keys_available.get(ref_output_key, set()):
                    errors.append(f"stage \"{stage_id}\" references field \"{ref_field}\", which \"{ref_output_key}\" doesn't export")

            elif mode not in ("HTTP_REST",):
                errors.append(f"stage \"{stage_id}\" has an unrecognized dataSource.mode \"{mode}\"")

            # Track this stage's own exports for LATER stages to reference
            stage_output = stage.get("stageOutput")
            if stage_output:
                export_keys_available[stage_output["exportKey"]] = set(stage_output.get("exportedFields", []))

        return errors

    def register_journey(self, journey_name: str, config: dict) -> None:
        """
        Registers or updates a journey's config in RAM and on disk.

        The original "skip if exists" approach conflated two concerns:
          - feedback_score: user-generated, must survive restarts unchanged
          - recipe config: developer-owned, must update when changed

        Now uses VERSION-BASED MERGING instead:
          - New journey (not in store): registered fresh, written to disk
          - Existing journey, same version: skipped -- nothing changed
          - Existing journey, higher version: recipe fields updated,
            feedback_score preserved from disk

        This means adding a new stage, changing a baseDurationMs, or
        adding a new rail control no longer requires deleting journeystore.json.
        Just bump the recipe's "version" field in journey_bp.py and restart.

        Version field is optional -- recipes without it default to version 0,
        which always triggers an update (safe for initial migration, since
        existing disk entries also won't have a version field).
        """
        incoming_version = config.get("version", 0)
        existing = self._ram_store.get(journey_name)

        if existing is not None:
            existing_version = existing.get("version", -1)
            if incoming_version <= existing_version:
                print(f"📎 [JOURNEY STORE] \"{journey_name}\" v{existing_version} up to date -- skipping.")
                return
            # Version bumped -- update recipe fields, preserve feedback_score
            preserved_score = existing.get("feedback_score", 0)
            self._ram_store[journey_name] = {
                **config,
                "feedback_score": preserved_score,
            }
            print(f"🔄 [JOURNEY STORE] \"{journey_name}\" updated v{existing_version} → v{incoming_version} (feedback_score preserved: {preserved_score})")
        else:
            self._ram_store[journey_name] = config
            print(f"✅ [JOURNEY STORE] \"{journey_name}\" v{incoming_version} registered fresh.")

        threading.Thread(target=self._persist_to_disk).start()

    def list_all_journeys(self, include_experimental: bool = True) -> list:
        result = []
        for name, config in self._ram_store.items():
            if not include_experimental and config["status"] == "experimental":
                continue
            result.append({
                "name": name,
                "label": config["label"],
                "description": config["description"],
                "status": config["status"],
                "category": config.get("category"),
            })
        return result

    def list_journeys_by_category(self, category: str, include_experimental: bool = True) -> list:
        """MATCH: all journeys registered for a given condition/category (e.g. "afib") -- the mechanism that makes "many candidate variants for the same detection goal" a queryable set."""
        result = []
        for name, config in dict(self._ram_store).items():  # snapshot -- safe against race with register_journey()
            if config.get("category") != category:
                continue
            if not include_experimental and config["status"] == "experimental":
                continue
            result.append({"name": name, **config})
        return result

    def get_best_journey_in_category(self, category: str) -> dict | None:
        """RE-REASONING: given multiple candidates for the same condition, return the one with the highest feedback score. Not meaningfully useful yet -- every score defaults to 0 until real feedback data flows in."""
        candidates = self.list_journeys_by_category(category)
        if not candidates:
            return None
        return max(candidates, key=lambda c: c.get("feedback_score", 0))

    def update_feedback_score(self, journey_name: str, score_delta: float) -> None:
        """Public writer: adjusts a journey's feedback score in RAM and triggers a safe background write to disk."""
        if journey_name in self._ram_store:
            current = self._ram_store[journey_name].get("feedback_score", 0)
            self._ram_store[journey_name]["feedback_score"] = current + score_delta
            threading.Thread(target=self._persist_to_disk).start()

    def _persist_to_disk(self) -> None:
        """Private worker: safely flushes the memory structure back to the physical drive."""
        with self._disk_lock:
            # Take a shallow copy before serialising -- without this, if the
            # main thread calls register_journey() while json.dump() is
            # iterating _ram_store, Python raises RuntimeError: dictionary
            # changed size during iteration. The copy is a snapshot at this
            # moment; json.dump iterates it safely regardless of what the
            # main thread does to _ram_store after this line.
            snapshot = dict(self._ram_store)
            with open(self.json_path, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, indent=4)
