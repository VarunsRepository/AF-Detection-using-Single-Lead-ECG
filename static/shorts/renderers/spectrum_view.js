// ---------------------------------------------------------------------------
// renderers/spectrum_view.js
//
// Power spectrum as a curve, with the frequency bands shaded beneath it
// and their integrated powers as bars.
//
// WHY A LOG POWER AXIS
//   Band powers in a real ECG span roughly 3e-6 to 2e-2 -- four orders
//   of magnitude. On a linear axis everything except the QRS band is
//   flat against zero, so baseline wander and mains interference, the
//   two faults this view exists to reveal, are invisible. Log makes a
//   10x difference the same height wherever it occurs.
//
// WHY A LINEAR FREQUENCY AXIS
//   Log frequency would give the 0-0.5Hz baseline band a third of the
//   width, which is misleading about where energy actually lives. The
//   bars below carry each band's power regardless of how little
//   horizontal space it occupies, so the curve can stay honest about
//   frequency.
//
// The reveal sweeps left to right across frequency, so bands fill in
// order: baseline, then P/T, then QRS, then muscle and mains. A
// contaminated recording announces itself at the moment its band fills.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped for the same
// global-scope reason as the filters.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("spectrum_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const { psd, freqs, bands, peakFrequency, resolutionHz, segments }
            = dspOutput.finalOutput;

        if (!psd || psd.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">No spectrum to draw.</p>`;
            return;
        }

        const useDPR  = globalThis._DEV_CANVAS_DPR  ?? devicePixelRatio;
        const useGlow = globalThis._DEV_CANVAS_GLOW ?? true;

        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const initW = container.offsetWidth  || 800;
        const initH = container.offsetHeight || 300;
        canvas.width  = Math.round(initW * useDPR);
        canvas.height = Math.round(initH * useDPR);
        canvas.style.width  = initW + "px";
        canvas.style.height = initH + "px";

        const ro = new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
        });
        ro.observe(container);

        const rootStyle = getComputedStyle(document.documentElement);
        const gridColor = rootStyle.getPropertyValue("--grid-color").trim()
                          || "rgba(116,125,140,0.13)";

        // Frequency range: show up to the highest band edge, not Nyquist.
        // At fs=300 Nyquist is 150Hz but nothing interesting lives above
        // 100Hz, and including it would waste a third of the width.
        const fMax = Math.min(
            freqs[freqs.length - 1],
            config.maxFrequency ?? Math.max(...bands.map(b => b.hi)));

        // Log floor. A PSD legitimately contains near-zero bins, and
        // log(0) is -Infinity -- clamping to a fraction of the peak keeps
        // the axis finite without inventing a floor so high it hides the
        // quiet bands.
        let pMax = 0;
        for (let k = 0; k < psd.length; k++) {
            if (freqs[k] <= fMax && psd[k] > pMax) pMax = psd[k];
        }
        const pMin = Math.max(pMax * 1e-7, 1e-14);
        const logMin = Math.log10(pMin), logMax = Math.log10(pMax);

        function drawTo(freqLimit, barProgress) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const barsH = 54 * useDPR;            // bar strip along the bottom
            const M = { top: 14 * useDPR, right: 12 * useDPR,
                        bottom: 26 * useDPR + barsH, left: 44 * useDPR };
            const plotW = W - M.left - M.right;
            const plotH = H - M.top - M.bottom;

            const toX = f => M.left + (f / fMax) * plotW;
            const toY = p => {
                const lg = Math.log10(Math.max(p, pMin));
                return M.top + plotH - ((lg - logMin) / (logMax - logMin)) * plotH;
            };

            ctx.clearRect(0, 0, W, H);

            // Decade gridlines -- the natural spacing for a log axis.
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.fillStyle = "#5c6470";
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "right";
            for (let d = Math.ceil(logMin); d <= Math.floor(logMax); d++) {
                const py = toY(Math.pow(10, d));
                ctx.beginPath();
                ctx.moveTo(M.left, py); ctx.lineTo(M.left + plotW, py);
                ctx.stroke();
                ctx.fillText(`1e${d}`, M.left - 4 * useDPR, py + 3 * useDPR);
            }

            // Band regions, shaded under the curve. Drawn before it so
            // the trace stays legible on top.
            for (const b of bands) {
                if (b.id === "mains") continue;   // overlaps muscle -- drawn
                                                  // as a marker line instead
                const x0 = toX(Math.max(0, b.lo)), x1 = toX(Math.min(fMax, b.hi));
                if (x1 <= x0) continue;
                ctx.fillStyle = b.color + "14";   // ~8% alpha
                ctx.fillRect(x0, M.top, x1 - x0, plotH);
                ctx.strokeStyle = b.color + "33";
                ctx.beginPath();
                ctx.moveTo(x1, M.top); ctx.lineTo(x1, M.top + plotH);
                ctx.stroke();
            }

            // Mains: a narrow 2Hz band, so a marker rather than a region.
            const mains = bands.find(b => b.id === "mains");
            if (mains && mains.lo < fMax) {
                const mx = toX((mains.lo + mains.hi) / 2);
                ctx.strokeStyle = "rgba(231,76,60,0.45)";
                ctx.setLineDash([4 * useDPR, 3 * useDPR]);
                ctx.beginPath();
                ctx.moveTo(mx, M.top); ctx.lineTo(mx, M.top + plotH);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // The spectrum, revealed up to freqLimit.
            ctx.save();
            ctx.beginPath();
            ctx.rect(M.left, M.top, plotW, plotH);
            ctx.clip();

            if (useGlow) {
                ctx.shadowColor = "#5cc24a";
                ctx.shadowBlur  = 5 * useDPR;
            }
            ctx.strokeStyle = "#a8e88f";
            ctx.lineWidth   = 1.5 * useDPR;
            ctx.lineJoin    = "round";
            ctx.beginPath();
            let started = false;
            for (let k = 1; k < psd.length; k++) {   // skip DC
                if (freqs[k] > fMax || freqs[k] > freqLimit) break;
                const x = toX(freqs[k]), y = toY(psd[k]);
                started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
            }
            ctx.stroke();
            ctx.restore();

            // Peak marker, once the sweep has passed it.
            if (peakFrequency <= freqLimit && peakFrequency <= fMax) {
                const px = toX(peakFrequency);
                ctx.fillStyle = "#eb7b2b";
                ctx.beginPath();
                ctx.arc(px, toY(dspOutput.finalOutput.peakPower),
                        3.2 * useDPR, 0, Math.PI * 2);
                ctx.fill();
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "center";
                ctx.fillText(`${peakFrequency.toFixed(1)}Hz`,
                             px, toY(dspOutput.finalOutput.peakPower) - 7 * useDPR);
            }

            // ── Frequency axis ──────────────────────────────────────────
            ctx.fillStyle = "#5c6470";
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "center";
            const tickStep = fMax > 80 ? 20 : 10;
            for (let f = 0; f <= fMax; f += tickStep) {
                ctx.fillText(`${f}`, toX(f), M.top + plotH + 14 * useDPR);
            }
            ctx.textAlign = "right";
            ctx.fillText("Hz", M.left + plotW, M.top + plotH + 14 * useDPR);

            // ── Band power bars ─────────────────────────────────────────
            // Percentages, not absolute power: the question is how energy
            // is DISTRIBUTED, and absolute values in mV^2/Hz mean nothing
            // to most people looking at this.
            const barsTop = H - barsH + 4 * useDPR;
            const barW    = plotW / bands.length;
            ctx.textAlign = "center";
            bands.forEach((b, i) => {
                const share = Math.min(1, Math.max(0, barProgress));
                const pct   = b.percent * share;
                const bx    = M.left + i * barW + barW * 0.16;
                const bw    = barW * 0.68;
                const maxBarH = barsH - 24 * useDPR;
                const bh    = (Math.min(pct, 100) / 100) * maxBarH;

                ctx.fillStyle = "rgba(255,255,255,0.05)";
                ctx.fillRect(bx, barsTop, bw, maxBarH);
                ctx.fillStyle = b.color + "cc";
                ctx.fillRect(bx, barsTop + maxBarH - bh, bw, bh);

                ctx.fillStyle = "#9aa4b0";
                ctx.font = `${8 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(b.label, bx + bw / 2, barsTop + maxBarH + 10 * useDPR);
                ctx.fillStyle = b.color;
                ctx.font = `600 ${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${pct.toFixed(0)}%`,
                             bx + bw / 2, barsTop + maxBarH + 20 * useDPR);
            });

            // Readout
            ctx.textAlign = "left";
            ctx.fillStyle = "#5c6470";
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${segments} windows \u00b7 ${resolutionHz.toFixed(2)}Hz bins`,
                         M.left + 4 * useDPR, M.top + 10 * useDPR);
        }

        drawTo(0, 0);

        // Shared sweep loop, so pause/resume/speed/restart all work
        // through activeSweepControl without this renderer knowing.
        // Bars fill over the last 25% -- the curve has to exist before a
        // summary of it means anything.
        function drawAtElapsed(elapsed) {
            const t = Math.min(1, elapsed / durationMs);
            const sweep = Math.min(1, t / 0.75);
            drawTo(sweep * fMax, (t - 0.75) / 0.25);
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});

})();
