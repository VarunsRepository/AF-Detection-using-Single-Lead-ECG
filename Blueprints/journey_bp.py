# ---------------------------------------------------------------------------
# Blueprints/journey_bp.py
#
# ROUTES ONLY. Every journey recipe, data source, algorithm, renderer and
# schema declaration lives in the `catalog` package.
#
# WHY THE SPLIT
#   This file had grown to ~1160 lines of which roughly 85% was
#   registration data and recipes. Adding a journey meant editing the
#   blueprint -- which is how one careless edit deleted 500 lines of
#   recipes in a single slice. Routes and content had no business sharing
#   a file.
#
#   Adding a journey now means a new file in catalog/journeys/ and one
#   import in catalog/__init__.py. This file does not change.
# ---------------------------------------------------------------------------

from flask import Blueprint, render_template, abort, jsonify, request

from Services.data_source_store import data_source_store
from Services.Schema_Registry   import schema_registry
from Services.analytics_store   import AnalyticsStore

# Importing the catalog is what registers everything -- sources,
# components, schemas and recipes, in that order.
from catalog import journey_store, dsp_store, rendering_store

analytics_store = AnalyticsStore(cache_dir="data_cache")


journey_bp = Blueprint('journey', __name__)


@journey_bp.route('/journey/<journey_name>')
def journey(journey_name):
    try:
        package = journey_store.build_journey(journey_name)
    except ValueError as e:
        abort(500, description=str(e))
    if not package:
        abort(404)

    dsp_entrypoints       = dsp_store.resolve(package["stages"])
    rendering_entrypoints = rendering_store.resolve(package["stages"])
    data_source_configs   = data_source_store.resolve_for_stages(package["stages"])

    # ── shared-link landing card ────────────────────────────────────
    # ?sample=A00042 starts the feed on that card and then continues
    # with the normal list. Validated HERE rather than in the browser:
    # a stale link -- a deleted record, a typo, someone else's install --
    # should degrade to an ordinary feed, not to a card that sits there
    # failing to fetch. A link outliving its data is normal.
    start_sample = request.args.get("sample")
    if start_sample:
        source_id = (package["stages"][0].get("dataSource", {}) or {}).get("sourceId")
        provider  = data_source_store.get_provider(source_id) if source_id else None
        if provider is None:
            start_sample = None
        else:
            try:
                provider(start_sample)
            except Exception as e:
                print(f'[JOURNEY] shared sample "{start_sample}" is not available '
                      f'in "{source_id}" ({type(e).__name__}) -- starting normally')
                start_sample = None

    return render_template(
        package["template"],
        journey_stages=package["stages"],
        journey_themes=package["globalThemes"],
        journey_rules=package["journeyRules"],
        journey_api_endpoint=package["api_endpoint"],
        journey_ui_shell=package["uiShell"],
        journey_playback_config=package["playbackConfig"],
        journey_layout=package["layout"],
        start_sample=start_sample,
        dsp_entrypoints=dsp_entrypoints,
        rendering_entrypoints=rendering_entrypoints,
        data_source_configs=data_source_configs,
        # Single-journey mode -- all cards use the same recipe
        shorts_batch=None,
    )


