# ---------------------------------------------------------------------------
# catalog/glossaries/wireless.py
#
# Acronym, full name, a plain-English name, and a short swappable form.
#
# WHY HERE AND NOT IN static/shorts/core/
#   core/ is the engine -- the interpreter, the registries, the feed. It
#   is app infrastructure and strictly app only. A glossary is DOMAIN
#   CONTENT, and domain content already has a home: catalog/, which is
#   where sources/, packs/ and journeys/ all split one module per domain.
#   Twenty domains with their own vocabulary would turn core/ into a
#   dumping ground, which is the argument that moved this file.
#
#   It also costs nothing at the client: the terms travel inside the
#   recipe a stage already sends, so there is no extra script tag, no
#   load-order constraint, and nothing to forget.
#
# WHY THE TERMS GO ON THE RENDERER'S CONFIG
#   A glossary is a view concern. It changes nothing a DSPE computes, and
#   the DSPE should not have to know the card wants to explain itself. So
#   `terms_for()` output goes into renderingEngine.config and the
#   renderer reads it from there.
#
# WHY A THIRD COLUMN
#   "PDU = Protocol Data Unit" is not an explanation, it is the same
#   opacity with more syllables. `plain` is the one a viewer actually
#   reads: what the thing IS, in words that need no further expansion.
#
# WHY A FOURTH COLUMN -- `short`
#   `plain` is a DEFINITION, and a definition cannot be dropped into a
#   sentence. Substituting it gives "The layer that says which kind of
#   traffic a packet is multiplexes", which is broken English.
#
#   `short` is the form the jargon switch actually uses: a noun phrase
#   that stands exactly where the acronym stood, so one written sentence
#   serves both registers.
#
#       "{{L2CAP}} adds four bytes"
#         termLevel full   -> "L2CAP adds four bytes"
#         termLevel plain  -> "the multiplexing layer adds four bytes"
#
#   THE TEST FOR A GOOD `short`: substitute it into a real sentence from
#   a card and read the sentence aloud. If it needs the surrounding words
#   changed, it is a definition, not a short form.
#
#   It must also be a NOUN PHRASE, including its article where one is
#   needed -- "the multiplexing layer", not "multiplexes". The acronym it
#   replaces is a noun, so its substitute has to be one too.
#
# WHY A FIFTH COLUMN -- `emoji`, and why most terms have none
#   Repeated glyphs teach; unique glyphs decorate. A symbol that appears
#   on one card is a picture, and the card's own title explains more than
#   a picture does. A symbol that appears wherever a TERM appears
#   accumulates meaning: by the third card, a reader who has seen the
#   lock beside the integrity check knows what it marks.
#
#   So `emoji` is deliberately sparse. It is set only where the term
#   recurs across cards AND the glyph is unambiguous. Most entries have
#   none, and that is the intended state rather than unfinished work.
#
#   Shown only when termLevel is "plain". A sober theme stays sober.
#
# THE RULE FOR ADDING ONE
#   `plain` AND `short` must use no other acronym from this file. If they
#   need one, they are not plain enough. Enforced by
#   tests/check_glossary.py, which fails on any plain or short name
#   containing another key as a whole word.
#
# ── ENTRIES NEEDING A SECOND OPINION ──────────────────────────────────
#   Marked `# REVIEW` inline. These are the ones where a short form risks
#   being plausible but wrong, which on this material is worse than being
#   clumsy:
#
#     LLID    "the packet-type bits" -- compresses three possible values
#             into one phrase; check it does not read as a single flag
#     SCA     "the clock-drift rating" -- it is a rating OF the drift,
#             not the drift itself
#     instant "the agreed switch-over point" -- the spec means a specific
#             connection-event COUNT, which "point" leaves vague
#     CCM     "the encrypt-and-verify mode" -- accurate but loses that
#             the two operations share one pass
#     GFSK    "the frequency-nudging scheme" -- informal to the point of
#             being odd next to the real name
#     DLE     "the longer-packet option" -- fine, but 251-vs-27 is the
#             actual content and the number is what people remember
# ---------------------------------------------------------------------------

