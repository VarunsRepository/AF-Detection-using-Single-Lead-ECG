// ---------------------------------------------------------------------------
// renderers/moore_view.js
//
// Three views of one table of chips, chosen by config.view:
//
//   line    transistor count against year, log power of ten, with the fit
//   claim   density x node^2 against the flat line that would mean the
//           node label tracked density
//   dies    the same scatter, with multi-die packages called out
//
// WHY A LOG COUNT AXIS
//   The data spans 2,300 to 114,000,000,000 -- eight orders of magnitude.
//   On a linear axis every chip before about 2005 is a single row of dots
//   on the floor and the first thirty years of the story are invisible.
//   Log turns the exponential into a straight line, which is the whole
//   claim being made: a line you can see is a claim you can check.
//   (Same argument as spectrum_view's log power axis, same reason.)
//
// WHY ESTIMATED POINTS ARE DRAWN HOLLOW
//   Some die areas come off photographs, not datasheets, and the claim
//   view divides by them. Marking which numbers are soft costs one shape
//   and keeps the chart from overstating what it knows.
//
// SIZING -- read this before changing it
//   container.offsetWidth is frequently 0 at the moment render() runs,
//   which is why every renderer in this folder carries a literal pixel
//   fallback. An earlier version of this file used clientWidth with
//   Math.max(1, ...) as the guard; that turns the zero case into a 1x1
//   canvas, which throws nothing, logs nothing and draws a perfectly
//   blank card. All geometry is therefore computed INSIDE draw() from
//   the canvas's current size, so a resize cannot leave stale scales
//   behind.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

const FAM = {
    x86:   "#2edac4",
    apple: "#eb7b2b",
    gpu:   "#9b59b6",
    multi: "#ff3366",
};

