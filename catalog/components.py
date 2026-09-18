# ---------------------------------------------------------------------------
# catalog/components.py
#
# Which DSP algorithms and renderers exist, and which JS file each lives
# in. Pure data -- no logic, no routes.
#
# Adding an algorithm or renderer means adding a line here, not editing
# journey_bp.py. The blueprint imports this package and never changes.
# ---------------------------------------------------------------------------

from Services.Dsp_Store import DspAlgorithmStore
from Services.Rendering_Store import RenderingStore

dsp_store = DspAlgorithmStore()
dsp_store.register("pan_tompkins",
    entrypoint="/static/shorts/filters/pan_tompkins_filter.js",
    label="Pan-Tompkins", description="Real-time ECG peak detection")
dsp_store.register("pan_tompkins_py",
    entrypoint="/static/shorts/filters/pan_tompkins_python_port.js",
    label="Pan-Tompkins (Python port)",
    description="Ported from a Python reference; also emits P/Q/S/T wave points")
dsp_store.register("hamilton_tompkins",
    entrypoint="/static/shorts/filters/hamilton_tompkins_filter.js",
    label="Hamilton-Tompkins", description="Alternative ECG peak detection")
dsp_store.register("aes128_encrypt",
    entrypoint="/static/shorts/filters/aes128_filter.js",
    label="AES-128", description="Key expansion and encryption, verified against FIPS-197")
dsp_store.register("stacked_beats",
    entrypoint="/static/shorts/filters/stacked_beats_filter.js",
    label="Stacked Beats",
    description="Slices the signal into R-centred windows so every beat overlays")
dsp_store.register("db4_wavelet",
    entrypoint="/static/shorts/filters/db4_filter.js",
    label="DB4 Wavelet", description="Daubechies-4 multi-level decomposition")
dsp_store.register("poincare_standard",
    entrypoint="/static/shorts/filters/math_algorithms.js",
    label="Poincaré", description="RR-interval HRV scatter analysis")
dsp_store.register("passthrough",
    entrypoint="/static/shorts/filters/math_algorithms.js",
    label="Passthrough", description="Raw signal, no DSP")
dsp_store.register("null_dsp",
    entrypoint="/static/shorts/filters/null_dsp.js",
    label="Null DSP", description="Testing stub -- raw signal passthrough, output matches chart_v1 input contract")

# ---------------------------------------------------------------------------
# Rendering registry -- server side.
# Maps renderer IDs to the static JS file the browser needs to load.
# ---------------------------------------------------------------------------
rendering_store = RenderingStore()
rendering_store.register("chart_v1",
    entrypoint="/static/shorts/renderers/chart_v1.js",
    label="ECG Sweep (Plotly)", description="Progressively-revealed waveform with peak markers -- SVG via Plotly")
rendering_store.register("chart_v1_canvas",
    entrypoint="/static/shorts/renderers/chart_v1_canvas.js",
    label="ECG Sweep (Canvas)", description="Same sweep as chart_v1 but Canvas 2D -- no Plotly, raw GPU draw calls")
rendering_store.register("aes_state_grid",
    entrypoint="/static/shorts/renderers/aes_state_grid.js",
    label="AES State Grid", description="4x4 byte grid stepping through interim states")
rendering_store.register("stacked_beats_view",
    entrypoint="/static/shorts/renderers/stacked_beats_view.js",
    label="Stacked Beats", description="All beats overlaid on one axis, aligned at the R-apex")
rendering_store.register("chart_v1_webgl",
    entrypoint="/static/shorts/renderers/chart_v1_webgl.js",
    label="ECG Sweep (WebGL)", description="WebGL GPU vertex buffer -- single draw call per frame, fastest possible")
rendering_store.register("scatter_density",
    entrypoint="/static/shorts/renderers/scatter_density.js",
    label="Scatter Density", description="Poincaré scatter plot with progressive reveal")
rendering_store.register("dwt_comparison_view",
    entrypoint="/static/shorts/renderers/dwt_comparison_view.js",
    label="DWT Comparison", description="Multi-level toggle stack for wavelet decomposition")
rendering_store.register("rr_tachogram",
    entrypoint="/static/shorts/renderers/rr_tachogram.js",
    label="RR Tachogram", description="Beat-to-beat RR interval time series, progressive reveal")
rendering_store.register("null_renderer",
    entrypoint="/static/shorts/renderers/null_renderer.js",
    label="Null Renderer", description="Testing stub -- dumps DSP finalOutput as formatted JSON, accepts any input shape")

# Safe to call every time the app starts -- register_journey() skips
# silently if the journey already exists (loaded from a previous run),
# so this won't wipe out any accumulated feedback_score on restart.
#
# Uses the REAL dataSource/dspEngine/renderingEngine schema now -- the
# old {block, dependsOn} shape is retired. Two stages, both proven
# working end-to-end: Pan-Tompkins peak detection into a Poincare plot.
