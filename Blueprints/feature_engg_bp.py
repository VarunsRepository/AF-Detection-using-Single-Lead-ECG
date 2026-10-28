# ---------------------------------------------------------------------------
# Blueprints/feature_engg_bp.py
#
# The single-sample ECG analysis API -- everything /lab calls to do its
# work. Seven JSON endpoints and nothing else.
#
# WHY THESE LEFT app.py
#   Every other blueprint already lived in Blueprints/; this one was
#   declared and populated inline, so app.py was ~200 lines of routes
#   wearing a composition root's name. Same split the catalog made for
#   the same reason: routes stay generic, content lives elsewhere.
#
# WHY THE PAGE IS NOT HERE
#   index.html used to be served from this blueprint's root, which put a
#   page inside an API namespace -- /api/v1/splunk/ returning HTML. The
#   page now lives in lab_bp at /lab. This file is the API it talks to,
#   and the two are separate concerns that only ever looked related
#   because they shared a prefix.
#
# THE MANAGERS ARE CREATED HERE, ONCE
#   physionet_mgr and ECG_Features hold live in-RAM state -- the feature
#   cache and the rubber stamps. Two instances would mean save-stat
#   writing to one and get-stat reading from the other, which presents
#   as a caching bug and is not one. So they are module-level singletons
#   in exactly one place, and anything else that needs them imports them
#   from here rather than constructing its own. This is the same rule
#   data_source_store states for itself:
#
#       "Previously each blueprint built its own, so a source registered
#        in one was invisible to the other."
# ---------------------------------------------------------------------------

from flask import Blueprint, jsonify, request, redirect

# Dataset labels. PhysioNet keeps the labels for all 8.5K recordings in
# separate files; this crawls them once and caches locally.
from Services.physionet_Init import PhysioNetRegistryManager

# Pre-computed statistical RR-analytics features (HRV, VIX, pNN50 ...).
from Services.ECG_Feature_Manager import ECG_Signal_Feature_Manager

# The main pipeline, called whenever any control on /lab changes.
from Engine.Engine import run_ecg_pipeline, get_dropdown_options


feature_engg_bp = Blueprint('features', __name__)


# ── The shared instances ─────────────────────────────────────────────────
# initialize_registry() runs at import, exactly as it did in app.py, so
# the startup behaviour is unchanged by the move. It is a network crawl:
# if it ever needs to become lazy, that is a deliberate change with its
# own reasoning, not a side effect of moving a file.
physionet_mgr = PhysioNetRegistryManager(cache_dir="data_cache/training2017")
physionet_mgr.initialize_registry()

ECG_Features = ECG_Signal_Feature_Manager(cache_dir="data_cache/FeatureStore")


# ── Legacy root ──────────────────────────────────────────────────────────
# This used to serve index.html. Kept as a permanent redirect so anything
# already bookmarked still arrives somewhere sensible; 301 rather than
# 302 because the page is not coming back to this namespace.
@feature_engg_bp.route('/')
def splunk_root():
    return redirect('/lab', code=301)


# ── Registry and options ─────────────────────────────────────────────────

# Populates the algorithm dropdown in the view.
@feature_engg_bp.route('/peak_detection_algorithms', methods=['GET'])
def fetch_algorithms():
    # Gets ['Pan Tompkins Native', 'Pan Tompkins nk2', etc ]
    algo_list = get_dropdown_options()
    return jsonify(algo_list)


@feature_engg_bp.route('/registry', methods=['GET'])
def get_registry_slice():
    """
    Returns lists of matching sample IDs based on a requested target class
    """
    target_class = request.args.get('class', 'N').upper()
    print(f"\n[BACKEND] Frontend requested recordings for class: '{target_class}'")

    # Safely query live cache from our global class object instance
    live_cache = physionet_mgr.get_registry()
    print(f"[BACKEND] Current registry keys available: {list(live_cache.keys())}")

    if target_class not in live_cache:
        print(f"[BACKEND] ERROR: '{target_class}' not found in registry cache keys.")
        return jsonify({"error": "Invalid class. Choose N, A, O, or ~"}), 400

    # Extract the matching samples using the dedicated class accessor method
    samples_list = physionet_mgr.get_records_by_class(target_class)

    print(f"[BACKEND] Great Success! Found {len(samples_list)} records for class '{target_class}'")
    print(f"[BACKEND] First 5 samples being sent: {samples_list[:5]}")

    return jsonify({
        "class": target_class,
        "count": len(samples_list),
        "samples": samples_list
    })


# ── The pipeline ─────────────────────────────────────────────────────────

