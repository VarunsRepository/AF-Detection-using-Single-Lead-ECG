"""
Blueprint for the ECG Shorts feed.

Currently minimal on purpose: the feed still runs on client-generated
synthetic waveforms (see generateSyntheticEcg in shorts_feed.js), so there's
no real data layer to wire up yet. This blueprint's only job right now is
serving the page shell, same as statistical_analytics_bp serves its
dashboard shell.

The commented-out section at the bottom marks exactly where a real
/api/shorts/next endpoint (backed by a future EcgShortsStore, following the
same Store/Manager pattern as SpectralBandStore) will attach once actual
sample data replaces the synthetic placeholder.
"""

from flask import Blueprint, render_template, jsonify
from Services.physionet_Init import PhysioNetRegistryManager


# No custom static_folder/static_url_path here -- this reuses your app's
# existing shared static folder (just a "shorts" subfolder inside it),
# so nothing about your current static file setup needs to change.
shorts_bp = Blueprint(
    "shorts",
    __name__,
    template_folder="../templates/shorts",
)
 


@shorts_bp.route("/")
def feed_page():
    return render_template("shorts_feed.html")

 

registry = PhysioNetRegistryManager(cache_dir="data_cache/training2017")
registry.initialize_registry()  


HARDCODED_FS = 300  # TODO: get_individual_record_wfdb() only returns the
                     # signal array, discarding wfdb.rdsamp()'s `fields`
                     # (where fs actually lives). Hardcoded until that
                     # method is extended to return fs alongside the signal.


@shorts_bp.route("/api/sample/<sample_id>/raw")
def get_raw_signal(sample_id):
    try:
        signal = registry.get_individual_record_wfdb(sample_id)
    except FileNotFoundError:
        return jsonify({"error": f"Sample '{sample_id}' not found"}), 404
    except IOError as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "sample_id": sample_id,
        "signal": signal.tolist(),
        "fs": HARDCODED_FS,  # <-- see below, this is the one real gap
    })


#@shorts_bp.route("/api/samples")
#def list_samples():
#    from flask import request
#    limit = request.args.get("limit", type=int)
#    return jsonify({"samples": registry.list_playable_records_with_labels(limit=limit)})
 

@shorts_bp.route("/api/samples")
def list_samples():
    from flask import request
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", default=0, type=int)
    samples = registry.list_playable_records_with_labels(limit=limit, offset=offset)
    return jsonify({
        "samples": samples,
        "total": registry.count_playable_records(),
        "offset": offset,
    })
 
 
#@shorts_bp.route("/api/sample/<sample_id>/raw")
#def get_raw_signal(sample_id):
#    try:
#        signal = registry.get_individual_record_wfdb(sample_id)
#    except FileNotFoundError:
#        return jsonify({"error": f"Sample '{sample_id}' not found"}), 404
#    except IOError as e:
#        return jsonify({"error": str(e)}), 500
# 
#    return jsonify({
#        "sample_id": sample_id,
#        "signal": signal.tolist(),
#        "fs": HARDCODED_FS,
#    })

 

# ---------------------------------------------------------------------------
# FUTURE: once real sample data is wired in, routes like this attach here --
# mirroring how /api/plot/raw-bands and /api/plot/pcatsne sit inside
# statistical_analytics_bp, delegating to SpectralBandStoreManager.
#
# from Services.Ecg_Shorts_Store import EcgShortsStore
# shorts_store = EcgShortsStore(...)
#
# @shorts_bp.route("/api/shorts/next")
# def next_sample():
#     seen = request.args.get("seen", "")
#     seen_ids = [s for s in seen.split(",") if s]
#     sample = shorts_store.get_next_unseen(seen_ids)
#     if sample is None:
#         return jsonify({"error": "No more samples"}), 404
#     return jsonify(sample)
# ---------------------------------------------------------------------------
