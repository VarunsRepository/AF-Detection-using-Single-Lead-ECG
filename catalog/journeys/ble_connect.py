# ---------------------------------------------------------------------------
# catalog/journeys/ble_connect.py
#
# "Twenty-six packets to deliver two bytes" -- everything that happens
# between a sensor starting to advertise and the first temperature value
# arriving.
#
# This is the companion to `ble_txpath`, which starts from an established
# connection. Split deliberately: setup is six stages and the transmit
# path is twelve, and eighteen in one journey is not a short.
#
#   ble_connect   how the connection comes to exist        6 stages
#   ble_txpath    what one notification then costs        12 stages
#
# Both live in /tour/wireless alongside the backlog's items 13-15.
#
#
# WHY THIS PASSES THE BACKLOG'S THREE TESTS
#
#   1. It is a state sequence. Twenty-six packets in order, with real
#      turnaround gaps between them that differ by two hundred times.
#
#   2. Watching beats reading. Every BLE book has this message-sequence
#      diagram and they all share one flaw: every arrow is the same
#      length. The two gap scales -- 150 microseconds inside a connection
#      event, 30 milliseconds between them -- are the whole reason
#      connecting feels slow while transmitting feels instant, and a
#      static diagram cannot show it. The failure it shows is discovery:
#      dozens of round trips, which is why bonding caches the result.
#
#   3. It has an oracle, AND IT STATES ITS LIMIT. oracle_ble_connect.py
#      derives every field width, PDU total, on-air total and opcode from
#      Core specification field definitions, independently. What it
#      cannot verify is the ORDER of stage 4 -- either side may initiate
#      the feature exchange or the length update, and real stacks differ.
#      Stage 4's card says so in its own words. Per the backlog's rule, a
#      journey with no oracle for a claim must say so rather than let the
#      animation imply certainty.
#
#      The honest fix is a capture. _check_against_capture.js is written
#      and waiting for an nRF Sniffer export; until then stage 4's
#      ordering is a model.
#
#
# A NOTE ON THE GLOSSARY
#   Every stage surfaces a few terms from core/ble_glossary.js --
#   acronym, full name, and a plain-English name that uses no other
#   acronym. That file is NOT a registered component; it is core JS,
#   loaded unconditionally, and both BLE journeys read it. See the
#   wireless pack for the one-line template addition it needs.
# ---------------------------------------------------------------------------

import catalog
from catalog.glossaries.wireless import terms_for

SOURCE_ID = "ecg_single"   # placeholder: nothing is read from it

TEMPLATE = "shorts/journey_page.html"
API_ENDPOINT = f"/api/data/{SOURCE_ID}/samples"

# The link under test, shared by every stage so they cannot drift. 30 ms
# is a common phone-to-sensor interval and sits mid-range on the rail.
_LINK = {
    "intervalMs": 30,
    "deviceName": "nRF Temp Demo",   # must match CONFIG_BT_DEVICE_NAME
}

_RAIL = [
    {
        "ui": {"label": "Speed"},
        "action": {"target": "journey", "method": "cycleSpeed",
                   "payload": {"options": [0.5, 1.0, 1.5, 2.0]}},
    },
    {
        "ui": {"label": "Theme", "icon": "icon_theme"},
        "action": {"target": "journey", "method": "cycleTheme", "payload": {}},
    },
]

# The renderer, built per stage because each card carries its own term
# definitions. They are a VIEW concern -- they change nothing the DSPE
# computes -- so they ride on the renderer's config rather than being
# something the algorithm has to know about.
def _renderer(terms):
    return {
        "availableRenderers": [
            {"id": "exchange_view", "isDefault": True},
        ],
        "config": {
            "showGlossary": True,
            # terms_for() raises on an unknown key, and this runs at
            # import time -- so a typo fails startup loudly instead of
            # leaving a card silently undefined.
            "glossary": terms_for(terms),
        },
    }

_ORACLE_NOTE = (
    "Oracle: oracle_ble_connect.py derives every field width, packet total "
    "and opcode on this card from Bluetooth Core specification field "
    "definitions, independently of the animation. The arithmetic is exact, "
    "so the two agree byte for byte rather than within a tolerance."
)

_SCALE_NOTE = (
    "Not to scale, and the card says so on itself: every packet gets an "
    "equal slice of the animation, because the real gaps differ by two "
    "hundred times and a faithful version would spend its whole length on "
    "the last one. The gap figures printed are real. A * marks a value "
    "that is a model rather than a spec constant."
)


