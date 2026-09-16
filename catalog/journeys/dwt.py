# ---------------------------------------------------------------------------
# catalog/journeys/dwt.py
#
# Daubechies-4 wavelet decomposition.
#
# Pure recipe data. A recipe names a sourceId, an algoId and a
# rendererId -- never a URL, a file path or a sample. Adding a journey
# means adding a file here and a line in catalog/__init__.py.
# ---------------------------------------------------------------------------

# journey_store is created in catalog/__init__.py before this module is
# imported, so importing the MODULE (not the name) avoids a circular
# import during package initialisation.
import catalog

journey_store = catalog.journey_store

journey_store.register_journey("dwt", {
    "version": 2,  # bump this whenever the recipe changes
    "label": "Wavelet Decomposition",
    "description": "Daubechies-4 multi-resolution analysis of real ECG signals.",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "experimental",
    "category": "wavelet_analysis",
    "feedback_score": 0,
    "globalThemes": {
        "activeTheme": "clinical_dark",
        "themes": [
            {"id": "clinical_dark", "palette": {"primary": "#00FF66", "accent": "#FF3366", "secondary": "#00E5FF"}},
        ],
    },
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True, "preloadNextStage": True},
    "uiShell": {
        "showProgressBar": True,
        "progressBar": {
            "position": "top",
            "activeColor": "globalThemes.activeTheme.palette.primary",
            "inactiveColor": "rgba(255,255,255,0.2)",
        },
    },
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "description": "bottom", "plot": "center", "caption": "bottom"},
    "stages": [
        {
            "stageId": "stage_01_raw_signal",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "passthrough", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1_canvas", "isDefault": True}, {"id": "chart_v1_webgl", "isDefault": False}, {"id": "chart_v1", "isDefault": False}],
                "config": {},
            },
            "uiFillers": {"title": "Raw Signal", "caption": "The original ECG recording."},
            "railControls": [
                {"ui": {"label": "Renderer", "icon": "icon_renderer"}, "action": {"target": "renderingEngine", "method": "switchRenderer", "payload": {}}},
                {"ui": {"label": "Speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
        },
        {
            "stageId": "stage_02_db4_decomposition",
            "baseDurationMs": 9000,
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},  # re-fetches the raw signal directly -- this stage needs it, not Stage 1's passthrough output
            "dspEngine": {
                "availableAlgorithms": [{"id": "db4_wavelet", "isDefault": True}],
                "parameters": {"levels": 6},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "dwt_comparison_view", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Daubechies-4 Decomposition",
                "caption": "Toggle any combination of levels on to compare them side by side.",
            },
            "railControls": [],
        },
    ],
})

# ---------------------------------------------------------------------------
# TEST JOURNEYS -- 4 configurations for isolated testing
#
# Configuration matrix:
#   real_dsp  + real_renderer  → /journey/ecg or /journey/dwt (production)
#   null_dsp  + real_renderer  → /journey/test_null_dsp
#   real_dsp  + null_renderer  → /journey/test_null_renderer
#   null_dsp  + null_renderer  → /journey/test_null_both
#
# All 3 test journeys use the same ECG samples (/shorts/api/samples) so
# real signal data still flows through -- only the processing/rendering
# layer changes. This isolates each layer independently.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# TEST 1: null_dsp + real_renderer (chart_v1)
# Use: verify chart_v1 renders correctly before any DSP is built.
#      Raw unprocessed ECG signal rendered as a sweep, no peak markers.
#      If the chart looks wrong, the bug is in the renderer or data source,
#      not in any DSP algorithm.
# ---------------------------------------------------------------------------
