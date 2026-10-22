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
#
#   SEED_TOUR used to live here too, and was edited thirteen times before
#   anyone noticed it was content sitting in a routes file. Tours are now
#   data in catalog/tours.py; adding one changes nothing here.
# ---------------------------------------------------------------------------

import hmac
import os

from flask import Blueprint, render_template, abort, jsonify, request

from Services.data_source_store import data_source_store
from Services.Schema_Registry   import schema_registry
from Services.analytics_store   import AnalyticsStore

# Importing the catalog is what registers everything -- sources,
# components, schemas and recipes, in that order.
from catalog import journey_store, dsp_store, rendering_store
from catalog.page_meta import meta_for
from catalog.tours import tour_store, DEFAULT_TOUR

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
        journey_name=journey_name,
        start_sample=start_sample,
        dsp_entrypoints=dsp_entrypoints,
        rendering_entrypoints=rendering_entrypoints,
        data_source_configs=data_source_configs,
        page_meta=meta_for(journey_name, f"/journey/{journey_name}"),
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
        page_meta=meta_for(None, "/shorts"),
        shorts_batch={"recipes": recipes, "pattern": pattern},
    )


# ---------------------------------------------------------------------------
# Pathway builder
# ---------------------------------------------------------------------------

@journey_bp.route('/builder/pathway')
def pathway_builder():
    """
    Author a pathway and watch it run, with no restart and no deploy.

    It loads the SAME DSPE and renderers the feed uses, so what the
    preview shows is what a card would show -- a builder with its own
    simplified view would be a different program.

    PREVIEW ONLY: nothing is saved. Persisting a model pulls in
    hot-loading, a review gate and the question of who may add content.
    Until then "copy the JSON into catalog/sources/biology.py" is a
    perfectly good publishing step, and the validation here is what makes
    that paste safe.
    """
    # Starts from a real pathway rather than an empty box: the fastest way
    # to learn the format is to edit something that already works.
    from catalog.sources.biology import PATHWAY_MODELS
    starter = PATHWAY_MODELS.get("path_tca", {}).get("pathway", {})
    return render_template("shorts/pathway_builder.html", starter=starter)


# ---------------------------------------------------------------------------
# Tours -- an ordered set of cards, shared as one link
#
# /tour/ecg      four chosen cards across four journeys, then it ends
# /seed          alias for the default tour, so old links keep working
#
# The route knows nothing about any particular tour. Adding one means
# adding a dict entry in catalog/tours.py and nothing here changes --
# the same rule that already holds for journeys and data sources.
# ---------------------------------------------------------------------------

