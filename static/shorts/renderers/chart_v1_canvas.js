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
// OUTPUT CONTRACT -- new, and OPTIONAL for other renderers:
//   container.__kymoProjection = { toScreen(absoluteSampleIndex) }
//
//   annotation_layer.js needs to ask "where on screen is beat 3 right
//   now", and only the renderer can answer: it owns the margins, the
//   y-range and -- during a sliding sweep -- which samples are even
//   on screen this frame. Publishing one small function is what lets the
//   overlay live outside every renderer instead of inside all ten.
//
//   A renderer without it gets no annotations and is otherwise unaffected,
//   the same way a renderer with no CRT treatment ignores the Romulus
//   theme. Nothing needs to be added to the registry contract for this.
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js must load first).
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("chart_v1_canvas", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        // Clean up any previous render
        container.innerHTML = "";
        container.style.position = "relative";
        // The overlay element was a child of container, so innerHTML="" has
        // already destroyed it -- but the bookkeeping object and the drawFn
        // wrapper both outlive the DOM. Clearing it here keeps a stale
        // wrapper from being restored onto this render's control entry.
        if (typeof unmountAnnotations === "function") {
            unmountAnnotations(container, sampleId);
        }

        const { filteredSignal, peakIndices } = dspOutput.finalOutput;
        const totalSamples   = filteredSignal.length;
        const totalDurationS = totalSamples / fs;
        const WINDOW_S       = 3.0; // seconds visible at once -- same as chart_v1
        const windowSamples  = Math.round(WINDOW_S * fs);

        // ── Canvas setup ────────────────────────────────────────────────
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%; height:100%; display:block;";
        container.appendChild(canvas);

        // Dev overrides -- only active when ?dev=1 is in the URL.
        // These MUST be declared before any canvas sizing below uses them.
        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;

        // ── Everything themeable, read ONE way ──────────────────────────
        // All of it via CSS variables, including the values this file used
        // to take straight off THEMES[themeIndex]. That mixed approach is
        // what the single-path change removed: colour and weight are the
        // same kind of thing and had no business arriving by two different
        // routes in the same function.
        //
        // One getComputedStyle() for the whole render. Reading per value
        // forces a style recalculation each time, which matters in a path
        // that feeds a per-frame draw.
        //
        // Every fallback is the value that used to be hardcoded here, so a
        // theme declaring nothing renders exactly as before.
        // typeof-guarded, same idiom as trackEvent and mountAnnotations.
        // rail_controls.js owns these readers and the template loads it
        // first, but renderer files are injected per journey by
        // rendering_store.resolve() rather than being written into the
        // page by hand -- so this file should not assume it wins a load
        // order it does not control. Without the guard, a renderer that
        // happened to load early would throw on every render.
        const styles = typeof themeStyles === "function"
                     ? themeStyles()
                     : getComputedStyle(document.documentElement);
        const readColor = (name, fallback) =>
            typeof themeColor === "function"
                ? themeColor(styles, name, fallback)
                : (styles.getPropertyValue(name).trim() || fallback);
        const readNumber = (name, fallback) => {
            if (typeof themeNumber === "function") {
                return themeNumber(styles, name, fallback);
            }
            const n = parseFloat(styles.getPropertyValue(name).trim());
            return Number.isFinite(n) ? n : fallback;
        };

        const traceColor = readColor("--trace-color", "#e8f4f8");
        const gridColor  = readColor("--grid-color", "rgba(116,125,140,0.13)");
        const glowColor  = readColor("--ecg-glow-color", "rgba(232,244,248,0.5)");
        const traceWidth = readNumber("--trace-width", 1.8);
        const glowBlur   = readNumber("--glow-blur", 8);

        // The theme wins, the recipe is the fallback. That ordering is the
        // point of the change: the marker is the exact thing an annotation
        // points at, so it has to follow the look rather than whichever
        // journey happens to be running. Recipes keep working untouched.
        const markerColor = readColor("--peak-marker-color",
                                      config.peakMarkerColor || "#ff4d4d");

        // A theme can switch the glow off with glowBlur: 0, which matters
        // for heavy traces -- at 3.4px the old blur turns the line into a
        // glowing tube rather than a trace. The dev toggle still wins.
        const useGlow = (globalThis._DEV_CANVAS_GLOW ?? true) && glowBlur > 0;

        // Set canvas size immediately from container's current dimensions.
        // With CSS scroll-snap cards are laid out even when off-screen,
        // so offsetWidth/offsetHeight are correct here.
        const initW = container.offsetWidth  || 800;
        const initH = container.offsetHeight || 300;
        canvas.width  = Math.round(initW * useDPR);
        canvas.height = Math.round(initH * useDPR);
        canvas.style.width  = initW + "px";
        canvas.style.height = initH + "px";

        // ResizeObserver keeps canvas in sync on rotation / resize.
        //
        // TWO GUARDS, AND BOTH ARE LOAD-BEARING -- this callback was the
        // cause of "pause the card, tap any rail button, the trace
        // disappears until you scrub".
        //
        // Assigning canvas.width RESETS THE DRAWING SURFACE to
        // transparent. That is true even when the value assigned is
        // identical to the current one -- it is not a no-op, it is a
        // full reallocation. And ResizeObserver delivers an INITIAL
        // callback as soon as observe() is called, reporting the size
        // the element already has.
        //
        // So every single render ran this sequence:
        //      render -> draw a frame -> observer fires -> surface wiped
        //
        // While the sweep is RUNNING that is invisible: the next rAF
        // frame repaints ~30 times a second, so the wipe never survives
        // long enough to see. While PAUSED nothing repaints, so the card
        // sat blank -- and seeking fixed it only because a scrub calls
        // drawFn again. Entirely a function of whether a redraw happened
        // to follow, which is why it looked random.
        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (width === 0 || height === 0) return;

            const w = Math.round(width  * useDPR);
            const h = Math.round(height * useDPR);

            // GUARD 1 -- do not touch the surface when nothing changed.
            // This alone fixes the reported bug, because the initial
            // callback always reports the size render() just applied.
            if (canvas.width === w && canvas.height === h) return;

            canvas.width  = w;
            canvas.height = h;
            canvas.style.width  = width  + "px";
            canvas.style.height = height + "px";

            // GUARD 2 -- a REAL resize (rotation, split view) still wipes
            // the surface, and if the sweep is paused nothing else will
            // ever repaint it. Redraw at the position we are actually at.
            //
            // Via control.drawFn rather than drawAtElapsed directly: that
            // is the annotation layer's wrapper when one is mounted, so
            // the marks get repositioned against the new geometry too.
            // Falling back to the raw function covers the window before
            // startSweepLoop has registered anything.
            const control = activeSweepControl.get(sampleId);
            if (control) control.drawFn(control.lastElapsedMs ?? 0);
            else drawAtElapsed(0);
        });
        ro.observe(container);

        const axisLayer = buildAxisLayer(totalDurationS, filteredSignal, styles);
        container.appendChild(axisLayer);

        // ── Geometry, hoisted out of drawFrame ──────────────────────────
        // MARGIN and the y-range used to be recomputed inside every frame.
        // Both are constant for the life of a sweep -- the y-range is taken
        // from the WHOLE signal, not the visible window, so it does not
        // change as the window slides. Two reasons to hoist them:
        //
        //   1. toScreen() has to use EXACTLY the same numbers the draw
        //      path uses, or the mark lands near the beat instead of on
        //      it. Sharing one definition is the only way to guarantee
        //      that; two copies drift the first time one is edited.
        //   2. Math.min(...filteredSignal) spreads ~9000 arguments onto
        //      the stack, and it was doing that twice per frame at 30fps
        //      for a value that never changed.
        //
        // left was 44 -- a gutter reserved for y-axis labels OUTSIDE
        // the plot. On a 390px phone that is 11% of the width spent on
        // five short numbers. The labels now sit INSIDE the plot
        // (buildAxisLayer), so the trace runs nearly edge to edge.
        const MARGIN = { top: 10, right: 6, bottom: 24, left: 6 };
        const yMin   = Math.min(...filteredSignal) - 0.05;
        const yMax   = Math.max(...filteredSignal) + 0.05;
        const yRange = yMax - yMin;

        // Which samples the most recently drawn frame actually put on
        // screen. toScreen() is only meaningful relative to a frame that
        // has been drawn, so it reads this rather than recomputing a
        // window from a clock of its own.
        let lastFrame = null; // { startSample, endSample, sliceLength }

        // ── Draw one frame ──────────────────────────────────────────────
        function drawFrame(startSample, endSample) {
            const ctx    = canvas.getContext("2d");
            const W      = canvas.width;
            const H      = canvas.height;
            const plotW  = W - MARGIN.left - MARGIN.right;
            const plotH  = H - MARGIN.top  - MARGIN.bottom;

            // Data slice for this window
            const slice  = filteredSignal.slice(startSample, endSample);

            lastFrame = { startSample, endSample, sliceLength: slice.length };

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
                ctx.shadowBlur  = glowBlur * useDPR;
                ctx.strokeStyle = traceColor;
                // Kept at +0.2px over the crisp pass, the same relationship
                // the hardcoded 2-over-1.8 had.
                ctx.lineWidth   = (traceWidth + 0.2) * useDPR;
                ctx.lineJoin    = "round";
                ctx.lineCap     = "round";
                ctx.globalAlpha = 0.4;
                drawSignalPath(ctx, slice, sampleToX, valueToY);
                ctx.restore();
            }

            // Signal pass (crisp, full opacity)
            ctx.save();
            ctx.strokeStyle = traceColor;
            ctx.lineWidth   = traceWidth * useDPR;
            ctx.lineJoin    = "round";
            ctx.lineCap     = "round";
            ctx.globalAlpha = 1.0;
            drawSignalPath(ctx, slice, sampleToX, valueToY);
            ctx.restore();

            // ── Peak markers ───────────────────────────────────────────
            const windowStartTime = startSample / fs;
            const windowEndTime   = endSample   / fs;

            // The peak dot scales with the trace, or a 3.4px line ends up
            // with a marker thinner than itself. max() keeps every theme
            // at the old 4px radius: 1.8 * 2 is 3.6, so only a genuinely
            // heavy trace moves it.
            const markerRadius = Math.max(4, traceWidth * 2);

            ctx.save();
            if (useGlow) {
                ctx.shadowColor = markerColor;
                // Was a hardcoded 6 against a hardcoded blur of 8 -- kept
                // at that same ratio so existing themes are unchanged.
                ctx.shadowBlur  = glowBlur * 0.75 * useDPR;
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
                ctx.arc(px, py, markerRadius * useDPR, 0, Math.PI * 2);
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

        // ── Projection, for overlays ────────────────────────────────────
        // Returns CSS pixels relative to `container`, NOT canvas pixels:
        // the canvas backing store is devicePixelRatio times larger than
        // its CSS box, so handing a DOM overlay raw canvas coordinates
        // puts it at roughly twice the intended offset on any retina
        // screen -- and correctly on a DPR-1 desktop, which is exactly
        // how that class of bug survives a dev session.
        //
        // Returns null rather than a guess when the sample is not on
        // screen. During a sliding sweep that is the normal case, not an
        // error: a beat the sweep has not reached yet, or one that has
        // scrolled off the left edge, genuinely has no position. A caller
        // that got a clamped number instead would park a pointer at the
        // edge of the plot indicating nothing.
        container.__kymoProjection = {
            toScreen(absoluteSampleIndex) {
                if (!lastFrame) return null;
                const { startSample, endSample, sliceLength } = lastFrame;
                if (!sliceLength) return null;
                if (absoluteSampleIndex < startSample) return null;
                if (absoluteSampleIndex >= endSample)  return null;

                const value = filteredSignal[absoluteSampleIndex];
                if (value == null) return null;

                // Read canvas dims live -- a rotation between frames
                // changes them, and a stale width would offset every mark.
                const plotW = canvas.width  - MARGIN.left - MARGIN.right;
                const plotH = canvas.height - MARGIN.top  - MARGIN.bottom;
                const relIdx = absoluteSampleIndex - startSample;

                const canvasX = MARGIN.left + (relIdx / sliceLength) * plotW;
                const canvasY = MARGIN.top + plotH - ((value - yMin) / yRange) * plotH;

                return { x: canvasX / useDPR, y: canvasY / useDPR };
            },
        };

        // ── Sweep loop ──────────────────────────────────────────────────
        // Progress → which window of samples to paint.
        // No downsampling needed -- Canvas lineTo() handles all 900 raw
        // samples per frame at negligible cost vs Plotly's SVG diffing.
        function drawAtElapsed(elapsed) {
            const progress    = Math.min(1, elapsed / durationMs);
            // FLOORED AT 1, so endSample is never less than 2.
            //
            // At elapsed exactly 0 the window was a single sample, and
            // drawSignalPath returns early below slice.length < 2 -- so
            // the frame painted grid lines and no trace, which on a black
            // card is indistinguishable from a broken renderer. Reachable
            // whenever something redraws at position zero: a replay, a
            // scrub to the start, or a rail tap on a card paused at the
            // very beginning.
            //
            // renderWaveformSweep in shared_signal_utils.js already
            // carries the same guard as Math.max(2, ...); this renderer
            // never got it.
            const leadingIdx  = Math.max(1, Math.round(progress * (totalSamples - 1)));
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
function buildAxisLayer(totalDurationS, signal, styles) {
    // Themed, and inherited by the spans below rather than set on each.
    // `styles` is passed in from the render path so this does not force a
    // second style recalculation of its own.
    const s = styles ?? getComputedStyle(document.documentElement);
    const read = (name, fallback) =>
        typeof themeColor === "function"
            ? themeColor(s, name, fallback)
            : (s.getPropertyValue(name).trim() || fallback);
    const axisColor = read("--axis-label-color", "#747d8c");
    const axisFont  = read("--axis-font", "'IBM Plex Mono', monospace");

    const layer  = document.createElement("div");
    layer.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none;
        font-family: ${axisFont};
        font-size: 10px;
        color: ${axisColor};
    `;

    const yMin   = Math.min(...signal) - 0.05;
    const yMax   = Math.max(...signal) + 0.05;
    const steps  = 4;
    const MARGIN_BOTTOM = 24;   // must match MARGIN in the draw loop
    const MARGIN_TOP    = 10;

    for (let g = 0; g <= steps; g++) {
        const v      = yMin + (g / steps) * (yMax - yMin);
        const pct    = 1 - (g / steps); // 0 at top, 1 at bottom
        const label  = document.createElement("span");
        label.style.cssText = `
            position: absolute;
            /* INSIDE the plot now, not in a left gutter. The text shadow
               keeps it readable where the trace passes behind it -- a
               solid background chip would punch holes in the waveform,
               which matters more than the label does. */
            left: 6px;
            text-shadow: 0 0 4px #000, 0 0 8px #000;
            top: calc(${MARGIN_TOP}px + ${pct * 100}% - ${MARGIN_TOP + MARGIN_BOTTOM}px * ${pct} - 6px);
            font-size: 9px;
        `;
        label.textContent = v.toFixed(2);
        layer.appendChild(label);
    }

    // X-axis label
    const xLabel = document.createElement("span");
    // Bottom-LEFT, not bottom-right: the rail buttons occupy the
    // bottom-right corner and were sitting on top of this.
    xLabel.style.cssText = "position:absolute; bottom:2px; left:6px; "
                         + "font-size:9px; text-shadow:0 0 4px #000;";
    xLabel.textContent = `${totalDurationS.toFixed(1)}s`;
    layer.appendChild(xLabel);

    return layer;
}
