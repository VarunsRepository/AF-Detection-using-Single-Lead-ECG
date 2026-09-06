from flask import Blueprint, render_template, abort
from Services.Journey_Store import JourneyStore

journey_store = JourneyStore(cache_dir="data_cache")

# Safe to call every time the app starts -- register_journey() skips
# silently if the journey already exists (loaded from a previous run),
# so this won't wipe out any accumulated feedback_score on restart.
journey_store.register_journey("ecg", {
    "label": "AFib Detection",
    "description": "Peak detection and HRV analysis on real ECG recordings.",
    "template": "shorts/shorts_feed.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "production",
    "category": "afib",
    "feedback_score": 0,
    "stages": [
        {"block": "raw_signal", "dependsOn": None},
        {"block": "baseline_correction", "dependsOn": 0},
        {"block": "peak_detection", "dependsOn": 1},
        {"block": "hrv_metrics", "dependsOn": 2},
        {"block": "verdict", "dependsOn": 3},
    ],
})

journey_store.register_journey("dwt", {
    "label": "Wavelet Decomposition",
    "description": "Multi-resolution DWT analysis of real ECG signals.",
    "template": "shorts/dwt_journey.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "experimental",
    "category": "wavelet_analysis",
    "feedback_score": 0,
    "stages": [
        {"block": "raw_signal", "dependsOn": None},
        {"block": "dwt_decomposition", "dependsOn": 0},
    ],
})

journey_bp = Blueprint('journey', __name__)


@journey_bp.route('/journey/<journey_name>')
def journey(journey_name):
    try:
        package = journey_store.build_journey(journey_name)
    except ValueError as e:
        abort(500, description=str(e))
    if not package:
        abort(404)
    return render_template(package["template"], journey_recipe=package["recipe"])