def _build_tour(stops):
    """
    Turn a list of stops into the {recipes, pattern} the feed expects.

    Returns (recipes, pattern). An empty pattern means nothing could be
    built and the caller should 404.

    CURATED, not paginated. The normal feed draws every card's sample from
    ONE endpoint, which ties the whole feed to a single source -- fine for
    8,528 ECG records, impossible for a tour whose first card is an ECG
    recording and whose fifth is an AES block. Each pattern entry carries
    its own sampleId and the client skips pagination entirely (see
    isCurated in journey_scroll_feed.js).

    A stop whose journey or sample is unavailable is DROPPED rather than
    failing the page. A tour missing one stop is still a tour.
    """
    # Record ids per source, fetched at most once each. A tour with four
    # ECG stops needs four DIFFERENT recordings, so the cursor is per
    # source rather than per stop -- which is the whole reason /tour/ecg
    # works at all.
    pools, cursors = {}, {}

    def next_from(source_id):
        if source_id not in pools:
            lister = data_source_store.get_lister(source_id)
            ids = []
            if lister:
                try:
                    ids = [s["record_id"]
                           for s in lister(16, 0).get("samples", [])]
                except Exception as e:
                    print(f'[TOUR] could not list "{source_id}": {e}')
            pools[source_id], cursors[source_id] = ids, 0
        ids, i = pools[source_id], cursors[source_id]
        if i >= len(ids):
            return None
        cursors[source_id] = i + 1
        return ids[i]

    recipes, pattern = {}, []

    for stop in stops:
        name = stop.get("journey")
        package = journey_store.build_journey(name) if name else None
        if not package:
            print(f'[TOUR] journey "{name}" is not registered -- skipping')
            continue

        sample_id = stop.get("sample")
        if sample_id is None:
            # THE SOURCE COMES FROM THE RECIPE, never from the tour. A
            # tour that named its own source could name one the journey
            # does not use, and nothing would catch it.
            source_id = (package["stages"][0].get("dataSource", {}) or {}
                         ).get("sourceId")
            if not source_id:
                print(f'[TOUR] "{name}" stage 0 declares no sourceId '
                      f'-- skipping')
                continue
            sample_id = next_from(source_id)
            if sample_id is None:
                print(f'[TOUR] no record left in "{source_id}" for '
                      f'"{name}" -- skipping')
                continue

        recipes[name] = package
        entry = {"journey": name, "sampleId": sample_id}
        # The feed already carries this through to analytics --
        # journey_scroll_feed.js does `label: entry.label ?? null`.
        if stop.get("label"):
            entry["label"] = stop["label"]
        # Only the master tour sets this. It is the card's "more from"
        # target: with it the chip leads to /tour/<tour>, without it to
        # /journey/<journey>. The client cannot work this out for itself
        # -- a journey can belong to several tours (silicon is in both
        # "compute" and "hardware"), so a reverse lookup would be
        # guessing. The stop says where it came from instead.
        if stop.get("tour"):
            entry["tour"] = stop["tour"]
        pattern.append(entry)

    # EVERY sampleId MUST BE UNIQUE. The feed keys a running journey by
    # sampleId, so a second card with the same sample is treated as
    # already playing and never starts -- blank, with no error anywhere.
    # Two seed stops once shared aes_fips197 and card 6 silently refused
    # to load. This turns that into a log line instead of a mystery.
    #
    # Checked HERE as well as at import because lister-drawn samples are
    # not known until now.
    seen = {}
    for entry in pattern:
        sid = entry["sampleId"]
        if sid in seen:
            print(f'[TOUR] WARNING: "{sid}" is used by both "{seen[sid]}" '
                  f'and "{entry["journey"]}". The feed keys journeys by '
                  f'sampleId, so the second card will render BLANK. Give '
                  f'each stop its own sample.')
        seen[sid] = entry["journey"]

    return recipes, pattern


def _tour_meta(tour_name, spec):
    """
    Link preview for a tour.

    A tour is BUILT to be shared, so falling back to the generic site
    card would be the one place a wrong preview actually costs
    something. The tour already declares a label and a description, and
    that is exactly what a preview needs -- no second source of truth.

    Starts from meta_for() so the url and the default image are built by
    the same code every other page uses, then overrides what the tour
    knows better. Set "image" on a tour (a full URL) to give it a card of
    its own.
    """
    meta = dict(meta_for(None, f"/tour/{tour_name}"))
    if spec.get("label"):
        meta["title"] = f'{spec["label"]} — Kymograph'
    if spec.get("description"):
        meta["description"] = spec["description"]
    if spec.get("image"):
        meta["image"] = spec["image"]
    return meta


def _render_tour(recipes, pattern, tour_name=None, page_meta=None):
    """Template variables that assume a single journey come from the
    first stop; the feed engine overrides them per card."""
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
        tour_name=tour_name,
        page_meta=page_meta,
        dsp_entrypoints=dsp_store.resolve(batch_stages),
        rendering_entrypoints=rendering_store.resolve(batch_stages),
        data_source_configs=data_source_store.resolve_for_stages(batch_stages),
        shorts_batch={"recipes": recipes, "pattern": pattern},
    )


