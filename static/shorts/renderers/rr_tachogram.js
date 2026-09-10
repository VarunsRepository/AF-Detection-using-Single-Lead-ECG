// ---------------------------------------------------------------------------
// renderers/rr_tachogram.js
// RR interval tachogram -- plots each RR interval (ms) as a function of
// beat number, progressively revealed over the stage duration.
//
// A tachogram is the most direct visual representation of heart rate
// variability: each point is one RR interval, y-axis is interval length
// in ms (shorter = faster heart rate), x-axis is beat number.
// Trends, sudden changes, ectopic beats and arrhythmias are all
// immediately visible as vertical shifts in the line.
//
// Input contract (finalOutput from poincare_standard or passthrough):
//   rrIntervalsMs: float32[]  -- one value per beat-to-beat interval
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js must load first).
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("rr_tachogram", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        if (container._fullLayout) {
            Plotly.purge(container);
            void container.offsetWidth;
        }

        // rrIntervalsMs arrives directly -- this stage reads from
        // PREVIOUS_STAGE_PIPELINE so dspOutput.finalOutput IS the
        // rrIntervalsMs array (after passthrough DSP)
        const rr = dspOutput.finalOutput.rrIntervalsMs;
        if (!rr || rr.length < 2) {
            container.innerHTML = `<p style="color:#ff4d4d; padding:20px;">
                Not enough RR intervals to render tachogram (need at least 2 beats).
            </p>`;
            return;
        }

        const beatNumbers = rr.map((_, i) => i + 1); // x axis: beat 1, 2, 3 ...
        const meanRR      = rr.reduce((a, b) => a + b, 0) / rr.length;
        const meanHR      = Math.round(60000 / meanRR);
        const minRR       = Math.min(...rr);
        const maxRR       = Math.max(...rr);
        const yPad        = (maxRR - minRR) * 0.15 || 20; // 15% padding, floor 20ms

        // Mean line -- static reference, drawn first so it sits behind the trace
        const meanLine = {
            x: [1, rr.length], y: [meanRR, meanRR],
            mode: "lines",
            line: { color: "rgba(255,165,0,0.35)", width: 1.5, dash: "dot" },
            hoverinfo: "skip", showlegend: false,
        };

        // The tachogram trace -- starts empty, progressively filled
        const tachoTrace = {
            x: [], y: [],
            mode: "lines+markers",
            line: { color: "#00E5FF", width: 2, shape: "spline" },
            marker: { color: "#00E5FF", size: 5, opacity: 0.8 },
            hoverinfo: "skip", showlegend: false,
        };

        const rootStyle   = getComputedStyle(document.documentElement);
        const gridColor   = rootStyle.getPropertyValue("--grid-color").trim()
                            || "rgba(116, 125, 140, 0.13)";
        const zeroColor   = rootStyle.getPropertyValue("--zero-line-color").trim()
                            || "rgba(116, 125, 140, 0.25)";

        const layout = {
            paper_bgcolor: "transparent", plot_bgcolor: "transparent",
            margin: { t: 10, r: 20, b: 50, l: 60 },
            xaxis: {
                title: "Beat number",
                range: [1, rr.length],
                color: "#888", gridcolor: gridColor, zerolinecolor: zeroColor,
                tickfont: { size: 13 }, titlefont: { size: 14 },
            },
            yaxis: {
                title: "RR interval (ms)",
                range: [minRR - yPad, maxRR + yPad],
                color: "#888", gridcolor: gridColor, zerolinecolor: zeroColor,
                tickfont: { size: 13 }, titlefont: { size: 14 },
            },
            annotations: [{
                text: `Mean HR: ${meanHR} bpm &nbsp;|&nbsp; Mean RR: ${Math.round(meanRR)}ms`,
                xref: "paper", yref: "paper", x: 0.02, y: 0.97,
                xanchor: "left", yanchor: "top",
                showarrow: false, font: { color: "#fff", size: 13 },
            }],
        };

        Plotly.newPlot(
            container,
            [meanLine, tachoTrace],
            layout,
            { staticPlot: true, responsive: true }
        );

        // Progressive reveal -- each frame shows more beats as time advances
        function drawAtElapsed(elapsed) {
            const progress     = Math.min(1, elapsed / durationMs);
            const visibleCount = Math.max(1, Math.round(progress * rr.length));
            Plotly.update(container,
                {
                    x: [null, beatNumbers.slice(0, visibleCount)],
                    y: [null, rr.slice(0, visibleCount)],
                },
                {},
                [0, 1] // trace 0 = mean line (static), trace 1 = tachogram
            );
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});