# ---------------------------------------------------------------------------
# /shorts -- mixed-journey batch route
#
# Server composes a batch of cards from multiple journey types.
# Each card carries its own recipe, sourceId, and sampleId.
# The template loads the UNION of all required DSP/RE files.
# The feed engine reads card.recipe per card instead of one shared recipe.
#
# Phase 1 (now): fixed composition -- 2 ECG, 1 DWT, repeat.
#   No recommendation engine yet -- that's Sprint 3.
# Phase 2: recommendation engine weights the mix by analytics.
# ---------------------------------------------------------------------------
# shorts_bp no longer serves a page route, so '/shorts' and '/shorts/'
# both resolve here -- the trailing-slash ambiguity is gone.
# '/feed' is kept as a friendlier alias.
# ---------------------------------------------------------------------------
@journey_bp.route('/feed')
@journey_bp.route('/shorts')
def shorts():
    """
    Mixed-journey batch.

    SHIPPED TO THE CLIENT:
        { "recipes": {"ecg": {...}, "dwt": {...}},
          "pattern": [{"journey":"ecg"}, {"journey":"ecg"},
                      {"journey":"dwt"}, {"journey":"ecg"},
                      {"journey":"dwt"}] }

    Recipes are shipped ONCE and referenced by name; the pattern is the
    play order and repeats (card N uses pattern[N % len]). A recipe names
    a sourceId, never a sampleId -- it holds no data, so the same "ecg"
    recipe drives many cards against different samples. That is why it
    can be sent once instead of per card.

    The PATTERN is where sequencing intent lives. Sprint 3's recommender
    rewrites this list, and entries may gain hints
    ({"journey":"ecg","prefer_label":"A"}) without recipes ever becoming
    data-bound.
    """
    pattern = [
        {"journey": "ecg"},
        {"journey": "ecg"},
        {"journey": "dwt"},
        {"journey": "ecg"},
        {"journey": "dwt"},
    ]

    # Build each DISTINCT recipe once. dict.fromkeys dedupes while
    # preserving first-seen order.
    wanted  = list(dict.fromkeys(e["journey"] for e in pattern))
    recipes = {}
    for name in wanted:
        package = journey_store.build_journey(name)
        if package:
            recipes[name] = package
        else:
            print(f'[SHORTS] journey "{name}" is in the pattern but not '
                  f'registered -- dropping it from the batch.')

    # Drop pattern entries whose recipe failed to build, so the client
    # never references a journey that is not there.
    pattern = [e for e in pattern if e["journey"] in recipes]
    if not recipes:
        abort(500, description="No journeys in the batch could be built.")

    # Resolution runs over the union of stages across DISTINCT recipes --
    # not once per card. Each store dedupes internally.
    batch_stages = [s for r in recipes.values() for s in r["stages"]]

    dsp_entrypoints       = dsp_store.resolve(batch_stages)
    rendering_entrypoints = rendering_store.resolve(batch_stages)
    data_source_configs   = data_source_store.resolve_for_stages(batch_stages)

    # Template variables that assume a single journey come from the first
    # recipe in the pattern; the feed engine overrides per card.
    primary = recipes[pattern[0]["journey"]]

    return render_template(
        "shorts/journey_page.html",
        journey_stages=primary["stages"],
        journey_themes=primary["globalThemes"],
        journey_rules=primary["journeyRules"],
        journey_api_endpoint=primary["api_endpoint"],
        journey_ui_shell=primary["uiShell"],
        journey_playback_config=primary["playbackConfig"],
        journey_layout=primary["layout"],
        dsp_entrypoints=dsp_entrypoints,
        rendering_entrypoints=rendering_entrypoints,
        data_source_configs=data_source_configs,
        shorts_batch={"recipes": recipes, "pattern": pattern},
    )


# ---------------------------------------------------------------------------
# Seed feed -- one card per journey, across every domain
# ---------------------------------------------------------------------------

# (journey name, source id). The ECG entries draw their sample from the
# live record list; the cipher entries name a specific block, because
# those samples are hand-authored and a particular one is the point --
# aes_fips197 is the FIPS-197 worked example, spn_classic the standard
# SPN demonstration.
SEED_TOUR = [
    ("ecg",            "ecg_single", None),
    ("beats",          "ecg_single", None),
    ("spectrum",       "ecg_single", None),
    ("dwt",            "ecg_single", None),
    ("aes_round",      "aes_block",  "aes_fips197"),
    # A DIFFERENT block from aes_round above -- see the uniqueness note.
    # It also reads better: key expansion depends on the KEY, so a tour
    # stop showing a different key produces a visibly different schedule.
    ("aes_expansion",  "aes_block",  "aes_ascii"),
    ("spn",            "spn_block",  "spn_classic"),
    ("sha1",           "sha1_message", "sha1_abc"),
]


