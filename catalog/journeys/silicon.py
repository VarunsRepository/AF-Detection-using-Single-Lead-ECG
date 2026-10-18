# ---------------------------------------------------------------------------
# catalog/journeys/silicon.py
#
# Fifty years of transistor counts, and two reasons to distrust the
# obvious reading of them.
#
# THE ARGUMENT THE STAGES MAKE
#   1  line    the exponential is real, and here is the doubling period
#   2  claim   the node label and the silicon agreed, then stopped
#   3  dies    the top of the curve depends on what you call "one chip"
#
# Stage 1 on its own is the most reproduced graphic in computing and
# adds nothing to the version on Wikipedia. Stages 2 and 3 are why this
# exists: both are findings, and both are things the standard chart
# quietly suppresses by plotting a single number per year.
#
# Stage 3 is deliberately the CAVEAT, promoted to content. A dataset
# that mixed nine-die packages into a curve about chips without saying
# so would be wrong in exactly the place it looks most impressive, so
# rather than footnote it, the journey makes you watch the packages
# come out and the fit change.
#
# Verified against a separate Python run over the same records: the x86
# line fits log10(transistors) against year at r2 = 0.990, doubling
# every 2.14 years, and real density falls behind the label's implied
# density at 22nm in 2012 and never recovers.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_SHELL = {
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/silicon_scaling/samples",
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
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, view, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "silicon_scaling"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "moore_fit", "isDefault": True}],
            "parameters": {},
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "moore_view", "isDefault": True}],
            "config": {"view": view},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("silicon", {
    "version": 1,
    "label": "Fifty Years Of Doubling",
    "description": "Transistor counts, the node label, and what counts as one chip",
    "status": "stable",
    "category": "compute",
    **_SHELL,
    "stages": [
        _stage("silicon_line", "line",
               "The Straight Line",
               "Transistor count against year, powers of ten",
               "A straight line on a log axis is an exponential, so the "
               "slope is the only number that matters. Across the x86 line "
               "it works out at a doubling every 2.14 years, fitting at "
               "r2 = 0.990 over forty-four years -- which is a tighter "
               "agreement than most things called laws manage. On a linear "
               "axis every chip before about 2005 would be a row of dots on "
               "the floor.",
               13000),

        _stage("silicon_claim", "claim",
               "What The Label Promised",
               "Density x node squared -- flat, if the label meant anything",
               "Halving a transistor's linear size quarters its area, so a "
               "node label implies a density of 1/node squared. Multiply "
               "the two together and the answer is CONSTANT -- if the "
               "label tracks the silicon. The dashed line is that "
               "prediction. The data wanders across it by nearly nine "
               "times, so the label was never a reliable proxy for "
               "density, not even in the years people assume it was. What "
               "is new is the direction: x86 stops beating its label at "
               "45nm, NVIDIA at 12nm, Apple at 5nm, and none of the three "
               "recovers.",
               14000),

        _stage("silicon_dies", "dies",
               "What Counts As One Chip",
               "Watch the packages come out",
               "The ringed points are not chips, they are packages: an Epyc "
               "Rome holds nine dies, an M1 Ultra two. Their totals are "
               "true and they are answering a different question from a "
               "single-die Pentium. When they are removed the top of the "
               "curve drops and the fit changes. Nothing was measured "
               "differently -- only the definition changed, which is worth "
               "knowing before quoting any number from the last five years.",
               13000),
    ],
})
