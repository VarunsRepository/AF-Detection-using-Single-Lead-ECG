// ---------------------------------------------------------------------------
// static/shorts/renderers/primer_view.js
//
// The renderer for the ECG primer. Five views, one per stage, chosen by
// config.view -- the same convention moore_view uses.
//
//   what_is_signal  a flat line, then one beat
//   count_them      five beats, counted as they arrive
//   anatomy         one textbook beat, labelled, with a beating heart
//   the_landmark    beats stacked IN DEPTH, and the R-to-R interval
//   why_hard        a REAL recording, no markers, and the question
//
// CANVAS, NOT PLOTLY, and not WebGL either.
//   Plotly costs ~1MB of blocking payload and eats touch events on every
//   stage it renders. WebGL was considered for the depth stack and
//   rejected for now: fourteen beats is ~4,000 vertices, which canvas
//   draws in well under a millisecond. WebGL earns its place when
//   PER-VERTEX COLOUR meets MANY THOUSANDS OF POINTS, because that is
//   where canvas needs one stroke call per segment and GL needs one draw
//   call with a colour attribute. A few hundred beats on the ribbon
//   would be that moment. Fourteen is not, and chart_v1_webgl sat with
//   invisible peak markers for weeks precisely because it was a second
//   renderer nobody looked at.
//
// COLOUR IS A LEGEND, NOT DECORATION.
//   P cyan, QRS green, T violet -- and the SAME three colours light the
//   corresponding chambers of the heart diagram. Introduced in stage 3,
//   where the parts get names, and deliberately NOT used in stages 1, 2
//   and 5, where the trace is just "a signal" and colouring it would
//   imply a distinction the viewer has not been given yet.
//
// DEPTH IS BEAT NUMBER, NOT A TILT.
//   A tilted ECG is worse at its job: perspective distorts heights and
//   widths, and this journey's stage 3 is literally about measuring
//   them. So the anatomy view stays flat, and the depth axis in stage 4
//   carries beat index -- amplitudes and intervals within each beat are
//   undistorted, and the R peaks form a ridge that can be read directly.
//
// SIZING -- same rule as every renderer in this folder: offsetWidth is
// frequently 0 when render() runs, so there is a LITERAL pixel fallback,
// and all geometry is computed inside draw() from the canvas's current
// size so a resize cannot leave a stale scale behind.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Plain-English glosses. Facts about the heart, not editorial choices
// about this journey, so they live with the renderer rather than in the
// recipe -- a five-part label set split across two files would end up
// with four parts in one of them.
const PARTS = {
    P:  { label: "P", says: "the atria squeeze",                 seg: 1 },
    Q:  { label: "Q", says: "",                                  seg: 2 },
    R:  { label: "R", says: "the ventricles fire — the big one", seg: 2 },
    Sw: { label: "S", says: "",                                  seg: 2 },
    T:  { label: "T", says: "the ventricles reset",              seg: 3 },
};

// segOf values from the filter: 0 baseline, 1 P, 2 QRS, 3 T.
const SEG_COLOUR = ["#5f6b7a", "#4fd1ff", null, "#b779f0"];
//                   flat       P cyan    QRS   T violet
//  QRS is null because it takes the live theme accent -- it is the one
//  the rest of the app already draws in, and overriding that would make
//  the primer disagree with every other ECG card.

