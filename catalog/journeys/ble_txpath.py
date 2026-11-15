# ---------------------------------------------------------------------------
# ble_txpath_recipe.py
#
# Recipe for the `ble_txpath` journey: what happens between your code
# producing two bytes and those bytes leaving the antenna.
#
# Register it the same way the existing recipes are registered:
#
#     from ble_txpath_recipe import BLE_TXPATH
#     journey_store.register_journey("ble_txpath", BLE_TXPATH)
#
# Bump "version" to push a change through register_journey()'s
# version-based merge rather than deleting journeystore.json.
#
# THREE INTEGRATION POINTS to match against an existing recipe before
# this will load -- they are environment-specific and set here to the
# most likely values rather than guessed silently:
#
#   TEMPLATE      the Jinja template the other journeys use
#   API_ENDPOINT  the endpoint journey_bp.py serves this journey from
#   SOURCE_ID     a registered data source (see data_registry.js)
#
# SOURCE_ID is the one that matters. This journey is spec-driven: every
# number it draws comes from `parameters` below and from Core
# specification field widths, so both DSPEs ignore `data` entirely. The
# stage still needs to resolve SOMETHING, because dataSource is required
# and a null resolve aborts the stage. Point it at whichever lightweight
# source the non-signal journeys already use.
#
#
# WHY THIS PASSES THE BACKLOG'S THREE TESTS
#
#   1. It is a time series. The packet's life from produced to
#      acknowledged is a timeline with real durations spanning four
#      orders of magnitude, and the encapsulation chain is a state
#      sequence with one step per layer.
#
#   2. Watching beats reading. Every tutorial draws this as nine
#      equally-sized boxes; on a true axis one step is 184 microseconds
#      and another is 15,000. The picture is almost entirely one long bar
#      of nothing happening, and that bar is the explanation for BLE's
#      power consumption, its latency and why batching matters. Two
#      failures are shown as well: a dropped acknowledgement becoming a
#      silent retry, and a transmit queue overflowing.
#
#   3. It has an oracle. oracle_ble_txpath.py derives every number from
#      spec field widths and first principles, sharing no code with the
#      JS. The arithmetic is exact, so there is no tolerance to hide
#      behind -- any disagreement at all is a bug. It has already earned
#      its place once: it caught ITSELF being wrong about the size of an
#      empty link-layer PDU (it wrapped ATT and L2CAP headers round a
#      packet that carries neither, inflating the receive window by
#      56 us). The animation was right and the reference was not, which
#      is the less comfortable way for a check to pay off.
#
#
# SPLITTING THIS, IF TWELVE STAGES IS TOO LONG FOR ONE CARD
#   Stages 1-7 and 8-12 are independent and split cleanly:
#     ble_packet    the encapsulation chain and the batching fix
#     ble_airtime   the wait, the event, the hop, the retry, the queue
#   Both would sit in /tour/wireless alongside backlog items 13-15. The
#   only shared state is _PACKET below, so the split is two dicts and a
#   second register_journey() call. Judge it in the feed first.
#
#
# A NOTE ON THE OPENING STAGE
#   The natural cold open is the ECG sweep with pan_tompkins marking an
#   R-peak -- "here is where the two bytes came from" -- which would
#   connect the embedded tour to the ECG tour, as the backlog wants. It
#   is deliberately NOT included here, because the pan_tompkins stage
#   block and chart_v1 config keys would have been guessed rather than
#   copied. Lift that stage verbatim from the ecg recipe and put it in
#   front of stage 1; nothing else changes.
# ---------------------------------------------------------------------------

import catalog

SOURCE_ID = "ecg_single"   # placeholder: nothing is read from it

TEMPLATE = "shorts/journey_page.html"

# CORRECTED against catalog/journeys/beats.py. This is NOT a per-journey
# API route -- it is the data source's own samples lister, served by the
# generic /api/data/<source>/samples route in journey_bp. So it follows
# SOURCE_ID and changes with it, rather than being named for the journey.
API_ENDPOINT = f"/api/data/{SOURCE_ID}/samples"


