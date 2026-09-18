# ---------------------------------------------------------------------------
# catalog/journeys/beats.py
#
# "Do these beats agree with each other?" -- a different question from
# "what does this signal look like", and the reason this is its own
# journey rather than a renderer option on the ECG one.
#
# A normal ECG sweep shows beats one after another in time, so comparing
# beat 3 with beat 40 means remembering what beat 3 looked like. Stage 2
# re-zeroes the time axis at every R-apex and draws all of them on one
# set of axes: consistent morphology reads as a tight bundle, and
# anything irregular is the single line that departs from it.
#
# Ported from updateStackedChart() / sliceStackedBeatsFrontend() in the
# original single-sample ECG analysis page.
#
# Stage 2 uses pan_tompkins_py as its default rather than pan_tompkins,
# because only the Python port emits P/Q/S/T wave points -- and those are
# what turn the overlay from a bundle of lines into a labelled beat. It
# still works with plain pan_tompkins, just with R markers alone.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

journey_store.register_journey("beats", {
    "version": 5,   # v5: 350ms pre-R window for P/f-wave visibility
    "label": "Every Beat At Once",
    "description": "Detect the beats, then stack them on top of each other",
    "status": "stable",
    "category": "ecg",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/ecg_single/samples",

    "globalThemes": {
        "activeTheme": "clinical",
        "themes": [{"id": "clinical",
                    "palette": {"primary": "#5cc24a", "accent": "#eb7b2b"}}],
    },
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top",
                                "activeColor": "#5cc24a",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom",
               "description": "bottom", "plot": "center",
               "railControls": "bottom"},

    "stages": [
        # ── Stage 1: the familiar sweep, so stage 2 has something to
        # contrast against. Without seeing the beats in time first, the
        # overlay in stage 2 has no reference point.
        {
            "stageId": "beats_detect",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins_py", "isDefault": True},
                    {"id": "pan_tompkins", "isDefault": False},
                    {"id": "hamilton_tompkins", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [
                    {"id": "chart_v1_canvas", "isDefault": True},
                    {"id": "chart_v1_webgl", "isDefault": False},
                ],
                "config": {"peakMarkerColor": "#eb7b2b"},
            },
            "uiFillers": {
                "title": "Finding Every Beat",
                "caption": "Pan-Tompkins marks each R-apex",
                "description": "The sweep shows beats in the order they happened. Comparing the third beat with the fortieth means remembering what the third looked like -- which is the problem the next stage solves.",
            },
            "railControls": [
                # Invert matters more in THIS journey than elsewhere: an
                # upside-down signal makes Pan-Tompkins find the wrong
                # extrema, so stage 2 would stack beats around wrong R
                # positions and the overlay would be meaningless. Being
                # able to flip it is how you notice.
                {"ui": {"label": "Invert", "icon": "icon_flip_vertical"},
                 "action": {"target": "dspEngine", "method": "setParameter",
                            "payload": {"key": "invertSignal", "operation": "toggle"}}},
                {"ui": {"label": "Algorithm", "icon": "icon_cycle"},
                 "action": {"target": "dspEngine", "method": "switchAlgorithm", "payload": {}}},
                {"ui": {"label": "Renderer", "icon": "icon_renderer"},
                 "action": {"target": "renderingEngine", "method": "switchRenderer", "payload": {}}},
                {"ui": {"label": "Speed"},
                 "action": {"target": "journey", "method": "cycleSpeed",
                            "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 9000,
            # Exports the whole peak-detection output, because stacked_beats
            # needs filteredSignal AND peakIndices AND (optionally)
            # wavePoints -- not a single field.
            "stageOutput": {
                "exportKey": "detected_beats",
                "exportedFields": ["filteredSignal", "peakIndices",
                                   "rrIntervalsMs", "wavePoints"],
            },
        },

        # ── Stage 2: the same beats, re-zeroed at R and drawn on top of
        # each other. Time no longer runs left-to-right across the record;
        # it runs from -200ms to +400ms RELATIVE TO EACH BEAT'S OWN R.
        {
            "stageId": "beats_stacked",
            # No consumedField: this stage needs THREE fields from the
            # export (filteredSignal, peakIndices, wavePoints), so it takes
            # the whole thing rather than one array.
            "dataSource": {
                "mode": "PREVIOUS_STAGE_PIPELINE",
                "stageId": "beats_detect",
                "outputKey": "detected_beats",
            },
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "stacked_beats", "isDefault": True},
                ],
                # beatsToStack 1 = one beat per window. 2 spans two R-R
                # intervals, which is how the original page showed
                # consecutive-beat pairs.
                "parameters": {"beatsToStack": 1},
            },
            "renderingEngine": {
                "availableRenderers": [
                    {"id": "stacked_beats_view", "isDefault": True},
                ],
                "config": {},
            },
            "uiFillers": {
                "title": "All Of Them, Overlaid",
                "caption": "Every beat re-centred on its own R-apex",
                "description": "The dashed line is t=0, the R-apex every beat is aligned to. A tight bundle means consistent morphology. Watch the shaded P/f region on the left: a clean bundle of matching P-waves means organised atrial activity, while a fuzzy band means f-waves -- the atria fibrillating instead of contracting. That, plus irregular R-R intervals, is what AFib looks like.",
            },
            "railControls": [
                {"ui": {"label": "Speed"},
                 "action": {"target": "journey", "method": "cycleSpeed",
                            "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 12000,
        },
        # ── Stage 3: two-beat windows. The window now spans from one R to
        # the NEXT one, so the orange horizontal lines -- each running
        # from t=0 to that beat's next R -- become visible. Their LENGTH
        # is the R-R interval, so variable rhythm shows as lines of
        # obviously different lengths stacked over each other, and a
        # steady rhythm collapses them into one thick line.
        #
        # This is what the original page's default (beatsToStack = 2) was
        # showing. Kept as its own stage rather than a parameter toggle
        # because it answers a different question: stage 2 is "do the
        # beats look alike", stage 3 is "do they arrive evenly".
        {
            "stageId": "beats_rr_pairs",
            "dataSource": {
                "mode": "PREVIOUS_STAGE_PIPELINE",
                "stageId": "beats_detect",
                "outputKey": "detected_beats",
            },
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "stacked_beats", "isDefault": True},
                ],
                "parameters": {"beatsToStack": 2},
            },
            "renderingEngine": {
                "availableRenderers": [
                    {"id": "stacked_beats_view", "isDefault": True},
                ],
                "config": {"showRRLines": True},
            },
            "uiFillers": {
                "title": "The Gaps Between Them",
                "caption": "Each orange line spans one R-R interval",
                "description": "Every line runs from this beat's R to the next one, so its length IS the R-R interval, and the box marks where that next beat landed. The shaded band is the volatility window -- boxes inside it are typical intervals, boxes outside are not. VIX is the standard deviation of successive log-ratios: near zero for a steady rhythm, above 10% when the rhythm is genuinely irregular.",
            },
            "railControls": [
                {"ui": {"label": "Speed"},
                 "action": {"target": "journey", "method": "cycleSpeed",
                            "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 12000,
        },
    ],
})