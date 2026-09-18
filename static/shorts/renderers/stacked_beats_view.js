// ---------------------------------------------------------------------------
// renderers/stacked_beats_view.js
//
// Draws every R-aligned beat on one set of axes, beat by beat, so the
// bundle accumulates as you watch. Canvas 2D -- 40 beats x ~180 samples
// is 7,200 line segments per frame, which Plotly would struggle with and
// Canvas does not notice.
//
// WHY PROGRESSIVE RATHER THAN ALL AT ONCE
//   Drawing all beats instantly gives a static picture. Drawing them one
//   at a time makes CONSISTENCY visible as a process: each new beat
//   either lands on the bundle or does not, and an ectopic beat announces
//   itself by being the one line that departs. The sweep is carrying
//   information here, not just decoration.
//
// WHAT THE VIEW SHOWS
//   faint grey      every beat drawn so far
//   accent line     the mean beat, drawn last and on top
//   vertical line   t=0, the R-apex every beat is aligned to
//   PQRST dots      only when the upstream detector emitted wavePoints
//
// INPUT
//   finalOutput.beats           [{timeMs, amplitudeMv, features}]
//   finalOutput.meanBeat        sample-wise mean across beats
//   finalOutput.stats           {mean, rmssd, pnn50, total}
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js first).
// IIFE-wrapped for the same global-scope reason as the filters.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("stacked_beats_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const { beats, meanBeat, meanBeatTimeMs, stats, vix } = dspOutput.finalOutput;
        if (!beats || beats.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">No beats to stack.</p>`;
            return;
        }

        const useDPR  = globalThis._DEV_CANVAS_DPR  ?? devicePixelRatio;
        const useGlow = globalThis._DEV_CANVAS_GLOW ?? true;

        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        // Size immediately from the container. Under CSS scroll-snap the
        // card is laid out even while off-screen, so offsetWidth is real
        // here -- waiting for ResizeObserver would leave the first frames
        // drawn into a 300x150 default that the first resize then clears.
        const initW = container.offsetWidth  || 800;
        const initH = container.offsetHeight || 300;
        canvas.width  = Math.round(initW * useDPR);
        canvas.height = Math.round(initH * useDPR);
        canvas.style.width  = initW + "px";
        canvas.style.height = initH + "px";

        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (width === 0 || height === 0) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width  = width  + "px";
            canvas.style.height = height + "px";
        });
        ro.observe(container);

        const rootStyle  = getComputedStyle(document.documentElement);
        const accent     = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                           || rootStyle.getPropertyValue("--accent").trim() || "#5cc24a";
        const gridColor  = rootStyle.getPropertyValue("--grid-color").trim()
                           || "rgba(116,125,140,0.13)";

        // Fixed extents across ALL beats. Rescaling per beat would make
        // every beat look the same height, destroying the amplitude
        // comparison the view exists to make.
        let tMin =  Infinity, tMax = -Infinity;
        let yMin =  Infinity, yMax = -Infinity;
        for (const b of beats) {
            if (b.timeMs[0] < tMin) tMin = b.timeMs[0];
            if (b.timeMs[b.timeMs.length - 1] > tMax) tMax = b.timeMs[b.timeMs.length - 1];
            for (const v of b.amplitudeMv) {
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
            }
        }
        const pad = (yMax - yMin) * 0.08;
        yMin -= pad; yMax += pad;

        // ── X-AXIS BOUND ────────────────────────────────────────────────
        // In atrial fibrillation R-R intervals can range from 400ms to
        // 1400ms. Spanning the widest one squashes every normal beat into
        // the left third of the plot while a single outlier owns the rest
        // -- so the view is dominated by its least representative beat.
        //
        // Bounded at a PERCENTILE of R-R duration instead, so the bulk of
        // the distribution fills the axis.
        //
        // NOT bounded by RMSSD, which was considered: RMSSD measures
        // SUCCESSIVE DIFFERENCES between adjacent beats, not absolute
        // duration. In AFib RMSSD is typically 100-200ms while the
        // intervals themselves are 400-1400ms, so clipping just past
        // RMSSD would cut off almost every line. They are different
        // quantities that happen to share a unit.
        //
        // Beats past the bound are NOT hidden -- they are drawn up to the
        // edge and flagged. In AFib the outliers ARE the finding, and
        // silently truncating them would be the worst possible outcome.
        // Bound the axis just past the BULK of the distribution.
        //
        // The problem: in AFib R-R intervals run from ~400ms to ~1400ms.
        // Spanning the widest one squashes every ordinary beat into the
        // left third while one outlier owns the rest, so the plot is
        // dominated by its least representative beat.
        //
        // Two approaches were tried and rejected:
        //
        //   90th percentile -- with a typical 15-40 beat record that
        //   lands within one or two of the longest beat, so it excludes
        //   almost nothing and the outlier still owns the axis.
        //
        //   q75 + 1.5*IQR -- Tukey's outlier FENCE. On real data that
        //   computed to 2300ms against a 1797ms maximum: it is built to
        //   flag extreme points, not to bound a display, so it sits well
        //   beyond every actual value.
        //
        // What works: the median plus a fraction of the spread above it.
        // A steady rhythm has a narrow spread so the bound hugs the bulk;
        // a variable one widens proportionally. Clipped beats are drawn
        // to the edge and flagged -- in AFib the outliers ARE the finding,
        // so hiding them silently would be the worst outcome.
        let clippedCount = 0;

        if (config.clipRRAxis !== false && beats.length > 4) {
            const durations = beats
                .map(b => b.timeMs[b.timeMs.length - 1])
                .sort((a, b) => a - b);

            const med   = durations[Math.floor(0.50 * durations.length)];
            const upper = durations[Math.floor(0.80 * durations.length)];
            // Stretch 0.8 chosen by measurement, not taste. Tested across
            // 0.4-1.6 against a steady rhythm and a 400-1400ms AFib one:
            //   steady   never clips at any value -- correct, no outliers
            //   afib     clips 4 beats at 0.4, 1 at 1.6
            // 0.8 clips ~19% of the AFib beats while leaving sinus
            // completely untouched, which is the behaviour wanted.
            const bound = med + (upper - med) * (config.rrClipStretch ?? 0.8)
                              + 60;   // a little air so the median beat is
                                      // never flush against the edge

            if (bound < tMax) {
                clippedCount = beats.filter(
                    b => b.timeMs[b.timeMs.length - 1] > bound).length;
                tMax = bound;
            }
        }

        const WAVE_COLORS = {
            P: "#1abc9c", Q: "#f1c40f", R: "#eb7b2b",
            S: "#e74c3c", T: "#9b59b6",
        };

        // frac (0..1) = how much of the CURRENT beat to draw. Beats
        // before it are drawn whole.
        function drawUpTo(nBeats, showMean, frac = 1) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const M = { top: 12 * useDPR, right: 12 * useDPR,
                        bottom: 30 * useDPR, left: 46 * useDPR };
            const plotW = W - M.left - M.right;
            const plotH = H - M.top  - M.bottom;

            const toX = t => M.left + ((t - tMin) / (tMax - tMin)) * plotW;
            const toY = v => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

            ctx.clearRect(0, 0, W, H);

            // Horizontal gridlines
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            for (let g = 0; g <= 4; g++) {
                const py = toY(yMin + (g / 4) * (yMax - yMin));
                ctx.beginPath();
                ctx.moveTo(M.left, py);
                ctx.lineTo(M.left + plotW, py);
                ctx.stroke();
            }

            // ── P-WAVE / f-WAVE REGION ──────────────────────────────
            // The window where a P-wave should appear, roughly 200ms to
            // 80ms before the R. Shaded faintly so the eye knows where to
            // look without the tint competing with the traces.
            //
            // WHY MARK IT: in atrial fibrillation f-waves REPLACE the
            // P-wave -- a chaotic, low-amplitude baseline instead of a
            // single clean deflection. Across a stacked bundle that shows
            // as this region being a fuzzy band rather than a tight
            // bundle of matching P-waves, which is a genuinely different
            // signal from the irregular R-R intervals the rest of the
            // plot shows. AFib needs both.
            if (config.showPWaveRegion !== false && tMin < -150) {
                const px0 = toX(Math.max(tMin, -200));
                const px1 = toX(-80);
                if (px1 > px0) {
                    ctx.save();
                    ctx.fillStyle = "rgba(26,188,156,0.05)";
                    ctx.fillRect(px0, M.top, px1 - px0, plotH);
                    ctx.strokeStyle = "rgba(26,188,156,0.22)";
                    ctx.lineWidth = 1 * useDPR;
                    ctx.setLineDash([3 * useDPR, 3 * useDPR]);
                    ctx.beginPath();
                    ctx.moveTo(px0, M.top); ctx.lineTo(px0, M.top + plotH);
                    ctx.moveTo(px1, M.top); ctx.lineTo(px1, M.top + plotH);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = "rgba(26,188,156,0.55)";
                    ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.textAlign = "center";
                    ctx.fillText("P / f", (px0 + px1) / 2, M.top + 11 * useDPR);
                    ctx.textAlign = "left";
                    ctx.restore();
                }
            }

            // ── VOLATILITY BAND ─────────────────────────────────────
            // mean * exp(±sigma) of the log-returns: the window R-R
            // intervals should land in if the rhythm is stable. Drawn
            // UNDER the traces because it is context, not data -- the
            // second R-peaks falling inside or outside it is the reading.
            //
            // A tight band with every R inside means a steady rhythm. A
            // wide band, or R-peaks scattered outside it, is what
            // volatility looks like.
            if (vix && config.showVixBand !== false) {
                const bx0 = toX(Math.max(tMin, vix.lowerBound));
                const bx1 = toX(Math.min(tMax, vix.upperBound));
                if (bx1 > bx0) {
                    ctx.save();
                    ctx.fillStyle = vix.isVolatile
                        ? "rgba(231,76,60,0.07)"      // red when unstable
                        : "rgba(136,192,208,0.06)";
                    ctx.fillRect(bx0, M.top, bx1 - bx0, plotH);

                    ctx.strokeStyle = vix.isVolatile
                        ? "rgba(231,76,60,0.35)"
                        : "rgba(136,192,208,0.30)";
                    ctx.lineWidth = 1 * useDPR;
                    ctx.setLineDash([4 * useDPR, 3 * useDPR]);
                    ctx.beginPath();
                    ctx.moveTo(bx0, M.top); ctx.lineTo(bx0, M.top + plotH);
                    ctx.moveTo(bx1, M.top); ctx.lineTo(bx1, M.top + plotH);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
            }

            // t=0 -- the R-apex. The single most important line in the
            // view: it is what every beat is aligned to.
            const x0 = toX(0);
            ctx.strokeStyle = "rgba(235,123,43,0.55)";
            ctx.lineWidth = 1.5 * useDPR;
            ctx.setLineDash([5 * useDPR, 4 * useDPR]);
            ctx.beginPath();
            ctx.moveTo(x0, M.top);
            ctx.lineTo(x0, M.top + plotH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Every beat so far, faint. Opacity scales down as the count
            // grows so a 60-beat bundle stays readable rather than
            // saturating into a solid block.
            const alpha = Math.max(0.10, Math.min(0.42, 6 / Math.max(1, nBeats)));
            ctx.strokeStyle = `rgba(200,212,224,${alpha})`;
            ctx.lineWidth   = 1.1 * useDPR;
            ctx.lineJoin = "round";

            // Everything from here draws inside the plot rect only. With
            // a percentile-bounded x-axis some beats extend past tMax,
            // and without a clip they would paint over the axis labels
            // and outside the card.
            ctx.save();
            ctx.beginPath();
            ctx.rect(M.left, M.top, plotW, plotH);
            ctx.clip();

            // Completed beats -- drawn whole, faint.
            const completed = Math.max(0, Math.min(nBeats, beats.length) - 1);
            for (let i = 0; i < completed; i++) {
                const b = beats[i];
                ctx.beginPath();
                ctx.moveTo(toX(b.timeMs[0]), toY(b.amplitudeMv[0]));
                for (let s = 1; s < b.amplitudeMv.length; s++) {
                    ctx.lineTo(toX(b.timeMs[s]), toY(b.amplitudeMv[s]));
                }
                ctx.stroke();
            }

            // The CURRENT beat, drawn left-to-right as far as `frac`.
            //
            // WHY: a beat appearing whole, instantly, reads as a picture
            // being added to a pile. Drawing it in sweeps it onto the
            // axes the way the original signal was recorded -- so you see
            // the P rise, the QRS spike and the T settle land on (or miss)
            // the bundle already there. The comparison happens DURING the
            // draw rather than after it.
            //
            // Brighter than the settled beats so the eye follows it.
            const curIdx = Math.min(nBeats, beats.length) - 1;
            if (curIdx >= 0 && frac > 0) {
                const b   = beats[curIdx];
                const upTo = Math.max(2, Math.round(frac * b.amplitudeMv.length));
                ctx.save();
                ctx.strokeStyle = `rgba(232,244,248,${Math.min(0.85, alpha + 0.45)})`;
                ctx.lineWidth   = 1.6 * useDPR;
                ctx.beginPath();
                ctx.moveTo(toX(b.timeMs[0]), toY(b.amplitudeMv[0]));
                for (let s = 1; s < upTo; s++) {
                    ctx.lineTo(toX(b.timeMs[s]), toY(b.amplitudeMv[s]));
                }
                ctx.stroke();

                // Leading dot -- marks where the trace currently is, the
                // same cue the ECG sweep uses.
                if (upTo < b.amplitudeMv.length) {
                    ctx.fillStyle = accent;
                    ctx.beginPath();
                    ctx.arc(toX(b.timeMs[upTo - 1]), toY(b.amplitudeMv[upTo - 1]),
                            2.6 * useDPR, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // PQRST markers from the most recent beat only. Plotting them
            // for every beat produces five dense clouds that hide the
            // waveform underneath.
            const last = beats[Math.min(nBeats, beats.length) - 1];
            if (last?.features) {
                for (const [wave, pts] of Object.entries(last.features)) {
                    ctx.fillStyle = WAVE_COLORS[wave] || accent;
                    for (const p of pts) {
                        ctx.beginPath();
                        ctx.arc(toX(p.x), toY(p.y), 3.2 * useDPR, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            // ── R-R interval lines, ON TOP of the beats ─────────────
            // Drawn AFTER the waveforms, not before. These lines are the
            // entire point of the two-beat view, and painting the beats
            // over them buried the thing the stage exists to show.
            //
            // Each line runs from this beat's R (t=0) to its NEXT R, at R
            // height -- so the line's LENGTH is the R-R interval.
            // Consistent rhythm stacks them into one thick band; variable
            // rhythm fans them out.
            if (config.showRRLines !== false) {
                ctx.save();
                ctx.lineWidth = 1.4 * useDPR;
                ctx.lineCap = "round";
                for (let i = 0; i < Math.min(nBeats, beats.length); i++) {
                    const rs = beats[i].features?.R;
                    if (!rs) continue;
                    for (const r of rs) {
                        if (r.x <= 0) continue;   // t=0 is this beat's own R
                        const clipped = r.x > tMax;
                        const endX = clipped ? toX(tMax) : toX(r.x);
                        ctx.strokeStyle = clipped
                            ? "rgba(231,76,60,0.55)"      // red: runs off
                            : "rgba(235,123,43,0.45)";
                        ctx.beginPath();
                        ctx.moveTo(toX(0), toY(r.y));
                        ctx.lineTo(endX,   toY(r.y));
                        ctx.stroke();

                        // Box the second R -- the beat this interval
                        // arrives at. Its position relative to the
                        // volatility band is the whole reading: inside
                        // means this interval was typical, outside means
                        // it was not.
                        if (!clipped && config.showRBoxes !== false) {
                            const bx = toX(r.x), by = toY(r.y);
                            const s  = 5 * useDPR;
                            const inBand = vix &&
                                r.x >= vix.lowerBound && r.x <= vix.upperBound;
                            ctx.save();
                            ctx.strokeStyle = inBand
                                ? "rgba(136,192,208,0.85)"
                                : "rgba(231,76,60,0.9)";
                            ctx.lineWidth = 1.4 * useDPR;
                            ctx.strokeRect(bx - s, by - s, s * 2, s * 2);
                            ctx.restore();
                        }

                        // Arrowhead on a clipped line -- says "continues
                        // past here" rather than letting it look like a
                        // genuinely short interval.
                        if (clipped) {
                            const py = toY(r.y);
                            ctx.beginPath();
                            ctx.moveTo(endX, py);
                            ctx.lineTo(endX - 5 * useDPR, py - 3.5 * useDPR);
                            ctx.lineTo(endX - 5 * useDPR, py + 3.5 * useDPR);
                            ctx.closePath();
                            ctx.fillStyle = "rgba(231,76,60,0.75)";
                            ctx.fill();
                        }
                    }
                }
                ctx.restore();
            }

            // Mean beat on top, once the bundle is complete.
            if (showMean && meanBeat?.length) {
                ctx.save();
                if (useGlow) {
                    ctx.shadowColor = accent;
                    ctx.shadowBlur  = 6 * useDPR;
                }
                ctx.strokeStyle = accent;
                ctx.lineWidth   = 2.2 * useDPR;
                ctx.beginPath();
                ctx.moveTo(toX(meanBeatTimeMs[0]), toY(meanBeat[0]));
                for (let s = 1; s < meanBeat.length; s++) {
                    ctx.lineTo(toX(meanBeatTimeMs[s]), toY(meanBeat[s]));
                }
                ctx.stroke();
                ctx.restore();
            }

            ctx.restore();   // end plot-rect clip -- labels live outside it

            // Axis labels
            ctx.fillStyle = "#747d8c";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "right";
            for (let g = 0; g <= 4; g++) {
                const v = yMin + (g / 4) * (yMax - yMin);
                ctx.fillText(v.toFixed(2), M.left - 5 * useDPR,
                             toY(v) + 3 * useDPR);
            }
            ctx.textAlign = "center";
            ctx.fillText("0 ms (R)", x0, H - 10 * useDPR);
            ctx.textAlign = "left";
            ctx.fillText(`${tMin.toFixed(0)}`, M.left, H - 10 * useDPR);
            ctx.textAlign = "right";
            ctx.fillText(`${tMax.toFixed(0)} ms`, M.left + plotW, H - 10 * useDPR);

            // Running count, and the stats once complete
            ctx.textAlign = "left";
            ctx.fillStyle = accent;
            ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${Math.min(nBeats, beats.length)} / ${beats.length} beats`,
                         M.left + 4 * useDPR, M.top + 12 * useDPR);

            if (showMean && stats) {
                ctx.fillStyle = "#9aa1ab";
                ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`mean RR ${stats.mean.toFixed(0)}ms`,
                             M.left + 4 * useDPR, M.top + 28 * useDPR);
                ctx.fillText(`RMSSD ${stats.rmssd.toFixed(1)}ms`,
                             M.left + 4 * useDPR, M.top + 42 * useDPR);

                // Say so when beats run past the axis. A count that is
                // never mentioned is a lie by omission -- in AFib these
                // are the diagnostic beats.
                let row = 56;
                if (vix) {
                    ctx.fillStyle = vix.isVolatile
                        ? "rgba(231,76,60,0.95)" : "rgba(136,192,208,0.95)";
                    ctx.font = `600 ${10 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(
                        `VIX ${vix.volatilityPercentage.toFixed(1)}%  ${vix.isVolatile ? "VOLATILE" : "STABLE"}`,
                        M.left + 4 * useDPR, M.top + row * useDPR);
                    row += 14;
                    ctx.fillStyle = "#747d8c";
                    ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(
                        `band ${vix.lowerBound.toFixed(0)}\u2013${vix.upperBound.toFixed(0)}ms`,
                        M.left + 4 * useDPR, M.top + row * useDPR);
                    row += 14;
                }
                if (clippedCount > 0) {
                    ctx.fillStyle = "rgba(231,76,60,0.9)";
                    ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(`${clippedCount} beat${clippedCount > 1 ? "s" : ""} exceed ${tMax.toFixed(0)}ms \u2192`,
                                 M.left + 4 * useDPR, M.top + row * useDPR);
                }
            }
        }

        drawUpTo(1, false);

        // Driven by the shared sweep loop rather than a private rAF, so
        // pause, resume, speed and restart all work through
        // activeSweepControl without this renderer knowing about them.
        // The last 15% of the duration holds the completed bundle with
        // the mean drawn -- without it the final state flashes past.
        function drawAtElapsed(elapsed) {
            const progress = Math.min(1, elapsed / durationMs);
            const revealT  = Math.min(1, progress / 0.85);

            // Continuous beat position: the integer part is how many
            // beats are complete, the fraction is how far through the
            // current one. Rounding here instead would make beats appear
            // whole and lose the sweep entirely.
            const pos  = revealT * beats.length;
            const n    = Math.max(1, Math.ceil(pos));
            const frac = progress >= 0.85 ? 1 : (pos - Math.floor(pos)) || 1;

            drawUpTo(n, progress >= 0.85, frac);
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});

})();