# The packet under test, shared by every encapsulation stage so they
# cannot drift apart. Two bytes is one RR interval in milliseconds, which
# is what an on-chip Pan-Tompkins detector actually has to send.
_PACKET = {
    "bytesPerReading": 2,
    "encrypted": True,
    "phy": "1M",
    "attMtu": 23,          # the spec default
    "llPayloadMax": 27,    # the spec default
}

# The link under test. 30 ms is a common phone-to-sensor interval and
# sits in the middle of the range the rail offers.
_LINK = {
    "intervalMs": 30,
    "onAirBytes": 23,      # from _PACKET, verified by the oracle
    "payloadBytes": 2,
    "phy": "1M",
    "centralScaPpm": 50,       # a phone, crystal
    "peripheralScaPpm": 50,    # LFXO on the sensor
    "hopIncrement": 7,
    "startChannel": 0,
    "txBuffers": 3,
    "packetsPerEvent": 4,
}

_RAIL = [
    {
        "ui": {"label": "Speed", "icon": "icon_speed"},
        # Options listed explicitly, matching beats.py. bgp_maxprefix
        # passes an empty payload and relies on a default; the stable
        # journey states them, so this does too.
        "action": {"target": "journey", "method": "cycleSpeed",
                   "payload": {"options": [0.5, 1.0, 1.5, 2.0]}},
    },
    {
        "ui": {"label": "Theme", "icon": "icon_theme"},
        "action": {"target": "journey", "method": "cycleTheme", "payload": {}},
    },
]

_PACKET_RENDERER = {
    "availableRenderers": [
        {"id": "packet_stack_view", "isDefault": True},
    ],
    "config": {"showFieldBytes": True},
}

_TIMELINE_RENDERER = {
    "availableRenderers": [
        {"id": "tx_timeline_view", "isDefault": True},
    ],
    "config": {"showChannels": True},
}

# The batch and PHY controls are the lesson of stages 6 and 7 and noise
# everywhere before that -- a viewer who batches on stage 2 is shown a
# bigger ATT header, which teaches nothing. The recipe has veto power
# over a DSPE-declared choice but cannot invent one.
_HIDE_BATCH_AND_PHY = {
    "batchCount": {"hide": True},
    "phy": {"hide": True},
}


def _packet_stage(stage_id, up_to, duration, title, caption, description, **overrides):
    """One encapsulation stage. Six cards, one DSPE, one parameter apart."""
    params = {**_PACKET, "upToLayer": up_to, "batchCount": 1, **overrides}
    return {
        "stageId": stage_id,
        "baseDurationMs": duration,
        "dataSource": {"mode": "HTTP_REST", "sourceId": SOURCE_ID},
        "dspEngine": {
            "availableAlgorithms": [{"id": "ble_encapsulation", "isDefault": True}],
            "parameters": params,
        },
        "renderingEngine": _PACKET_RENDERER,
        "choiceControls": dict(_HIDE_BATCH_AND_PHY) if up_to < 5 else {},
        "railControls": _RAIL,
        "uiFillers": {"title": title, "caption": caption, "description": description},
    }


def _timeline_stage(stage_id, duration, title, caption, description, **overrides):
    """One timeline stage. Interval stays on the rail: it is the trade-off."""
    return {
        "stageId": stage_id,
        "baseDurationMs": duration,
        "dataSource": {"mode": "HTTP_REST", "sourceId": SOURCE_ID},
        "dspEngine": {
            "availableAlgorithms": [{"id": "ble_tx_timeline", "isDefault": True}],
            "parameters": {**_LINK, **overrides},
        },
        "renderingEngine": _TIMELINE_RENDERER,
        "railControls": _RAIL,
        "uiFillers": {"title": title, "caption": caption, "description": description},
    }


_ORACLE_NOTE = (
    "Oracle: oracle_ble_txpath.py derives every number here from Bluetooth "
    "Core specification field widths, independently of the animation. The "
    "arithmetic is exact, so the two must agree byte for byte rather than "
    "within a tolerance."
)

