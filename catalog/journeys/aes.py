# ---------------------------------------------------------------------------
# catalog/journeys/aes.py
#
# AES-128, as TWO journeys.
#
# Key expansion and encryption are different questions -- "where do the
# round keys come from" and "what does a round do to the block" -- and
# together they are ~50 operations, which at 8s each is seven minutes of
# scrolling. Splitting them serves both.
#
# aes_round is also the depth ladder in practice: stage 1 shows the
# cipher at round granularity, stage 2 the four steps inside a round,
# stage 3 the per-column detail inside MixColumns. One DSPE run, three
# resolutions -- the renderer filters, nothing recomputes.
#
# Pure recipe data. A recipe names a sourceId, an algoId and a
# rendererId -- never a URL, a file path or a sample.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

journey_store.register_journey("aes_expansion", {
    "version": 1,
    "label": "AES Key Expansion",
    "description": "How one 128-bit key becomes eleven round keys",
    "status": "stable",
    "category": "cryptography",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/aes_block/samples",
    "globalThemes": {
        "activeTheme": "crypto",
        "themes": [{"id": "crypto",
                    "palette": {"primary": "#5cc24a", "accent": "#5cc24a"}}],
    },
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": False},
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
            "stageId": "expansion_round_keys",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "aes_block"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "aes128_encrypt", "isDefault": True}],
                # mode:"expansion" makes the DSPE return only the key
                # schedule captures. Encryption still runs -- it needs the
                # keys -- but its captures are tagged phase:"encrypt" and
                # filtered out by the renderer.
                "parameters": {"mode": "expansion"},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "aes_state_grid", "isDefault": True}],
                "config": {"phase": "expansion", "depth": 1},
            },
            "uiFillers": {
                "title": "Eleven Keys From One",
                "caption": "Each round key is derived from the one before it",
                "description": "RotWord, SubWord and a round constant transform the last word of the previous key; the rest cascade by XOR. Ten rounds need eleven keys -- one for pre-whitening and one per round.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"},
                 "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
                {"ui": {"label": "Theme", "icon": "icon_theme"},
                 "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
            ],
            "baseDurationMs": 11000,
        },
    ],
})


journey_store.register_journey("aes_round", {
    "version": 1,
    "label": "Inside an AES Round",
    "description": "SubBytes, ShiftRows, MixColumns, AddRoundKey",
    "status": "stable",
    "category": "cryptography",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/aes_block/samples",
    "globalThemes": {
        "activeTheme": "crypto",
        "themes": [{"id": "crypto",
                    "palette": {"primary": "#5cc24a", "accent": "#5cc24a"}}],
    },
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": False},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top",
                                "activeColor": "#5cc24a",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom",
               "description": "bottom", "plot": "center",
               "railControls": "bottom"},
    "stages": [
        # Stage 1 -- the whole cipher at round granularity. Plaintext,
        # whitening, ten round results, ciphertext.
        {
            "stageId": "aes_rounds_overview",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "aes_block"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "aes128_encrypt", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "aes_state_grid", "isDefault": True}],
                "config": {"phase": "encrypt", "depth": 1},
            },
            "uiFillers": {
                "title": "Ten Rounds",
                "caption": "The block after each round",
                "description": "Whitening XORs the plaintext with round key 0, then ten rounds each scramble the state further. Watch how quickly it stops resembling the input.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"},
                 "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
            ],
            "baseDurationMs": 10000,
        },
        # Stage 2 -- one level deeper. The four operations inside a round.
        {
            "stageId": "aes_round_steps",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "aes_block"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "aes128_encrypt", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "aes_state_grid", "isDefault": True}],
                "config": {"phase": "encrypt", "depth": 2},
            },
            "uiFillers": {
                "title": "Four Steps Per Round",
                "caption": "SubBytes, ShiftRows, MixColumns, AddRoundKey",
                "description": "Highlighted cells are the ones that step changed. SubBytes alters every value without moving anything; ShiftRows moves bytes without altering any value. Row 0 never moves.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"},
                 "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
            ],
            "baseDurationMs": 14000,
        },
        # Stage 3 -- deepest level. Per-column inside MixColumns, the one
        # round step with genuinely interesting substructure.
        {
            "stageId": "aes_mixcolumns_detail",
            "dataSource": {"mode": "HTTP_REST", "sourceId": "aes_block"},
            "dspEngine": {
                "availableAlgorithms": [{"id": "aes128_encrypt", "isDefault": True}],
                "parameters": {},
            },
            "renderingEngine": {
                "availableRenderers": [{"id": "aes_state_grid", "isDefault": True}],
                "config": {"phase": "encrypt", "depth": 3,
                           "drillParent": "mixedColumnsBlock"},
            },
            "uiFillers": {
                "title": "Inside MixColumns",
                "caption": "One column at a time",
                "description": "Each column is treated as a four-term polynomial and multiplied in GF(2\u2078). Only one column changes at a time -- the operation never mixes across columns, which is what ShiftRows is there to compensate for.",
            },
            "railControls": [
                {"ui": {"label": "Speed", "icon": "icon_speed"},
                 "action": {"target": "journey", "method": "cycleSpeed", "payload": {}}},
            ],
            "baseDurationMs": 8000,
        },
    ],
})
