// ---------------------------------------------------------------------------
// static/shorts/renderers/artefact_view.js
//
// A TRACE, AND THE TRACE IT SHOULD HAVE BEEN.
//
// Every card in this journey is the same picture: a reference signal in
// grey, the actual signal over it in the theme accent, and -- where there
// is one -- the thing that made them differ, drawn alone underneath.
//
// That shape is deliberately more general than this journey needs. The
// planned follow-up puts a REAL recording in the accent and a smoothed
// reconstruction holding the same PQRST points in the grey; the roles of
// "reference" and "actual" swap, and nothing else about the drawing
// changes. Building it twice would be building the drift between two
// copies, which is the lesson chart_v1 / chart_v1_canvas / chart_v1_webgl
// already taught the hard way -- the WebGL one lost its peak markers and
// nobody noticed for weeks.
//
// THREE VIEWS
//   artefact   one imperfection introduced, named, and drawn alone below
//   mix        every imperfection at the scenario's own levels
//   recovered  the 5-15 Hz bandpass applied, and what it costs
//
// WHAT IS DRAWN IS NOT DETECTED
//   The beat markers come from the source's ground truth, because the
//   source generated the beats and therefore knows where they are. No
//   peak detector runs here. That is what lets the last card say how
//   many beats survive the filter without the claim being circular.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("artefact_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        // The three views this renderer serves, named explicitly. The
        // recipe asked for "mix" from the start and this file never
        // mentioned it -- it fell through to the default branch and drew
        // very nearly the right card, which is the worst kind of working:
        // nothing visibly wrong, and no way to tell that the coupling
        // between recipe and renderer was never real. Found by a seam
        // check that had itself been silently matching nothing.
        const VIEWS = {
            artefact:  { span: 4, ghostLabel: "textbook",   mainLabel: "recorded" },
            mix:       { span: 4, ghostLabel: "textbook",   mainLabel: "recorded" },
            recovered: { span: 8, ghostLabel: "unfiltered", mainLabel: "filtered" },
        };
        const view = (config && config.view) || "artefact";
        const fo   = dspOutput?.finalOutput ?? {};

        if (!VIEWS[view]) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;font-family:monospace;">
                 artefact_view: unknown view "${view}". Known views are
                 ${Object.keys(VIEWS).join(", ")}. A view that is not
                 named here used to fall through to the default and draw
                 something plausible, which hid the mismatch.</p>`;
            return;
        }
        const VIEW = VIEWS[view];

        // The two series this card is about. `ref` is the grey, `main`
        // is the accent. The view picks which is which; everything below
        // is view-agnostic.
        const ref  = fo.clean;
        const main = (view === "recovered" && fo.filtered) ? fo.filtered : fo.y;

        if (!main || !main.length || !ref || !ref.length) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;font-family:monospace;">
                 artefact_view: no trace for view "${view}". The filter
                 returns clean + y on every stage, and filtered only when
                 the stage asks for it.</p>`;
            return;
        }
        if (!Number.isFinite(main[0])) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;font-family:monospace;">
                 artefact_view: samples are not numbers — got
                 <code>${Object.prototype.toString.call(main)}</code>.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const sizeTo = (w, h) => {
            canvas.width  = Math.round(w * useDPR);
            canvas.height = Math.round(h * useDPR);
            canvas.style.width  = w + "px";
            canvas.style.height = h + "px";
        };
        sizeTo(container.offsetWidth || 390, container.offsetHeight || 420);

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined"
                        && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#2edac4";
        const dim    = root.getPropertyValue("--text-dim").trim() || "#9aa4b0";
        const text   = root.getPropertyValue("--text").trim() || "#d8dee9";
        const warn   = root.getPropertyValue("--warn").trim() || "#c98a1f";
        const ghost  = "#6b7889";

        const mono = (s, w) => `${w ? w + " " : ""}${s * useDPR}px `
                             + `"IBM Plex Mono", ui-monospace, monospace`;
        const sans = (s, w) => `${w ? w + " " : ""}${s * useDPR}px `
                             + `"IBM Plex Sans", sans-serif`;

        const focus = fo.focus || null;
        // The isolated strip only exists when there is something to put
        // in it. A stage with no focus gets the full height for the
        // trace rather than an empty box with a label on it.
        const hasStrip = !!(focus && (focus.y || (focus.isMask && focus.mask)));

        let lastProgress = 0;

        function frame() {
            const W = canvas.width, H = canvas.height;
            const M = { l: 14 * useDPR, r: 14 * useDPR,
                        t: 64 * useDPR, b: 46 * useDPR };
            const inner = H - M.t - M.b;
            const stripH = hasStrip ? Math.round(inner * 0.30) : 0;
            const gap    = hasStrip ? 18 * useDPR : 0;
            return { W, H, M, pw: W - M.l - M.r,
                     mainH: inner - stripH - gap, stripH, gap };
        }

        // Both traces share ONE vertical scale, always. Scaling them
        // independently would make a corrupted trace and its reference
        // look the same height, which would quietly destroy the only
        // thing every card in this journey is trying to show.
        function sharedScale(a, b) {
            let lo = Infinity, hi = -Infinity;
            for (const s of [a, b]) {
                if (!s) continue;
                for (let i = 0; i < s.length; i++) {
                    if (s[i] < lo) lo = s[i];
                    if (s[i] > hi) hi = s[i];
                }
            }
            if (!(hi > lo)) { lo -= 1; hi += 1; }
            const pad = (hi - lo) * 0.08;
            return { lo: lo - pad, hi: hi + pad };
        }

        // ── How much of the record to show ────────────────────────────
        // The source carries 8 seconds, which is nine beats. Drawn across
        // a phone card that is forty pixels a beat, and the first card --
        // the one that is supposed to look like the beat the primer just
        // taught -- came out as a barcode with the P and T waves lost.
        //
        // Clinical paper is 25mm/s by 10mm/mV, about 14:1 for a 1.4mV
        // beat over 8s. There is no way to hit that on a tall card, but
        // showing four seconds instead of eight halves the error, and
        // five beats is still plainly a rhythm. The last card shows the
        // whole record, because counting what survived is its job.
        const WINDOW_S = VIEW.span;
        const winLen = Math.min(main.length, Math.round(WINDOW_S * (fs || fo.fs || 360)));

        // THE WINDOW MUST CONTAIN THE THING THE CARD IS ABOUT.
        //
        // Shortening the view to four seconds fixed the barcode problem
        // and immediately created a worse one: the electrode dropout
        // happens at 6.2s, so the card titled "Electrode disconnect"
        // showed four seconds of signal with no disconnect in it, and an
        // empty strip underneath a label describing one. Same failure as
        // the scenario-mix one, from the opposite direction, caught the
        // same way -- by looking at it.
        //
        // Rather than special-casing the electrode, slide the window to
        // wherever the focus artefact actually is. Uniform artefacts
        // (wander, mains) have flat energy and land at the start, which
        // is what they would have done anyway; transient ones follow
        // their event. No per-artefact branch to fall out of date.
        function pickWindow() {
            const energy = (fo.focus && (fo.focus.mask || fo.focus.y)) || null;
            if (!energy || winLen >= main.length) return [0, winLen];
            const stride = Math.max(1, Math.round(winLen / 8));
            let best = 0, bestE = -1;
            for (let s0 = 0; s0 + winLen <= energy.length; s0 += stride) {
                let e = 0;
                for (let i = s0; i < s0 + winLen; i += 4) e += Math.abs(energy[i]);
                if (e > bestE) { bestE = e; best = s0; }
            }
            return [best, best + winLen];
        }
        const WIN = pickWindow();

        // The scale is computed over the WINDOW, not the whole record --
        // otherwise a motion burst outside the visible span silently
        // flattens everything that is visible.
        function sliceOf(s) { return s ? s.subarray
            ? s.subarray(WIN[0], WIN[1]) : s.slice(WIN[0], WIN[1]) : null; }
        const scale = sharedScale(sliceOf(ref), sliceOf(main));

        // MIN/MAX DECIMATION, not stride sampling.
        //
        // The first version took every n/width-th sample. At 2880 samples
        // into ~760 device pixels that is every 4th sample, and 50 Hz at
        // 360 Hz is 7.2 samples per cycle -- so the mains trace on screen
        // was an ALIAS. Not a rougher picture of the right signal: a
        // different signal, at a frequency the filter never produced, on
        // a card whose entire claim is "this is what 50 Hz looks like".
        //
        // Taking the min and max of every pixel column instead draws the
        // signal's envelope, which is what a dense oscillation actually
        // looks like and cannot alias. Caught by rendering the card and
        // looking at it; no assertion here was ever going to notice.
        function plot(ctx, s, x0, y0, w, h, sc, upTo, colour, width, alpha,
                      win) {
            if (!s || !s.length) return;
            const from = win ? win[0] : 0;
            const to   = win ? win[1] : s.length;
            const n    = to - from;
            if (n < 2) return;
            const span = sc.hi - sc.lo;
            const cols = Math.max(1, Math.round(w));
            const lastCol = Math.max(1, Math.round(cols * upTo));
            const Y = (v) => y0 + h - ((v - sc.lo) / span) * h;

            ctx.save();
            ctx.globalAlpha = alpha ?? 1;
            ctx.strokeStyle = colour;
            ctx.lineWidth = width * useDPR;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.beginPath();
            let started = false;
            for (let c = 0; c < lastCol; c++) {
                const a = from + Math.floor((c / cols) * n);
                const b = Math.min(to, from + Math.floor(((c + 1) / cols) * n));
                if (b <= a) continue;
                let lo = Infinity, hi = -Infinity;
                for (let i = a; i < b; i++) {
                    if (s[i] < lo) lo = s[i];
                    if (s[i] > hi) hi = s[i];
                }
                const x = x0 + (c / cols) * w;
                if (!started) { ctx.moveTo(x, Y(s[a])); started = true; }
                ctx.lineTo(x, Y(hi));
                ctx.lineTo(x, Y(lo));
            }
            ctx.stroke();
            ctx.restore();
        }

        // Text that will not overflow its box -- the DRM renderer shipped
        // labels running off the edge of their panels because nothing
        // measured them before drawing.
        function fitLabel(ctx, s, maxW) {
            if (ctx.measureText(s).width <= maxW) return s;
            let t = s;
            while (t.length > 4 && ctx.measureText(t + "…").width > maxW) {
                t = t.slice(0, -1);
            }
            return t + "…";
        }

        function wrap(ctx, s, maxW, maxLines) {
            const words = String(s).split(/\s+/);
            const lines = [];
            let line = "";
            for (const w of words) {
                const t = line ? line + " " + w : w;
                if (ctx.measureText(t).width > maxW && line) {
                    lines.push(line); line = w;
                    if (lines.length === maxLines) break;
                } else { line = t; }
            }
            if (lines.length < maxLines && line) lines.push(line);
            return lines;
        }

        function drawHeader(ctx, g) {
            const x = g.M.l;
            let y = 22 * useDPR;

            if (focus) {
                ctx.fillStyle = accent;
                ctx.font = sans(13, "600");
                ctx.fillText(fitLabel(ctx, focus.label, g.pw), x, y);
                y += 15 * useDPR;
                ctx.fillStyle = dim;
                ctx.font = sans(10.5);
                for (const ln of wrap(ctx, focus.cause, g.pw, 2)) {
                    ctx.fillText(ln, x, y); y += 12 * useDPR;
                }
            } else {
                const t = view === "recovered"
                    ? "After the 5–15 Hz bandpass"
                    : (fo.scenario?.name || "Everything at once");
                ctx.fillStyle = accent;
                ctx.font = sans(13, "600");
                ctx.fillText(fitLabel(ctx, t, g.pw), x, y);
                y += 15 * useDPR;
                ctx.fillStyle = dim;
                ctx.font = sans(10.5);
                const sub = view === "recovered"
                    ? "What survives, and what it cost."
                    : (fo.scenario?.blurb || "");
                for (const ln of wrap(ctx, sub, g.pw, 2)) {
                    ctx.fillText(ln, x, y); y += 12 * useDPR;
                }
            }
        }

        function drawLegend(ctx, g) {
            const yb = g.H - 26 * useDPR;
            ctx.font = mono(8.5);
            let x = g.M.l;
            const chip = (colour, label, alpha) => {
                ctx.save();
                ctx.globalAlpha = alpha ?? 1;
                ctx.strokeStyle = colour;
                ctx.lineWidth = 2 * useDPR;
                ctx.beginPath();
                ctx.moveTo(x, yb - 3 * useDPR);
                ctx.lineTo(x + 13 * useDPR, yb - 3 * useDPR);
                ctx.stroke();
                ctx.restore();
                x += 17 * useDPR;
                ctx.fillStyle = dim;
                ctx.fillText(label, x, yb);
                x += ctx.measureText(label).width + 14 * useDPR;
            };
            chip(ghost, VIEW.ghostLabel, 0.9);
            chip(accent, VIEW.mainLabel);
        }

        function drawFooter(ctx, g) {
            const yb = g.H - 10 * useDPR;
            ctx.font = mono(8.5, "600");

            // Severity, and -- the honest half -- whether the level on
            // screen is this scenario's or a demonstration. A card that
            // showed a demonstration level while naming a scenario would
            // be the exact fault this journey exists to warn about.
            ctx.textAlign = "left";
            ctx.fillStyle = dim;
            const sev = fo.severityLabel ? `SEVERITY ${fo.severityLabel.toUpperCase()}` : "";
            ctx.fillText(sev, g.M.l, yb);

            ctx.textAlign = "right";
            ctx.fillStyle = warn;
            ctx.globalAlpha = 0.9;
            ctx.fillText("DRAWN · NOT A RECORDING", g.W - g.M.r, yb);
            ctx.globalAlpha = 1;
            ctx.textAlign = "left";
        }

        function drawBeats(ctx, g, y0, h, upTo) {
            const R = fo.truthR;
            if (!R || !R.length) return;
            const n = WIN[1] - WIN[0];
            ctx.save();
            ctx.strokeStyle = text;
            ctx.globalAlpha = 0.22;
            ctx.lineWidth = 1 * useDPR;
            ctx.setLineDash([2 * useDPR, 4 * useDPR]);
            for (const idx of R) {
                const k = idx - WIN[0];
                if (k < 0 || k >= n || k / n > upTo) continue;
                const x = g.M.l + (k / (n - 1)) * g.pw;
                ctx.beginPath();
                ctx.moveTo(x, y0);
                ctx.lineTo(x, y0 + h);
                ctx.stroke();
            }
            ctx.restore();
        }

        function drawDropout(ctx, g, y0, h, upTo) {
            const mask = fo.focus?.mask || null;
            if (!mask) return;
            const n = WIN[1] - WIN[0];
            ctx.save();
            ctx.fillStyle = warn;
            ctx.globalAlpha = 0.10;
            let runStart = -1;
            for (let i = 0; i <= n; i++) {
                const on = i < n && mask[WIN[0] + i] > 0.001 && (i / n) <= upTo;
                if (on && runStart < 0) runStart = i;
                if (!on && runStart >= 0) {
                    const x0 = g.M.l + (runStart / (n - 1)) * g.pw;
                    const x1 = g.M.l + ((i - 1) / (n - 1)) * g.pw;
                    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), h);
                    runStart = -1;
                }
            }
            ctx.restore();
        }

        function drawStrip(ctx, g, upTo) {
            if (!hasStrip) return;
            const y0 = g.M.t + g.mainH + g.gap;
            const h  = g.stripH;

            ctx.save();
            ctx.strokeStyle = ghost;
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 1 * useDPR;
            ctx.beginPath();
            ctx.moveTo(g.M.l, y0 - g.gap * 0.5);
            ctx.lineTo(g.W - g.M.r, y0 - g.gap * 0.5);
            ctx.stroke();
            ctx.restore();

            // ── How much of it to show ────────────────────────────────
            // Mains and EMG are fast. Drawn across the same four seconds
            // as the trace above, 50 Hz is two hundred cycles in seven
            // hundred pixels and the strip rendered as a SOLID AMBER
            // BLOCK -- a rectangle, on the card whose job is to show what
            // 50 Hz looks like. Slow artefacts need the span to be read
            // at all; fast ones need a fraction of a second. So the
            // window is a property of the artefact, and the label says
            // which one the viewer is looking at.
            const FAST = focus.id === "mains" || focus.id === "emg";
            const sFs = fs || fo.fs || 360;
            const sWin = FAST
                ? [WIN[0], WIN[0] + Math.round(0.25 * sFs)]
                : WIN;
            const sSpanS = (sWin[1] - sWin[0]) / sFs;

            ctx.fillStyle = dim;
            ctx.font = mono(8, "600");
            const head = "THIS ONE, ALONE — " + String(focus.band || "").toUpperCase()
                       + (FAST ? `  ·  ${sSpanS.toFixed(2)}s ZOOM` : "");
            ctx.fillText(fitLabel(ctx, head, g.pw), g.M.l, y0 - 3 * useDPR);

            if (focus.isMask && focus.mask) {
                // A disconnect has no waveform of its own to show. What it
                // has is a WINDOW, so that is what gets drawn: where the
                // signal is, and where it simply is not.
                const n = sWin[1] - sWin[0];
                ctx.save();
                ctx.strokeStyle = ghost;
                ctx.globalAlpha = 0.5;
                ctx.lineWidth = 1.5 * useDPR;
                ctx.beginPath();
                ctx.moveTo(g.M.l, y0 + h * 0.5);
                ctx.lineTo(g.M.l + g.pw * upTo, y0 + h * 0.5);
                ctx.stroke();
                ctx.restore();

                ctx.save();
                ctx.fillStyle = warn;
                ctx.globalAlpha = 0.55;
                let x0 = -1, x1 = -1;
                for (let i = 0; i < n; i++) {
                    if (focus.mask[sWin[0] + i] <= 0.001 || (i / n) > upTo) continue;
                    const x = g.M.l + (i / (n - 1)) * g.pw;
                    if (x0 < 0) x0 = x;
                    x1 = x;
                    ctx.fillRect(x, y0 + h * 0.3, Math.max(1.5, g.pw / n), h * 0.4);
                }
                ctx.restore();

                // The label goes ON the gap it is naming. Put at the left
                // margin it sat a third of a card away from the only
                // thing it referred to.
                if (x0 >= 0) {
                    ctx.fillStyle = warn;
                    ctx.font = mono(8, "600");
                    const lab = "NO SIGNAL";
                    const lw = ctx.measureText(lab).width;
                    const cx = Math.min(g.W - g.M.r - lw,
                                        Math.max(g.M.l, (x0 + x1) / 2 - lw / 2));
                    ctx.fillText(lab, cx, y0 + h * 0.3 - 3 * useDPR);
                }
            } else {
                const seg = focus.y.subarray
                    ? focus.y.subarray(sWin[0], sWin[1])
                    : focus.y.slice(sWin[0], sWin[1]);
                const sc = sharedScale(seg, null);
                plot(ctx, focus.y, g.M.l, y0, g.pw, h, sc, upTo,
                     warn, 0.9, 0.95, sWin);
            }
        }

        function drawCost(ctx, g) {
            if (view !== "recovered" || !fo.cost) return;
            const pct = Math.round(fo.cost.keptFrac * 100);
            const beats = (fo.truthR && fo.truthR.length) || 0;
            const s = `WANDER AND ${fo.mainsHz ?? 50} HZ GONE · ` +
                      `${pct}% OF THE QRS LEFT · ${beats} BEATS`;
            ctx.save();
            ctx.font = mono(8.5, "600");
            ctx.fillStyle = accent;
            ctx.globalAlpha = 0.92;
            ctx.fillText(fitLabel(ctx, s, g.pw), g.M.l, g.M.t - 8 * useDPR);
            ctx.restore();
        }

        function draw(progress) {
            lastProgress = progress;
            const ctx = canvas.getContext("2d");
            const g = frame();
            ctx.clearRect(0, 0, g.W, g.H);

            drawHeader(ctx, g);
            drawCost(ctx, g);

            drawDropout(ctx, g, g.M.t, g.mainH, progress);
            drawBeats(ctx, g, g.M.t, g.mainH, progress);

            // The reference is drawn WHOLE, not swept. It is not a second
            // signal arriving alongside; it is what this one was supposed
            // to be, and it is already known from the first frame.
            plot(ctx, ref, g.M.l, g.M.t, g.pw, g.mainH, scale, 1,
                 ghost, 1.3, 0.95, WIN);
            plot(ctx, main, g.M.l, g.M.t, g.pw, g.mainH, scale, progress,
                 accent, 1.5, 1, WIN);

            drawStrip(ctx, g, progress);
            drawLegend(ctx, g);
            drawFooter(ctx, g);
        }

        // Resizing a canvas clears it, so whatever resizes it owns
        // repainting it. Four renderers in this app were missing this and
        // went blank whenever a rail control fired while paused.
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            sizeTo(width, height);
            draw(lastProgress);
        }).observe(container);

        draw(0);
        startSweepLoop(sampleId, durationMs, (elapsed) => {
            draw(Math.max(0, Math.min(1, elapsed / durationMs)));
        });
    },
});

})();
