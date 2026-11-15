# ---------------------------------------------------------------------------
# catalog/journeys/drm.py
#
# WHY THE SCREENSHOT IS BLACK.
#
# THE ARGUMENT THE STAGES MAKE
#   1  the file is already noise      having it gets you nothing
#   2  seven places a frame lives     and who can read each one
#   3  the grab                       fire the probe; black comes back
#   4  the same row, the other path   where the frame IS readable
#   5  the receipt                    the published caps, and the pattern
#
# Stage 3 and stage 4 are the whole journey. Same seven steps, same
# sample, one thing changed -- and the capture returns a frame instead of
# black. Nobody started blocking anything; the memory moved.
#
# THE ORACLE IS STAGE 5, and it is a published table rather than anything
# computed here: 2160p appears only where a hardware path exists. The
# source asserts that at import against the table it draws from, so a
# future row that breaks the claim is a startup warning rather than a
# card quietly lying.
#
# WHAT THIS JOURNEY DOES NOT CLAIM
#   Which DRM system each row uses is INFERRED. Netflix publishes the
#   caps, not the mechanism. The card says so.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_RAIL = [
    # No Renderer button: there is one renderer. A control that cycles a
    # list of length one asserts a choice the data cannot support.
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, view, params, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "drm_path"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "drm_path", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "secure_path_view",
                                    "isDefault": True}],
            "config": {"view": view},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("drm", {
    "version": 1,
    "label": "Why The Screenshot Is Black",
    "description": "Netflix is not blocking your capture. The pixels were "
                   "never there.",
    "status": "stable",
    "category": "media",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/drm_path/samples",
    "globalThemes": {"activeTheme": "drm",
                     "themes": [{"id": "drm",
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

    "stages": [
        _stage("already_noise", "cipher", {},
               "{name}",
               "The file is encrypted before it leaves the CDN.",
               "This is the actual content, as it sits on the server: "
               "AES-128-CTR, with the key and counter printed beside it so "
               "you can reproduce the bytes yourself. Anyone can have this "
               "file. Having it is worth nothing. Note what the page is "
               "NOT doing — it never decrypts this. It cannot. It has the "
               "ciphertext and no key, which is the arrangement the whole "
               "stack exists to maintain.",
               11000),

        _stage("seven_places", "pipeline", {},
               "Seven places a frame lives",
               "Between the CDN and the panel, and who can read each one.",
               "A frame is not in one place. It is in seven, in turn, and "
               "the only question that matters at each is whether code the "
               "operating system runs can address that memory. Teal is "
               "sealed, grey is encrypted-but-readable, red is readable "
               "and plain. On this row the decrypt and decode steps happen "
               "inside a Trusted Execution Environment, so the frame "
               "exists in memory the OS cannot name.",
               13000),

        _stage("the_grab", "grab", {"grabAt": 5},
               "The grab",
               "Fire the capture at the compositor and see what comes back.",
               "Black. And here is the part people get wrong: nothing was "
               "blocked. The capture API was not refused, no alarm fired, "
               "Netflix was never told. The screenshot read the "
               "framebuffer, which is what a screenshot does, and the "
               "framebuffer contained an empty surface. The real pixels "
               "are overlaid in hardware afterwards, on the way to the "
               "panel, and never pass through memory the OS owns.",
               13000),

        _stage("other_path", "grab", {"grabAt": 5, "forcePath": "software"},
               "The same row, the other path",
               "One thing changed. The capture returns the frame.",
               "Same seven steps, same sample, same probe at the same "
               "point — but with decryption in ordinary process memory "
               "instead of a TEE. Now the frame is in the framebuffer "
               "alongside every other window, and the capture returns it, "
               "because it is there. This is not a weaker version of the "
               "protection. It is the absence of a place to hide, and it "
               "is what every software-path row in the next stage is "
               "actually describing.",
               13000),

        _stage("the_receipt", "table", {},
               "The receipt",
               "Netflix publishes the caps. The pattern is the fingerprint.",
               "2160p appears only where a hardware path exists — no "
               "software-only row reaches it, on any OS, in any browser. "
               "Two rows are nearly a controlled experiment. Edge is "
               "2160p on Windows and 720p on macOS: same engine, same "
               "vendor, same site. And Chrome on Windows sat at 720p for "
               "years until Chromium gained a hardware DRM path, at which "
               "point it became 4K — the video code did not change. "
               "Honest caveat: the caps are published, the DRM system per "
               "row is inferred. The claim here is about the pattern, and "
               "a single 2160p software row would break it.",
               15000),
    ],
})
