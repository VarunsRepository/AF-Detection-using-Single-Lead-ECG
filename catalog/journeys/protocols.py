# ---------------------------------------------------------------------------
# catalog/journeys/protocols.py
#
# How two chips agree on anything.
#
# WHY THIS IS ONE JOURNEY AND NOT FOUR
#   UART, SPI, I2C and CAN look like four subjects and are one: every
#   card is a voltage against time, a rule for where to look, and a byte
#   that either comes back or does not. Splitting them into four journeys
#   would hide the only idea worth carrying away -- that a protocol is a
#   convention about SAMPLING INSTANTS, and almost every bus bug is two
#   devices disagreeing about where those instants are.
#
# THE ARGUMENT THE STAGES MAKE
#   1  read the wire   the bytes are in there, if you look at the right moments
#   2  break one thing  move the moments, or the world, and watch it fail
#
# THE SECOND STAGE IS NOT ONE LESSON
#   Each frame names its own failure, the way each pathway names its own
#   regulated step. UART gets the wrong baud, SPI gets the wrong shift
#   direction, I2C loses its device, CAN has its identifiers swapped --
#   one stage, a different lesson on every card.
#
#   Two of those change the RECEIVER and leave the wire untouched, which
#   is why the picture is identical and only the sample ticks move. The
#   other two change the WORLD and carry a genuinely different waveform.
#   Nothing is faked in either case: the wrong bytes are whatever those
#   sampling instants actually landed on.
# ---------------------------------------------------------------------------

import catalog

journey_store = catalog.journey_store

_RAIL = [
    # Deliberately only the two journey-level controls.
    #
    # The Readout switch and the per-protocol controls are NOT declared
    # here: the renderer declares emphasis and the DSPE declares the
    # frame's own conditions, and the engine builds the rail from that
    # intersection. So a SPI card gets a Shift button and a UART card
    # gets a Receiver button, instead of every card carrying four
    # controls that three of them ignore -- the same reason the pathway
    # recipe dropped its Route button.
    #
    # There is also no Renderer button, because there is one renderer. A
    # button that cycles a list of length one is a control that asserts
    # a choice the data cannot support.
    {"ui": {"label": "Speed"},
     "action": {"target": "journey", "method": "cycleSpeed",
                "payload": {"options": [0.5, 1.0, 1.5, 2.0]}}},
    {"ui": {"label": "Theme", "icon": "icon_theme"},
     "action": {"target": "journey", "method": "cycleTheme", "payload": {}}},
]


def _stage(stage_id, params, title, caption, description, ms):
    return {
        "stageId": stage_id,
        "dataSource": {"mode": "HTTP_REST", "sourceId": "protocol_frame"},
        "dspEngine": {
            "availableAlgorithms": [{"id": "protocol", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": {
            "availableRenderers": [{"id": "timing_view", "isDefault": True}],
            "config": {},
        },
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
        "railControls": _RAIL,
        "baseDurationMs": ms,
    }


journey_store.register_journey("protocols", {
    "version": 1,
    "label": "How Chips Agree",
    "description": "UART, SPI, I2C and CAN, decoded off the wire",
    "status": "stable",
    "category": "embedded",
    "template": "shorts/journey_page.html",
    "api_endpoint": "/api/data/protocol_frame/samples",
    "globalThemes": {"activeTheme": "bus",
                     "themes": [{"id": "bus",
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
        _stage("read_the_wire", {},
               "{frame.name}",
               "{frame.blurb}",
               "The ticks across each lane are not decoration — they are "
               "the instants the receiver actually looks at the line, and "
               "everything between them is ignored. A protocol is mostly a "
               "convention about where those instants fall: UART counts "
               "them off its own clock from one falling edge, SPI is told "
               "by a wire, I2C reads while the clock is high, and CAN "
               "watches the bus while it talks. Nothing here knows what "
               "was sent — the bytes underneath were recovered from the "
               "edges alone.",
               13000),

        _stage("break_one_thing", {"perturb": True},
               "Break One Thing",
               "{note}",
               "Each frame names its own failure. Two of them misconfigure "
               "the RECEIVER and leave the wire untouched, so the picture "
               "is pixel-identical and only the sample ticks move — which "
               "is exactly why a wrong baud rate is silent rather than "
               "loud. The other two change the world: no device answers, "
               "or the identifiers move, and the waveform genuinely "
               "differs. None of the wrong answers are written down "
               "anywhere. They are whatever those sampling instants "
               "landed on.",
               12000),
    ],
})
