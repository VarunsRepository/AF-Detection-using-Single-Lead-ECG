# ---------------------------------------------------------------------------
# catalog/journeys/test_journeys.py
#
# Null-object journeys used to isolate the feed engine from DSP/RE bugs.
#
# Pure recipe data. A recipe names a sourceId, an algoId and a
# rendererId -- never a URL, a file path or a sample. Adding a journey
# means adding a file here and a line in catalog/__init__.py.
# ---------------------------------------------------------------------------

# journey_store is created in catalog/__init__.py before this module is
# imported, so importing the MODULE (not the name) avoids a circular
# import during package initialisation.
import catalog
from catalog.journeys._shared import (_SHARED_TEST_THEME, _SHARED_TEST_RULES,
                                      _SHARED_TEST_SHELL, _SHARED_TEST_LAYOUT)

journey_store = catalog.journey_store

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
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "null_dsp", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1_canvas", "isDefault": True}, {"id": "chart_v1_webgl", "isDefault": False}, {"id": "chart_v1", "isDefault": False}],
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
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
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
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
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
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
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

# ---------------------------------------------------------------------------
# TEST 4: Canvas renderer -- compare directly with chart_v1 (Plotly)
# Visit /journey/test_canvas alongside /journey/ecg to compare smoothness.
# Same DSP (pan_tompkins), same data, different renderer.
# ---------------------------------------------------------------------------


journey_store.register_journey("test_canvas", {
    "version": 1,
    "label": "Test: Canvas 2D Renderer",
    "description": "Same Pan-Tompkins DSP as ECG journey but rendered via Canvas 2D instead of Plotly SVG. Compare smoothness.",
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
            "stageId": "canvas_stage_1",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins",      "isDefault": True},
                    {"id": "hamilton_tompkins", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1_canvas", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "Canvas 2D Renderer",
                "caption": "Same Pan-Tompkins DSP as /journey/ecg. Canvas instead of Plotly SVG.",
                "description": "If this looks smoother than the ECG journey, Canvas wins. No Plotly involved -- pure ctx.lineTo() calls.",
            },
            "railControls": [
                {"ui": {"label": "Algorithm", "icon": "icon_cycle"}, "action": {"target": "dspEngine", "method": "switchAlgorithm", "payload": {}}},
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 8000,
        },
    ],
})


journey_store.register_journey("test_webgl", {
    "version": 1,
    "label": "Test: WebGL Renderer",
    "description": "Same Pan-Tompkins DSP, signal uploaded to GPU vertex buffer once, single draw call per frame.",
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
            "stageId": "webgl_stage_1",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins",      "isDefault": True},
                    {"id": "hamilton_tompkins", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [
                    {"id": "chart_v1_webgl",   "isDefault": True},
                    {"id": "chart_v1_canvas",  "isDefault": False},
                    {"id": "chart_v1",         "isDefault": False},
                ],
                "config": {},
            },
            "uiFillers": {
                "title": "WebGL Renderer",
                "caption": "Signal on GPU vertex buffer. Single gl.drawArrays() per frame.",
                "description": "Tap ◻ to cycle: WebGL → Canvas 2D → Plotly SVG. Watch render cost in dev HUD.",
            },
            "railControls": [
                {"ui": {"label": "Renderer", "icon": "icon_renderer"}, "action": {"target": "renderingEngine", "method": "switchRenderer", "payload": {}}},
                {"ui": {"label": "Speed", "icon": "icon_speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 8000,
        },
    ],
})

# ---------------------------------------------------------------------------
# AES journeys
#
# TWO journeys, not one. AES is ~50 distinct operations end to end; at 8
# seconds each that is seven minutes of scrolling and nobody swipes
# through that. Key expansion and encryption are also different
# questions -- "where do the round keys come from" and "what does a round
# do to the block" -- so forcing both into one journey serves neither.
#
# Cards within each journey vary the plaintext/key pair. Same recipe,
# different data: the viewer sees SubBytes act on many different states,
# which is the repetition the whole product model is built on.
# ---------------------------------------------------------------------------
