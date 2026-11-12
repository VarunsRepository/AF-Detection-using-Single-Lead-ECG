# ---------------------------------------------------------------------------
# catalog/glossaries/wireless.py
#
# Acronym, full name, and a plain-English name you could say out loud.
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
# THE RULE FOR ADDING ONE
#   `plain` must use no other acronym from this file. If it needs one,
#   it is not plain enough. Enforced by tests/check_glossary.py, which
#   fails on any plain name containing another key as a whole word.
# ---------------------------------------------------------------------------

TERMS: dict[str, dict[str, str]] = {

    # ── the layers ────────────────────────────────────────────────────────
    "PDU": {
        "full": "Protocol Data Unit",
        "plain": "one packet's worth of content, as a given layer sees it",
    },
    "ATT": {
        "full": "Attribute Protocol",
        "plain": "the read, write and notify protocol over a numbered table of values",
    },
    "GATT": {
        "full": "Generic Attribute Profile",
        "plain": "the agreed way of arranging that table into services and characteristics",
    },
    "L2CAP": {
        "full": "Logical Link Control and Adaptation Protocol",
        "plain": "the layer that says which kind of traffic a packet is, and splits long ones up",
    },
    "SMP": {
        "full": "Security Manager Protocol",
        "plain": "the pairing conversation that produces a shared key",
    },
    "GAP": {
        "full": "Generic Access Profile",
        "plain": "the rules for how devices find and connect to each other",
    },
    "LL": {
        "full": "Link Layer",
        "plain": "the part that owns the radio's timing, acknowledgements and retries",
    },
    "HCI": {
        "full": "Host Controller Interface",
        "plain": "the boundary between the timing-critical half and the application half",
    },

    # ── inside a packet ───────────────────────────────────────────────────
    "LLID": {
        "full": "Logical Link Identifier",
        "plain": "two bits saying whether this packet carries data, a fragment, or a command",
    },
    "MIC": {
        "full": "Message Integrity Check",
        "plain": "four bytes proving nobody altered the packet in flight",
    },
    "CRC": {
        "full": "Cyclic Redundancy Check",
        "plain": "three bytes that catch a packet damaged by noise",
    },
    "SN": {
        "full": "Sequence Number",
        "plain": "one bit numbering this packet, so a repeat can be spotted",
    },
    "NESN": {
        "full": "Next Expected Sequence Number",
        "plain": "one bit telling the other side whether the last packet arrived",
    },
    "MD": {
        "full": "More Data",
        "plain": "one bit meaning keep listening, there is another packet coming",
    },
    "AdvData": {
        "full": "Advertising Data",
        "plain": "up to 31 bytes of whatever you want strangers to know about you",
    },
    "AdvA": {
        "full": "Advertiser Address",
        "plain": "the six bytes identifying who is advertising",
    },
    "InitA": {
        "full": "Initiator Address",
        "plain": "the six bytes identifying who is asking to connect",
    },

    # ── sizes and limits ──────────────────────────────────────────────────
    "MTU": {
        "full": "Maximum Transmission Unit",
        "plain": "the largest single message the other side promises it can receive",
    },
    "DLE": {
        "full": "Data Length Extension",
        "plain": "the option to send 251 bytes a packet instead of 27",
    },
    "ATT_MTU": {
        "full": "Attribute Protocol Maximum Transmission Unit",
        "plain": "the largest value a read or a notification can carry, 23 bytes until raised",
    },

    # ── timing ────────────────────────────────────────────────────────────
    "T_IFS": {
        "full": "Inter Frame Space",
        "plain": "the fixed 150 microsecond gap between one packet and the reply",
    },
    "SCA": {
        "full": "Sleep Clock Accuracy",
        "plain": "how badly a device's slow clock drifts, which decides how early it must start listening",
    },
    "HFXO": {
        "full": "High Frequency Crystal Oscillator",
        "plain": "the 32 megahertz crystal the radio cannot run without",
    },
    "LFXO": {
        "full": "Low Frequency Crystal Oscillator",
        "plain": "the accurate slow crystal that times sleep between appointments",
    },
    "LFRC": {
        "full": "Low Frequency RC Oscillator",
        "plain": "the cheap built-in slow clock, accurate enough only for short naps",
    },
    "instant": {
        "full": "Instant",
        "plain": "a future appointment number both sides agree to change something on",
    },

    # ── roles ─────────────────────────────────────────────────────────────
    "central": {
        "full": "Central",
        "plain": "the side that starts the connection and sets its timetable",
    },
    "peripheral": {
        "full": "Peripheral",
        "plain": "the side that advertises and keeps to the other's timetable",
    },
    "client": {
        "full": "Client",
        "plain": "the side that asks for values",
    },
    "server": {
        "full": "Server",
        "plain": "the side that holds the values",
    },

    # ── the bits people most often have to ask about ──────────────────────
    "CCCD": {
        "full": "Client Characteristic Configuration Descriptor",
        "plain": "the switch a reader flips to say yes, push updates to me",
    },
    "UUID": {
        "full": "Universally Unique Identifier",
        "plain": "a number naming what a value means, so two vendors agree",
    },
    "handle": {
        "full": "Attribute Handle",
        "plain": "the row number of a value in the table",
    },
    "PHY": {
        "full": "Physical Layer",
        "plain": "how fast the bits go out, and how far they reach",
    },
    "GFSK": {
        "full": "Gaussian Frequency Shift Keying",
        "plain": "nudging the radio frequency up for a one and down for a zero",
    },
    "CCM": {
        "full": "Counter with CBC-MAC",
        "plain": "the encryption mode that both hides the payload and proves it is untampered",
    },
    "ADV_IND": {
        "full": "Advertising Indication",
        "plain": "the packet that says I exist and you may connect to me",
    },
    "CONNECT_IND": {
        "full": "Connection Indication",
        "plain": "the single packet that creates a connection and dictates its timing",
    },
    "AFH": {
        "full": "Adaptive Frequency Hopping",
        "plain": "dropping channels that keep failing, and using the rest",
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
