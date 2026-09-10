// ---------------------------------------------------------------------------
// renderers/chart_v1_canvas.js
// Canvas 2D ECG sweep renderer -- same data contract as chart_v1 but
// draws directly to a Canvas element instead of Plotly SVG.
//
// WHY CANVAS OVER PLOTLY FOR THE SWEEP:
//   Plotly.update() on every frame diffs and repaints the SVG DOM --
//   ~8-15ms per frame on mobile. Canvas ctx.stroke() is a single GPU
//   draw call -- ~0.1ms per frame. At 60fps that's the difference between
//   hitting the 16ms frame budget and blowing past it.
//
// APPROACH -- hybrid, not full replacement:
//   Canvas draws: signal line, peak markers, glow effect
//   CSS draws:    background (already black from card)
//   JS draws:     axis labels, grid, annotations (lightweight DOM elements)
//
//   No Plotly at all. No SVG. Pure pixel operations.
//
// INPUT CONTRACT (same as chart_v1):
//   dspOutput.finalOutput.filteredSignal: float32[]
//   dspOutput.finalOutput.peakIndices:    int[]
//   fs:         sample rate in Hz
//   durationMs: total animation duration (speed-scaled)
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js must load first).
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("chart_v1_canvas", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        // Clean up any previous render
        container.innerHTML = "";
        container.style.position = "relative";

        const { filteredSignal, peakIndices } = dspOutput.finalOutput;
        const totalSamples   = filteredSignal.length;
        const totalDurationS = totalSamples / fs;
        const WINDOW_S       = 3.0; // seconds visible at once -- same as chart_v1
        const windowSamples  = Math.round(WINDOW_S * fs);

        // ── Canvas setup ────────────────────────────────────────────────
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%; height:100%; display:block;";
        container.appendChild(canvas);

        // Lightweight axis layer -- plain DOM, no Plotly needed
        const axisLayer = buildAxisLayer(totalDurationS, filteredSignal);
        container.appendChild(axisLayer);

        // Dev overrides -- only active when ?dev=1 is in the URL
        const useGlow = globalThis._DEV_CANVAS_GLOW ?? true;
        const useDPR  = globalThis._DEV_CANVAS_DPR  ?? devicePixelRatio;

        // ResizeObserver keeps canvas pixel dimensions in sync with
        // container CSS dimensions -- same reason chart_v1 uses
        // responsive:true in Plotly.
        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width  = width  + "px";
            canvas.style.height = height + "px";
        });
        ro.observe(container);

        // ── Read theme ──────────────────────────────────────────────────
        const rootStyle    = getComputedStyle(document.documentElement);
        const traceColor   = THEMES[themeIndex].traceColor || "#e8f4f8";
        const glowColor    = rootStyle.getPropertyValue("--ecg-glow-color").trim()
                             || "rgba(232,244,248,0.5)";
        const gridColor    = rootStyle.getPropertyValue("--grid-color").trim()
                             || "rgba(116,125,140,0.13)";

        // ── Draw one frame ──────────────────────────────────────────────
        function drawFrame(startSample, endSample) {
            const ctx    = canvas.getContext("2d");
            const W      = canvas.width;
            const H      = canvas.height;
            const MARGIN = { top: 10, right: 10, bottom: 28, left: 44 };
            const plotW  = W - MARGIN.left - MARGIN.right;
            const plotH  = H - MARGIN.top  - MARGIN.bottom;

            // Data slice for this window
            const slice  = filteredSignal.slice(startSample, endSample);
            const yMin   = Math.min(...filteredSignal) - 0.05;
            const yMax   = Math.max(...filteredSignal) + 0.05;
            const yRange = yMax - yMin;

            // Map sample value → canvas pixel
            function sampleToX(i) {
                return MARGIN.left + (i / slice.length) * plotW;
            }
            function valueToY(v) {
                return MARGIN.top + plotH - ((v - yMin) / yRange) * plotH;
            }

            // Clear
            ctx.clearRect(0, 0, W, H);

            // Grid lines (horizontal only -- y-axis gridlines)
            ctx.strokeStyle = gridColor;
            ctx.lineWidth   = 1;
            const gridSteps = 4;
            for (let g = 0; g <= gridSteps; g++) {
                const v  = yMin + (g / gridSteps) * yRange;
                const py = valueToY(v);
                ctx.beginPath();
                ctx.moveTo(MARGIN.left, py);
                ctx.lineTo(MARGIN.left + plotW, py);
                ctx.stroke();
            }

            // Zero line
            if (yMin < 0 && yMax > 0) {
                const zy = valueToY(0);
                ctx.strokeStyle = "rgba(116,125,140,0.3)";
                ctx.lineWidth   = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(MARGIN.left, zy);
                ctx.lineTo(MARGIN.left + plotW, zy);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // ── Signal line with glow ──────────────────────────────────
            if (useGlow) {
                // Glow pass (wide, low opacity)
                ctx.save();
                ctx.shadowColor = traceColor;
                ctx.shadowBlur  = 8 * useDPR;
                ctx.strokeStyle = traceColor;
                ctx.lineWidth   = 2 * useDPR;
                ctx.lineJoin    = "round";
                ctx.lineCap     = "round";
                ctx.globalAlpha = 0.4;
                drawSignalPath(ctx, slice, sampleToX, valueToY);
                ctx.restore();
            }

            // Signal pass (crisp, full opacity)
            ctx.save();
            ctx.strokeStyle = traceColor;
            ctx.lineWidth   = 1.8 * useDPR;
            ctx.lineJoin    = "round";
            ctx.lineCap     = "round";
            ctx.globalAlpha = 1.0;
            drawSignalPath(ctx, slice, sampleToX, valueToY);
            ctx.restore();

            // ── Peak markers ───────────────────────────────────────────
            const windowStartTime = startSample / fs;
            const windowEndTime   = endSample   / fs;
            const markerColor     = config.peakMarkerColor || "#ff4d4d";

            ctx.save();
            if (useGlow) {
                ctx.shadowColor = markerColor;
                ctx.shadowBlur  = 6 * useDPR;
            }
            ctx.fillStyle = markerColor;

            peakIndices.forEach(idx => {
                const peakTime = idx / fs;
                if (peakTime < windowStartTime || peakTime > windowEndTime) return;
                const relIdx = idx - startSample;
                if (relIdx < 0 || relIdx >= slice.length) return;
                const px = sampleToX(relIdx);
                const py = valueToY(slice[relIdx]);
                ctx.beginPath();
                ctx.arc(px, py, 4 * useDPR, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }

        function drawSignalPath(ctx, slice, toX, toY) {
            if (slice.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(toX(0), toY(slice[0]));
            for (let i = 1; i < slice.length; i++) {
                ctx.lineTo(toX(i), toY(slice[i]));
            }
            ctx.stroke();
        }

        // ── Sweep loop ──────────────────────────────────────────────────
        // Progress → which window of samples to paint.
        // No downsampling needed -- Canvas lineTo() handles all 900 raw
        // samples per frame at negligible cost vs Plotly's SVG diffing.
        function drawAtElapsed(elapsed) {
            const progress    = Math.min(1, elapsed / durationMs);
            const leadingIdx  = Math.round(progress * (totalSamples - 1));
            const startSample = Math.max(0, leadingIdx - windowSamples);
            const endSample   = Math.min(totalSamples, leadingIdx + 1);
            drawFrame(startSample, endSample);
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});

// ── Axis layer ──────────────────────────────────────────────────────────────
// Lightweight DOM overlay for y-axis tick labels -- avoids needing Plotly
// just for text. Positioned absolute over the canvas.
function buildAxisLayer(totalDurationS, signal) {
    const layer  = document.createElement("div");
    layer.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px;
        color: #747d8c;
    `;

    const yMin   = Math.min(...signal) - 0.05;
    const yMax   = Math.max(...signal) + 0.05;
    const steps  = 4;
    const MARGIN_BOTTOM = 28;
    const MARGIN_TOP    = 10;

    for (let g = 0; g <= steps; g++) {
        const v      = yMin + (g / steps) * (yMax - yMin);
        const pct    = 1 - (g / steps); // 0 at top, 1 at bottom
        const label  = document.createElement("span");
        label.style.cssText = `
            position: absolute;
            left: 4px;
            top: calc(${MARGIN_TOP}px + ${pct * 100}% - ${MARGIN_TOP + MARGIN_BOTTOM}px * ${pct} - 6px);
            font-size: 9px;
        `;
        label.textContent = v.toFixed(2);
        layer.appendChild(label);
    }

    // X-axis label
    const xLabel = document.createElement("span");
    xLabel.style.cssText = "position:absolute; bottom:4px; right:8px; font-size:9px;";
    xLabel.textContent = `${totalDurationS.toFixed(1)}s`;
    layer.appendChild(xLabel);

    return layer;
}