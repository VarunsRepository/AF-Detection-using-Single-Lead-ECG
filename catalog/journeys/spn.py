# ---------------------------------------------------------------------------
# catalog/journeys/spn.py
#
# A 16-bit substitution-permutation network -- the structure AES is
# built from, small enough that every bit is on screen.
#
# WHY THIS EXISTS ALONGSIDE THE AES JOURNEY
#   AES hides its own structure behind scale. 128 bits, a 256-entry
#   S-box, GF(2^8) arithmetic -- the SHAPE (confuse, diffuse, add key,
#   repeat) is identical but buried. At 16 bits you can flip one input
#   bit and watch where it goes.
#
#   So this is not a simpler AES. It is the same idea with the scale
#   removed so the idea is visible.
#
# THE ARGUMENT THE STAGES MAKE
#   1  rounds        the block scrambles -- but how?
#   2  the steps     substitution stays in its nibble; permutation does not
#   3  the wiring    one round's diffusion is confined; four rounds is not
#
# Verified by exhaustive test, not by published vectors: all 65,536
# plaintexts roundtrip, encryption is a bijection over the whole space,
# and avalanche measures 7.95 of 16 bits against an ideal of 8.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_SHELL = {
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/spn_block/samples",
    "globalThemes": {"activeTheme": "crypto",
                     "themes": [{"id": "crypto",
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


def _stage(stage_id, depth, title, caption, description, ms, parent=None):
    cfg = {"depth": depth}
    if parent:
        cfg["drillParent"] = parent
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "spn_block"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "spn_cipher", "isDefault": True}],
            "parameters": {},
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "spn_bits_view", "isDefault": True}],
            "config": cfg,
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("spn", {
    "version": 1,
    "label": "Confuse, Then Diffuse",
    "description": "A 16-bit substitution-permutation network, bit by bit",
    "status": "stable",
    "category": "cryptography",
    **_SHELL,
    "stages": [
        # Depth 1 -- the block after each round. Establishes THAT it
        # scrambles before asking how.
        _stage("spn_rounds", 1,
               "Four Rounds",
               "The block after each round",
               "Sixteen bits, in four groups of four. Watch the pattern "
               "stop resembling the input. Each round does three things, "
               "and the next stage takes them apart.",
               9000),

        # Depth 2 -- the three operations. This is where the permutation
        # draws its wires, and where the substitution/permutation
        # distinction becomes visible.
        _stage("spn_steps", 2,
               "Three Steps, Repeated",
               "AddRoundKey, Substitute, Permute",
               "Substitution replaces each nibble using a lookup table -- "
               "values change, but every bit stays in its own group. "
               "Permutation does the opposite: it moves bits between "
               "groups without changing any value. The wires show each "
               "bit's origin colour, so four colours arriving in every "
               "group IS the diffusion.",
               16000),

        # Depth 2 filtered to round 1 -- the same data, one round only,
        # so the wiring can be followed rather than watched.
        _stage("spn_round_one", 2,
               "One Round, Slowly",
               "Round 1 on its own",
               "The same three steps with nothing else happening. A single "
               "round spreads one flipped input bit to about two outputs; "
               "four rounds spread it to eight of sixteen, which is the "
               "most you can ask for. That gap is why ciphers have rounds "
               "at all.",
               11000, parent="Round 1"),
    ],
})