# Goes to the PhysioNet site and fetches the actual recording.
@feature_engg_bp.route('/stream')
def stream_ecg():

    record_id = request.args.get('record', 'A01000')

    # 1. Consolidate Toggle State Parameters
    config = {
        'record_id'                   : record_id,
        'enable_filter'               : request.args.get('filter', 'false').lower() == 'true',
        'enable_local_r'              : request.args.get('local_r', 'false').lower() == 'true',
        'enable_pan'                  : request.args.get('pan_tompkins', 'false').lower() == 'true',
        'enable_poincare'             : request.args.get('poincare', 'false').lower() == 'true',
        'enable_fft'                  : request.args.get('fft', 'false').lower() == 'true',
        'enable_cancel'               : request.args.get('cancel', 'false').lower() == 'true',
        'use_wavelet'                 : request.args.get('wavelet', 'false').lower() == 'true',
        'timeline_scale'              : request.args.get('scale', 'short').lower(),
        'force_manual_flip'           : request.args.get('manual_flip', 'false').lower() == 'true',
        'peak_detection_method'       : request.args.get('peak_detection_method', 'false').lower(),
        'stacked_beats'               : request.args.get('StackedBeats', 'false').lower() == 'true',
        'Stacked_Beats_On_Beats'      : request.args.get('StackedBeatsOnBeats', 'false').lower() == 'true',
        'Stacked_n_RR_Beats'          : request.args.get('Stacked_n_RR_Beats', 'false').lower() == 'true',
        'VIX_Beats'                   : request.args.get('VIX_Beats', 'false').lower() == 'true',
        'Stacked_Wavelets_On_Wavelets': request.args.get('StackedWaveletsOnWavelets', 'false').lower() == 'true',
    }

    try:
        # get_individual_record_wfdb() reads the ECG recording the old
        # legacy way.
        signal_values = physionet_mgr.get_individual_record_wfdb(record_id)

        # Direct downstream vector payload execution to pipeline engine
        result_payload = run_ecg_pipeline(signal_values, config)

        # Return serialized dictionary directly to UI graph modules
        return jsonify(result_payload), 200

    except Exception as e:
        print(f"[API ERROR] Pipeline processing crash for record {record_id}: {e}")
        return jsonify({"error": str(e)}), 500


# ── The feature cache ────────────────────────────────────────────────────

# Checks whether the current config for this signal is already in the
# store. If it is, the UI updates from the cache instead of re-running
# the pNN50 or VIX maths from scratch.
#
# LEADING SLASH ADDED. It was 'get-stat', which Flask joins to the same
# URL -- prefix.rstrip("/") + "/" + rule.lstrip("/") -- so this is a
# cosmetic fix with no behaviour change. It mattered only in that it was
# the one route that would have broken if the prefix were ever removed.
@feature_engg_bp.route('/get-stat', methods=['GET'])
def get_statistic():
    record_id = request.args.get('record_id')
    stat_name = request.args.get('stat_name')
    version = request.args.get('version')

    # query the Feature from the ECG_Feature_Manager object
    metric_data = ECG_Features.get_metric(record_id, stat_name, version)

    if metric_data:
        return jsonify({"cached": True, "data": metric_data})
    return jsonify({"cached": False, "message": "Computation required."})


# Saves the current config for a given sample into the store -- whichever
# config is selected (small- or full-signal, orientation-corrected or
# original). The first read of a record with a given config has to
# compute the metric; this is where it is kept.
@feature_engg_bp.route('/save-stat', methods=['POST'])
def save_statistic():
    payload = request.json

    # saving the feature into the object
    ECG_Features.update_metric(
        record_id=payload["record_id"],
        stat_name=payload["statistic_name"],
        value=payload["value"],
        version=payload["version"],
        timestamp=payload.get("last_calculated", "2026-07-19T00:00:00Z")
    )

    return jsonify({"status": "Great Success",
                    "message": "RAM state updated. Background persistence active."})


# ── Verification stamps ──────────────────────────────────────────────────

# THE READER ROUTE (GET)
@feature_engg_bp.route('/get-record-meta', methods=['GET'])
def get_record_meta():
    # Readers pass parameters via URL/Query string: ?record_id=123
    record_id = request.args.get('record_id')

    if not record_id:
        return jsonify({"status": "Failed", "error": "Missing record_id"}), 400

    stamp_info = ECG_Features.get_rubber_stamp_config(record_id)

    if stamp_info:
        return jsonify({"status": "Success", **stamp_info})

    return jsonify({"status": "Success",
                    "record_id": record_id,
                    "is_verified": False})


# THE WRITER ROUTE (POST)
@feature_engg_bp.route('/rubber-stamp-record', methods=['POST'])
def rubber_stamp_record():
    # Writers pass parameters via JSON Body
    data = request.get_json() or {}
    record_id = data.get('record_id')
    verified_signature = data.get('verified_signature')

    if not record_id or not verified_signature:
        return jsonify({"status": "Failed", "error": "Missing parameters"}), 400

    # Execute the write and disk save
    ECG_Features.rubber_stamp_record_config(record_id, verified_signature)

    return jsonify({"status": "Success", "message": f"Config locked for {record_id}"})
