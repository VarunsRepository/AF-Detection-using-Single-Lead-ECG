// ---------------------------------------------------------------------------
// renderers/sha1_state_view.js
//
// SHA-1's five working words as five rows of 32 bits.
//
// WHY BITS AND NOT JUST HEX
//   The hex is there too, but hex hides the thing worth seeing: a SHA-1
//   round barely computes anything new. Four of the five words simply
//   SHIFT DOWN one place (c picking up a 30-bit rotation on the way),
//   and only `a` is genuinely new. At the bit level that shift is
//   visible as a pattern sliding down the rows; in hex it looks like
//   five unrelated numbers changing at once.
//
// NO PER-BIT TEXT
//   160 bits will not carry a readable "0"/"1" on a phone -- 32 cells
//   across a 390px screen is about 9px each. Filled or empty squares
//   read fine at that size, and the hex column carries the exact value.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("sha1_state_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const all    = dspOutput.interimOutputs ?? [];
        const depth  = config.depth ?? 1;
        const parent = config.drillParent ?? null;

        let steps = all.filter(c => c.depth === depth);
        if (parent) steps = steps.filter(c => c.parent === parent);
        if (steps.length === 0) steps = all.filter(c => c.depth === 1);
        if (steps.length === 0) {
            container.innerHTML = `<p style="color:#ff4d4d;padding:20px;">Nothing to draw.</p>`;
            return;
        }

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

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const NAMES  = ["a", "b", "c", "d", "e"];
        // One colour per word, so a value can be followed as it shifts
        // down the rows from one round to the next.
        const WORD   = ["#eb7b2b", "#1abc9c", "#9b59b6", "#3b82f6", "#e74c3c"];

        // Weighted by repeatRole: the first round of each group is the
        // exemplar and gets more time than the 19 that repeat it.
        const WEIGHT = { exemplar: 3, repeat: 1 };
        const w = steps.map(s => WEIGHT[s.repeatRole] ?? 2);
        const sum = w.reduce((a, b) => a + b, 0);
        const bounds = [];
        let acc = 0;
        for (const x of w) { acc += x / sum; bounds.push(acc); }

        function draw(idx, frac) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const step = steps[idx];
            if (!step) return;
            ctx.clearRect(0, 0, W, H);

            const padL = 22 * useDPR, padR = 74 * useDPR;
            const gridW = W - padL - padR;
            const cell  = gridW / 32;
            const rowH  = Math.min(cell * 1.6, 22 * useDPR);
            const gapY  = rowH * 1.55;
            const top   = H * 0.30;

            ctx.textAlign = "center";
            ctx.fillStyle = accent;
            ctx.font = `600 ${15 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(step.label, W / 2, 26 * useDPR);
            ctx.fillStyle = "#78828e";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(step.tech ?? "", W / 2, 42 * useDPR);

            const prev = idx > 0 ? steps[idx - 1] : null;

            for (let r = 0; r < 5; r++) {
                const y = top + r * gapY;
                const rowBits = step.bits[r] ?? [];
                const prevBits = prev?.bits?.[r];

                ctx.fillStyle = "#5c6470";
                ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "left";
                ctx.fillText(NAMES[r], 4 * useDPR, y + rowH * 0.75);

                for (let i = 0; i < 32; i++) {
                    const x = padL + i * cell;
                    const on = rowBits[i] === 1;
                    ctx.fillStyle = on ? WORD[r] : "rgba(255,255,255,0.055)";
                    ctx.fillRect(x, y, cell - 1.2 * useDPR, rowH);
                    // Outline bits this step changed -- the shift down the
                    // rows is only obvious when the differences are marked.
                    if (prevBits && prevBits[i] !== rowBits[i]) {
                        ctx.strokeStyle = "rgba(255,255,255,0.75)";
                        ctx.lineWidth = 1 * useDPR;
                        ctx.strokeRect(x, y, cell - 1.2 * useDPR, rowH);
                    }
                }

                ctx.fillStyle = "#9aa4b0";
                ctx.font = `${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "left";
                ctx.fillText(step.hex[r], padL + gridW + 6 * useDPR,
                             y + rowH * 0.75);
            }

            // At round level, name what actually moved. Four of the five
            // words are just the row above, so saying so turns a wall of
            // changing bits into one rule.
            if (step.round && frac > 0.35) {
                ctx.fillStyle = "#5c6470";
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "left";
                // Kept short: these sit in the hex gutter, and the long
                // form ("old b, rotated 30") ran off the right edge.
                const notes = ["\u2190 new", "\u2190 old a", "\u2190 b rot30",
                               "\u2190 old c", "\u2190 old d"];
                for (let r = 0; r < 5; r++) {
                    ctx.fillText(notes[r], padL + gridW + 6 * useDPR,
                                 top + r * gapY + rowH * 0.75 + 11 * useDPR);
                }
            }

            ctx.textAlign = "center";
            ctx.fillStyle = "#4a5260";
            ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
            const wNote = step.w ? `  \u00b7  W = ${step.w}` : "";
            ctx.fillText(`${idx + 1} / ${steps.length}${wNote}`, W / 2, H - 16 * useDPR);

            if (step.digest) {
                ctx.fillStyle = accent;
                ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(step.digest, W / 2, H - 34 * useDPR);
            }
        }

        draw(0, 1);

        function drawAtElapsed(elapsed) {
            const t = Math.min(1, elapsed / durationMs);
            let idx = bounds.findIndex(b => t < b);
            if (idx === -1) idx = steps.length - 1;
            const lo = idx === 0 ? 0 : bounds[idx - 1];
            draw(idx, (t - lo) / (bounds[idx] - lo || 1));
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});

})();