def _stage(stage_id, n, duration, title, caption, description, terms):
    """One stage. Six cards, one DSPE, one parameter apart."""
    return {
        "stageId": stage_id,
        "baseDurationMs": duration,
        "dataSource": {"mode": "HTTP_REST", "sourceId": SOURCE_ID},
        "dspEngine": {
            "availableAlgorithms": [{"id": "ble_connect", "isDefault": True}],
            "parameters": {**_LINK, "stage": n},
        },
        "renderingEngine": _renderer(terms),
        "railControls": _RAIL,
        "uiFillers": {"title": title, "caption": caption,
                      "description": description},
    }


BLE_CONNECT = {
    # BUMP THIS ON EVERY RECIPE CHANGE. register_journey compares it
    # against the copy in data_cache/JourneyStore and SKIPS the update
    # when it is not higher -- so an edited recipe with a stale version
    # is silently ignored, and the log line says "up to date", which
    # reads like success.
    "version": 1,  # v1: first build
    "label": "Twenty-six packets for two bytes",
    "description": (
        "Everything two devices say to each other before one of them can "
        "send a single temperature reading."
    ),
    "status": "experimental",
    "category": "wireless",

    "template": TEMPLATE,
    "api_endpoint": API_ENDPOINT,

    "globalThemes": {
        "activeTheme": "default",
        "themes": [
            {"id": "default",
             "palette": {"primary": "#4aa3d8", "accent": "#e0a030"}},
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

    "layout": {"title": "bottom", "caption": "bottom",
               "description": "bottom", "plot": "center",
               "railControls": "bottom"},

    "stages": [

        _stage(
            "advertising", 1, 9000,
            "Shouting into an empty room",
            "The same 38 bytes, on three channels.",
            "Nothing in Bluetooth Low Energy happens until a device starts "
            "advertising. The peripheral broadcasts one packet on channel 37, "
            "then 38, then 39, microseconds apart — that trio is one "
            "advertising event — and then sleeps and does it again. Anywhere "
            "from every 20 milliseconds to every 10.24 seconds, with a "
            "mandatory 0 to 10 millisecond random delay added each time so "
            "that two devices on the same interval cannot collide forever in "
            "lockstep.\n\n"
            "There is no addressing here and nobody is necessarily "
            "listening. The access address in the framing is 0x8E89BED6 — the "
            "same value on every Bluetooth Low Energy device on earth, fixed "
            "in the specification, because a scanner has to be able to "
            "recognise a packet before it knows who sent it.\n\n"
            "22 of the 38 bytes are the advertising data itself: flags, one "
            "16-bit service identifier, and the device name. The 31-byte "
            "ceiling on that payload is why BLE device names are short.\n\n"
            + _ORACLE_NOTE,
            ['ADV_IND', 'AdvData', 'AdvA', 'PDU', 'peripheral'],
        ),

        _stage(
            "connect_ind", 2, 10000,
            "One packet makes a connection",
            "34 bytes, and the link exists.",
            "A scanner that heard the advertisement and wants to connect "
            "replies 150 microseconds later, on the same channel. That gap "
            "is T_IFS and it is fixed by the specification, not chosen.\n\n"
            "One packet, no handshake, no negotiation — and from that moment "
            "there is a connection. Look at what it carries: a new random "
            "32-bit access address for this link alone, a checksum seed, the "
            "window that says when the first appointment starts, the "
            "interval, the latency, the supervision timeout, the 37-bit map "
            "of permitted channels, the hop increment, and the central's own "
            "clock accuracy.\n\n"
            "Every timing decision for the life of the connection, dictated "
            "by one side, in one packet, and never repeated. The peripheral "
            "does not get a vote — it can request changes later, but this is "
            "not a negotiation.\n\n"
            "The colours split it: three addresses, five timing fields, two "
            "channel fields. All one layer, doing three different jobs.\n\n"
            + _ORACLE_NOTE,
            ['CONNECT_IND', 'InitA', 'central', 'T_IFS', 'SCA'],
        ),

        _stage(
            "first_event", 3, 7000,
            "Alive, and carrying nothing",
            "Ten bytes each way. Zero payload.",
            "At the moment the transmit window specified, both sides leave "
            "the advertising channels for a data channel and the first "
            "connection event happens. The central transmits first — it "
            "always does — and the peripheral replies 150 microseconds "
            "later.\n\n"
            "Both packets are empty. Ten bytes on air, 80 microseconds, no "
            "payload at all: preamble, access address, a two-byte header, "
            "and a checksum.\n\n"
            "They are not useless. That header carries the sequence and "
            "next-expected-sequence bits, which are the entire "
            "acknowledgement scheme in Bluetooth Low Energy — there is no "
            "acknowledgement packet, every packet acknowledges the last one. "
            "So an empty exchange confirms both sides are alive and holds "
            "off the supervision timeout. It is a heartbeat.\n\n"
            + _ORACLE_NOTE,
            ['LLID', 'SN', 'NESN', 'MD'],
        ),

        _stage(
            "negotiation", 4, 12000,
            "Agreeing what both can do",
            "Seven packets. Still no application.",
            "Now the two controllers negotiate, and your application code is "
            "still asleep through all of it.\n\n"
            "Three exchanges, each a request and a response. The feature "
            "exchange trades 8-byte capability bitmaps — bit 5 is the "
            "251-byte payload extension, bit 8 is the 2 megabit radio mode. "
            "The length exchange proposes raising the payload past 27 bytes "
            "and settles on the smaller of each pair. The physical-layer "
            "exchange proposes the faster radio mode, and the central then "
            "sends an update indication naming an instant — a future "
            "appointment number both sides switch on, so neither changes "
            "early and loses the other.\n\n"
            "These are link-layer control packets. Two bits in the header "
            "mark the payload as a command rather than data, and one control "
            "packet never shares a packet with another.\n\n"
            "HONEST LIMIT, and this is the one claim on this card with no "
            "oracle behind it: the ORDER shown is a model. Either side may "
            "start the feature exchange or the length update, and Zephyr, "
            "the SoftDevice and iOS all differ in what they ask for and "
            "when. Only the update indication is fixed as central-only. "
            "Sniff your own link rather than trusting this sequence.\n\n"
            + _ORACLE_NOTE + "\n\n" + _SCALE_NOTE,
            ['LL', 'DLE', 'PHY', 'instant'],
        ),

        _stage(
            "mtu", 5, 8000,
            "Twenty-three bytes by default",
            "The first packet the host sends.",
            "The host finally speaks. The client asks the largest message "
            "the server can receive, the server answers with its own, and "
            "the agreed value is the smaller of the two.\n\n"
            "This is the first packet in the whole sequence whose payload is "
            "L2CAP rather than a link-layer command — a different pair of "
            "bits in the same header position, and suddenly the packet is "
            "carrying application-layer traffic.\n\n"
            "The default matters more than almost any other number in "
            "Bluetooth Low Energy. 23 bytes, of which 3 are the attribute "
            "protocol's own header, leaves 20 bytes for a value. Every "
            "notification, every read, capped at 20 bytes until this one "
            "exchange raises it — and it can only happen once per "
            "connection. There is no renegotiating it.\n\n"
            "20 plus 3 plus the 4-byte L2CAP header is 27, which is exactly "
            "the default link-layer payload maximum. Those two numbers were "
            "chosen to coincide, so one full attribute packet fits one "
            "unfragmented radio packet. The oracle asserts it.\n\n"
            + _ORACLE_NOTE + "\n\n" + _SCALE_NOTE,
            ['MTU', 'ATT_MTU', 'ATT', 'L2CAP'],
        ),

        _stage(
            "discovery", 6, 14000,
            "Reading the table, then subscribing",
            "Eleven packets. Then, finally, 2 bytes.",
            "The server holds one flat numbered list. Every row has a "
            "handle, an identifier saying what it means, and a value. "
            "Services and characteristics are just rows with special "
            "identifiers that group the rows after them — the structure is a "
            "convention, not a different kind of storage.\n\n"
            "So the client reads it. List the primary services. List the "
            "characteristics inside that range. List the descriptors after "
            "the value. Each request covers one handle range, each response "
            "packs as many rows as the agreed message size allows, and the "
            "client only learns it has finished when a request past the end "
            "of the table comes back as Attribute Not Found.\n\n"
            "Two rounds are shown in full and the third carries a marker, "
            "because a third identical round teaches only that there are "
            "many of them.\n\n"
            "Then the subscribe: a two-byte write to the descriptor at "
            "handle 4. Until that packet arrives the server is forbidden "
            "from pushing anything, which is the single most common reason a "
            "working peripheral appears to send nothing.\n\n"
            "And then the temperature. 2 bytes, 19 on air.\n\n"
            "Add it all up: 26 packets, 546 bytes on air, 338 milliseconds, "
            "to deliver 2 bytes of payload. A ratio of 273 to one. The "
            "companion journey shows the ongoing cost per reading after this "
            "— 23 bytes for 2, a ratio of 11.5. Setup costs twenty-four "
            "times more than the thing it enables.\n\n"
            "This is also why bonding exists. A bonded client caches the "
            "table and skips almost all of stage 6 next time.\n\n"
            + _ORACLE_NOTE + "\n\n" + _SCALE_NOTE,
            ['GATT', 'UUID', 'handle', 'CCCD', 'client', 'server'],
        ),
    ],
}


# ── registration ───────────────────────────────────────────────────────
# Idiom copied from catalog/journeys/beats.py. BLE_CONNECT stays a named
# constant, unlike beats.py's inline literal, so the check harness can
# import the recipe without standing up the whole catalog package.
journey_store = catalog.journey_store
journey_store.register_journey("ble_connect", BLE_CONNECT)
