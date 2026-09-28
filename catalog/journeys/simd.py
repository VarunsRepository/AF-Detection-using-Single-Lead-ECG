# ---------------------------------------------------------------------------
# catalog/journeys/simd.py
#
# One SIMD instruction, taken apart.
#
# The three stages make one argument in order: WHAT it does, HOW MUCH it
# saves, and WHAT IT COSTS to get there.
#
#   1  lanes     four sums appear together, not in sequence
#   2  compare   four scalar instructions beside one vector instruction
#   3  pipeline  the packing step everyone skips when explaining this
#
# Stage 3 exists because the first two oversell it. Data has to be
# contiguous and aligned before a vector register can hold it, and when
# it is not already laid out that way the packing can cost more than the
# arithmetic it enables. A journey that stopped at stage 2 would teach
# "SIMD is 4x faster", which is not true.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_SHELL = {
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/simd_vectors/samples",
    "globalThemes": {"activeTheme": "compute",
                     "themes": [{"id": "compute",
                                 "palette": {"primary": "#5cc24a",
                                             "accent": "#5cc24a"}}]},
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top", "activeColor": "#5cc24a",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom", "description": "bottom",
               "plot": "center", "railControls": "bottom"},
}

_RAIL = [
    # Listing an algorithm in availableAlgorithms is NOT enough -- without
    # this button nothing cycles it, and the second implementation is
    # registered, loaded and unreachable.
    {"ui": {"label": "Algorithm", "icon": "icon_cycle"},
     "action": {"target": "dspEngine", "method": "switchAlgorithm", "payload": {}}},
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, view, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "simd_vectors"},
        "dspEngine": {
            # Two implementations of the same arithmetic, one tap apart.
            # The WASM one is NOT the default: its module initialises
            # asynchronously, so on a cold load the first card could
            # render before it has registered.
            "availableAlgorithms": [
                {"id": "simd_add",      "isDefault": True},
                {"id": "simd_add_wasm", "isDefault": False},
            ],
            "parameters": {},
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "simd_lanes_view", "isDefault": True}],
            "config": {"view": view},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("simd", {
    "version": 3,   # v3: Algorithm button on the rail
    "label": "Four Sums, One Instruction",
    "description": "What a SIMD instruction actually does, and what it costs",
    "status": "stable",
    "category": "compute",
    **_SHELL,
    "stages": [
        _stage("simd_lanes", "lanes",
               "Four Lanes At Once",
               "A + B, every lane together",
               "A 128-bit register holds four 32-bit values side by side. "
               "One add instruction operates on all four. Nothing crosses "
               "between lanes -- lane 2 cannot see lane 0, which is exactly "
               "why they can run at the same instant. Watch the result row: "
               "it fills all at once, never left to right.",
               8000),

        _stage("simd_compare", "compare",
               "Four Instructions, Or One",
               "The scalar path, then the vector path",
               "The same four sums done one at a time. Each scalar add is "
               "its own instruction, waiting its turn. The vector version "
               "issues once. Four instructions become one -- though that is "
               "an instruction count, not a stopwatch reading.",
               11000),

        _stage("simd_pipeline", "pipeline",
               "Getting Into The Register",
               "INPUT, SCALAR, PACK, REGISTER, ADD, RESULT",
               "The step usually left out: values must be contiguous and "
               "aligned before a vector register can hold them. When data "
               "is already laid out that way, packing is free. When it is "
               "not, gathering it can cost more than the arithmetic saved -- "
               "which is why SIMD rewards data layout more than clever "
               "instructions.",
               12000),
    ],
})