_MODEL_NOTE = (
    "Model, not measurement: the 400 us crystal startup and 40 us radio "
    "ramp-up are nRF52840 figures and depend on your crystal. Three transmit "
    "buffers and four packets per event are stack configuration, not "
    "protocol. Everything else on this card is specification arithmetic."
)


BLE_TXPATH = {
    # BUMP THIS ON EVERY RECIPE CHANGE. register_journey compares it
    # against the copy in data_cache/JourneyStore and SKIPS the update
    # when it is not higher -- so an edited recipe with a stale version
    # is silently ignored, and the log line says "up to date", which
    # reads like success. Keep the one-line history below it, as
    # beats.py does.
    "version": 1,  # v1: first build
    "label": "Two bytes, twenty-three on air",
    "description": (
        "What happens between your code producing a number and that number "
        "leaving the antenna. Mostly, what happens is waiting."
    ),
    "status": "experimental",
    "category": "wireless",

    "template": TEMPLATE,
    "api_endpoint": API_ENDPOINT,

    "globalThemes": {
        "activeTheme": "default",
        "themes": [
            {
                "id": "default",
                "palette": {"primary": "#4aa3d8", "accent": "#e0a030"},
            },
        ],
    },

    "journeyRules": {
        "autoAdvance": True,
        "preloadNextStage": True,
        "allowStageNavigation": True,
    },

    "uiShell": {
        "showProgressBar": True,
        "progressBar": {
            "position": "top",
            "activeColor": "globalThemes.activeTheme.palette.primary",
            "inactiveColor": "rgba(255,255,255,0.22)",
        },
    },

    "playbackConfig": {"isPaused": False},

    # Present in beats.py and absent from bgp_maxprefix, so it is
    # optional with defaults. Stated here because twelve stages of dense
    # copy want the text pinned to the bottom rather than wherever the
    # default puts it.
    "layout": {"title": "bottom", "caption": "bottom",
               "description": "bottom", "plot": "center",
               "railControls": "bottom"},

    "stages": [

        # ══ PHASE 0 — the data exists ═════════════════════════════════
        _packet_stage(
            "the_payload", 0, 7000,
            "Two bytes",
            "One RR interval. The whole message.",
            "A heartbeat detector on the chip has found an R-peak and measured "
            "the gap since the last one. At a sixteenth of a millisecond of "
            "resolution that fits in a 16-bit integer, so the thing worth "
            "sending is two bytes wide.\n\n"
            "That is the entire payload. Everything in the next six cards is "
            "packaging, and none of it is optional.\n\n"
            "Hold this picture. The bar is drawn to the size the packet will "
            "eventually be, not to the size it is now, so the empty space to "
            "the right is what the protocol is about to fill."
        ),

        # ══ PHASE A — one wrapper per card ════════════════════════════
        _packet_stage(
            "att", 1, 7000,
            "ATT adds three",
            "An opcode and a handle. 5 bytes.",
            "The Attribute Protocol is a key-value store. The server holds a "
            "flat table of attributes, each with a 16-bit handle, and the "
            "client reads, writes or subscribes by handle.\n\n"
            "So a notification has to say two things beyond the value itself: "
            "what kind of message this is (opcode 0x1B, Handle Value "
            "Notification) and which attribute it concerns (the handle). One "
            "byte and two bytes.\n\n"
            "This is also where the first real constraint lives. The default "
            "ATT MTU is 23 bytes, and three of those are this header, so a "
            "notification value cannot exceed 20 bytes until the MTU is "
            "negotiated up. That ceiling catches more people than any other "
            "number in BLE.\n\n"
            + _ORACLE_NOTE
        ),

        _packet_stage(
            "l2cap", 2, 7000,
            "L2CAP adds four",
            "A length and a channel. 9 bytes.",
            "The Logical Link Control and Adaptation Protocol multiplexes. A "
            "single BLE connection carries attribute traffic, security "
            "handshakes and link signalling, and something has to say which "
            "of them this packet is.\n\n"
            "Two bytes of length, two bytes of channel identifier. ATT always "
            "travels on the fixed channel 0x0004; 0x0005 is signalling and "
            "0x0006 is the Security Manager.\n\n"
            "L2CAP also fragments, which does not happen here: 20 bytes of "
            "value plus 3 of ATT plus 4 of L2CAP is 27, and 27 is exactly the "
            "default link-layer payload maximum. Those two defaults were "
            "chosen to coincide, so one full-size ATT packet fits one "
            "unfragmented link-layer packet. The oracle asserts it.\n\n"
            + _ORACLE_NOTE
        ),

        _packet_stage(
            "link_layer", 3, 7000,
            "The link layer adds two",
            "Flags and a length. 11 bytes.",
            "From here down, the controller owns the packet and your code "
            "cannot reach it. Two bytes: one of flags, one of length.\n\n"
            "The flags byte is doing a remarkable amount of work for eight "
            "bits. Two bits of LLID say whether this is the start of an L2CAP "
            "message, a continuation, or a control message. One bit of SN and "
            "one of NESN are the entire acknowledgement scheme — there is no "
            "ACK packet in BLE, every packet acknowledges the last one. One "
            "bit of MD says whether more data is waiting, which is how "
            "several packets get chained into one connection event.\n\n"
            "Reliability, flow control and framing, in two bytes.\n\n"
            + _ORACLE_NOTE
        ),

        _packet_stage(
            "encryption", 4, 7000,
            "Encryption adds four",
            "A message integrity check. 15 bytes.",
            "The CCM peripheral encrypts the payload in place with the "
            "session key and appends a four-byte Message Integrity Check. "
            "Hardware, via DMA — the processor never touches the bytes.\n\n"
            "The MIC is what makes the link tamper-evident rather than merely "
            "private. Without it an attacker could flip bits in the "
            "ciphertext and the receiver would decrypt something different "
            "and have no way to know.\n\n"
            "Four bytes is twice the size of the data being protected. That is "
            "the correct trade and it is still worth noticing.\n\n"
            + _ORACLE_NOTE
        ),

        _packet_stage(
            "on_air", 5, 10000,
            "On air: twenty-three",
            "2 bytes of data. 184 microseconds.",
            "The radio adds the last eight bytes as it transmits: a one-byte "
            "preamble for the receiver's gain control and clock recovery, the "
            "four-byte access address identifying this connection, and a "
            "three-byte CRC computed on the fly.\n\n"
            "Twenty-three bytes on air for two bytes of data. An overhead "
            "ratio of 11.5 to one, and a payload fraction of 8.7%. At "
            "1 Mbps that is 184 microseconds of airtime, of which 16 carry "
            "anything anyone wanted.\n\n"
            "Tap PHY. LE 2M doubles the symbol rate and costs one extra "
            "preamble byte, so the same packet becomes 24 bytes and 96 "
            "microseconds — which is better for battery life despite drawing "
            "more current, because energy is current times time.\n\n"
            "Then tap Batch, because the ratio is not a law of nature.\n\n"
            + _ORACLE_NOTE
        ),

        _packet_stage(
            "batching", 5, 11000,
            "Send ten at once",
            "230 bytes becomes 41.",
            "The fixed overhead is paid per packet, not per byte. So the fix "
            "is not to make the headers smaller — you cannot — but to send "
            "fewer, fuller packets.\n\n"
            "Ten RR intervals buffered and sent together is 20 bytes of "
            "payload in a 41-byte packet. Sent one at a time they would cost "
            "ten packets of 23 bytes: 230 bytes on air against 41. A factor "
            "of 5.6, for the same data, with no protocol changes and no "
            "parameter tuning.\n\n"
            "The overhead ratio falls from 11.5 to 2.05. And 20 bytes is "
            "exactly the default ATT value limit, so the batch runs out of "
            "room at the same moment the lesson lands — push past it and the "
            "card tells you to negotiate the MTU up.\n\n"
            "For an ECG device this is the difference between a coin cell "
            "lasting weeks and lasting a year. The cost is latency: a reading "
            "now waits for nine more before it leaves.\n\n"
            + _ORACLE_NOTE,
            # CAUGHT BY _check_copy.js: this was missing, so the stage was a
            # silent duplicate of `on_air` -- identical picture, while the
            # prose claimed 41 bytes and a 5.6x saving. Exactly the ITSM
            # "estimated, not computed" failure recorded in the master
            # document, and invisible without a check that reads the prose.
            batchCount=10,
        ),

        # ══ PHASE B and C — the wait, and the event ═══════════════════
        _timeline_stage(
            "the_wait", 12000,
            "Then it waits",
            "1.2% of the time was transmitting.",
            "Here is the part no sequence diagram shows honestly.\n\n"
            "bt_gatt_notify() does not transmit. It builds the packet, puts it "
            "in the controller's transmit queue, and returns in a few "
            "microseconds. The packet then sits there until the next "
            "connection event, which arrives on the central's schedule and "
            "not yours.\n\n"
            "On a 30 ms interval the average wait is 15 milliseconds. The "
            "transmission itself is 184 microseconds. So about 1.2% of the "
            "elapsed time between your code producing the data and the peer "
            "receiving it was spent transmitting, and the rest was waiting "
            "for an appointment.\n\n"
            "Watch the top two lanes. Your code and the controller share one "
            "processor, and at this scale neither has any width at all — "
            "their work is drawn as ticks because it is narrower than a "
            "pixel. That is not a drawing shortcut. It is the honest answer "
            "to \"how much CPU does BLE cost\".\n\n"
            "Tap Interval. At 1 second the duty cycle falls to 0.11% and the "
            "transmission becomes 0.04% of the elapsed time — years on a coin "
            "cell, and up to a second of latency. At 7.5 ms it climbs to "
            "nearly 12% and the data is almost immediate. There is no third "
            "option: the same knob sets both, in opposite directions.\n\n"
            + _ORACLE_NOTE + "\n\n" + _MODEL_NOTE,
            zoom="interval",
        ),

        _timeline_stage(
            "the_event", 11000,
            "Inside one event",
            "184 microseconds of 900.",
            "Zoomed in by a factor of thirty, the connection event has "
            "structure.\n\n"
            "The chip wakes 400 microseconds early, because the radio cannot "
            "run on the internal RC oscillator and the 32 MHz crystal needs "
            "that long to stabilise. Then 40 microseconds of radio ramp-up, "
            "184 of transmission, a 150 microsecond inter-frame space fixed "
            "by the spec, 40 more of ramp-up to receive, and 86 listening for "
            "the reply.\n\n"
            "Nine hundred microseconds awake to move two bytes. The crystal "
            "startup alone costs more than twice the transmission.\n\n"
            "That receive window is wider than the reply needs, because both "
            "clocks drift and the receiver has to open early and close late. "
            "At 30 ms with crystals on both ends that is 3 microseconds each "
            "side. Run the sensor on its internal RC oscillator at a 1 second "
            "interval and it becomes 550 microseconds each side — a receive "
            "window dominated entirely by not knowing what time it is. This "
            "is why the 32.768 kHz crystal earns its board area.\n\n"
            + _ORACLE_NOTE + "\n\n" + _MODEL_NOTE,
            zoom="event",
        ),

        _timeline_stage(
            "the_hop", 9000,
            "A different channel each time",
            "0 → 7 → 14 → 21 → 28 → 35 → 5",
            "Every connection event uses a different one of the 37 data "
            "channels, and the next one is simply the last plus a fixed "
            "increment, modulo 37.\n\n"
            "The increment was agreed once, in the single CONNECT_IND packet "
            "that established the connection, and never mentioned again. Both "
            "ends run the identical calculation and arrive at the identical "
            "channel, so frequency hopping costs nothing on air — no "
            "announcement, no negotiation, no overhead.\n\n"
            "Because 37 is prime, any non-zero increment eventually visits "
            "every channel. The spec's 5-to-16 range is not about coverage: "
            "an increment of 1 would walk through adjacent channels, so a "
            "wide interferer — a Wi-Fi channel, say — would hit you several "
            "events in a row rather than once.\n\n"
            "This is also why a sniffer must capture the CONNECT_IND. It has "
            "no privileged access; it follows a connection by running the "
            "same arithmetic. Start sniffing after two devices have already "
            "connected and you see nothing at all.\n\n"
            + _ORACLE_NOTE
        ),

        # ══ PHASE D — the acknowledgement, and the two failures ═══════
        _timeline_stage(
            "the_retry", 10000,
            "When the reply doesn't come",
            "Kept, and sent again 30 ms later.",
            "The peer's reply carries one bit — NESN — saying whether our "
            "packet arrived. If it does not say so, the controller keeps the "
            "packet and transmits it again at the next connection event. And "
            "the next. Indefinitely, until it succeeds or the supervision "
            "timeout declares the link dead.\n\n"
            "Two consequences worth holding onto.\n\n"
            "First, a BLE connection has no silent packet loss. Your "
            "notification is not dropped in transit; it is delayed. Code that "
            "worries about lost readings on a live link is worrying about the "
            "wrong thing.\n\n"
            "Second, what you get instead is jitter. A retry costs a whole "
            "connection interval, so on a 1 second interval a single failed "
            "transmission delays your data by a second. If your application "
            "cares when a reading was taken, timestamp it at the sensor. The "
            "arrival time tells the receiver nothing useful.\n\n"
            "Notice the retry goes out on a different channel. That is the "
            "hopping doing its job: the channel that failed is not the "
            "channel that is tried again.\n\n"
            + _ORACLE_NOTE,
            zoom="interval", failFirstTx=True,
        ),

        _timeline_stage(
            "the_queue", 11000,
            "The queue is finite",
            "500/s into a 133/s pipe.",
            "The queue your notification went into holds three packets, and "
            "the connection drains about four per event. On a 30 ms interval "
            "that is 133 notifications a second, exactly, and it is a ceiling "
            "rather than a guideline.\n\n"
            "Call notify faster and the queue fills. The call then returns "
            "-ENOMEM, or -ENOBUFS depending on your stack, and it is your job "
            "to back off and retry when a transmit-complete event arrives. At "
            "500 a second the three buffers are gone in 8 milliseconds.\n\n"
            "This is the failure mode that separates a sensor from a data "
            "logger. One RR interval per beat is about one notification a "
            "second and will never trouble this. Streaming raw ECG at 500 Hz, "
            "batched ten samples to a packet, is 50 a second — still "
            "sustainable, but fifty times the radio time, and the first thing "
            "you will hit if you shorten the interval to reduce latency "
            "without recomputing the ceiling.\n\n"
            "The fix is the one from stage 7. Fuller packets, fewer of them.\n\n"
            + _ORACLE_NOTE + "\n\n" + _MODEL_NOTE,
            zoom="interval", notifyHz=500,
        ),
    ],
}


# ── registration ───────────────────────────────────────────────────────
# Idiom copied verbatim from catalog/journeys/beats.py: `import catalog`
# plus attribute access, NOT `from catalog import journey_store`.
# catalog/__init__.py imports this module from its own bottom, so the
# package is only partially initialised at this point. Binding the module
# and reading the attribute keeps the failure legible as an AttributeError
# if that import order ever moves, rather than the more confusing
# "cannot import name from partially initialized module".
#
# ONE DELIBERATE DEVIATION from beats.py, which passes an inline dict
# literal: BLE_TXPATH stays a named constant so the check harness can
# import the recipe WITHOUT importing the whole catalog package. That
# isolation is what caught the missing batchCount on stage 7 and the
# wrong duty-cycle figure in stage 8's prose before either ever ran.
#
# The CALL lives here because it needs BLE_TXPATH to exist. The IMPORT is
# at the top of the file, where it belongs -- there is no circular-import
# reason to defer it. catalog/__init__.py binds journey_store well before
# it reaches the recipe imports at its own bottom, so the package being
# only partially initialised at this point is harmless.
journey_store = catalog.journey_store
journey_store.register_journey("ble_txpath", BLE_TXPATH)