@journey_bp.route('/tour/<tour_name>')
def tour(tour_name):
    spec = tour_store.get(tour_name)
    if spec is None:
        known = ", ".join(tour_store.names())
        abort(404, description=f'No tour "{tour_name}". Available: {known}')

    recipes, pattern = _build_tour(spec["stops"])
    if not pattern:
        abort(500, description=f'No journeys available for tour "{tour_name}".')
    return _render_tour(recipes, pattern, tour_name,
                        page_meta=_tour_meta(tour_name, spec))


@journey_bp.route('/seed')
def seed_feed():
    """The original curated tour. Kept as an alias so links that have
    already been shared keep working -- /tour/seed is the same page."""
    return tour(DEFAULT_TOUR)


@journey_bp.route('/api/tours')
def list_tours():
    """What tours exist. Useful for a future index page, and for checking
    a tour registered at all without loading the feed."""
    return jsonify({"tours": tour_store.list_all(),
                    "default": DEFAULT_TOUR})


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
# Writes -- ONE route for every writable source, exactly as
# /api/data/<source>/<id> is one route for every readable one. A source
# becomes writable by registering a saver, not by anyone adding a route.
#
# THE GATE
#
#   Reads stay public. Writes do not. Gating the feed would mean logging
#   in on every incognito window and every phone, for no safety gained,
#   since the feed is public content anyway.
#
#   The check below is a shared token from the environment. That is NOT
#   identity -- it cannot tell John from Ashlinda, and everyone who has it
#   is the same person as far as the server is concerned. It is a lock on
#   the door while the building is still empty, and it is honest about
#   being that.
#
#   When real auth arrives, `_author()` is the only function that changes:
#   it starts returning a user id from the session instead of a constant.
#   Every caller already treats its return value as "who is writing this".
# ---------------------------------------------------------------------------

def _author() -> str | None:
    """
    Who is writing. None means "not allowed to".

    Swap point. Today: a shared token. Tomorrow:

        from flask_login import current_user
        return current_user.get_id() if current_user.is_authenticated else None

    Nothing else in the save path needs to know which of those it is.
    """
    expected = os.environ.get("BUILDER_TOKEN", "")
    if not expected:
        # No token configured. Allow writes only from the machine the app
        # is running on, so a fresh clone works on a laptop without
        # ceremony and a deployed instance is not silently wide open.
        return "local" if request.remote_addr in ("127.0.0.1", "::1") else None

    sent = (request.headers.get("X-Builder-Token")
            or (request.get_json(silent=True) or {}).get("token")
            or "")
    # Constant time: a plain == leaks the token one character at a time to
    # anyone willing to measure.
    return "builder" if hmac.compare_digest(sent, expected) else None


@journey_bp.route("/api/data/<source_id>/save", methods=["POST"])
def save_sample(source_id):
    """
    POST {"model": {...}, "id": "...", "overwrite": false}
      201 saved (new)       200 saved (overwrote)
      400 validation failed -- errors[] says what, in the author's terms
      401 no write permission
      405 source exists but is read-only
      404 no such source
    """
    if data_source_store.get(source_id) is None:
        return jsonify({"ok": False, "errors": [f'no source "{source_id}"']}), 404

    saver = data_source_store.get_saver(source_id)
    if saver is None:
        return jsonify({"ok": False,
                        "errors": [f'"{source_id}" does not accept writes']}), 405

    author = _author()
    if author is None:
        return jsonify({"ok": False, "errors": ["not permitted to save"]}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "errors": ["body must be a JSON object"]}), 400

    # A model big enough to be a denial-of-service is not a model anyone
    # authored by hand. Cheap ceiling, checked before any parsing work.
    if request.content_length and request.content_length > 512 * 1024:
        return jsonify({"ok": False, "errors": ["model too large"]}), 400

    result = saver(payload, author)
    if not result.get("ok"):
        return jsonify(result), 400
    return jsonify(result), 201 if result.get("created") else 200


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