TERMS: dict[str, dict[str, str]] = {

    # ── the layers ────────────────────────────────────────────────────────
    "PDU": {
        "full": "Protocol Data Unit",
        "plain": "one packet's worth of content, as a given layer sees it",
        "short": "the packet body",
    },
    "ATT": {
        "full": "Attribute Protocol",
        "plain": "the read, write and notify protocol over a numbered table of values",
        "short": "the read-and-write protocol",
    },
    "GATT": {
        "full": "Generic Attribute Profile",
        "plain": "the agreed way of arranging that table into services and characteristics",
        "short": "the table's layout rules",
    },
    "L2CAP": {
        "full": "Logical Link Control and Adaptation Protocol",
        "plain": "the layer that says which kind of traffic a packet is, and splits long ones up",
        "short": "the multiplexing layer",
    },
    "SMP": {
        "full": "Security Manager Protocol",
        "plain": "the pairing conversation that produces a shared key",
        "short": "the pairing conversation",
        "emoji": "🔑",
    },
    "GAP": {
        "full": "Generic Access Profile",
        "plain": "the rules for how devices find and connect to each other",
        "short": "the find-and-connect rules",
    },
    "LL": {
        "full": "Link Layer",
        "plain": "the part that owns the radio's timing, acknowledgements and retries",
        "short": "the radio timing layer",
    },
    "HCI": {
        "full": "Host Controller Interface",
        "plain": "the boundary between the timing-critical half and the application half",
        "short": "the controller boundary",
    },

    # ── inside a packet ───────────────────────────────────────────────────
    "LLID": {
        "full": "Logical Link Identifier",
        "plain": "two bits saying whether this packet carries data, a fragment, or a command",
        "short": "the packet-type bits",   # REVIEW -- three values, one phrase
    },
    "MIC": {
        "full": "Message Integrity Check",
        "plain": "four bytes proving nobody altered the packet in flight",
        "short": "the tamper check",
        # Recurs on the encryption stage, the on-air stage and the
        # byte-budget stages -- earns a glyph by repetition.
        "emoji": "🔒",
    },
    "CRC": {
        "full": "Cyclic Redundancy Check",
        "plain": "three bytes that catch a packet damaged by noise",
        "short": "the damage check",
    },
    "SN": {
        "full": "Sequence Number",
        "plain": "one bit numbering this packet, so a repeat can be spotted",
        "short": "the packet-number bit",
    },
    "NESN": {
        "full": "Next Expected Sequence Number",
        "plain": "one bit telling the other side whether the last packet arrived",
        "short": "the acknowledgement bit",
        # The whole acknowledgement scheme in BLE is this one bit, and it
        # comes up on the empty-packet, retry and header stages.
        "emoji": "✅",
    },
    "MD": {
        "full": "More Data",
        "plain": "one bit meaning keep listening, there is another packet coming",
        "short": "the more-coming bit",
    },
    "AdvData": {
        "full": "Advertising Data",
        "plain": "up to 31 bytes of whatever you want strangers to know about you",
        "short": "the broadcast payload",
    },
    "AdvA": {
        "full": "Advertiser Address",
        "plain": "the six bytes identifying who is advertising",
        "short": "the broadcaster's address",
    },
    "InitA": {
        "full": "Initiator Address",
        "plain": "the six bytes identifying who is asking to connect",
        "short": "the caller's address",
    },

    # ── sizes and limits ──────────────────────────────────────────────────
    "MTU": {
        "full": "Maximum Transmission Unit",
        "plain": "the largest single message the other side promises it can receive",
        "short": "the message size limit",
        "emoji": "📏",
    },
    "DLE": {
        "full": "Data Length Extension",
        "plain": "the option to send 251 bytes a packet instead of 27",
        "short": "the longer-packet option",   # REVIEW -- loses 251 vs 27
    },
    "ATT_MTU": {
        "full": "Attribute Protocol Maximum Transmission Unit",
        "plain": "the largest value a read or a notification can carry, 23 bytes until raised",
        "short": "the value size limit",
        "emoji": "📏",
    },

    # ── timing ────────────────────────────────────────────────────────────
    "T_IFS": {
        "full": "Inter Frame Space",
        "plain": "the fixed 150 microsecond gap between one packet and the reply",
        "short": "the fixed reply gap",
        # Timing is the whole point of both BLE journeys, and this gap
        # appears on five of the six connect stages.
        "emoji": "⏱",
    },
    "SCA": {
        "full": "Sleep Clock Accuracy",
        "plain": "how badly a device's slow clock drifts, which decides how early it must start listening",
        "short": "the clock-drift rating",   # REVIEW -- rating OF drift
    },
    "HFXO": {
        "full": "High Frequency Crystal Oscillator",
        "plain": "the 32 megahertz crystal the radio cannot run without",
        "short": "the fast crystal",
    },
    "LFXO": {
        "full": "Low Frequency Crystal Oscillator",
        "plain": "the accurate slow crystal that times sleep between appointments",
        "short": "the accurate slow crystal",
    },
    "LFRC": {
        "full": "Low Frequency RC Oscillator",
        "plain": "the cheap built-in slow clock, accurate enough only for short naps",
        "short": "the cheap slow clock",
    },
    "instant": {
        "full": "Instant",
        "plain": "a future appointment number both sides agree to change something on",
        "short": "the agreed switch-over point",   # REVIEW -- it is a COUNT
    },

    # ── roles ─────────────────────────────────────────────────────────────
    "central": {
        "full": "Central",
        "plain": "the side that starts the connection and sets its timetable",
        "short": "the connecting side",
    },
    "peripheral": {
        "full": "Peripheral",
        "plain": "the side that advertises and keeps to the other's timetable",
        "short": "the advertising side",
    },
    "client": {
        "full": "Client",
        "plain": "the side that asks for values",
        "short": "the asking side",
    },
    "server": {
        "full": "Server",
        "plain": "the side that holds the values",
        "short": "the holding side",
    },

    # ── the bits people most often have to ask about ──────────────────────
    "CCCD": {
        "full": "Client Characteristic Configuration Descriptor",
        "plain": "the switch a reader flips to say yes, push updates to me",
        "short": "the subscribe switch",
        # The single most common reason a working peripheral appears to
        # send nothing, per the discovery stage. Worth marking everywhere.
        "emoji": "🔔",
    },
    "UUID": {
        "full": "Universally Unique Identifier",
        "plain": "a number naming what a value means, so two vendors agree",
        "short": "the meaning number",
    },
    "handle": {
        "full": "Attribute Handle",
        "plain": "the row number of a value in the table",
        "short": "the row number",
    },
    "PHY": {
        "full": "Physical Layer",
        "plain": "how fast the bits go out, and how far they reach",
        "short": "the radio mode",
    },
    "GFSK": {
        "full": "Gaussian Frequency Shift Keying",
        "plain": "nudging the radio frequency up for a one and down for a zero",
        "short": "the frequency-nudging scheme",   # REVIEW -- informal
    },
    "CCM": {
        "full": "Counter with CBC-MAC",
        "plain": "the encryption mode that both hides the payload and proves it is untampered",
        "short": "the encrypt-and-verify mode",   # REVIEW -- one pass, not two
    },
    "ADV_IND": {
        "full": "Advertising Indication",
        "plain": "the packet that says I exist and you may connect to me",
        "short": "the advertising packet",
    },
    "CONNECT_IND": {
        "full": "Connection Indication",
        "plain": "the single packet that creates a connection and dictates its timing",
        "short": "the connection packet",
        "emoji": "🤝",
    },
    "AFH": {
        "full": "Adaptive Frequency Hopping",
        "plain": "dropping channels that keep failing, and using the rest",
        "short": "the channel-avoiding scheme",
    },
}


