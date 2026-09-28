// ---------------------------------------------------------------------------
// renderers/simd_lanes_view.js
//
// Three views of one SIMD instruction, chosen by config.view:
//
//   lanes     A over B over result, with a column per lane
//   compare   four scalar ops filling one at a time, beside one vector op
//   pipeline  INPUT -> SCALAR -> PACK -> REGISTER -> ADD -> RESULT
//
// WHY LANES ARE COLUMNS
//   The whole claim of SIMD is that the lanes are INDEPENDENT and
//   SIMULTANEOUS. Columns make independence visual -- nothing crosses
//   between them -- and revealing all four at the same instant makes
//   simultaneity visual. The scalar view deliberately fills its columns
//   one at a time, so the difference is a difference in TIMING, which is
//   what it actually is.
//
// Canvas 2D, not WebGL. The content is a dozen boxes and some arrows;
// a GPU path would add a build step and a JS bridge to draw rectangles.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("simd_lanes_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const view  = config.view ?? "lanes";
        const steps = (dspOutput.interimOutputs ?? []).filter(c => c.view === view);
        if (steps.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">No "${view}" steps to draw.</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};

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
        // One colour per LANE, held across every row and every view, so a
        // value can be followed from input to result.
        const LANE = ["#eb7b2b", "#1abc9c", "#9b59b6", "#3b82f6"];
        const stepMs = durationMs / steps.length;

        function box(ctx, x, y, w, h, fill, stroke, text, textCol, size) {
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, w, h);
            if (stroke) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 1.4 * useDPR;
                ctx.strokeRect(x, y, w, h);
            }
            if (text !== undefined && text !== null) {
                ctx.fillStyle = textCol;
                ctx.font = `600 ${size * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "center";
                ctx.fillText(String(text), x + w / 2, y + h / 2 + size * 0.36 * useDPR);
            }
        }

        function laneRow(ctx, values, x0, y, laneW, h, opts = {}) {
            values.forEach((v, i) => {
                const x = x0 + i * (laneW + 6 * useDPR);
                const shown = v !== null && v !== undefined;
                box(ctx, x, y, laneW, h,
                    shown ? (opts.fill ?? LANE[i] + "33") : "rgba(255,255,255,0.04)",
                    shown ? (opts.stroke ?? LANE[i]) : "rgba(255,255,255,0.10)",
                    shown ? v : "", "#e8f4f8", opts.size ?? 13);
            });
        }

        function header(ctx, W, label, tech) {
            ctx.textAlign = "center";
            ctx.fillStyle = accent;
            ctx.font = `600 ${15 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(label, W / 2, 26 * useDPR);
            ctx.fillStyle = "#78828e";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(tech ?? "", W / 2, 42 * useDPR);
        }

        function rowLabel(ctx, text, x, y, h) {
            ctx.fillStyle = "#5c6470";
            ctx.font = `${11 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "right";
            ctx.fillText(text, x - 8 * useDPR, y + h / 2 + 4 * useDPR);
        }

        function draw(idx, frac) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const step = steps[idx];
            if (!step) return;
            ctx.clearRect(0, 0, W, H);
            header(ctx, W, step.label, step.tech);

            const padL  = 34 * useDPR, padR = 14 * useDPR;
            const gridW = W - padL - padR;
            const laneW = (gridW - 3 * 6 * useDPR) / 4;
            const h     = Math.min(laneW * 0.62, 38 * useDPR);

            if (view === "lanes") {
                const yA = H * 0.26, yB = H * 0.45, yR = H * 0.68;
                const ops = step.operands;
                rowLabel(ctx, "A", padL, yA, h);
                laneRow(ctx, ops ? ops[0] : (step.label === "Vector A" ? step.data : fo.a),
                        padL, yA, laneW, h);
                rowLabel(ctx, "B", padL, yB, h);
                laneRow(ctx, ops ? ops[1] : (step.label === "Vector B" ? step.data : fo.b),
                        padL, yB, laneW, h);

                // The result row appears ALL AT ONCE, never lane by lane --
                // that is the entire point of the instruction.
                if (ops) {
                    ctx.fillStyle = "#e8f4f8";
                    ctx.font = `600 ${14 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.textAlign = "center";
                    ctx.fillText("+", W / 2, (yB + h + yR) / 2 + 5 * useDPR);
                    rowLabel(ctx, "=", padL, yR, h);
                    laneRow(ctx, step.data, padL, yR, laneW, h,
                            { fill: accent + "33", stroke: accent });
                }

            } else if (view === "compare") {
                const isSimd = step.mode === "simd";
                const yTop = H * 0.30, yBot = H * 0.58;

                rowLabel(ctx, "A", padL, yTop, h);
                laneRow(ctx, fo.a, padL, yTop, laneW, h);
                rowLabel(ctx, "B", padL, yBot - h * 1.15, h);
                laneRow(ctx, fo.b, padL, yBot - h * 1.15, laneW, h);

                const yOut = H * 0.74;
                rowLabel(ctx, "=", padL, yOut, h);
                laneRow(ctx, step.data, padL, yOut, laneW, h,
                        { fill: (isSimd ? accent : "#e74c3c") + "33",
                          stroke: isSimd ? accent : "#e74c3c" });

                // The counter IS the argument: 4 -> 1.
                ctx.textAlign = "center";
                ctx.fillStyle = isSimd ? accent : "#e74c3c";
                ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(isSimd ? "1 instruction"
                                    : `${step.opCount} of ${fo.scalarOps} instructions`,
                             W / 2, H - 34 * useDPR);
                ctx.fillStyle = "#5c6470";
                ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(isSimd ? "all four lanes advance together"
                                    : "one lane at a time, in sequence",
                             W / 2, H - 18 * useDPR);

            } else {   // pipeline
                // A vertical run of stages, the current one lit. Kept as
                // one column because the stages are strictly sequential --
                // laying them side by side would imply they overlap.
                const kinds = steps.map(s => s.stageKind);
                const boxH  = Math.min(H * 0.085, 34 * useDPR);
                const gap   = boxH * 0.55;
                const top   = H * 0.20;
                const bw    = Math.min(gridW * 0.62, 210 * useDPR);
                const bx    = (W - bw) / 2;

                kinds.forEach((k, i) => {
                    const y = top + i * (boxH + gap);
                    const active = i === idx;
                    const done   = i < idx;
                    box(ctx, bx, y, bw, boxH,
                        active ? accent + "33" : done ? "rgba(255,255,255,0.06)"
                                                      : "rgba(255,255,255,0.03)",
                        active ? accent : "rgba(255,255,255,0.12)",
                        steps[i].label, active ? "#e8f4f8" : "#6b7480", 11);
                    if (i < kinds.length - 1) {
                        ctx.strokeStyle = done ? accent + "88" : "rgba(255,255,255,0.15)";
                        ctx.lineWidth = 1.4 * useDPR;
                        ctx.beginPath();
                        ctx.moveTo(W / 2, y + boxH);
                        ctx.lineTo(W / 2, y + boxH + gap);
                        ctx.stroke();
                    }
                });

                // The current stage's values, under the column.
                const yv = top + kinds.length * (boxH + gap) + 8 * useDPR;
                if (yv + h < H - 20 * useDPR) {
                    laneRow(ctx, step.data.slice(0, 4), padL, yv, laneW, h,
                            { fill: accent + "22", stroke: accent, size: 12 });
                }
            }

            ctx.textAlign = "center";
            ctx.fillStyle = "#4a5260";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${idx + 1} / ${steps.length}`, W / 2, H - 6 * useDPR);
        }

        draw(0, 0);
        startSweepLoop(sampleId, durationMs, e => {
            const idx = Math.min(steps.length - 1, Math.floor(e / stepMs));
            draw(idx, (e % stepMs) / stepMs);
        });
    },
});

})();
