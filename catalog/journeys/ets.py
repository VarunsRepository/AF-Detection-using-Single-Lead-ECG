# ---------------------------------------------------------------------------
# catalog/journeys/ets.py
#
# The electron transport chain: one electron pair falling, and what the
# fall pays for.
#
# WHY IT SUITS THIS ENGINE
#   It is a cascade with a number at every step. deltaG = -nFdeltaE turns
#   each complex into a measurable drop, and the drops are wildly unequal
#   -- Complex IV releases 108 kJ/mol against Complex III's 40. Textbook
#   diagrams draw equal boxes and lose exactly that.
#
# THE SECOND STAGE IS THE POINT
#   Stage 1 shows the chain working. Stage 2 blocks Complex IV on the
#   SAME sample, and the non-obvious thing appears: Complexes I and III
#   stop too. Electrons have nowhere to go, so everything upstream backs
#   up. That is why cyanide acts in minutes -- it does not slow the
#   chain, it halts all of it.
#
# The numbers are checkable: NADH to O2 totals about -220 kJ/mol and
# yields ~2.5 ATP; succinate about -150 and ~1.5. Both textbook values,
# so the implementation has an external oracle.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_RAIL = [
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, params, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "ets_scenario"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "ets_chain", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "ets_cascade_view", "isDefault": True}],
            "config": {},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("ets", {
    "version": 1,
    "label": "What The Fall Pays For",
    "description": "Electrons falling down the transport chain, and the ATP it buys",
    "status": "stable",
    "category": "biology",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/ets_scenario/samples",
    "globalThemes": {"activeTheme": "bio",
                     "themes": [{"id": "bio",
                                 "palette": {"primary": "#5cc24a",
                                             "accent": "#3b82f6"}}]},
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top", "activeColor": "#5cc24a",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom", "description": "bottom",
               "plot": "center", "railControls": "bottom"},

    "stages": [
        _stage("ets_fall", {},
               "Electrons Falling",
               "Each drop pays for protons",
               "Electrons move from a low redox potential to a high one, "
               "and every step down releases energy that pushes protons "
               "across the membrane. The step heights are the energy: "
               "Complex IV releases 108 kJ/mol, Complex III only 40. Ten "
               "protons divided by four per ATP is where 2.5 ATP per NADH "
               "comes from -- not the 3 that older textbooks quote.",
               12000),

        # inhibitor forced here, so the contrast happens on whatever
        # sample the viewer is already looking at.
        _stage("ets_blocked", {"inhibitor": "cyanide"},
               "Cut It At The End",
               "Cyanide stops Complex IV -- and everything before it",
               "Blocking the LAST complex stops the first two as well. "
               "Electrons have nowhere to go, so the carriers back up "
               "fully reduced and the upstream complexes stall. No "
               "electron flow means no pumping, no gradient and no ATP -- "
               "which is why cyanide acts in minutes rather than hours.",
               12000),
    ],
})