@journey_bp.route('/seed')
def seed_feed():
    """
    A tour: one card per journey, spanning every domain the engine runs.

    CURATED, not paginated. The normal feed draws every card's sample from
    ONE endpoint, which ties the whole feed to a single source -- fine for
    8,528 ECG records, impossible for a tour where card 1 is an ECG
    recording and card 5 is an AES block. So each pattern entry carries
    its own sampleId and the client skips pagination entirely
    (see isCurated in journey_scroll_feed.js).

    Entries whose journey or sample is unavailable are DROPPED rather than
    failing the page -- a tour missing one stop is still a tour.

    EVERY sampleId MUST BE UNIQUE ACROSS THE TOUR. The feed keys a running
    journey by sampleId ("if (!activeJourneys.has(sampleId))"), so a second
    card with the same sample is treated as already playing and never
    starts -- it just sits there blank, with no error anywhere. Two stops
    originally shared aes_fips197 and card 6 silently refused to load.
    The check below turns that into a log line instead of a mystery.
    """
    # ECG sample ids come from the live list, so the tour works on any
    # install regardless of which records were uploaded.
    ecg_ids = []
    lister = data_source_store.get_lister("ecg_single")
    if lister:
        try:
            ecg_ids = [s["record_id"] for s in lister(8, 0).get("samples", [])]
        except Exception as e:
            print(f"[SEED] could not list ECG records: {e}")

    recipes, pattern, ecg_cursor = {}, [], 0
    for journey, source_id, fixed_sample in SEED_TOUR:
        package = journey_store.build_journey(journey)
        if not package:
            print(f'[SEED] journey "{journey}" is not registered -- skipping')
            continue

        if fixed_sample is not None:
            sample_id = fixed_sample
        else:
            if ecg_cursor >= len(ecg_ids):
                print(f'[SEED] no ECG record left for "{journey}" -- skipping')
                continue
            sample_id = ecg_ids[ecg_cursor]
            ecg_cursor += 1

        recipes[journey] = package
        pattern.append({"journey": journey, "sampleId": sample_id})

    seen = {}
    for entry in pattern:
        if entry["sampleId"] in seen:
            print(f'[SEED] WARNING: "{entry["sampleId"]}" is used by both '
                  f'"{seen[entry["sampleId"]]}" and "{entry["journey"]}". '
                  f'The feed keys journeys by sampleId, so the second card '
                  f'will render BLANK. Give each tour stop its own sample.')
        seen[entry["sampleId"]] = entry["journey"]

    if not pattern:
        abort(500, description="No journeys available for the seed tour.")

    batch_stages = [s for r in recipes.values() for s in r["stages"]]
    primary = recipes[pattern[0]["journey"]]

    return render_template(
        "shorts/journey_page.html",
        journey_stages=primary["stages"],
        journey_themes=primary["globalThemes"],
        journey_rules=primary["journeyRules"],
        journey_api_endpoint=primary["api_endpoint"],
        journey_ui_shell=primary["uiShell"],
        journey_playback_config=primary["playbackConfig"],
        journey_layout=primary["layout"],
        dsp_entrypoints=dsp_store.resolve(batch_stages),
        rendering_entrypoints=rendering_store.resolve(batch_stages),
        data_source_configs=data_source_store.resolve_for_stages(batch_stages),
        shorts_batch={"recipes": recipes, "pattern": pattern},
    )


# ---------------------------------------------------------------------------
# Generic data route -- ONE route for every provider-backed source.
# Adding a data source no longer means adding a route.
# ---------------------------------------------------------------------------

@journey_bp.route('/api/data/<source_id>/<sample_id>')
def get_source_data(source_id, sample_id):
    provider = data_source_store.get_provider(source_id)
    if provider is None:
        known = ", ".join(data_source_store.list_ids())
        return jsonify({"error": f'No provider for source "{source_id}". '
                                 f'Registered: {known}'}), 404
    try:
        return jsonify(provider(sample_id))
    except FileNotFoundError:
        return jsonify({"error": f'Sample "{sample_id}" not found in '
                                 f'source "{source_id}"'}), 404
    except Exception as e:
        # A broken provider must not take the app down -- report it and
        # let the card show an error rather than the feed dying.
        print(f'[DATA] provider "{source_id}" failed for "{sample_id}": {e}')
        return jsonify({"error": str(e)}), 500


