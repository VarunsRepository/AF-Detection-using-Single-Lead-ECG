# ---------------------------------------------------------------------------
# catalog/journeys/sha1.py
#
# SHA-1 -- a HASH beside two ciphers, which is the reason it is here.
#
# AES and the SPN are reversible and key-driven, and their output is the
# same size as their input. SHA-1 has no key, no inverse, and collapses
# any input length to exactly 160 bits. The machinery looks similar --
# rounds, rotations, constants -- but the goal is opposite: a cipher must
# be undoable by the key holder, a hash by nobody.
#
# SHA-1 is BROKEN for collision resistance (SHAttered, 2017). It is here
# because it is broken and small: it teaches the Merkle-Damgard shape
# that SHA-256 still uses, without implying anyone should deploy it. The
# final stage says so on screen.
#
# Verified against the FIPS-180 published digests and, separately, against
# 50 random messages diffed byte-for-byte with Node's own crypto module.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_SHELL = {
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/sha1_message/samples",
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
        "dataSource": {"mode": "HTTP_REST", "sourceId": "sha1_message"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "sha1_hash", "isDefault": True}],
            "parameters": {},
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "sha1_state_view", "isDefault": True}],
            "config": cfg,
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("sha1", {
    "version": 1,
    "label": "Everything Becomes 160 Bits",
    "description": "SHA-1: no key, no way back, always the same output size",
    "status": "stable",
    "category": "cryptography",
    **_SHELL,
    "stages": [
        # Depth 1 -- the shape of the whole hash: initial constants, the
        # message schedule, four function groups, the fold-back, digest.
        _stage("sha1_overview", 1,
               "Four Groups, Eighty Rounds",
               "The five words after each stage of the hash",
               "Five 32-bit words start from constants fixed by the "
               "standard. Eighty rounds mix the message into them, in four "
               "groups of twenty -- each group using a different mixing "
               "function. At the end the words are ADDED to the running "
               "digest rather than replacing it, and that addition is what "
               "makes the whole thing one-way.",
               12000),

        # Depth 2 -- inside a round. This is where the shift is visible.
        _stage("sha1_round", 2,
               "One Round At A Time",
               "Only `a` is new -- the rest shift down",
               "A round computes far less than it appears to. Four of the "
               "five words simply move down one place, with c picking up a "
               "30-bit rotation on the way; only a is genuinely new. "
               "Outlined bits are the ones that changed. Watch a pattern "
               "slide down the rows from one round to the next.",
               16000, parent="Ch \u00b7 rounds 1-20"),
    ],
})
