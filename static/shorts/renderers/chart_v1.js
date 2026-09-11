// ---------------------------------------------------------------------------
// renderers/chart_v1.js
// ECG sweep renderer -- progressively reveals the signal left-to-right
// with peak markers overlaid.
//
// Self-registers into RENDER_ALGORITHMS (defined in rendering_registry.js,
// which must load first). The server (rendering_store.py) decides whether
// this file is loaded at all -- it's only sent to the browser if a
// journey's recipe actually references "chart_v1". Journeys that use only
// scatter_density or dwt_comparison_view will never load this file.
//
// Depends on: rendering_registry.js, shared_signal_utils.js
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("chart_v1", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        if (container._fullLayout) Plotly.purge(container);

        const { filteredSignal, peakIndices } = dspOutput.finalOutput;
        const t = filteredSignal.map((_, i) => i / fs);

        const allPeakX = peakIndices.map(i => i / fs);
        const allPeakY = peakIndices.map(i => filteredSignal[i]);

        // renderWaveformSweep calls Plotly.newPlot internally with the
        // line as trace index 0. We then immediately add the empty marker
        // trace as index 1 BEFORE starting the sweep loop, so the
        // onFrame callback can safely update [0, 1] from the very first
        // frame. Deferring addTraces (as before) caused a timing race:
        // the sweep loop started updating trace index 1 before it existed,
        // silently corrupting the line trace and making it disappear.
        renderWaveformSweep(container, sampleId, durationMs, t, filteredSignal, fs);

        // Add empty marker trace synchronously right after newPlot.
        // Plotly.newPlot is synchronous, so trace 1 exists before
        // the sweep loop's first requestAnimationFrame fires.
        Plotly.addTraces(container, {
            x: [], y: [],
            mode: "markers",
            marker: { color: config.peakMarkerColor || "#ff4d4d", size: 8 },
            hoverinfo: "skip",
        });

        // Now wire up the per-frame marker update via the sweep loop's
        // activeSweepControl -- inject the marker update alongside the
        // existing drawFn rather than replacing it, so the line still
        // updates normally and markers appear in sync.
        const control = activeSweepControl.get(sampleId);
        if (control) {
            const originalDrawFn = control.drawFn;
            control.drawFn = (elapsed) => {
                originalDrawFn(elapsed);
                const currentTimeSecs = (elapsed / durationMs) * t[t.length - 1];
                const visibleCount = allPeakX.filter(px => px <= currentTimeSecs).length;
                Plotly.update(container,
                    { x: [allPeakX.slice(0, visibleCount)], y: [allPeakY.slice(0, visibleCount)] },
                    {},
                    [1] // only update marker trace -- line trace updates via originalDrawFn
                );
            };
        }
    },
});