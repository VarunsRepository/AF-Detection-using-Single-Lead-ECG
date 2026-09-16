"""
ECG data API for the Shorts feed.

PURE DATA LAYER -- this blueprint serves no pages.

  GET /shorts/api/samples              paginated sample list + total
  GET /shorts/api/sample/<id>/raw      raw signal for one record

Page routes all live in journey_bp, which reads a recipe from
journey_store and renders it through the single generic template. That is
the architecture: ONE page route serving N journeys from recipes, and one
blueprint per DATA SOURCE.

Data_Source_Store points at the endpoints above:

    data_source_store.register("ecg_single",
        endpoint_template="/shorts/api/sample/{id}/raw", ...)

so renaming them means updating that registration too.

REMOVED: `@shorts_bp.route("/")` rendering shorts_feed.html -- the
pre-recipe ECG page, superseded by /journey/ecg. Its presence also made
`/shorts/` (trailing slash) resolve here instead of to journey_bp's mixed
batch at `/shorts`, which cost real debugging time.
"""

from flask import Blueprint, jsonify, request
from Services.physionet_Init import PhysioNetRegistryManager


# No custom static_folder/static_url_path -- reuses the app's shared
# static folder. Registered in app.py with url_prefix="/shorts".
shorts_bp = Blueprint("shorts", __name__)


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
##    limit = request.args.get("limit", type=int)
#    return jsonify({"samples": registry.list_playable_records_with_labels(limit=limit)})
 

@shorts_bp.route("/api/samples")
def list_samples():
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", default=0, type=int)
    samples = registry.list_playable_records_with_labels(limit=limit, offset=offset)
    return jsonify({
        "samples": samples,
        "total": registry.count_playable_records(),
        "offset": offset,
    })
