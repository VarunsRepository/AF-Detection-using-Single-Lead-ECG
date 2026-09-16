// ---------------------------------------------------------------------------
// renderers/dwt_comparison_view.js
// DWT sweep renderer -- all decomposition levels rendered as separate
// traces on ONE shared Plotly chart with shared x (time, seconds) and
// y (amplitude) axes. All traces sweep simultaneously left-to-right.
//
// Toggle buttons show/hide individual traces via Plotly.restyle rather
// than rebuilding the chart -- fast, no re-init needed.
//
// Self-registers into RENDER_ALGORITHMS. Only loaded for DWT journeys.
// Depends on: rendering_registry.js, shared_signal_utils.js (startSweepLoop)
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("dwt_comparison_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        if (container._fullLayout) Plotly.purge(container);

        const { decomposition, originalSignal } = dspOutput.finalOutput;
        const finalLevel = decomposition[decomposition.length - 1];
        const totalDurationSecs = originalSignal.length / fs;

        // All levels -- Original, D1..DN, AN
        const allLevels = [
            { id: "original", label: "Original", data: originalSignal, color: "#e8f4f8" },
            ...decomposition.map((d, i) => ({
                id: `d${d.level}`, label: `D${d.level}`, data: d.detail,
                color: `hsl(${180 + i * 28}, 80%, 60%)`,
            })),
            { id: `a${finalLevel.level}`, label: `A${finalLevel.level}`,
              data: finalLevel.approx, color: "#d9a441" },
        ];

        // Map each level's sample indices to shared time axis [0, totalDurationSecs]
        const MAX_POINTS = 400;
        function toTimeSeries(data) {
            const n = data.length;
            if (n <= MAX_POINTS) {
                return {
                    x: data.map((_, i) => (i / n) * totalDurationSecs),
                    y: [...data],
                };
            }
            const stride = Math.ceil(n / MAX_POINTS);
            const x = [], y = [];
            for (let i = 0; i < n; i += stride) {
                x.push((i / n) * totalDurationSecs);
                y.push(data[i]);
            }
            // Always include the last point
            x.push(totalDurationSecs);
            y.push(data[n - 1]);
            return { x, y };
        }

        // Pre-compute full downsampled time series for all levels
        const levelSeries = allLevels.map(level => ({
            ...level,
            series: toTimeSeries(level.data),
        }));

        // Build traces -- all start empty, progressively filled by sweep
        const traces = levelSeries.map(level => ({
            x: [], y: [],
            name: level.label,
            mode: "lines",
            line: { color: level.color, width: 1.5 },
            hoverinfo: "skip",
            visible: true,
        }));

        const rootStyle = getComputedStyle(document.documentElement);
        const gridColor = rootStyle.getPropertyValue("--grid-color").trim()
                          || "rgba(116,125,140,0.13)";

        const WINDOW_SECS = 3.0; // scrolling window width -- same as ECG sweep

        const layout = {
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            margin: { t: 10, r: 20, b: 50, l: 50 },
            showlegend: true,
            legend: {
                orientation: "h",
                x: 0, y: 1.02, xanchor: "left", yanchor: "bottom",
                font: { size: 11, color: "#aaa" },
                bgcolor: "transparent",
            },
            xaxis: {
                title: "Time (s)",
                range: [0, WINDOW_SECS],
                color: "#888",
                gridcolor: gridColor,
                tickfont: { size: 12 },
                titlefont: { size: 13 },
            },
            yaxis: {
                title: "Amplitude",
                color: "#888",
                gridcolor: gridColor,
                tickfont: { size: 12 },
                titlefont: { size: 13 },
                zeroline: true,
                zerolinecolor: "rgba(116,125,140,0.25)",
            },
        };

        Plotly.newPlot(container, traces, layout, { staticPlot: true, responsive: true });

        // Toggle buttons -- show/hide traces via Plotly.restyle
        const toggleRow = document.createElement("div");
        toggleRow.style.cssText = "display:flex; gap:6px; padding:6px 8px; flex-wrap:wrap; position:absolute; bottom:8px; left:8px; z-index:10;";
        toggleRow.addEventListener("click", e => e.stopPropagation());
        container.style.position = "relative";
        container.appendChild(toggleRow);

        const visibleSet = new Set(allLevels.map(l => l.id));

        allLevels.forEach((level, traceIndex) => {
            const btn = document.createElement("button");
            btn.textContent = level.label;
            btn.className = "rail-btn";
            btn.style.cssText = `
                font-size: 0.7rem; width: 36px; height: 28px;
                border: 1px solid ${level.color}66;
                color: ${level.color};
                background: rgba(0,0,0,0.5);
            `;

            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const nowVisible = !visibleSet.has(level.id);
                nowVisible ? visibleSet.add(level.id) : visibleSet.delete(level.id);
                Plotly.restyle(container, { visible: nowVisible }, [traceIndex]);
                btn.style.opacity = nowVisible ? "1" : "0.35";
            });

            toggleRow.appendChild(btn);
        });

        function drawAtElapsed(elapsed) {
            const progress    = Math.min(1, elapsed / durationMs);
            const leadingEdge = progress * totalDurationSecs;
            const rangeStart  = Math.max(0, leadingEdge - WINDOW_SECS);
            const rangeEnd    = Math.max(WINDOW_SECS, leadingEdge);

            const xUpdates = levelSeries.map(level => {
                const { x, y } = level.series;
                // Show only samples within the current window
                const visible = x.filter((t, i) => t >= rangeStart && t <= leadingEdge);
                return visible;
            });
            const yUpdates = levelSeries.map(level => {
                const { x, y } = level.series;
                const visibleY = x.reduce((acc, t, i) => {
                    if (t >= rangeStart && t <= leadingEdge) acc.push(y[i]);
                    return acc;
                }, []);
                return visibleY;
            });

            Plotly.update(container,
                { x: xUpdates, y: yUpdates },
                { "xaxis.range": [rangeStart, rangeEnd] },
                levelSeries.map((_, i) => i)
            );
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});
