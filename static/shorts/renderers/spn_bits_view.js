// ---------------------------------------------------------------------------
// renderers/spn_bits_view.js
//
// All 16 bits of an SPN block, drawn as cells. The permutation step
// draws two rows with wires between them, because "bits move between
// nibbles" is the claim the whole cipher rests on and a single row
// cannot show it.
//
// WHY BITS RATHER THAN HEX
//   AES is rendered as a grid of bytes because 128 bits will not fit.
//   At 16 bits they do, and that changes what can be taught: you can
//   watch ONE bit flip and follow where it goes. Hex would hide exactly
//   the thing this cipher exists to demonstrate.
//
// WHY NIBBLE GROUPING
//   The S-box operates on 4-bit nibbles independently. Grouping the
//   cells 4-4-4-4 makes the lanes visible, so when the permutation then
//   scatters bits ACROSS those groups the contrast is obvious --
//   substitution stays in its lane, permutation does not.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("spn_bits_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const all  = dspOutput.interimOutputs ?? [];
        const perm = dspOutput.finalOutput?.perm ?? [];
        const depth  = config.depth ?? 2;
        const parent = config.drillParent ?? null;

        let steps = all.filter(c => c.depth === depth);
        if (parent) steps = steps.filter(c => c.parent === parent);
        if (steps.length === 0) steps = all.filter(c => c.depth === 1);
        if (steps.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">Nothing to draw.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);

        const iw = container.offsetWidth || 800, ih = container.offsetHeight || 300;
        canvas.width = Math.round(iw * useDPR);
        canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";

        const ro = new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width = Math.round(width * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
        });
        ro.observe(container);

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        // One colour per nibble, so a bit can be tracked across the
        // permutation by the lane it CAME from.
        const NIB = ["#eb7b2b", "#1abc9c", "#9b59b6", "#3b82f6"];

        // Even time per step -- unlike the AES grid, which weights by
        // repeatRole. Here every step is structurally different (there
        // are only 4 rounds, none redundant), so there is nothing to
        // compress.
        const stepMs = durationMs / steps.length;

        let lastDrawn = -1;
        function draw(idx, frac) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const step = steps[idx];
            if (!step) return;

            ctx.clearRect(0, 0, W, H);

            const isPerm = step.label === "Permute" && step.before !== undefined;
            const cellW  = Math.min((W - 60 * useDPR) / 19, 26 * useDPR);
            const cellH  = cellW * 1.15;
            const gap    = cellW * 0.45;          // between nibble groups
            const rowW   = cellW * 16 + gap * 3;
            const x0     = (W - rowW) / 2;

            const cellX = i => x0 + i * cellW + Math.floor(i / 4) * gap;

            function drawRow(bits, y, changed, dim) {
                for (let i = 0; i < 16; i++) {
                    const x = cellX(i), on = bits[i] === 1;
                    const col = NIB[Math.floor(i / 4)];
                    ctx.globalAlpha = dim ? 0.45 : 1;
                    ctx.fillStyle = on ? col : "rgba(255,255,255,0.05)";
                    ctx.fillRect(x, y, cellW - 2 * useDPR, cellH);
                    if (changed && changed[i]) {
                        ctx.strokeStyle = "#fff";
                        ctx.lineWidth = 1.6 * useDPR;
                        ctx.strokeRect(x, y, cellW - 2 * useDPR, cellH);
                    }
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = on ? "#0b0d10" : "#4a5260";
                    ctx.font = `600 ${cellW * 0.5}px "IBM Plex Mono", monospace`;
                    ctx.textAlign = "center";
                    ctx.fillText(on ? "1" : "0",
                                 x + (cellW - 2 * useDPR) / 2, y + cellH * 0.68);
                }
            }

            const prev = idx > 0 ? steps[idx - 1].bits : null;
            const changed = prev
                ? step.bits.map((b, i) => b !== prev[i]) : null;

            ctx.fillStyle = accent;
            ctx.font = `600 ${15 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "center";
            ctx.fillText(step.label, W / 2, 26 * useDPR);
            ctx.fillStyle = "#78828e";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(step.tech ?? "", W / 2, 42 * useDPR);

            if (isPerm) {
                // Two rows: where bits were, where they go, wires between.
                // Wires are drawn progressively so they can be followed
                // one at a time rather than arriving as a tangle.
                const beforeBits = Array.from({length:16},
                    (_, i) => (step.before >> (15 - i)) & 1);
                const yTop = H * 0.30, yBot = H * 0.62;

                drawRow(beforeBits, yTop, null, true);

                const nWires = Math.round(Math.min(1, frac / 0.7) * 16);
                for (let i = 0; i < nWires; i++) {
                    const src = perm[i];      // output bit i takes input bit perm[i]
                    const sx = cellX(src) + cellW / 2, sy = yTop + cellH;
                    const dx = cellX(i)   + cellW / 2, dy = yBot;
                    // Colour by SOURCE nibble -- that is what makes the
                    // scattering legible. A wire's colour says where the
                    // bit came from, so four colours arriving in every
                    // group IS the diffusion.
                    ctx.strokeStyle = NIB[Math.floor(src / 4)] + "99";
                    ctx.lineWidth = 1.3 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.bezierCurveTo(sx, sy + (dy - sy) * 0.5,
                                      dx, dy - (dy - sy) * 0.5, dx, dy);
                    ctx.stroke();
                }

                // The lower row fills in as its wires land.
                const partial = step.bits.map((b, i) => i < nWires ? b : null);
                for (let i = 0; i < 16; i++) {
                    if (partial[i] === null) continue;
                    const x = cellX(i), on = partial[i] === 1;
                    ctx.fillStyle = on ? NIB[Math.floor(perm[i] / 4)]
                                       : "rgba(255,255,255,0.05)";
                    ctx.fillRect(x, yBot, cellW - 2 * useDPR, cellH);
                    ctx.fillStyle = on ? "#0b0d10" : "#4a5260";
                    ctx.font = `600 ${cellW * 0.5}px "IBM Plex Mono", monospace`;
                    ctx.textAlign = "center";
                    ctx.fillText(on ? "1" : "0",
                                 x + (cellW - 2 * useDPR) / 2, yBot + cellH * 0.68);
                }
            } else {
                drawRow(step.bits, H * 0.42, changed, false);
            }

            // Nibble labels, so the lanes have names
            ctx.fillStyle = "#4a5260";
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "center";
            for (let n = 0; n < 4; n++) {
                const cx = (cellX(n*4) + cellX(n*4+3) + cellW) / 2;
                ctx.fillText(`nibble ${n}`, cx,
                             (isPerm ? H * 0.30 : H * 0.42) - 6 * useDPR);
            }

            // Hex and progress
            ctx.fillStyle = "#9aa4b0";
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`0x${step.hex}`, W / 2, H - 34 * useDPR);
            ctx.fillStyle = "#5c6470";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${idx + 1} / ${steps.length}`, W / 2, H - 16 * useDPR);

            lastDrawn = idx;
        }

        draw(0, 1);

        function drawAtElapsed(elapsed) {
            const idx  = Math.min(steps.length - 1, Math.floor(elapsed / stepMs));
            const frac = (elapsed % stepMs) / stepMs;
            draw(idx, frac);
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});

})();
