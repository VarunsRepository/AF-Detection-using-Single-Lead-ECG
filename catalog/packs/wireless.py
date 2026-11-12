# ---------------------------------------------------------------------------
# catalog/packs/wireless.py
#
# Components for the wireless domain. Same shape as packs/ecg.py and
# packs/crypto.py: one registry call per component, carrying the
# entrypoint and the contract together so the id cannot disagree with
# itself across two files.
#
# This pack will also hold 802.15.4, Thread and Matter components as the
# backlog's items 16-18 get built, which is why it is named for the
# domain rather than for BLE.
#
# Add to catalog/__init__.py, in the components block, after the existing
# packs and before the recipes:
#
#     from catalog.packs import wireless as _pack_wireless   # noqa: E402,F401
#
# and in the recipes block:
#
#     from catalog.journeys import ble_connect               # noqa: E402,F401
#     from catalog.journeys import ble_txpath                # noqa: E402,F401
#
#
# THE GLOSSARY IS NOT A COMPONENT, AND NEEDS NO TEMPLATE CHANGE
#
#   Term definitions live in catalog/glossaries/wireless.py -- domain
#   content, beside sources/ and packs/, not in static/shorts/core/,
#   which is engine code and strictly app only. Twenty domains with their
#   own vocabulary would turn core/ into a dumping ground.
#
#   The recipe calls terms_for() at import time and puts the result on
#   each stage's renderingEngine.config, so the definitions travel inside
#   a recipe the stage already sends. No script tag, no load order, and
#   nothing to forget. Registering it as a component would be wrong
#   twice: registry.py's _claim() treats ids as global, and a file with
#   no process() or render() would fail contract validation forever.
# ---------------------------------------------------------------------------

from catalog import registry

_FILTERS   = "/static/shorts/filters"
_RENDERERS = "/static/shorts/renderers"


# ── DSPEs ──────────────────────────────────────────────────────────────

registry.dsp(
    "ble_encapsulation",
    entrypoint=f"{_FILTERS}/ble_encapsulation_filter.js",
    label="BLE encapsulation",
    description=(
        "A payload wrapped layer by layer into an on-air packet. "
        "Parameterised by upToLayer so one algorithm serves six stages."
    ),
    # TODO before shipping: copy the `requires` / `provides` dict shape
    # from packs/ecg.py and fill these in. Left off deliberately rather
    # than guessed -- registry.undeclared() prints unvalidated components
    # at startup, so an omission is LOUD. A wrong guess at the shape
    # would declare a contract that passes validation while describing
    # the wrong thing, which is the quieter and worse failure.
    #
    # What this DSPE actually provides, for whoever fills it in:
    #   layers[]        six {id,name,owner,bytes,added,fields[],note}
    #   visibleLayers[] the slice up to upToLayer
    #   currentLayer    the newest one
    #   payloadBytes, onAirBytes, bytesPerReading, batchCount
    #   phy, encrypted
    #   airtimeUs, airtimeUsAtCurrentLayer
    #   overheadRatio, payloadFractionPct
    #   attMtu, attValueLimit, exceedsMtu, llPayloadMax, fragments
    #   unbatchedOnAirBytes, batchSavingRatio
    #   oracle{}
    # It requires NOTHING from the envelope -- it is spec-driven and
    # ignores `data` entirely.
)

registry.dsp(
    "ble_tx_timeline",
    entrypoint=f"{_FILTERS}/ble_tx_timeline_filter.js",
    label="BLE transmit timeline",
    description=(
        "Lanes and segments for one packet's life, from notify() to "
        "acknowledged. Parameterised by zoom, plus a retry and an "
        "overflow flag."
    ),
    # TODO as above. What it provides:
    #   lanes[]     {id,label,owner,segments[{t0,t1,state,label}]}
    #   windowStartUs, windowUs, zoom
    #   events[]    {index,anchorUs,channel,txStartUs,txEndUs,endUs}
    #   channels[], hopIncrement
    #   packet{}    producedUs, queuedUs, txStartUs, txEndUs, ackUs,
    #               elapsedUs, attempts[], retried
    #   timing{}    hfxoStartupUs, rampUs, txUs, tIfsUs, rxUs,
    #               eventTotalUs, wideningUsEachSide, dutyCyclePct,
    #               txFractionOfThisPacketPct
    #   queue{}     tS[], occupancy[], capacity, notifyHz,
    #               packetsPerEvent, saturationHz, sustainable,
    #               overflowAtS, fillTimeS
    #   oracle{}
    # Also requires nothing from the envelope.
)


# ── renderers ──────────────────────────────────────────────────────────

registry.renderer(
    "packet_stack_view",
    entrypoint=f"{_RENDERERS}/packet_stack_view.js",
    label="Packet stack",
    description=(
        "The packet drawn to the scale of its FINAL on-air size from the "
        "first frame, so the payload visibly shrinks as wrappers arrive."
    ),
    # Consumes ble_encapsulation's layers[] and the ratio fields. Note it
    # warns to the console if its own on-air field ordering sums to a
    # different total than the DSPE reports -- that mismatch would mean
    # the picture is lying about the packet.
)

registry.renderer(
    "tx_timeline_view",
    entrypoint=f"{_RENDERERS}/tx_timeline_view.js",
    label="Transmit timeline",
    description=(
        "Generic lane/segment timeline on a true time axis. Sub-pixel "
        "segments become ticks rather than being scaled up or dropped."
    ),
    # DELIBERATELY GENERIC. The contract is lanes[] plus a window in
    # microseconds and nothing BLE-specific is required, because the
    # backlog wants this renderer for interrupt latency (item 4),
    # priority inversion (6), rate-monotonic scheduling (19), DMA
    # contention (21) and the Linux boot sequence (29). Anything that can
    # emit lanes[] can use it. Do not narrow its `requires` to BLE fields.
)


registry.dsp(
    "ble_connect",
    entrypoint=f"{_FILTERS}/ble_connect_filter.js",
    label="BLE connection setup",
    description=(
        "Every packet from the first advertisement to the first value. "
        "Parameterised by stage so one algorithm serves six cards."
    ),
    # TODO as above. What it provides:
    #   stage, stageTitle, stageCount
    #   parties{}   left/right, each {id, label, sub}
    #   exchanges[] {name, from, to, opcode, fields[{label,bytes,role}],
    #                pduBytes, onAirBytes, airtimeUs, gapBeforeUs,
    #                gapKind, note, collapsed}
    #   roleBytes{}, roleLabels{}
    #   glossary[]  {acronym, full, plain}
    #   totals{}    stage and journey-wide bytes, airtime, elapsed, ratio
    #   oracle{}    including `unverified`, which lists what it CANNOT
    #               check -- the ordering of stage 4
    # Requires nothing from the envelope; spec-driven like the other two.
)


registry.renderer(
    "exchange_view",
    entrypoint=f"{_RENDERERS}/exchange_view.js",
    label="Exchange",
    description=(
        "Two parties side by side. Packets assemble byte by byte, cross "
        "the corridor, and accumulate as a transcript."
    ),
    # DELIBERATELY GENERIC, like tx_timeline_view. The contract is
    # parties{} plus exchanges[], and nothing in it is BLE-specific,
    # because the backlog wants this shape for Matter commissioning
    # (item 18), I2C arbitration (9) and CAN error frames (10) too.
    # Do not narrow its `requires` to BLE fields.
)