registerRenderingAlgorithm("primer_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        const view = (config && config.view) || "what_is_signal";
        const fo = dspOutput?.finalOutput ?? {};

        const pick = {
            what_is_signal: () => fo.single,
            count_them:     () => fo.train,
            anatomy:        () => fo.beat,
            the_landmark:   () => fo.ribbon,
            why_hard:       () => fo.real,
        }[view];

        const data = pick ? pick() : null;
        const series = data && (data.y || (data.layers && data.layers[0]?.y));
        if (!data || !series || !series.length) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;font-family:monospace;">
                 primer_view: no series for view "${view}".
                 ${view === "why_hard"
                   ? "This stage needs a real recording and the envelope had none."
                   : "The filter should have generated one."}</p>`;
            return;
        }
        if (!Number.isFinite(series[0])) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;font-family:monospace;">
                 primer_view: samples are not numbers — got
                 <code>${Object.prototype.toString.call(series)}</code>.
                 A Float32Array mapped to objects yields NaN; use
                 Array.from() first.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const iw = container.offsetWidth || 390;
        const ih = container.offsetHeight || 420;
        const sizeTo = (w, h) => {
            canvas.width  = Math.round(w * useDPR);
            canvas.height = Math.round(h * useDPR);
            canvas.style.width  = w + "px";
            canvas.style.height = h + "px";
        };
        sizeTo(iw, ih);

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined"
                        && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const dim    = root.getPropertyValue("--text-dim").trim() || "#9aa4b0";
        const text   = root.getPropertyValue("--text").trim() || "#d8dee9";
        const warn   = root.getPropertyValue("--warn").trim() || "#c98a1f";
        const colourOf = (seg) => SEG_COLOUR[seg] || accent;

        const mono = (s, w) => `${w ? w + " " : ""}${s * useDPR}px `
                             + `"IBM Plex Mono", ui-monospace, monospace`;
        const sans = (s, w) => `${w ? w + " " : ""}${s * useDPR}px `
                             + `"IBM Plex Sans", sans-serif`;

        const y = data.y ? Array.from(data.y) : null;
        let lastProgress = 0;

        // ── Geometry ─────────────────────────────────────────────────────

        function frame() {
            const W = canvas.width, H = canvas.height;
            const M = { l: 16 * useDPR, r: 16 * useDPR,
                        t: 54 * useDPR, b: 56 * useDPR };
            return { W, H, M, pw: W - M.l - M.r, ph: H - M.t - M.b };
        }

        function yScale(g, s, padFrac) {
            let lo = Math.min(0, ...s), hi = Math.max(0, ...s);
            const pad = (hi - lo) * (padFrac ?? 0.18) || 0.5;
            lo -= pad; hi += pad;
            return (v) => g.M.t + g.ph - ((v - lo) / (hi - lo)) * g.ph;
        }

        const phase = (p, from, to) => {
            if (p <= from) return 0;
            if (p >= to) return 1;
            const u = (p - from) / (to - from);
            return u * u * (3 - 2 * u);
        };

        // ── Chrome ───────────────────────────────────────────────────────

        function grid(ctx, g, rows) {
            ctx.strokeStyle = "rgba(95,107,122,0.16)";
            ctx.lineWidth = 1;
            for (let r = 1; r < (rows || 4); r++) {
                const yy = g.M.t + (r / (rows || 4)) * g.ph;
                ctx.beginPath();
                ctx.moveTo(g.M.l, yy);
                ctx.lineTo(g.M.l + g.pw, yy);
                ctx.stroke();
            }
        }

        function baseline(ctx, g, toY) {
            ctx.strokeStyle = "rgba(154,164,176,0.32)";
            ctx.lineWidth = 1 * useDPR;
            ctx.setLineDash([4 * useDPR, 4 * useDPR]);
            ctx.beginPath();
            ctx.moveTo(g.M.l, toY(0));
            ctx.lineTo(g.M.l + g.pw, toY(0));
            ctx.stroke();
            ctx.setLineDash([]);
        }

        function heading(ctx, g, line, sub) {
            ctx.fillStyle = text;
            ctx.font = sans(15, 600);
            ctx.textAlign = "left";
            ctx.fillText(line, g.M.l, 26 * useDPR);
            if (sub) {
                ctx.fillStyle = dim;
                ctx.font = mono(10.5);
                ctx.fillText(sub, g.M.l, 42 * useDPR);
            }
        }

        function callout(ctx, x, yy, label, colour, up, alpha) {
            ctx.save();
            ctx.globalAlpha = alpha ?? 1;
            const len = 22 * useDPR;
            const ty = up ? yy - len : yy + len;
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1.4 * useDPR;
            ctx.beginPath();
            ctx.moveTo(x, up ? yy - 6 * useDPR : yy + 6 * useDPR);
            ctx.lineTo(x, ty);
            ctx.stroke();
            ctx.fillStyle = colour;
            ctx.font = mono(11, "600");
            ctx.textAlign = "center";
            ctx.textBaseline = up ? "bottom" : "top";
            ctx.fillText(label, x, up ? ty - 3 * useDPR : ty + 3 * useDPR);
            ctx.textBaseline = "alphabetic";
            ctx.restore();
        }

        function span(ctx, x1, x2, yy, label, colour, alpha) {
            ctx.save();
            ctx.globalAlpha = alpha ?? 1;
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1.3 * useDPR;
            const t = 5 * useDPR;
            ctx.beginPath();
            ctx.moveTo(x1, yy - t); ctx.lineTo(x1, yy + t);
            ctx.moveTo(x1, yy);     ctx.lineTo(x2, yy);
            ctx.moveTo(x2, yy - t); ctx.lineTo(x2, yy + t);
            ctx.stroke();
            ctx.font = mono(10);
            ctx.textAlign = "center";
            const w = ctx.measureText(label).width;
            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillRect((x1 + x2) / 2 - w / 2 - 3 * useDPR, yy - 7 * useDPR,
                         w + 6 * useDPR, 14 * useDPR);
            ctx.restore();
            ctx.fillStyle = colour;
            ctx.fillText(label, (x1 + x2) / 2, yy + 3.5 * useDPR);
            ctx.restore();
        }

        // Plain single-colour trace, for the stages where the signal is
        // just "a signal".
        function trace(ctx, s, toX, toY, upto, colour, width) {
            const end = Math.max(1, Math.min(s.length, Math.floor(upto)));
            ctx.strokeStyle = colour;
            ctx.lineWidth = (width ?? 2.0) * useDPR;
            ctx.lineJoin = "round"; ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(toX(0), toY(s[0]));
            for (let i = 1; i < end; i++) ctx.lineTo(toX(i), toY(s[i]));
            ctx.stroke();
            return { x: toX(end - 1), y: toY(s[end - 1]) };
        }

        // Coloured by segment. Drawn as RUNS rather than per-sample so
        // there is one stroke per wave, not one per point -- the thing
        // that would make a canvas ribbon expensive if it were done
        // naively, and the reason the WebGL question is about per-vertex
        // colour specifically.
        function traceByPart(ctx, s, segOf, toX, toY, upto, width, alpha) {
            const end = Math.max(1, Math.min(s.length, Math.floor(upto)));
            ctx.save();
            ctx.globalAlpha = alpha ?? 1;
            ctx.lineWidth = (width ?? 2.2) * useDPR;
            ctx.lineJoin = "round"; ctx.lineCap = "round";
            let i = 0;
            while (i < end - 1) {
                const seg = segOf ? segOf[i] : 0;
                let j = i + 1;
                while (j < end && (segOf ? segOf[j] : 0) === seg) j++;
                ctx.strokeStyle = colourOf(seg);
                ctx.beginPath();
                ctx.moveTo(toX(i), toY(s[i]));
                // One sample of overlap, or the colour changes leave a
                // visible gap at every boundary.
                for (let k = i + 1; k <= Math.min(j, end - 1); k++) {
                    ctx.lineTo(toX(k), toY(s[k]));
                }
                ctx.stroke();
                i = j;
            }
            ctx.restore();
        }

        // ── The heart ────────────────────────────────────────────────────
        //
        // A stylised two-part heart: atria across the top, ventricles
        // below. NOT the valentine shape -- that has no chambers and
        // nothing to light up. Two regions rather than four, because at
        // 76px four chambers is a smudge and the lesson only needs
        // "upstairs squeezes, then downstairs fires".
        //
        // Lit with the SAME colours as the trace, which is what turns the
        // colour scheme into a legend: cyan means atria, wherever it
        // appears.
        function heart(ctx, cx, cy, r, lit) {
            const a = lit.atria ?? 0, v = lit.vent ?? 0, rel = lit.relax ?? 0;
            // Ventricles contract on QRS -- a real squeeze, so the shape
            // gets smaller rather than just brighter.
            const vScale = 1 - 0.12 * v;

            ctx.save();
            ctx.translate(cx, cy);

            // Ventricles: a rounded cone, point down.
            ctx.save();
            ctx.scale(vScale, vScale);
            ctx.beginPath();
            ctx.moveTo(-r * 0.86, -r * 0.12);
            ctx.bezierCurveTo(-r * 0.92, r * 0.62, -r * 0.34, r * 1.04,
                              0, r * 1.12);
            ctx.bezierCurveTo(r * 0.34, r * 1.04, r * 0.92, r * 0.62,
                              r * 0.86, -r * 0.12);
            ctx.closePath();
            ctx.fillStyle = `rgba(92,194,74,${0.14 + 0.52 * v})`;
            ctx.fill();
            ctx.strokeStyle = v > 0.04 ? accent : "rgba(154,164,176,0.45)";
            ctx.lineWidth = 1.6 * useDPR;
            ctx.stroke();
            // The reset wave washes back over the ventricles.
            if (rel > 0.02) {
                ctx.fillStyle = `rgba(183,121,240,${0.42 * rel})`;
                ctx.fill();
            }
            ctx.restore();

            // Atria: two lobes sitting on top.
            for (const sx of [-1, 1]) {
                ctx.beginPath();
                ctx.ellipse(sx * r * 0.44, -r * 0.46, r * 0.42, r * 0.34,
                            0, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(79,209,255,${0.12 + 0.55 * a})`;
                ctx.fill();
                ctx.strokeStyle = a > 0.04 ? "#4fd1ff"
                                           : "rgba(154,164,176,0.45)";
                ctx.lineWidth = 1.5 * useDPR;
                ctx.stroke();
            }
            ctx.restore();
        }

        // Pulse strength from the nearest R, for the stages where the
        // heart is just keeping time rather than being dissected.
        function pulseAt(sampleNow, rList, decaySamples) {
            let best = 0;
            for (const r of rList || []) {
                if (r > sampleNow) continue;
                const d = (sampleNow - r) / decaySamples;
                best = Math.max(best, Math.exp(-d * d * 4));
            }
            return best;
        }

        // ── View 1 ───────────────────────────────────────────────────────
        function drawWhatIsSignal(ctx, p) {
            const g = frame();
            const toY = yScale(g, y);
            const toX = (i) => g.M.l + (i / (y.length - 1)) * g.pw;

            heading(ctx, g, "A line that means something",
                    "left to right is TIME · up and down is VOLTAGE");
            grid(ctx, g);
            baseline(ctx, g, toY);

            const seen = p * y.length;
            const lead = trace(ctx, y, toX, toY, seen, accent, 2.2);

            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(lead.x, lead.y, 3.6 * useDPR, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = dim;
            ctx.font = mono(10);
            ctx.textAlign = "right";
            ctx.fillText("time →", g.M.l + g.pw, g.M.t + g.ph + 20 * useDPR);
            ctx.save();
            ctx.translate(g.M.l - 2 * useDPR, g.M.t + g.ph / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = "center";
            ctx.fillText("voltage", 0, 0);
            ctx.restore();

            heart(ctx, g.M.l + g.pw - 40 * useDPR, 86 * useDPR, 20 * useDPR,
                  { atria: pulseAt(seen, data.rIdx, 0.16 * fs) * 0.7,
                    vent:  pulseAt(seen, data.rIdx, 0.12 * fs) });

            const r = (data.rIdx || [])[0];
            if (r != null) {
                const a = phase(seen / y.length, r / y.length,
                                Math.min(1, r / y.length + 0.16));
                if (a > 0.01) {
                    callout(ctx, toX(r), toY(y[r]),
                            "a heartbeat", accent, true, a);
                }
            }
        }

        // ── View 2 ───────────────────────────────────────────────────────
        function drawCountThem(ctx, p) {
            const g = frame();
            const toY = yScale(g, y);
            const toX = (i) => g.M.l + (i / (y.length - 1)) * g.pw;
            const peaks = data.peakIndices ?? [];
            const seen = p * y.length;

            heading(ctx, g, "Count them.",
                    "no algorithm, no maths — just your eyes");
            grid(ctx, g);
            baseline(ctx, g, toY);
            trace(ctx, y, toX, toY, seen, accent, 2.2);

            const got = peaks.filter(i => i <= seen);
            got.forEach((i, k) => {
                ctx.fillStyle = accent;
                ctx.beginPath();
                ctx.arc(toX(i), toY(y[i]), 4 * useDPR, 0, Math.PI * 2);
                ctx.fill();
                callout(ctx, toX(i), toY(y[i]), String(k + 1), accent, true);
            });

            heart(ctx, g.M.l + g.pw - 40 * useDPR, 86 * useDPR, 20 * useDPR,
                  { atria: pulseAt(seen, peaks, 0.16 * fs) * 0.7,
                    vent:  pulseAt(seen, peaks, 0.12 * fs) });

            ctx.textAlign = "left";
            ctx.fillStyle = got.length === peaks.length ? accent : dim;
            ctx.font = mono(30, "700");
            ctx.fillText(String(got.length), g.M.l, g.M.t + g.ph + 36 * useDPR);
            ctx.fillStyle = dim;
            ctx.font = mono(10.5);
            ctx.fillText(got.length === 1 ? "beat so far" : "beats so far",
                         g.M.l + 26 * useDPR, g.M.t + g.ph + 36 * useDPR);

            const done = phase(p, 0.88, 1.0);
            if (done > 0.01 && data.bpm) {
                ctx.save();
                ctx.globalAlpha = done;
                ctx.textAlign = "right";
                ctx.fillStyle = text;
                ctx.font = mono(13, "600");
                ctx.fillText(`${Math.round(data.intervalMs)} ms apart `
                           + `· ${data.bpm} bpm`,
                           g.M.l + g.pw, g.M.t + g.ph + 36 * useDPR);
                ctx.textAlign = "center";
                ctx.fillStyle = dim;
                ctx.font = mono(10);
                ctx.fillText("you just did peak detection",
                             g.M.l + g.pw / 2, g.M.t + g.ph + 54 * useDPR);
                ctx.restore();
            }
        }

        // ── View 3 ───────────────────────────────────────────────────────
        // FLAT, on purpose. This is the measuring stage -- perspective
        // would distort exactly the heights and widths it is about.
        function drawAnatomy(ctx, p) {
            const g = frame();
            const toY = yScale(g, y, 0.26);
            const toX = (i) => g.M.l + (i / (y.length - 1)) * g.pw;
            const marks = data.marks || {};

            heading(ctx, g, "The same shape, up close",
                    "three things the heart does, in three colours");
            grid(ctx, g);
            baseline(ctx, g, toY);

            // Whole trace up front: the stage is about NAMING parts of a
            // shape, so the shape has to be complete before naming starts.
            // Grey first, then each part takes its colour as it is named,
            // so the colour IS the label arriving.
            trace(ctx, y, toX, toY, y.length, "rgba(95,107,122,0.55)", 2.2);

            const order = ["P", "Q", "R", "Sw", "T"];
            const revealed = new Uint8Array(y.length);
            order.forEach((key, k) => {
                const from = 0.10 + k * 0.10;
                if (p < from) return;
                const want = PARTS[key].seg;
                for (let i = 0; i < y.length; i++)
                    if (data.segOf && data.segOf[i] === want) revealed[i] = want;
            });
            traceByPart(ctx, y, revealed, toX, toY, y.length, 2.4);

            order.forEach((key, k) => {
                const i = marks[key];
                if (i == null) return;
                const from = 0.10 + k * 0.10;
                const a = phase(p, from, from + 0.09);
                if (a < 0.01) return;
                callout(ctx, toX(i), toY(y[i]), PARTS[key].label,
                        colourOf(PARTS[key].seg), y[i] >= 0, a);
            });

            // The heart, driven by WHICH PART has been reached -- the
            // single most useful thing in the primer. Atria light on P,
            // ventricles fire on QRS, the reset wave washes back on T.
            heart(ctx, g.M.l + g.pw - 42 * useDPR, 92 * useDPR, 22 * useDPR, {
                atria: phase(p, 0.10, 0.19) * (1 - phase(p, 0.30, 0.46)),
                vent:  phase(p, 0.30, 0.38) * (1 - phase(p, 0.50, 0.68)),
                relax: phase(p, 0.50, 0.60) * (1 - phase(p, 0.80, 0.96)),
            });

            ["P", "R", "T"].forEach((key, k) => {
                if (!PARTS[key].says) return;
                const from = 0.60 + k * 0.08;
                const a = phase(p, from, from + 0.07);
                if (a < 0.01) return;
                ctx.save();
                ctx.globalAlpha = a;
                ctx.fillStyle = colourOf(PARTS[key].seg);
                ctx.font = sans(11.5, key === "R" ? "600" : "");
                ctx.textAlign = "left";
                ctx.fillText(`${PARTS[key].label} — ${PARTS[key].says}`,
                             g.M.l, g.M.t + g.ph + (16 + k * 15) * useDPR);
                ctx.restore();
            });

            const sp = data.spans, iv = data.intervalsMs;
            if (sp && iv) {
                const a = phase(p, 0.86, 1.0);
                if (a > 0.01) {
                    span(ctx, toX(sp.pr[0]), toX(sp.pr[1]),
                         g.M.t + 14 * useDPR,
                         `PR ${Math.round(iv.pr)}ms`, warn, a);
                    span(ctx, toX(sp.qt[0]), toX(sp.qt[1]),
                         g.M.t + g.ph - 6 * useDPR,
                         `QT ${Math.round(iv.qt)}ms`, warn, a);
                }
            }
        }

        // ── View 4: the depth stack ──────────────────────────────────────
        //
        // Each beat is drawn one step further back. Depth is BEAT NUMBER,
        // so nothing about a single beat is distorted -- the axis is
        // labelled to say so. Painter's algorithm, back to front, so the
        // nearest beat occludes the ones behind it.
        function drawLandmark(ctx, p) {
            const g = frame();
            const layers = data.layers || [];
            const tmpl = layers[0]?.y || [];
            const n = layers.length;

            heading(ctx, g, "R is the landmark",
                    "every beat, stacked back in time");

            // The projection. Receding up and to the right, with a mild
            // scale falloff -- enough to read as depth, not enough to
            // make the far beats unreadable.
            const DX = g.pw * 0.26, DY = -g.ph * 0.30;
            const plotW = g.pw - DX, plotH = g.ph * 0.46;
            const baseY = g.M.t + g.ph - 6 * useDPR;
            let lo = Math.min(0, ...tmpl), hi = Math.max(0, ...tmpl);
            const rng = (hi - lo) || 1;

            const proj = (i, v, d) => {
                const k = 1 - 0.18 * d;                    // perspective
                return {
                    x: g.M.l + d * DX + (i / (tmpl.length - 1)) * plotW * k,
                    y: baseY + d * DY - ((v - lo) / rng) * plotH * k,
                };
            };

            // Depth axis, drawn first so the ribbon sits on it.
            ctx.strokeStyle = "rgba(95,107,122,0.35)";
            ctx.lineWidth = 1 * useDPR;
            ctx.beginPath();
            const a0 = proj(0, 0, 0), a1 = proj(0, 0, 1);
            ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y);
            ctx.stroke();
            ctx.fillStyle = dim;
            ctx.font = mono(9);
            ctx.textAlign = "right";
            ctx.fillText("beat 1", a0.x - 4 * useDPR, a0.y + 3 * useDPR);
            ctx.fillText(`beat ${n}`, a1.x - 4 * useDPR, a1.y + 3 * useDPR);

            // How many beats have arrived.
            const shown = Math.max(1, Math.round(phase(p, 0.05, 0.70) * n));
            const ridge = [];

            for (let b = shown - 1; b >= 0; b--) {
                const d = n === 1 ? 0 : b / (n - 1);
                const near = 1 - d;
                ctx.save();
                ctx.globalAlpha = 0.30 + 0.70 * near * near;
                ctx.lineWidth = (0.9 + 1.5 * near) * useDPR;
                ctx.lineJoin = "round"; ctx.lineCap = "round";
                let i = 0;
                while (i < tmpl.length - 1) {
                    const seg = data.segOf ? data.segOf[i] : 0;
                    let j = i + 1;
                    while (j < tmpl.length
                           && (data.segOf ? data.segOf[j] : 0) === seg) j++;
                    ctx.strokeStyle = colourOf(seg);
                    ctx.beginPath();
                    const s0 = proj(i, tmpl[i], d);
                    ctx.moveTo(s0.x, s0.y);
                    for (let k = i + 1; k <= Math.min(j, tmpl.length - 1); k++) {
                        const s = proj(k, tmpl[k], d);
                        ctx.lineTo(s.x, s.y);
                    }
                    ctx.stroke();
                    i = j;
                }
                ctx.restore();
                ridge.push({ b, d, pt: proj(data.rAt, tmpl[data.rAt], d) });
            }

            // THE RIDGE. This is why the stack is worth drawing: the R
            // peaks of successive beats line up into a visible edge, and
            // the wobble in that edge IS beat-to-beat variability.
            const rg = phase(p, 0.56, 0.78);
            if (rg > 0.01 && ridge.length > 1) {
                ctx.save();
                ctx.globalAlpha = rg;
                ctx.strokeStyle = warn;
                ctx.lineWidth = 1.6 * useDPR;
                ctx.setLineDash([5 * useDPR, 4 * useDPR]);
                ctx.beginPath();
                ridge.forEach((r, k) => k ? ctx.lineTo(r.pt.x, r.pt.y)
                                          : ctx.moveTo(r.pt.x, r.pt.y));
                ctx.stroke();
                ctx.setLineDash([]);
                for (const r of ridge) {
                    ctx.fillStyle = r.d === 0 ? accent : warn;
                    ctx.beginPath();
                    ctx.arc(r.pt.x, r.pt.y, (r.d === 0 ? 4 : 2.4) * useDPR,
                            0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            heart(ctx, g.M.l + 26 * useDPR, 96 * useDPR, 18 * useDPR,
                  { atria: 0.25, vent: 0.55 * (0.5 + 0.5 * Math.sin(p * 26)) });

            const arith = phase(p, 0.80, 0.94);
            if (arith > 0.01 && data.bpm) {
                const rr = Math.round(60000 / data.bpm);
                ctx.save();
                ctx.globalAlpha = arith;
                ctx.textAlign = "center";
                ctx.fillStyle = text;
                ctx.font = mono(13, "600");
                ctx.fillText(`R to R = ${rr} ms → `
                           + `60000 ÷ ${rr} = ${data.bpm} bpm`,
                           g.M.l + g.pw / 2, g.M.t + g.ph + 26 * useDPR);
                ctx.fillStyle = dim;
                ctx.font = sans(10.5);
                ctx.fillText("P is too small to trust · T is too broad "
                           + "to pin down",
                             g.M.l + g.pw / 2, g.M.t + g.ph + 46 * useDPR);
                ctx.restore();
            }
        }

        // ── View 5 ───────────────────────────────────────────────────────
        function drawWhyHard(ctx, p) {
            const g = frame();
            const toY = yScale(g, y);
            const toX = (i) => g.M.l + (i / (y.length - 1)) * g.pw;

            heading(ctx, g, "Now a real recording",
                    data.recordId ? `PhysioNet · ${data.recordId}`
                                  : "PhysioNet · a real patient");
            grid(ctx, g);
            baseline(ctx, g, toY);
            trace(ctx, y, toX, toY, p * y.length, accent, 1.6);

            // NO MARKERS, and the filter does not even send peak indices
            // for this view. The stage asks a question; drawing the
            // answer on it would answer the question for the viewer.
            const a = phase(p, 0.82, 1.0);
            if (a > 0.01) {
                ctx.save();
                ctx.globalAlpha = a;
                ctx.textAlign = "center";
                ctx.fillStyle = warn;
                ctx.font = sans(16, 700);
                ctx.fillText("Where are the beats?",
                             g.M.l + g.pw / 2, g.M.t + g.ph + 26 * useDPR);
                ctx.fillStyle = dim;
                ctx.font = mono(9.5);
                ctx.fillText("the line drifts · the heights vary",
                             g.M.l + g.pw / 2, g.M.t + g.ph + 42 * useDPR);
                ctx.fillText("some T waves are nearly as tall as R",
                             g.M.l + g.pw / 2, g.M.t + g.ph + 55 * useDPR);
                ctx.restore();
            }
        }

        const DRAW = {
            what_is_signal: drawWhatIsSignal,
            count_them:     drawCountThem,
            anatomy:        drawAnatomy,
            the_landmark:   drawLandmark,
            why_hard:       drawWhyHard,
        };

        function draw(progress) {
            lastProgress = progress;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            (DRAW[view] || drawWhatIsSignal)(ctx, progress);

            // The provenance marker -- section 34's missing negative of
            // the ECG reference-class card. Four of these five stages are
            // DRAWN, and a viewer cannot tell a synthetic beat from a
            // real one by looking. Saying so is the difference between a
            // teaching diagram and a false claim.
            const synthetic = view !== "why_hard";
            ctx.save();
            ctx.textAlign = "right";
            ctx.font = mono(8.5, "600");
            ctx.fillStyle = synthetic ? warn : dim;
            ctx.globalAlpha = 0.85;
            ctx.fillText(synthetic ? "DRAWN · NOT A RECORDING"
                                   : "REAL RECORDING",
                         canvas.width - 14 * useDPR, 18 * useDPR);
            ctx.restore();
        }

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