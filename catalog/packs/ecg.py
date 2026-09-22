# ---------------------------------------------------------------------------
# catalog/packs/ecg.py
#
# ECG components: peak detectors, transforms, and the renderers
# that draw them.
#
# Everything about a domain lives in ONE file -- the JS entrypoint AND
# the contract, registered together. Adding an algorithm here means
# editing this file and writing the JS; it no longer means touching a
# components file, a schemas file and a journeys file that each repeat
# the same id.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("pan_tompkins",
    entrypoint="/static/shorts/filters/pan_tompkins_filter.js",
    label="Pan-Tompkins", description="Real-time ECG peak detection",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs"],
                "domain": "biomedical.ecg"})
dsp("pan_tompkins_py",
    entrypoint="/static/shorts/filters/pan_tompkins_python_port.js",
    label="Pan-Tompkins (Python port)",
    description="Ported from a Python reference; also emits P/Q/S/T wave points",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs",
                           "finalOutput.wavePoints", "finalOutput.threshold"],
                "domain": "biomedical.ecg"})
dsp("hamilton_tompkins",
    entrypoint="/static/shorts/filters/hamilton_tompkins_filter.js",
    label="Hamilton-Tompkins", description="Alternative ECG peak detection",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs"],
                "domain": "biomedical.ecg"})
dsp("db4_wavelet",
    entrypoint="/static/shorts/filters/db4_filter.js",
    label="DB4 Wavelet", description="Daubechies-4 multi-level decomposition",
    requires = {"fields": ["y", "fs"], "fs_required": True},
    provides = {"fields": ["interimOutputs", "finalOutput.decomposition"]})
dsp("poincare_standard",
    entrypoint="/static/shorts/filters/math_algorithms.js",
    label="Poincaré", description="RR-interval HRV scatter analysis")
dsp("stacked_beats",
    entrypoint="/static/shorts/filters/stacked_beats_filter.js",
    label="Stacked Beats",
    description="Slices the signal into R-centred windows so every beat overlays",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"],
                "fs_required": False, "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.beats",
                           "finalOutput.meanBeat", "finalOutput.stats",
                           "finalOutput.rrIntervalsMs",
                           "finalOutput.filteredSignal", "finalOutput.peakIndices"],
                "domain": "biomedical.ecg"})
dsp("fft_spectral",
    entrypoint="/static/shorts/filters/fft_spectral_filter.js",
    label="FFT Spectrum",
    description="Welch power spectrum with ECG frequency band powers",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.psd",
                           "finalOutput.freqs", "finalOutput.bands",
                           "finalOutput.peakFrequency"],
                "domain": "biomedical.ecg"})
dsp("passthrough",
    entrypoint="/static/shorts/filters/math_algorithms.js",
    label="Passthrough", description="Raw signal, no DSP")

renderer("chart_v1",
    entrypoint="/static/shorts/renderers/chart_v1.js",
    label="ECG Sweep (Plotly)", description="Progressively-revealed waveform with peak markers -- SVG via Plotly",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"]})
renderer("chart_v1_canvas",
    entrypoint="/static/shorts/renderers/chart_v1_canvas.js",
    label="ECG Sweep (Canvas)", description="Same sweep as chart_v1 but Canvas 2D -- no Plotly, raw GPU draw calls",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"]})
renderer("chart_v1_webgl",
    entrypoint="/static/shorts/renderers/chart_v1_webgl.js",
    label="ECG Sweep (WebGL)", description="WebGL GPU vertex buffer -- single draw call per frame, fastest possible",
    requires = {"fields": ["finalOutput.filteredSignal", "finalOutput.peakIndices"]})
renderer("scatter_density",
    entrypoint="/static/shorts/renderers/scatter_density.js",
    label="Scatter Density", description="Poincaré scatter plot with progressive reveal")
renderer("rr_tachogram",
    entrypoint="/static/shorts/renderers/rr_tachogram.js",
    label="RR Tachogram", description="Beat-to-beat RR interval time series, progressive reveal")
renderer("dwt_comparison_view",
    entrypoint="/static/shorts/renderers/dwt_comparison_view.js",
    label="DWT Comparison", description="Multi-level toggle stack for wavelet decomposition")
renderer("stacked_beats_view",
    entrypoint="/static/shorts/renderers/stacked_beats_view.js",
    label="Stacked Beats", description="All beats overlaid on one axis, aligned at the R-apex",
    requires = {"fields": ["finalOutput.beats", "finalOutput.meanBeat"]})
renderer("spectrum_view",
    entrypoint="/static/shorts/renderers/spectrum_view.js",
    label="Spectrum", description="Log-scale PSD curve with band power bars",
    requires = {"fields": ["finalOutput.psd", "finalOutput.freqs",
                           "finalOutput.bands"]})


# Pan-Tompkins compiled from Rust. Same contract as pan_tompkins_py -- it
# emits P/Q/S/T too, so it was ported from the Python version, and that
# is its oracle: identical input must give identical peak indices.
dsp("pan_tompkins_wasm",
    entrypoint="/static/shorts/filters/pan_tompkins_wasm.module.js",
    label="Pan-Tompkins (Rust/WASM)",
    description="Rust port via wasm-pack; zero-copy arena, copied out per call",
    requires = {"fields": ["y", "fs"], "fs_required": True,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.filteredSignal",
                           "finalOutput.peakIndices", "finalOutput.rrIntervalsMs",
                           "finalOutput.wavePoints", "finalOutput.threshold"],
                "domain": "biomedical.ecg"})


# The closing card of the ECG journey: the record's REFERENCE class.
# Not a classifier -- it reads the PhysioNet answer key and shows it
# beside the measurements the peak-detection stage produced.
dsp("sample_class",
    entrypoint="/static/shorts/filters/sample_class_filter.js",
    label="Reference class",
    description="Looks up the PhysioNet 2017 annotation for this record",
    requires = {"fields": ["meta.label"], "fs_required": False,
                "domains": ["biomedical.ecg"]},
    provides = {"fields": ["interimOutputs", "finalOutput.classId",
                           "finalOutput.className", "finalOutput.bpm",
                           "finalOutput.rmssd"],
                "domain": "biomedical.ecg"})

renderer("class_card_view",
    entrypoint="/static/shorts/renderers/class_card_view.js",
    label="Class card", description="Measurements, then the reference class",
    requires = {"fields": ["finalOutput.className"]})