registerRenderingAlgorithm("moore_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const view = config.view ?? "line";
        const fo = dspOutput.finalOutput ?? {};
        const steps = (dspOutput.interimOutputs ?? []).filter(c => c.view === view);
        if (steps.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">No "${view}" steps to draw.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 420;
        canvas.width  = Math.round(iw * useDPR);
        canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";

        const pts = fo.points ?? [];
        const claims = fo.claimPoints ?? [];
        const isClaim = view === "claim";
        const series = isClaim ? claims : pts;
        if (series.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">Nothing plottable in this sample.</p>`;
            return;
        }
        // SAY SO LOUDLY IF THE POINTS ARE NOT POINTS. A canvas call with
        // NaN coordinates is a silent no-op, so a single bad value
        // upstream produces a correctly sized, fully wired, entirely
        // blank chart with nothing in the console. That cost an hour
        // once -- multi_to_arrays hands every field over as a
        // Float32Array, and TypedArray.map returns a typed array, so a
        // map to objects quietly yields NaN. Checking one field converts
        // the whole failure mode from invisible to a sentence on screen.
        if (!Number.isFinite(series[0]?.year)) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">Points are not objects —
                 got <code>${Object.prototype.toString.call(series)}</code> of
                 <code>${typeof series[0]}</code>. The DSP probably mapped over a
                 Float32Array; it needs Array.from() first.</p>`;
            return;
        }

        // ── Scale bounds. Data-derived, so they are computed once; the
        // PIXEL mapping that uses them is rebuilt per frame from the
        // canvas's live size.
        const years = series.map(p => p.year);
        const yrLo = Math.min(...years) - 1, yrHi = Math.max(...years) + 1;

        let lo, hi;
        if (isClaim) {
            // Spans well under one decade, so snapping to powers of ten
            // would leave a single gridline. Padded range of its own,
            // always containing 1.0 -- the flat line is the comparison
            // being made and must be on screen.
            const l = claims.map(p => Math.log10(p.ratio)).concat([0]);
            lo = Math.min(...l) - 0.12;
            hi = Math.max(...l) + 0.12;
        } else {
            const vals = pts.map(p => p.transistors);
            lo = Math.floor(Math.log10(Math.min(...vals)));
            hi = Math.ceil(Math.log10(Math.max(...vals)));
        }

        // Evaluate a fit at a year. The filter sends slope and intercept
        // as numbers, never a closure -- see the note in moore_filter.js.
        const fitAt = (f, yr) => Math.pow(10, f.slope * yr + f.intercept);

        const mono = s => `${s * useDPR}px "IBM Plex Mono", monospace`;
        const bold = s => `600 ${s * useDPR}px "IBM Plex Mono", monospace`;

        let last = [0, 0, 0];

        function draw(idx, frac, progress) {
            last = [idx, frac, progress];
            const ctx = canvas.getContext("2d");
            // Live size, every frame. Hoisting these out of draw() is the
            // other half of the blank-canvas bug: after a resize the old
            // values describe a canvas that no longer exists.
            const W = canvas.width, H = canvas.height;
            if (!W || !H) return;

            const M = { left: 46 * useDPR, right: 14 * useDPR,
                        top: 54 * useDPR, bottom: 44 * useDPR };
            const plotW = W - M.left - M.right;
            const plotH = H - M.top - M.bottom;
            if (plotW <= 0 || plotH <= 0) return;

            const tx = y => M.left + ((y - yrLo) / (yrHi - yrLo)) * plotW;
            const ty = v => M.top + plotH
                            - ((Math.log10(Math.max(v, 1e-12)) - lo) / (hi - lo)) * plotH;

            ctx.clearRect(0, 0, W, H);
            grid(ctx, W, H, M, plotW, plotH, tx, ty);

            const shown = idx + 1;

            if (isClaim) {
                // THE FLAT LINE IS THE PREDICTION. If a node label tracked
                // density, density x node^2 would be constant and this
                // series would sit on 1.0 forever. Drawing the prediction
                // first, as a rule across the whole width, makes every
                // later point a visible departure rather than a wiggle.
                const y1 = ty(1);
                ctx.setLineDash([5 * useDPR, 4 * useDPR]);
                ctx.strokeStyle = "#eb7b2b";
                ctx.lineWidth = 1.7 * useDPR;
                ctx.beginPath();
                ctx.moveTo(M.left, y1);
                ctx.lineTo(M.left + plotW, y1);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "#eb7b2b";
                ctx.font = mono(9);
                ctx.textAlign = "left";
                ctx.fillText("if the label tracked density",
                             M.left + 6 * useDPR, y1 - 5 * useDPR);

                ctx.beginPath();
                claims.slice(0, shown).forEach((p, i) => {
                    const x = tx(p.year), y = ty(p.ratio);
                    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
                });
                ctx.strokeStyle = "#2edac4";
                ctx.lineWidth = 2.2 * useDPR;
                ctx.stroke();
                claims.slice(0, shown).forEach(p =>
                    dot(ctx, p, tx(p.year), ty(p.ratio),
                        p.ratio >= 1 ? "#2edac4" : FAM.multi, !p.estimated));

                const cross = fo.crossing;
                if (cross && claims.slice(0, shown).some(p => p.year >= cross.year)) {
                    const cx = tx(cross.year);
                    ctx.setLineDash([4 * useDPR, 4 * useDPR]);
                    ctx.strokeStyle = FAM.multi;
                    ctx.lineWidth = 1.6 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(cx, M.top);
                    ctx.lineTo(cx, M.top + plotH);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = FAM.multi;
                    ctx.font = bold(10);
                    ctx.textAlign = "center";
                    ctx.fillText(`${cross.nodeNm}nm — never above again`,
                                 cx, M.top - 6 * useDPR);
                }

                const cur = claims[idx];
                header(ctx, M, "Density x node²  —  flat if the label meant anything",
                       fo.spread
                         ? `wanders ${fo.spread.toFixed(1)}x`
                           + (cur ? `  ·  ${cur.name} at ${cur.ratio.toFixed(2)}x` : "")
                         : "",
                       cur && cur.ratio < 1 ? FAM.multi : "#78828e");

            } else {
                // Driven by progress through the WHOLE stage, not by the
                // current step. Keying it to the last step gave the
                // removal about a sixth of a second on a 13s stage.
                const hideMulti = view === "dies" && progress > 0.72;

                const f = (hideMulti && fo.fitSingleDie) ? fo.fitSingleDie : fo.fit;
                if (f) {
                    ctx.beginPath();
                    for (let yr = yrLo; yr <= yrHi; yr += 0.5) {
                        const x = tx(yr), y = ty(fitAt(f, yr));
                        yr === yrLo ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    }
                    ctx.strokeStyle = "rgba(255,255,255,0.26)";
                    ctx.setLineDash([6 * useDPR, 5 * useDPR]);
                    ctx.lineWidth = 1.6 * useDPR;
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                pts.slice(0, shown).forEach(p => {
                    if (hideMulti && p.dies > 1) return;
                    dot(ctx, p, tx(p.year), ty(p.transistors),
                        FAM[p.family] ?? "#8a94a2", !p.estimated);
                });

                // Label only the current chip. Forty names at 9px is the
                // grey fuzz problem; one name at 11px is a caption.
                const cur = pts[idx];
                if (cur && !(hideMulti && cur.dies > 1)) {
                    const x = tx(cur.year), y = ty(cur.transistors);
                    const right = x > M.left + plotW * 0.66;
                    ctx.textAlign = right ? "right" : "left";
                    const dx = (right ? -9 : 9) * useDPR;
                    ctx.fillStyle = "#e8f4f8";
                    ctx.font = bold(11);
                    ctx.fillText(cur.name, x + dx, y - 8 * useDPR);
                    ctx.fillStyle = "#78828e";
                    ctx.font = mono(9);
                    ctx.fillText(fmt(cur.transistors)
                                 + (cur.dies > 1 ? `  (${cur.dies} dies)` : ""),
                                 x + dx, y + 11 * useDPR);
                }

                if (view === "dies") {
                    header(ctx, M,
                           hideMulti ? "Single dies only" : "Everything, packages included",
                           hideMulti
                             ? `${fo.multiDieCount} package${fo.multiDieCount === 1 ? "" : "s"} removed`
                               + (fo.fitSingleDie?.doublingYears
                                   ? ` — doubling every ${fo.fitSingleDie.doublingYears.toFixed(2)} yr`
                                   : "")
                             : (cur ? cur.name : ""),
                           hideMulti ? FAM.multi : "#78828e");
                } else {
                    header(ctx, M, "Transistors per chip",
                           fo.fit?.doublingYears
                             ? `doubling every ${fo.fit.doublingYears.toFixed(2)} years`
                               + `  ·  r² ${fo.fit.r2.toFixed(3)}` : "");
                }
            }

            if (fo.estimatedCount) {
                ctx.textAlign = "right";
                ctx.fillStyle = "#4a5260";
                ctx.font = mono(9);
                ctx.fillText("hollow = estimated figure",
                             M.left + plotW, H - 6 * useDPR);
            }
            ctx.textAlign = "center";
            ctx.fillStyle = "#4a5260";
            ctx.font = mono(9);
            ctx.fillText(`${idx + 1} / ${steps.length}`, W / 2, H - 6 * useDPR);
        }

        function grid(ctx, W, H, M, plotW, plotH, tx, ty) {
            ctx.strokeStyle = "rgba(255,255,255,0.055)";
            ctx.lineWidth = 1 * useDPR;
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.textAlign = "right";

            const rule = (y, label) => {
                ctx.beginPath();
                ctx.moveTo(M.left, y);
                ctx.lineTo(M.left + plotW, y);
                ctx.stroke();
                ctx.fillText(label, M.left - 6 * useDPR, y + 3 * useDPR);
            };

            if (isClaim) {
                for (const v of [0.25, 0.5, 1, 2, 4]) {
                    const l = Math.log10(v);
                    if (l < lo || l > hi) continue;
                    rule(ty(v), `${v}x`);
                }
            } else {
                for (let e = lo; e <= hi; e++) rule(ty(Math.pow(10, e)), expLabel(e));
            }

            ctx.textAlign = "center";
            const span = yrHi - yrLo;
            const step = span > 40 ? 10 : span > 20 ? 5 : 2;
            for (let yr = Math.ceil(yrLo / step) * step; yr <= yrHi; yr += step) {
                ctx.fillText(`${yr}`, tx(yr), M.top + plotH + 15 * useDPR);
            }
        }

        function dot(ctx, p, x, y, col, solid) {
            const r = (p.dies > 1 ? 5.2 : 4.0) * useDPR;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            if (solid) { ctx.fillStyle = col; ctx.fill(); }
            else {
                ctx.strokeStyle = col;
                ctx.lineWidth = 1.7 * useDPR;
                ctx.stroke();
            }
            // A multi-die package gets a second ring, so the marker says
            // "this is a package" before any caption does.
            if (p.dies > 1) {
                ctx.beginPath();
                ctx.arc(x, y, r + 3.4 * useDPR, 0, Math.PI * 2);
                ctx.strokeStyle = FAM.multi;
                ctx.lineWidth = 1.4 * useDPR;
                ctx.stroke();
            }
        }

        function header(ctx, M, title, sub, subCol) {
            ctx.textAlign = "left";
            ctx.fillStyle = accent;
            ctx.font = bold(14);
            ctx.fillText(title, M.left, 22 * useDPR);
            if (sub) {
                ctx.fillStyle = subCol ?? "#78828e";
                ctx.font = mono(10);
                ctx.fillText(sub, M.left, 38 * useDPR);
            }
        }

        function expLabel(e) {
            if (e < 0) return `1e${e}`;
            if (e <= 3) return `${Math.pow(10, e)}`;
            if (e < 6) return `${Math.pow(10, e - 3)}K`;
            if (e < 9) return `${Math.pow(10, e - 6)}M`;
            return `${Math.pow(10, e - 9)}B`;
        }

        function fmt(n) {
            if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B transistors`;
            if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M transistors`;
            if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K transistors`;
            return `${n} transistors`;
        }

        // Redraws as well as resizes. The sweep loop would repaint on its
        // next tick anyway, but it stops at the end of the stage -- and a
        // resize after that would otherwise leave a cleared canvas, which
        // is exactly the state the builder preview sits in.
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            draw(...last);
        }).observe(container);

        // The dies view compresses its reveal into the first 72% of the
        // stage so the removal that follows has time to be noticed.
        const REVEAL = view === "dies" ? 0.72 : 1.0;

        draw(0, 0, 0);
        startSweepLoop(sampleId, durationMs, e => {
            const progress = Math.max(0, Math.min(1, e / durationMs));
            const pos = Math.min(1, progress / REVEAL) * steps.length;
            const idx = Math.min(steps.length - 1, Math.floor(pos));
            draw(idx, pos - idx, progress);
        });
    },
});

})();