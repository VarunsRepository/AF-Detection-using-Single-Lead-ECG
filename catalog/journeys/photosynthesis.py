# ---------------------------------------------------------------------------
# catalog/journeys/photosynthesis.py
#
# Why there are three photosynthesis pathways instead of one.
#
# RuBisCO also accepts oxygen -- it evolved before the atmosphere had
# much -- and every oxygenation wastes energy and hands carbon back.
# C4 and CAM are two workarounds for the same flaw:
#
#   C4   separates the chemistries in SPACE  (different cells)
#   CAM  separates them in TIME              (night and day)
#
# Both cost extra ATP, so neither is simply better. The journey's three
# stages change the CONDITIONS on whichever pathway the viewer is on,
# because the answer to "which is best" is only ever "it depends", and
# the dependency is computable.
#
# The model is anchored to published values -- ~3 ATP per CO2 for C3 and
# ~5 for C4, water use near 500/250/50 -- so the numbers on screen can be
# checked rather than trusted.
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
        "dataSource": {"mode": "HTTP_REST", "sourceId": "photo_scenario"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "photosynthesis", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "leaf_section_view", "isDefault": True}],
            "config": {},
        },
        "uiFillers": {"title": title, "caption": caption, "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("photosynthesis", {
    "version": 1,
    "label": "Three Ways To Catch Carbon",
    "description": "C3, C4 and CAM -- and why the best one depends on the weather",
    "status": "stable",
    "category": "biology",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/photo_scenario/samples",
    "globalThemes": {"activeTheme": "bio",
                     "themes": [{"id": "bio",
                                 "palette": {"primary": "#5cc24a", "accent": "#5cc24a"}}]},
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top", "activeColor": "#5cc24a",
                                "inactiveColor": "rgba(255,255,255,0.2)"}},
    "playbackConfig": {"isPaused": False},
    "layout": {"title": "bottom", "caption": "bottom", "description": "bottom",
               "plot": "center", "railControls": "bottom"},

    "stages": [
        _stage("photo_leaf", {},
               "Inside The Leaf",
               "CO2 in, water out, through one hole",
               "Follow the carbon through the cell. Which compartments "
               "appear depends on the pathway: a bundle sheath exists only "
               "in C4, a storage vacuole only in CAM, and a peroxisome "
               "appears only where photorespiration is happening. The "
               "stoma at the bottom carries the whole trade -- open, and "
               "CO2 enters while water escapes.",
               13000),

        _stage("photo_heat", {"temperatureC": 40},
               "Now Make It Hot",
               "RuBisCO gets less picky as it warms",
               "At 40 degrees the enzyme's preference for CO2 over O2 "
               "weakens and dissolved CO2 falls relative to O2. A C3 leaf "
               "starts handing carbon back; a C4 or CAM leaf hardly "
               "notices, because its RuBisCO sits in a pocket of "
               "concentrated CO2. This is why C4 grasses dominate hot "
               "grasslands and C3 trees dominate cool forests.",
               12000),

        _stage("photo_drought", {"drought": True},
               "Now Take The Water",
               "The stoma shuts, and everything depends on timing",
               "Closing the stoma saves water and starves the leaf of CO2 "
               "at the same moment -- C3 and C4 both stall. CAM already "
               "shut its stoma at dawn and is living off malate banked "
               "overnight, so it carries on. That is the whole reason a "
               "cactus can photosynthesise through a drought.",
               12000),
    ],
})
