# ---------------------------------------------------------------------------
# catalog/packs/testing.py
#
# Null-object components, used to isolate the feed engine from
# DSP and renderer bugs. Deliberately UNDECLARED -- they accept and
# produce anything, so a contract would be a fiction.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("null_dsp",
    entrypoint="/static/shorts/filters/null_dsp.js",
    label="Null DSP", description="Testing stub -- raw signal passthrough, output matches chart_v1 input contract")

renderer("null_renderer",
    entrypoint="/static/shorts/renderers/null_renderer.js",
    label="Null Renderer", description="Testing stub -- dumps DSP finalOutput as formatted JSON, accepts any input shape")
