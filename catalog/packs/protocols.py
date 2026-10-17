# ---------------------------------------------------------------------------
# catalog/packs/protocols.py
#
# Embedded bus protocols. One decoder and one renderer serve UART, SPI,
# I2C and CAN, because all four are the same problem wearing different
# wiring: a time series arrives, the features are found, the features are
# labelled. That is Pan-Tompkins with square corners.
#
# A fifth protocol is a frame spec in catalog/sources/protocols.py and a
# decode function. No new renderer, no new recipe.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("protocol",
    entrypoint="/static/shorts/filters/protocol_filter.js",
    label="Bus decoder",
    description="Recovers bytes from logic edges: UART, SPI, I2C, CAN arbitration",
    requires = {"fields": ["meta.frame"], "fs_required": False,
                "domains": ["embedded.protocol"]},
    provides = {"fields": ["interimOutputs", "finalOutput.steps",
                           "finalOutput.bytes", "finalOutput.verdict",
                           "finalOutput.errors"],
                "fs": None, "domain": "embedded.protocol"})

renderer("timing_view",
    entrypoint="/static/shorts/renderers/timing_view.js",
    label="Logic analyser",
    description="A lane per wire, square transitions, and the receiver's sample points",
    requires = {"fields": ["finalOutput.steps"]})
