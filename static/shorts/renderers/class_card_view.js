// ---------------------------------------------------------------------------
// renderers/class_card_view.js
//
// The closing card: the record's reference class, with the measurements
// that support it, revealed in that order.
//
// WHY THE MEASUREMENTS COME FIRST
//   Heart rate and R-R irregularity appear before the class name. Read
//   the evidence, make your own call, THEN see the answer -- which is
//   the only ordering that lets the card test a viewer rather than just
//   inform them. Class first would tell you what to think before you
//   had a chance to think it.
//
// WHY THE ATTRIBUTION IS ON SCREEN
//   The class is a cardiologist's annotation from the PhysioNet 2017
//   dataset, not something this app computed. Without that line the card
//   reads as a diagnosis the software made, which it must never do.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("class_card_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const f = dspOutput.finalOutput ?? {};
        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;

        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 400;
        canvas.width  = Math.round(iw * useDPR);
        canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";

        const ro = new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
        });
        ro.observe(container);

        const colour = f.classColour || "#78828e";

        // Wraps long text to the canvas width -- the blurbs differ a lot
        // in length and a fixed line break would clip some of them.
        function wrap(ctx, text, maxW) {
            const words = text.split(" ");
            const lines = [];
            let line = "";
            for (const w of words) {
                const test = line ? line + " " + w : w;
                if (ctx.measureText(test).width > maxW && line) {
                    lines.push(line); line = w;
                } else line = test;
            }
            if (line) lines.push(line);
            return lines;
        }

        function draw(t) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const cx = W / 2;
            ctx.clearRect(0, 0, W, H);
            ctx.textAlign = "center";

            const mono = s => `${s * useDPR}px "IBM Plex Mono", monospace`;

            // ── evidence first (0 - 45% of the stage) ───────────────────
            const stats = [
                f.bpm       != null ? [`${f.bpm.toFixed(0)}`, "bpm"] : null,
                f.rmssd     != null ? [`${f.rmssd.toFixed(0)}`, "ms RMSSD"] : null,
                f.irregular != null ? [`${f.irregular.toFixed(0)}%`, "irregularity"] : null,
            ].filter(Boolean);

            const statY = H * 0.20;
            stats.forEach(([val, lbl], i) => {
                if (t < 0.08 + i * 0.09) return;
                const x = cx + (i - (stats.length - 1) / 2) * (W / (stats.length + 0.6));
                ctx.fillStyle = "#d6dde5";
                ctx.font = `600 ${20 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(val, x, statY);
                ctx.fillStyle = "#6b7480";
                ctx.font = mono(9);
                ctx.fillText(lbl, x, statY + 15 * useDPR);
            });

            if (t > 0.38) {
                ctx.fillStyle = "#4a5260";
                ctx.font = mono(10);
                ctx.fillText("this recording is classified as",
                             cx, H * 0.38);
            }

            // ── the answer (45% onward) ─────────────────────────────────
            if (t > 0.45) {
                // Reveal scales the letter up slightly as it fades in, so
                // it lands rather than simply appearing.
                const p = Math.min(1, (t - 0.45) / 0.18);
                ctx.save();
                ctx.globalAlpha = p;
                ctx.fillStyle = colour;
                ctx.font = `700 ${(54 + 8 * (1 - p)) * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(f.classId ?? "?", cx, H * 0.56);
                ctx.restore();

                ctx.fillStyle = colour;
                ctx.font = `600 ${15 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(f.className, cx, H * 0.645);
            }

            if (t > 0.62) {
                ctx.fillStyle = "#8b939f";
                ctx.font = mono(11);
                const lines = wrap(ctx, f.classBlurb, W - 48 * useDPR);
                lines.forEach((ln, i) =>
                    ctx.fillText(ln, cx, H * 0.72 + i * 15 * useDPR));
            }

            // ── attribution, always last and always present ─────────────
            if (t > 0.8) {
                ctx.fillStyle = "#4a5260";
                ctx.font = mono(9);
                ctx.fillText(`${f.recordId ?? ""}  \u00b7  ${f.source}`,
                             cx, H - 14 * useDPR);
            }
        }

        draw(0);
        startSweepLoop(sampleId, durationMs, e => draw(Math.min(1, e / durationMs)));
    },
});

})();
