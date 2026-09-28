// ---------------------------------------------------------------------------
// renderers/ets_cascade_view.js
//
// The electron transport chain as a staircase: electrons fall left to
// right, and each drop pushes protons up across the membrane.
//
// WHY A STAIRCASE AND NOT A DIAGRAM
//   Textbook diagrams draw the complexes as equal-sized boxes, which
//   hides the thing that actually matters -- the drops are wildly
//   unequal. Complex IV releases 108 kJ/mol and Complex III only 40.
//   Plotting the y-axis as REDOX POTENTIAL makes each step's height
//   proportional to the energy it releases, so the picture carries the
//   number.
//
// WHY THE AXIS IS INVERTED
//   More positive potential means LOWER energy for the electron, so the
//   axis runs downward: NADH at the top, oxygen at the bottom. Electrons
//   fall. Drawing it the other way would be numerically tidy and exactly
//   backwards as a physical picture.
//
// PROTONS
//   Dots rising into the band above the membrane, added only where a
//   complex actually pumps. Complex II pumps none, and the gap where its
//   dots are missing IS the explanation for why FADH2 yields less ATP.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("ets_cascade_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const fo    = dspOutput.finalOutput ?? {};
        const steps = fo.steps ?? [];
        if (steps.length === 0) {
            container.innerHTML = `<p style="color:#ff4d4d;padding:20px;">No chain to draw.</p>`;
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

        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
        }).observe(container);

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const PROTON = "#3b82f6";
        const DEAD   = "#4a5260";

        const [pLo, pHi] = fo.potentialRange ?? [-0.35, 0.85];
        const totalProtons = steps.reduce((s, x) => s + x.protons, 0) || 1;

        function draw(t) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            // bottom holds the complex label, its kJ/mol, AND the ATP
            // summary -- 52 was enough for two of the three and the
            // summary overlapped them.
            const M = { top: 54 * useDPR, right: 14 * useDPR,
                        bottom: 70 * useDPR, left: 38 * useDPR };
            const bandH = 58 * useDPR;                 // intermembrane space
            const plotY = M.top + bandH;
            const plotH = H - plotY - M.bottom;
            const plotW = W - M.left - M.right;
            const colW  = plotW / steps.length;

            // Axis is inverted: low potential (high energy) at the top.
            const toY = p => plotY + ((p - pLo) / (pHi - pLo)) * plotH;

            // ── membrane ───────────────────────────────────────────────
            ctx.fillStyle = "rgba(59,130,246,0.05)";
            ctx.fillRect(0, M.top, W, bandH);
            ctx.strokeStyle = "rgba(255,255,255,0.18)";
            ctx.lineWidth = 2 * useDPR;
            ctx.beginPath();
            ctx.moveTo(0, M.top + bandH); ctx.lineTo(W, M.top + bandH);
            ctx.stroke();
            ctx.fillStyle = "#5c6470";
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "left";
            ctx.fillText("intermembrane space", 6 * useDPR, M.top + 12 * useDPR);
            ctx.fillText("matrix", 6 * useDPR, M.top + bandH + 13 * useDPR);

            // ── the cascade ────────────────────────────────────────────
            // Scaled so the LAST complex completes by t = 0.9, leaving the
            // final tenth to hold the finished picture. Plain
            // t * steps.length only reaches steps.length at t === 1, so
            // the last step never satisfied "done" -- its protons went
            // uncounted, its drop never finished, and a blocked final
            // complex never drew its cross. The readout silently said
            // 8 H+ instead of 10.
            const reveal = Math.min(steps.length, (t / 0.9) * steps.length);

            steps.forEach((s, i) => {
                const x0 = M.left + i * colW;
                const xMid = x0 + colW * 0.62;
                const x1 = x0 + colW;
                const yF = toY(s.fromPotential), yT = toY(s.toPotential);
                const done = reveal >= i + 1;
                const here = reveal > i && !done;
                const seen = reveal > i;

                const live = s.flowing;
                const col  = !live ? DEAD : (here ? "#e8f4f8" : accent);

                if (!seen) return;

                // plateau, then the drop
                ctx.strokeStyle = col;
                ctx.lineWidth = 2.4 * useDPR;
                ctx.beginPath();
                ctx.moveTo(x0, yF); ctx.lineTo(xMid, yF);
                ctx.stroke();

                const dropTo = here ? yF + (yT - yF) * Math.min(1, (reveal - i) * 1.6)
                                    : yT;
                ctx.beginPath();
                ctx.moveTo(xMid, yF); ctx.lineTo(xMid, dropTo);
                ctx.stroke();
                if (done) {
                    ctx.beginPath();
                    ctx.moveTo(xMid, yT); ctx.lineTo(x1, yT);
                    ctx.stroke();
                }

                // complex name and its energy drop
                ctx.textAlign = "center";
                ctx.fillStyle = s.blocked ? "#e74c3c" : live ? accent : DEAD;
                ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(s.name.replace("Complex ", "C"),
                             x0 + colW / 2, plotY + plotH + 16 * useDPR);
                ctx.fillStyle = live ? "#9aa4b0" : DEAD;
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${s.deltaG.toFixed(0)} kJ/mol`,
                             x0 + colW / 2, plotY + plotH + 29 * useDPR);

                // A blocked complex gets a cross; the rest say why they
                // stopped -- "backed up" and "starved" are different
                // failures and the distinction is the lesson.
                if (!live && done) {
                    const cy = (yF + yT) / 2;
                    if (s.blocked) {
                        ctx.strokeStyle = "#e74c3c";
                        ctx.lineWidth = 3 * useDPR;
                        const r = 9 * useDPR;
                        ctx.beginPath();
                        ctx.moveTo(xMid - r, cy - r); ctx.lineTo(xMid + r, cy + r);
                        ctx.moveTo(xMid + r, cy - r); ctx.lineTo(xMid - r, cy + r);
                        ctx.stroke();
                    }
                    ctx.fillStyle = s.blocked ? "#e74c3c" : DEAD;
                    ctx.font = `${8 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(s.state, xMid, cy + 20 * useDPR);
                }

                // protons pumped up into the band above
                if (done && s.protonsPumped > 0) {
                    for (let p = 0; p < s.protonsPumped; p++) {
                        const px = x0 + colW * (0.22 + 0.18 * p);
                        const py = M.top + bandH * 0.36 + (p % 2) * 13 * useDPR;
                        ctx.fillStyle = PROTON;
                        ctx.beginPath();
                        ctx.arc(px, py, 4 * useDPR, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = "rgba(59,130,246,0.35)";
                        ctx.lineWidth = 1.2 * useDPR;
                        ctx.beginPath();
                        ctx.moveTo(px, M.top + bandH);
                        ctx.lineTo(px, py + 5 * useDPR);
                        ctx.stroke();
                    }
                }
            });

            // ── axis ───────────────────────────────────────────────────
            ctx.fillStyle = "#5c6470";
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "right";
            [pLo, (pLo + pHi) / 2, pHi].forEach(p => {
                ctx.fillText(`${p > 0 ? "+" : ""}${p.toFixed(2)}V`,
                             M.left - 4 * useDPR, toY(p) + 3 * useDPR);
            });

            // ── readout ────────────────────────────────────────────────
            const shown = steps.filter((_, i) => reveal >= i + 1);
            const protons = shown.reduce((s, x) => s + x.protonsPumped, 0);
            const dG = shown.reduce((s, x) => s + (x.flowing ? x.deltaG : 0), 0);

            ctx.textAlign = "center";
            ctx.fillStyle = accent;
            ctx.font = `600 ${14 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${protons} H\u207A pumped`, W / 2, 24 * useDPR);
            ctx.fillStyle = "#78828e";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${dG.toFixed(0)} kJ/mol released`, W / 2, 40 * useDPR);

            if (t > 0.92) {
                const atp = fo.atpYield;
                ctx.fillStyle = atp > 0 ? accent : "#e74c3c";
                ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(
                    atp > 0 ? `${protons} H\u207A \u00f7 ${fo.protonsPerAtp} = ${atp} ATP`
                            : (fo.uncoupled ? "gradient leaks away \u2014 heat, not ATP"
                                            : "no gradient \u2014 no ATP"),
                    W / 2, H - 10 * useDPR);
            }
        }

        draw(0);
        startSweepLoop(sampleId, durationMs, e => draw(Math.min(1, e / durationMs)));
    },
});

})();