@journey_bp.route('/api/data/<source_id>/status')
def source_status(source_id):
    """Whatever the source can say about its own health. 404 if it
    offers nothing -- most sources have no lazily-built state."""
    fn = data_source_store.get_status(source_id)
    if fn is None:
        return jsonify({"error": f'source "{source_id}" reports no status'}), 404
    try:
        return jsonify(fn())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@journey_bp.route('/api/data/<source_id>/samples')
def list_source_samples(source_id):
    """
    Paginated sample list -- what the feed calls to know which cards to
    build.

    The route knows nothing about any specific source. Each source
    registers its own lister in catalog/sources.py, so adding a source
    never means editing this file. An earlier version hardcoded
    `if source_id == "aes_block"` here, which put catalog knowledge in a
    route and broke the moment the catalog moved.

    A source with no lister returns an empty list rather than a 404 --
    the feed then shows "no records" instead of failing outright.
    """
    lister = data_source_store.get_lister(source_id)
    limit  = request.args.get("limit", 10, type=int)
    offset = request.args.get("offset", 0, type=int)

    if lister is None:
        return jsonify({"samples": [], "total": 0, "offset": offset})
    try:
        return jsonify(lister(limit, offset))
    except Exception as e:
        print(f'[DATA] lister "{source_id}" failed: {e}')
        return jsonify({"error": str(e)}), 500


@journey_bp.route('/api/data/sources')
def list_sources():
    """What is registered, and what has declared a schema. Useful when a
    card renders blank and you need to know why."""
    return jsonify({
        "sources":  data_source_store.list_all(),
        "declared": schema_registry.declared(),
    })


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@journey_bp.route('/shorts/analytics', methods=['POST'])
def record_analytics():
    """
    Accepts a batch of feed events from event_collector.js.

    Batched, not per-event: one card view produces ~8 events and a request
    each would be pure overhead. The client flushes on threshold, timer,
    or page-hide via sendBeacon.

    Always returns 200, even when rows are rejected -- analytics must
    never surface as an error in the feed. Rejected rows are counted so a
    client bug is visible without breaking anything.
    """
    payload = request.get_json(silent=True) or {}
    events  = payload.get("events", [])
    if not isinstance(events, list):
        return jsonify({"accepted": 0, "rejected": 0,
                        "error": "events must be a list"}), 200
    return jsonify(analytics_store.record_batch(events)), 200


@journey_bp.route('/shorts/analytics/summary')
def analytics_summary():
    """Aggregates as JSON. For a readable view use /analytics."""
    return jsonify({
        "total_events": analytics_store.total_events(),
        "by_journey":   analytics_store.journey_performance(),
        "by_pairing":   analytics_store.pairing_performance(),
        "top_samples":  analytics_store.sample_performance(limit=20),
        "by_device":    analytics_store.device_performance(),
        "recent_hours": analytics_store.activity_by_hour(24),
    })


@journey_bp.route('/shorts/analytics/events')
def analytics_events():
    """Raw stream, newest first. ?session=<id>, ?limit=N."""
    return jsonify({
        "events": analytics_store.recent_events(
            limit=request.args.get("limit", 100, type=int),
            session_id=request.args.get("session"),
        )
    })


@journey_bp.route('/shorts/analytics/sessions')
def analytics_sessions():
    """One row per session -- when, what device, how much was watched."""
    return jsonify({
        "sessions": analytics_store.sessions(
            limit=request.args.get("limit", 30, type=int))
    })


@journey_bp.route('/analytics')
def analytics_dashboard():
    return render_template("shorts/analytics_dashboard.html")


# ---------------------------------------------------------------------------
# Contract validation -- runs once at import, after every journey is
# registered. REPORTS rather than raises: a schema mismatch should be loud
# but must not stop the app starting, or one bad recipe takes down every
# working journey with it.
# ---------------------------------------------------------------------------

def validate_all_journeys():
    all_errors = []
    for entry in journey_store.list_all_journeys():
        package = journey_store.build_journey(entry["name"])
        if not package:
            continue
        all_errors.extend(schema_registry.validate_journey(
            entry["name"], package["stages"], data_source_store))

    if all_errors:
        print("\n[SCHEMA] contract problems found:")
        for e in all_errors:
            print(f"  - {e}")
        print()
    else:
        print("[SCHEMA] all journey contracts valid")
    return all_errors


validate_all_journeys()