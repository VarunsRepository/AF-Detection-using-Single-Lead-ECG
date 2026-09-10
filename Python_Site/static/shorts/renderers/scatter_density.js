// ---------------------------------------------------------------------------
// renderers/scatter_density.js
// Poincaré scatter plot renderer -- progressively reveals RR-interval
// dots over the stage duration.
//
// Self-registers into RENDER_ALGORITHMS. Only loaded if a journey's recipe
// references "scatter_density" -- the server (rendering_store.py) resolves
// which renderer files are needed per request.
//
// Depends on: rendering_registry.js, shared_signal_utils.js (startSweepLoop)
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("scatter_density", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        if (container._fullLayout) {
            Plotly.purge(container);
            // After purge, force a reflow before newPlot so Plotly
            // measures the container at its actual dimensions, not 0px.
            // Without this, scaleanchor calculates the 1:1 aspect ratio
            // against a zero-width baseline -- then responsive:true
            // corrects the height later but the x-axis range has already
            // been locked in wrong, causing the x-axis to visibly stretch
            // on every restart.
            void container.offsetWidth;
        }

        const { rrCurrent, rrNext, sd1, sd2 } = dspOutput.finalOutput;
        const axisMax = Math.max(...rrCurrent, ...rrNext) * 1.15;

        const identityLine = {
            x: [0, axisMax], y: [0, axisMax], mode: "lines",
            line: { color: "rgba(150,150,150,0.4)", width: 1, dash: "dash" },
            showlegend: false, hoverinfo: "skip",
        };
        const points = {
            x: [], y: [], mode: "markers",
            marker: {
                color: "#00E5FF",
                size: 10,           // was 6 -- bigger, more readable
                opacity: 0.9,       // was 0.75
                line: {
                    color: "rgba(0, 229, 255, 0.4)", // outer ring for glow effect
                    width: 3,
                },
            },
            showlegend: false, hoverinfo: "skip",
        };

        const layout = {
            paper_bgcolor: "transparent", plot_bgcolor: "transparent",
            margin: { t: 10, r: 10, b: 40, l: 50 },
            xaxis: {
                title: "RR[n] (ms)", range: [0, axisMax], color: "#888",
                tickfont: { size: 13 }, titlefont: { size: 14 },
                gridcolor: "rgba(116, 125, 140, 0.13)", // 0.08 was too faint -- 0.13 sits between original (0.18) and too-faint
                zerolinecolor: "rgba(116, 125, 140, 0.25)",
            },
            yaxis: {
                title: "RR[n+1] (ms)", range: [0, axisMax], color: "#888",
                tickfont: { size: 13 }, titlefont: { size: 14 },
                gridcolor: "rgba(116, 125, 140, 0.13)",
                zerolinecolor: "rgba(116, 125, 140, 0.25)",
            },
            annotations: [{
                text: `SD1: ${sd1.toFixed(0)}ms &nbsp; SD2: ${sd2.toFixed(0)}ms`,
                xref: "paper", yref: "paper", x: 0.02, y: 0.98,
                showarrow: false, font: { color: "#fff", size: 14 },
            }],
        };

        Plotly.newPlot(container, [identityLine, points], layout, { staticPlot: true, responsive: true });

        function drawAtElapsed(elapsed) {
            const progress = Math.min(1, elapsed / durationMs);
            const visibleCount = Math.max(1, Math.round(progress * rrCurrent.length));
            Plotly.update(container,
                { x: [null, rrCurrent.slice(0, visibleCount)], y: [null, rrNext.slice(0, visibleCount)] },
                {}
            );
        }
        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});