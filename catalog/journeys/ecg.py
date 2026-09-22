# ---------------------------------------------------------------------------
# catalog/journeys/ecg.py
#
# Single-lead ECG: peak detection, Poincare, RR tachogram.
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

journey_store.register_journey("ecg", {
    # v3: added pan_tompkins_py to stage 1's availableAlgorithms.
    #
    # BUMP THIS ON EVERY RECIPE CHANGE. register_journey() compares the
    # incoming version against journeystore.json and SKIPS the update if
    # they match -- so an edited recipe at an unchanged version is
    # silently ignored, and the cached copy keeps serving. The startup log
    # says "up to date -- skipping" when that happens.
    "version": 6,   # v6: reference-class closing stage
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
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                # The algorithm rail button cycles this list in order.
                # pan_tompkins and pan_tompkins_py are the SAME algorithm
                # from two implementations -- tapping between them on one
                # record is the comparison this app exists to make easy.
                "availableAlgorithms": [
                    {"id": "pan_tompkins", "isDefault": True},
                    {"id": "pan_tompkins_py", "isDefault": False},
                    # NOT the default, deliberately. The module initialises
                    # asynchronously, so on a cold load the first card can
                    # render before it has registered. As a rail option it
                    # is only reached by a tap, long after init finishes.
                    {"id": "pan_tompkins_wasm", "isDefault": False},
                    {"id": "hamilton_tompkins", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "chart_v1_canvas", "isDefault": True}, {"id": "chart_v1_webgl", "isDefault": False}, {"id": "chart_v1", "isDefault": False}],
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
                {"ui": {"label": "Renderer", "icon": "icon_renderer"}, "action": {"target": "renderingEngine", "method": "switchRenderer", "payload": {}}},
                {"ui": {"label": "Speed"}, "action": {"target": "journey", "method": "cycleSpeed", "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"}, "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            # 14s for a 30s record is ~2.1x real-time. Without this the
            # stage fell back to STAGE_DURATION_MS (8000) -- 3.75x, fast
            # enough that beats blur past before the eye settles. The
            # sweep shows a 3s window, so at 14s the leading edge crosses
            # the visible width about every 1.4s.
            "baseDurationMs": 14000,
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
        # ── Stage 4: the answer key ────────────────────────────────
        # Deliberately LAST. The earlier stages ask what is in the signal;
        # this one says what the record is actually called, after you have
        # had a chance to form your own view. Shown first it would tell
        # the viewer what to see before they looked.
        #
        # Takes the WHOLE export (no consumedField) because it needs
        # rrIntervalsMs for the supporting numbers, and the record's label
        # rides in meta, which pipeline stages now inherit.
        {
            "stageId": "stage_04_reference_class",
            "dataSource": {
                "mode": "PREVIOUS_STAGE_PIPELINE",
                "stageId": "stage_01_peak_detection",
                "outputKey": "stage_01_processed_data",
            },
            "dspEngine": {
                "availableAlgorithms": [{"id": "sample_class", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "class_card_view", "isDefault": True}],
                "config": {},
            },
            "uiFillers": {
                "title": "What This Record Is",
                "caption": "The cardiologist's label for this recording",
                "description": "This class comes from the PhysioNet 2017 reference annotations -- a human expert's call, not something this app computed. The numbers above it are measured from the beats you just watched, so you can see how far they agree.",
            },
            "railControls": [
                {"ui": {"label": "Speed"},
                 "action": {"target": "journey", "method": "cycleSpeed",
                            "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 10000,
        },
    ],
})

# NOTE: "dwt" was previously excluded here since its recipe used the old
# {block, dependsOn} shape. Now migrated to the real schema, using the
# verified db4_wavelet DSP engine and dwt_comparison_view renderer.
