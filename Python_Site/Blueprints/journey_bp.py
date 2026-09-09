from flask import Blueprint, render_template, abort
from Services.Journey_Store import JourneyStore
from Services.dsp_store import DspAlgorithmStore
from Services.rendering_store import RenderingStore

journey_store = JourneyStore(cache_dir="data_cache/JourneyStore")
 
# ---------------------------------------------------------------------------
# DSP algorithm registry -- server side.
# Maps algorithm IDs to the static JS file the browser needs to load.
# Only registered algorithms can be used in recipes. The resolve() call
# per request returns ONLY the files a specific journey actually needs.
# ---------------------------------------------------------------------------
dsp_store = DspAlgorithmStore()
dsp_store.register("pan_tompkins",
    entrypoint="/static/shorts/filters/pan_tompkins_filter.js",
    label="Pan-Tompkins", description="Real-time ECG peak detection")
dsp_store.register("hamilton_tompkins",
    entrypoint="/static/shorts/filters/hamilton_tompkins_filter.js",
    label="Hamilton-Tompkins", description="Alternative ECG peak detection")
dsp_store.register("db4_wavelet",
    entrypoint="/static/shorts/filters/db4_filter.js",
    label="DB4 Wavelet", description="Daubechies-4 multi-level decomposition")
dsp_store.register("poincare_standard",
    entrypoint="/static/shorts/filters/math_algorithms.js",
    label="Poincaré", description="RR-interval HRV scatter analysis")
dsp_store.register("passthrough",
    entrypoint="/static/shorts/filters/math_algorithms.js",
    label="Passthrough", description="Raw signal, no DSP")
dsp_store.register("null_dsp",
    entrypoint="/static/shorts/filters/null_dsp.js",
    label="Null DSP", description="Testing stub -- raw signal passthrough, output matches chart_v1 input contract")

# ---------------------------------------------------------------------------
# Rendering registry -- server side.
# Maps renderer IDs to the static JS file the browser needs to load.
# ---------------------------------------------------------------------------
rendering_store = RenderingStore()
rendering_store.register("chart_v1",
    entrypoint="/static/shorts/renderers/chart_v1.js",
    label="ECG Sweep", description="Progressively-revealed waveform with peak markers")
rendering_store.register("scatter_density",
    entrypoint="/static/shorts/renderers/scatter_density.js",
    label="Scatter Density", description="Poincaré scatter plot with progressive reveal")
rendering_store.register("dwt_comparison_view",
    entrypoint="/static/shorts/renderers/dwt_comparison_view.js",
    label="DWT Comparison", description="Multi-level toggle stack for wavelet decomposition")
rendering_store.register("rr_tachogram",
    entrypoint="/static/shorts/renderers/rr_tachogram.js",
    label="RR Tachogram", description="Beat-to-beat RR interval time series, progressive reveal")
rendering_store.register("null_renderer",
    entrypoint="/static/shorts/renderers/null_renderer.js",
    label="Null Renderer", description="Testing stub -- dumps DSP finalOutput as formatted JSON, accepts any input shape")

