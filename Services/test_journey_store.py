"""
Quick test for JourneyStore -- run directly with:
    python3 test_journey_store.py

No Flask, no browser needed -- just proves the store correctly accepts a
valid recipe and correctly rejects a broken one.
"""

from Services.journey_store import JourneyStore

store = JourneyStore(cache_dir="data_cache_test")

# Your real 2-stage recipe (Pan-Tompkins -> Poincare)
good_recipe = {
    "label": "AFib Detection",
    "template": "shorts/shorts_feed.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "production",
    "category": "afib",
    "feedback_score": 0,
    "stages": [
        {
            "stageId": "stage_01_peak_detection",
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {"availableAlgorithms": [{"id": "pan_tompkins", "isDefault": True}]},
            "renderingEngine": {"availableRenderers": [{"id": "chart_v1", "isDefault": True}]},
            "uiFillers": {"title": "Finding Each Beat"},
            "stageOutput": {"exportKey": "stage_01_processed_data", "exportedFields": ["rrIntervalsMs", "peakIndices"]},
        },
        {
            "stageId": "stage_02_poincare_plot",
            "dataSource": {
                "mode": "PREVIOUS_STAGE_PIPELINE",
                "stageId": "stage_01_peak_detection",
                "outputKey": "stage_01_processed_data",
                "consumedField": "rrIntervalsMs",
            },
            "dspEngine": {"availableAlgorithms": [{"id": "poincare_standard", "isDefault": True}]},
            "renderingEngine": {"availableRenderers": [{"id": "scatter_density", "isDefault": True}]},
            "uiFillers": {"title": "HRV Poincare Plot"},
        },
    ],
}

print("=== Registering and building the VALID recipe ===")
store.register_journey("ecg_test", good_recipe)
package = store.build_journey("ecg_test")
print("Success:", package is not None)

print()
print("=== Deliberately breaking it: typo in consumedField ===")
broken_recipe = {**good_recipe}
broken_recipe["stages"] = [
    good_recipe["stages"][0],
    {**good_recipe["stages"][1], "dataSource": {**good_recipe["stages"][1]["dataSource"], "consumedField": "rrIntervalzz"}},
]
store.register_journey("ecg_broken_test", broken_recipe)
try:
    store.build_journey("ecg_broken_test")
    print("PROBLEM: should have raised an error, did not!")
except ValueError as e:
    print("Correctly rejected:", e)
