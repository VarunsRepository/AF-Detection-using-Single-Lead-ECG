# ---------------------------------------------------------------------------
# catalog/packs/compute.py
#
# How code runs: SIMD today; compiler passes, memory hierarchy and
# branch prediction are the natural neighbours later.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("simd_add",
    entrypoint="/static/shorts/filters/simd_add_filter.js",
    label="SIMD add",
    description="Lane-wise i32 add; emits lane, compare and pipeline views",
    requires = {"fields": ["arrays.a", "arrays.b"], "fs_required": False,
                "domains": ["compute.simd"]},
    provides = {"fields": ["interimOutputs", "finalOutput.result",
                           "finalOutput.scalarOps", "finalOutput.simdOps"],
                "fs": None, "domain": "compute.simd"})

renderer("simd_lanes_view",
    entrypoint="/static/shorts/renderers/simd_lanes_view.js",
    label="SIMD lanes",
    description="Lane columns, scalar-vs-vector, and the pipeline column",
    requires = {"fields": ["interimOutputs"]})


# The same arithmetic via a real WebAssembly v128 instruction, compiled
# from rust/simd_add. Same contract as simd_add -- only the arithmetic
# differs; the captures come from the shared builder in the JS filter.
dsp("simd_add_wasm",
    entrypoint="/static/shorts/filters/simd_add_wasm.module.js",
    label="SIMD add (Rust/WASM)",
    description="Real i32x4.add; NEON on phones, SSE on desktops, one binary",
    requires = {"fields": ["arrays.a", "arrays.b"], "fs_required": False,
                "domains": ["compute.simd"]},
    provides = {"fields": ["interimOutputs", "finalOutput.result",
                           "finalOutput.scalarOps", "finalOutput.simdOps"],
                "fs": None, "domain": "compute.simd"})
