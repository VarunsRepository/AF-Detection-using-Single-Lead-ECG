# ---------------------------------------------------------------------------
# catalog/journeys/pathway.py
#
# A metabolic pathway, drawn from its DATA rather than from code.
#
# WHY THIS JOURNEY MATTERS MORE THAN ITS CONTENT
#   The ETS and photosynthesis journeys each hardcode their choreography
#   in a bespoke renderer, so a third pathway would mean a third
#   renderer. Here the pathway is a JSON document in SBML's shape --
#   species and reactions, two flat lists, no ordering. The engine works
#   out the sequence from shared species names, notices whether the walk
#   closes into a cycle, and the renderer picks a ring or a chain from
#   that.
#
#   So glycolysis and the Calvin cycle are data, not code.
#
# The atom-balance check is the oracle: where every species in a
# reaction carries a formula, the atoms must match on both sides. A typo
# in the pathway fails arithmetic rather than animating wrong chemistry.
# Reactions involving large cofactors are reported UNCHECKED rather than
# passed, because a green tick that means nothing is worse than none.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_RAIL = [
    # No Route button here any more. Condition controls come from the
    # DSPE's choices(), which reads the pathway data -- so glycolysis gets
    # Oxygen and Organism buttons and the citric acid cycle gets none,
    # instead of every card carrying a control that nine of them ignored.
    # No Show button here: the RENDERER declares it via choices(), so
    # its options are named from the model's own vocabulary --
    # "Pass / Form / Resource" on a compiler pipeline, not
    # "Reaction / Metabolite / Cofactor".
    {"ui": {"label": "Renderer", "icon": "icon_renderer"},
     "action": {"target": "renderingEngine", "method": "switchRenderer",
                "payload": {}}},
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, params, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "pathway_model"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "pathway", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": {
            # Two views of one walk: the map shows the whole shape at
            # once, the navigator shows where you are in it. Neither
            # subsumes the other -- a ring cannot be read five nodes at a
            # time, and a ten-node chain cannot be read whole on a phone.
            "availableRenderers": [
                {"id": "pathway_view",     "isDefault": True},
                {"id": "pathway_nav_view", "isDefault": False},
            ],
            "config": {},
        },
        "uiFillers": {"title": title, "caption": caption, "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("pathway", {
    "version": 11,  # v11: templated overlay copy
    "label": "Round And Round",
    "description": "A metabolic pathway assembled from its own data",
    "status": "stable",
    "category": "biology",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/pathway_model/samples",
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
        _stage("pathway_walk", {},
               # Titles are read by someone who does not know how the
               # engine works. "The Order Is Not In The File" describes an
               # implementation detail -- true, and meaningless on a card.
               # The point it was making now lives in the description,
               # where an interested reader will find it.
               # Templated from the sample, so the compiler pipeline and
               # the mood model get their own names rather than a
               # biochemistry slogan. The caption is the HOOK -- the
               # render already shows the name, so repeating it in the
               # overlay would waste the only line a viewer reads.
               "{pathway.name}",
               "Nothing here is stored in order \u2014 watch it work it out",
               "The data holds two flat lists -- species and reactions -- "
               "and nothing says which comes first. The order you are "
               "watching was worked out from shared names: one reaction's "
               "product is the next one's reactant. When the walk returns "
               "to where it started, that is a cycle, and it is drawn as "
               "a ring for exactly that reason.",
               13000),

        _stage("pathway_blocked", {"blocked": "auto"},
               "Break One Step",
               "{note}",
               "Each pathway names its own regulated step -- succinate "
               "dehydrogenase in the TCA cycle, phosphofructokinase in "
               "glycolysis -- and this stage blocks it. No special "
               "handling is needed: a reaction fires only when its "
               "reactants are present, so removing one starves everything "
               "after it. That single rule is where inhibition comes from, "
               "rather than from any code about poisons.",
               12000),
    ],
})
