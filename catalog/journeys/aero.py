# ---------------------------------------------------------------------------
# catalog/journeys/aero.py
#
# Fan cars: Chaparral 2J (1970), Brabham BT46B (1978), Tesla Roadster.
#
# THE ARGUMENT THE STAGES MAKE
#   1  speed   a wing needs velocity; a fan does not. That is the point.
#   2  seal    the trick is millimetres of rubber, and it fails one way
#   3  claim   a downforce figure IS a pressure figure -- check it
#   4  thrust  the Roadster's other system is not this mechanism at all
#
# WHY NOT A PATHWAY
#   This was the obvious thing to reach for and it is wrong. A pathway is
#   species and reactions -- things consumed and produced, with order
#   emerging from shared names and the payoff being "block one step and
#   watch the rest stall". Nothing here is consumed. There is no network.
#   Using the SBML engine as a generic diagram renderer is the drift its
#   own file header warns about.
#
#   What this subject IS: one equation, F = dP x A, with a leak term, and
#   a second equation that looks similar and is not.
#
# HOW GOOD THE NUMBERS ARE -- say this out loud
#   Masses and years are documented. Sealed areas, fan characteristics
#   and skirt gaps are ESTIMATES: nobody published the BT46B's fan flow,
#   and Tesla has published no fan specification at all. The parameters
#   put real cars in a real ballpark so the RELATIONSHIPS can be shown;
#   they are not measurements and no conclusion here should rest on a
#   specific value.
#
#   Stage 3 is built to need none of them. A claimed downforce in g,
#   a mass and an area give the required pressure by arithmetic alone --
#   which is why it is the stage that can actually check something.
#
# Verified against an independent Python solve: flows balance at the
# operating point to float precision, a zero gap yields exactly the fan's
# stall pressure, and both historical cars land near 1g at rest.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_SHELL = {
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/fan_cars/samples",
    "globalThemes": {"activeTheme": "physical",
                     "themes": [{"id": "physical",
                                 "palette": {"primary": "#2edac4",
                                             "accent": "#2edac4"}}]},
    "journeyRules": {"allowStageNavigation": True, "autoAdvance": True,
                     "preloadNextStage": True},
    "uiShell": {"showProgressBar": True,
                "progressBar": {"position": "top", "activeColor": "#2edac4",
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
        "dataSource": {"mode": "HTTP_REST", "sourceId": "fan_cars"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "fan_suction", "isDefault": True}],
            "parameters": {},
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "suction_view", "isDefault": True}],
            "config": {"view": view},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("suction", {
    "version": 1,
    "label": "Cars That Suck",
    "description": "How a fan makes downforce that does not need speed",
    "status": "stable",
    "category": "physics",
    **_SHELL,
    "stages": [
        # The descriptions are written for someone who has never done any
        # physics. No equations, no pressure units, and forces given as
        # multiples of the car's own weight -- "pressed down twice as hard
        # as it weighs" needs no training to picture, and the renderer
        # uses the same units so the words and the chart agree.
        _stage("suction_speed", "speed",
               "A Wing Needs Speed",
               "What actually pushes the car onto the road",
               "A wing only works when air is rushing over it. Park the "
               "car and it does nothing whatsoever. A fan is different: it "
               "seals the gap under the car and pulls the air out from "
               "underneath, so the air above can press the car down whether "
               "it is moving or not. The green line never changes -- that "
               "is the entire idea. Watch for where the orange wing line "
               "finally climbs past it. Above that speed a wing is simply "
               "the better tool, which is why nobody ever built a car with "
               "only a fan.",
               13000),

        _stage("suction_seal", "seal",
               "Millimetres Of Rubber",
               "What happens when the skirt lifts off the road",
               "The fan is not really what grips the road. The seal is. "
               "Rubber skirts run along the sides of the car almost "
               "touching the ground, and they are what stops air sneaking "
               "back in underneath. Lift them a few millimetres and air "
               "floods in faster than the fan can pull it out. Notice how "
               "unfair the trade is: pressing the skirts down harder buys "
               "you very little, but losing them costs you nearly "
               "everything at once. That is why a broken skirt killed "
               "drivers in the 1970s. The grip did not fade -- it "
               "disappeared, mid-corner.",
               14000),

        _stage("suction_claim", "claim",
               "Thirty Tonnes You Never Feel",
               "A claim about grip is really a claim about air",
               "Air is already pressing down on this car's floor with "
               "about thirty tonnes of force. You never notice, because "
               "exactly the same air pushes up from below and the two "
               "cancel out. All a fan does is take a little of the air out "
               "from under the car, so the push from above wins by that "
               "much. The 1970s cars removed about two to three percent of "
               "it, and that was enough to hold the car down as hard as it "
               "weighed. Work backwards from a modern claim of twice the "
               "car's weight and you would have to remove thirteen percent "
               "and hold it there -- roughly five times what a "
               "purpose-built racing car managed.",
               13000),

        _stage("suction_thrust", "thrust",
               "A Thruster Is Not A Fan",
               "Throwing air away to push back",
               "The Roadster's other trick looks related and is not. A fan "
               "pushes air along without using it up, so it can run for as "
               "long as the engine does. A thruster throws stored air away "
               "to shove the car the other way, like letting go of an "
               "untied balloon. Ask it to push four times as hard as the "
               "car weighs and it has to throw away more than a hundred "
               "kilograms of air every second -- more than a grown adult's "
               "weight, each second. Any tank that fits inside a car is "
               "empty in a fraction of a second. That is fine for a jump. "
               "It is not flying.",
               12000),
    ],
})