# Safe to call every time the app starts -- register_journey() skips
# silently if the journey already exists (loaded from a previous run),
# so this won't wipe out any accumulated feedback_score on restart.
#
# Uses the REAL dataSource/dspEngine/renderingEngine schema now -- the
# old {block, dependsOn} shape is retired. Two stages, both proven
# working end-to-end: Pan-Tompkins peak detection into a Poincare plot.
journey_store.register_journey("ecg", {
    "label": "AFib Detection",
    "description": "Peak detection and HRV analysis on real ECG recordings.",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "production",
    "category": "afib",
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
            "stageId": "stage_01_peak_detection",
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins", "isDefault": True},
                    {"id": "hamilton_tompkins", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Finding Each Beat",
                "caption": "Peaks are the topmost points in an ECG representing cardiac contraction.",
                "description": "Uses whichever algorithm is currently selected -- try switching between Pan-Tompkins and Hamilton-Tompkins to compare.",
            },
            "railControls": [
                {"ui": {"label": "Invert", "icon": "icon_flip_vertical"}, "action": {"target": "dspEngine", "method": "setParameter", "payload": {"key": "invertSignal", "operation": "toggle"}}},
                {"ui": {"label": "Algorithm", "icon": "icon_cycle"}, "action": {"target": "dspEngine", "method": "switchAlgorithm", "payload": {}}},
                {"ui": {"label": "Speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "stageOutput": {"exportKey": "stage_01_processed_data", "exportedFields": ["rrIntervalsMs", "peakIndices"]},
        },
        {
            "stageId": "stage_02_poincare_plot",
            "baseDurationMs": 8000,
            "dataSource": {
                "mode": "PREVIOUS_STAGE_PIPELINE",
                "stageId": "stage_01_peak_detection",
                "outputKey": "stage_01_processed_data",
                "consumedField": "rrIntervalsMs",
            },
            "dspEngine": {
                "availableAlgorithms": [{"id": "poincare_standard", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "scatter_density", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "HRV Poincare Plot",
                "caption": "The width (SD1) and length (SD2) of the cloud reflect short- and long-term heart rate variability.",
            },
            "railControls": [
                {"ui": {"label": "Speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
        },
        {
            "stageId": "stage_03_rr_tachogram",
            "dataSource": {
                "mode": "PREVIOUS_STAGE_PIPELINE",
                "stageId": "stage_01_peak_detection",
                "outputKey": "stage_01_processed_data",
                "consumedField": "rrIntervalsMs",
            },
            "dspEngine": {
                "availableAlgorithms": [{"id": "passthrough", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "rr_tachogram", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "RR Tachogram",
                "caption": "Each point is one heartbeat. Shorter intervals = faster heart rate.",
                "description": "Trends, ectopic beats and arrhythmias appear as sudden vertical shifts in the line.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 8000,
        },
    ],
})

# NOTE: "dwt" was previously excluded here since its recipe used the old
# {block, dependsOn} shape. Now migrated to the real schema, using the
# verified db4_wavelet DSP engine and dwt_comparison_view renderer.
journey_store.register_journey("dwt", {
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
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "passthrough", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {"title": "Raw Signal", "caption": "The original ECG recording."},
            "railControls": [
                {"ui": {"label": "Speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
        },
        {
            "stageId": "stage_02_db4_decomposition",
            "baseDurationMs": 9000,
            "dataSource": {"mode": "HTTP_REST"},  # re-fetches the raw signal directly -- this stage needs it, not Stage 1's passthrough output
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
_SHARED_TEST_THEME = {
    "activeTheme": "test",
    "themes": [{"id": "test", "palette": {"primary": "#00FF66", "accent": "#FF3366"}}],
}
_SHARED_TEST_RULES = {"allowStageNavigation": True, "autoAdvance": False, "preloadNextStage": False}
_SHARED_TEST_SHELL = {"showProgressBar": True, "progressBar": {"position": "top", "activeColor": "rgba(255,165,0,0.8)", "inactiveColor": "rgba(255,255,255,0.2)"}}
_SHARED_TEST_LAYOUT = {"title": "bottom", "description": "bottom", "plot": "center", "caption": "bottom"}

journey_store.register_journey("test_null_dsp", {
    "label": "Test: Null DSP + Real Renderer",
    "description": "Raw signal passed through to chart_v1 unprocessed. Tests rendering pipeline in isolation.",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "test",
    "category": "test",
    "feedback_score": 0,
    "globalThemes": _SHARED_TEST_THEME,
    "journeyRules": _SHARED_TEST_RULES,
    "uiShell": _SHARED_TEST_SHELL,
    "playbackConfig": {"isPaused": False},
    "layout": _SHARED_TEST_LAYOUT,
    "stages": [
        {
            "stageId": "test_null_dsp_stage",
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "null_dsp", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Null DSP + Real Renderer",
                "caption": "Raw signal, no processing. No peaks. Tests chart_v1 in isolation.",
                "description": "null_dsp passes raw signal through unchanged. chart_v1 renders it as a sweep. If this looks wrong, the bug is in the renderer or data source -- not in any DSP algorithm.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 8000,
        },
    ],
})

# ---------------------------------------------------------------------------
# TEST 2: real_dsp (pan_tompkins) + null_renderer
# Use: inspect exactly what pan_tompkins produces before building or
#      debugging a renderer. null_renderer dumps finalOutput + interimOutputs
#      as formatted JSON directly in the card.
# ---------------------------------------------------------------------------
journey_store.register_journey("test_null_renderer", {
    "label": "Test: Real DSP + Null Renderer",
    "description": "Pan-Tompkins runs fully, output dumped as JSON. Tests DSP in isolation.",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "test",
    "category": "test",
    "feedback_score": 0,
    "globalThemes": _SHARED_TEST_THEME,
    "journeyRules": _SHARED_TEST_RULES,
    "uiShell": _SHARED_TEST_SHELL,
    "playbackConfig": {"isPaused": False},
    "layout": _SHARED_TEST_LAYOUT,
    "stages": [
        {
            "stageId": "test_null_renderer_stage",
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins",      "isDefault": True},
                    {"id": "hamilton_tompkins", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "null_renderer", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Real DSP + Null Renderer",
                "caption": "Pan-Tompkins output dumped as JSON. Tests DSP correctness.",
                "description": "Pan-Tompkins runs fully. null_renderer shows finalOutput fields and interimOutputs. If peak indices look wrong, the bug is in the DSP algorithm -- not in any renderer.",
            },
            "railControls": [
                {"ui": {"label": "Algorithm", "icon": "icon_cycle"}, "action": {"target": "dspEngine", "method": "switchAlgorithm", "payload": {}}},
                {"ui": {"label": "Invert", "icon": "icon_flip_vertical"}, "action": {"target": "dspEngine", "method": "setParameter", "payload": {"key": "invertSignal", "operation": "toggle"}}},
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
            ],
            "baseDurationMs": 8000,
        },
    ],
})

# ---------------------------------------------------------------------------
# TEST 3: null_dsp + null_renderer
# Use: test ONLY the feed engine mechanics -- pagination, lazy loading,
#      scroll snapping, tap zones, progress bar, pause/resume, speed
#      controls, theme cycling. Zero domain logic involved.
#      If anything here breaks, the bug is in journey_scroll_feed.js or
#      journey_interpreter.js -- not in any DSP or renderer.
# ---------------------------------------------------------------------------
journey_store.register_journey("test_null_both", {
    "label": "Test: Null DSP + Null Renderer",
    "description": "Zero domain logic. Tests only feed engine mechanics in isolation.",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/shorts/api/samples",
    "status": "test",
    "category": "test",
    "feedback_score": 0,
    "globalThemes": _SHARED_TEST_THEME,
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True, "preloadNextStage": True},
    "uiShell": _SHARED_TEST_SHELL,
    "playbackConfig": {"isPaused": False},
    "layout": _SHARED_TEST_LAYOUT,
    "stages": [
        {
            "stageId": "test_null_both_stage_1",
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "null_dsp", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "null_renderer", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Feed Engine Test — Stage 1",
                "caption": "Null DSP + Null Renderer. No domain logic.",
                "description": "Testing: pagination, lazy loading, scroll snapping, tap zones, progress bar, auto-advance. If anything breaks here, the bug is in the feed engine -- not in any DSP or renderer.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 3000,
        },
        {
            "stageId": "test_null_both_stage_2",
            "dataSource": {"mode": "HTTP_REST"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "null_dsp", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "null_renderer", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Feed Engine Test — Stage 2",
                "caption": "Auto-advanced from Stage 1. Tests stage chaining.",
                "description": "If you see this, autoAdvance, goToStage, and the progress bar all worked correctly in Stage 1.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 3000,
        },
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

    # Resolve which JS files this journey's stages actually need --
    # deduplicated, in registration order. Template generates <script>
    # tags from these lists, replacing the old hardcoded load-everything approach.
    dsp_entrypoints = dsp_store.resolve(package["stages"])
    rendering_entrypoints = rendering_store.resolve(package["stages"])

    return render_template(
        package["template"],
        journey_stages=package["stages"],
        journey_themes=package["globalThemes"],
        journey_rules=package["journeyRules"],
        journey_api_endpoint=package["api_endpoint"],
        journey_ui_shell=package["uiShell"],
        journey_playback_config=package["playbackConfig"],
        journey_layout=package["layout"],
        dsp_entrypoints=dsp_entrypoints,
        rendering_entrypoints=rendering_entrypoints,
    )