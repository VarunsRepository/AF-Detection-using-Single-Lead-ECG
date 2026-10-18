# ---------------------------------------------------------------------------
# catalog/packs/silicon.py
#
# Components for scaling journeys. Domain "compute.silicon" rather than
# "compute.simd": both are about how code runs, but a table of chip
# records is not a pair of vector lanes, and a schema that conflated
# them would let SIMD data reach a renderer expecting years.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("moore_fit",
    entrypoint="/static/shorts/filters/moore_filter.js",
    label="Scaling fit",
    description="Least squares in log space; doubling period, density, "
                "and label-vs-silicon divergence",
    requires = {"fields": ["arrays.year", "arrays.transistors"],
                "fs_required": False, "domains": ["compute.silicon"]},
    provides = {"fields": ["interimOutputs", "finalOutput.points",
                           "finalOutput.claimPoints", "finalOutput.fit",
                           "finalOutput.fitSingleDie", "finalOutput.crossing",
                           "finalOutput.multiDieCount"],
                "fs": None, "domain": "compute.silicon"})

renderer("moore_view",
    entrypoint="/static/shorts/renderers/moore_view.js",
    label="Scaling chart",
    description="Log-count scatter with trend line, label-vs-density pair, "
                "and the multi-die cut",
    requires = {"fields": ["interimOutputs", "finalOutput.points"]})
