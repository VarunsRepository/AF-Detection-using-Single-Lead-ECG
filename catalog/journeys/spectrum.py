# ---------------------------------------------------------------------------
# catalog/journeys/spectrum.py
#
# "Where does this signal's energy actually live?"
#
# The sweep views answer questions about TIME -- when does a beat happen,
# do the beats look alike. This one answers a question about FREQUENCY,
# and the two are genuinely different: a recording can look perfectly
# clean in the time domain while carrying 27% of its power at 50Hz.
#
# Stage 1 shows the waveform so there is something to contrast against.
# Stage 2 is the same signal viewed as a spectrum.
#
# WHY THESE BANDS: they are ECG SIGNAL bands, not HRV bands. HRV analysis
# runs an FFT on the R-R interval series and looks at VLF/LF/HF around
# 0.04-0.4Hz -- a different journey on different data. These are the
# spectrum of the waveform itself, where each band maps to a physical
# source: electrode drift, repolarisation, depolarisation, muscle, mains.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

journey_store.register_journey("spectrum", {
    "version": 1,
    "label": "Where The Energy Lives",
    "description": "The same ECG, viewed as a power spectrum",
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
        {
            "stageId": "spectrum_signal",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "pan_tompkins", "isDefault": True},
                    {"id": "pan_tompkins_py", "isDefault": False},
                ],
                "parameters": {"invertSignal": False},
            },
            "renderingEngine": {
                "availableRenderers": [
                    {"id": "chart_v1_canvas", "isDefault": True},
                    {"id": "chart_v1_webgl", "isDefault": False},
                ],
                "config": {},
            },
            "uiFillers": {
                "title": "The Signal In Time",
                "caption": "Amplitude against time, as recorded",
                "description": "This is how an ECG is normally read: what happened, and when. It answers nothing about which frequencies carry the signal's energy -- and a trace that looks clean here can still be badly contaminated.",
            },
            "railControls": [
                {"ui": {"label": "Invert", "icon": "icon_flip_vertical"},
                 "action": {"target": "dspEngine", "method": "setParameter",
                            "payload": {"key": "invertSignal", "operation": "toggle"}}},
                {"ui": {"label": "Renderer", "icon": "icon_renderer"},
                 "action": {"target": "renderingEngine", "method": "switchRenderer", "payload": {}}},
                {"ui": {"label": "Speed"},
                 "action": {"target": "journey", "method": "cycleSpeed",
                            "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 14000,
        },

        # Same signal, fetched again rather than piped from stage 1.
        # Stage 1 exports a FILTERED signal -- Pan-Tompkins bandpasses
        # 5-15Hz -- and running an FFT on that would show the filter's
        # response, not the recording's. The spectrum has to see the raw
        # signal to be honest about baseline drift and mains, both of
        # which sit outside that passband and would already be gone.
        {
            "stageId": "spectrum_bands",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "ecg_single"},
            "dspEngine": {
                "availableAlgorithms": [
                    {"id": "fft_spectral", "isDefault": True},
                ],
                "parameters": {
                    # 1024 samples at 300Hz = 3.4s windows, giving 0.29Hz
                    # bins and ~16 averaged segments from a 30s record.
                    # Larger windows would resolve finer but average
                    # fewer, leaving a spikier spectrum.
                    "segmentLength": 1024,
                    "invertSignal": False,
                },
            },
            "renderingEngine": {
                "availableRenderers": [
                    {"id": "spectrum_view", "isDefault": True},
                ],
                "config": {"maxFrequency": 100},
            },
            "uiFillers": {
                "title": "The Same Signal In Frequency",
                "caption": "Power per frequency, log scale",
                "description": "Each shaded region is a band with a physical source. QRS energy sits at 10-40Hz because depolarisation is fast; P and T waves are slower and sit below 10Hz. Power below 0.5Hz is electrode drift, not heart. A spike at 50Hz is mains interference -- and it is invisible in the time view above.",
            },
            "railControls": [
                {"ui": {"label": "Speed"},
                 "action": {"target": "journey", "method": "cycleSpeed",
                            "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 13000,
        },
    ],
})