def terms_for(keys: list[str]) -> list[dict]:
    """
    The entries a stage should surface, in the order given -- the order a
    viewer meets them matters more than alphabetical.

    Raises on an unknown key rather than skipping it. This runs at import
    time, so a typo fails the app's startup loudly instead of quietly
    leaving a card with no definitions, which is the sort of silent
    degradation the master document keeps recording.
    """
    out = []
    for k in keys:
        if k not in TERMS:
            raise KeyError(
                f'wireless glossary: no entry for "{k}". '
                f'Known keys: {", ".join(sorted(TERMS))}')
        out.append({"acronym": k, **TERMS[k]})
    return out


def glossary_for_client() -> dict:
    """
    The whole glossary, in the shape journey_interpreter's fill() needs to
    resolve {{KEY}} tokens in a stage's prose.

    WHY THE WHOLE THING AND NOT A PER-STAGE SUBSET:
      terms_for() already ships a subset per stage, for the glossary chip
      the renderer draws -- that subset is an EDITORIAL choice about which
      terms a card introduces. Token substitution is a different need: any
      stage's prose may reference any term, and a token that silently
      failed to resolve because the editorial subset omitted it would
      leave a literal "{{T_IFS}}" on the card.

      The whole wireless glossary is about 3 KB of JSON. Shipping it once
      per journey costs less than the bug.

    Only the fields substitution needs. `full` and `plain` stay with the
    per-stage subset, because the chip is the only thing that shows them.
    """
    return {
        k: {"acronym": k,
            "short": v.get("short", k),
            "emoji": v.get("emoji")}
        for k, v in TERMS.items()
    }
