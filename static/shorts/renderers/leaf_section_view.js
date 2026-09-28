// ---------------------------------------------------------------------------
// renderers/leaf_section_view.js
//
// A leaf in cross-section, with the active compartment lit as the
// pathway runs through it.
//
// WHY A CROSS-SECTION
//   C4 and CAM solve the same problem in different DIMENSIONS -- C4
//   separates the two chemistries into different CELLS, CAM into
//   different HOURS. A cross-section shows the first directly (bundle
//   sheath appears, and only for C4) and the second through the day/night
//   band at the top. Two different answers to one problem, told by the
//   same picture.
//
// THE STOMA CARRIES THE TRADE
//   Open, and CO2 enters while water leaves. Shut, and both stop. Every
//   pathway here is a different bet on that one hole, so it is drawn
//   large and its state is never implicit.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

registerRenderingAlgorithm("leaf_section_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};
        const steps = fo.steps ?? [];
        if (!steps.length) {
            container.innerHTML = `<p style="color:#ff4d4d;padding:20px;">Nothing to draw.</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);
        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 440;
        canvas.width = Math.round(iw * useDPR); canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width = Math.round(width * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
        }).observe(container);

        const root = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const CO2 = "#5cc24a", O2 = "#e74c3c", WATER = "#3b82f6", MALATE = "#eb7b2b";

        // Which compartments exist depends on the pathway -- bundle sheath
        // only for C4, vacuole only for CAM. Drawing all of them always
        // would erase the structural difference the journey is about.
        const shown = new Set(steps.map(s => s.compartment));
        const LAYOUT = [
            { id: "chloroplast", name: "chloroplast",   frac: 0.30 },
            { id: "bundle",      name: "bundle sheath", frac: 0.30 },
            { id: "vacuole",     name: "vacuole",       frac: 0.26 },
            { id: "peroxisome",  name: "peroxisome",    frac: 0.22 },
            { id: "mesophyll",   name: "mesophyll",     frac: 0.30 },
        ].filter(c => shown.has(c.id));

        const stepMs = durationMs / steps.length;

        function draw(idx, frac) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const step = steps[idx] ?? steps[0];
            ctx.clearRect(0, 0, W, H);
            const mono = s => `${s * useDPR}px "IBM Plex Mono", monospace`;

            // ── day / night band ───────────────────────────────────────
            const night = fo.isNight;
            ctx.fillStyle = night ? "rgba(59,130,246,0.10)" : "rgba(235,180,40,0.09)";
            ctx.fillRect(0, 0, W, 40 * useDPR);
            ctx.textAlign = "left";
            ctx.fillStyle = night ? "#7b93c9" : "#d9b23c";
            ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(night ? "NIGHT" : "DAY", 10 * useDPR, 25 * useDPR);
            ctx.textAlign = "right";
            ctx.fillStyle = "#78828e";
            ctx.font = mono(10);
            ctx.fillText(`${fo.pathway}  ${fo.tempC}\u00B0C${fo.drought ? "  DROUGHT" : ""}`,
                         W - 10 * useDPR, 25 * useDPR);

            // ── cells ──────────────────────────────────────────────────
            const top = 56 * useDPR, bottom = H - 92 * useDPR;
            const avail = bottom - top;
            const totalFrac = LAYOUT.reduce((s, c) => s + c.frac, 0);
            let y = top;
            const boxes = {};
            for (const c of LAYOUT) {
                const h = (c.frac / totalFrac) * avail * 0.86;
                const active = step.compartment === c.id;
                boxes[c.id] = { y, h };
                ctx.fillStyle = active ? accent + "22" : "rgba(255,255,255,0.035)";
                ctx.strokeStyle = active ? accent : "rgba(255,255,255,0.10)";
                ctx.lineWidth = (active ? 2 : 1) * useDPR;
                const x = 16 * useDPR, w = W - 32 * useDPR;
                ctx.beginPath();
                ctx.roundRect
                    ? ctx.roundRect(x, y, w, h, 7 * useDPR)
                    : ctx.rect(x, y, w, h);
                ctx.fill(); ctx.stroke();

                ctx.textAlign = "left";
                ctx.fillStyle = active ? accent : "#5c6470";
                ctx.font = mono(9);
                ctx.fillText(c.name, x + 8 * useDPR, y + 13 * useDPR);

                if (active) {
                    ctx.textAlign = "center";
                    ctx.fillStyle = "#e8f4f8";
                    ctx.font = `600 ${12 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(step.label, W / 2, y + h / 2 + 2 * useDPR);
                    ctx.fillStyle = step.wasteful ? "#e74c3c" : "#9aa4b0";
                    ctx.font = mono(9);
                    ctx.fillText(step.tech, W / 2, y + h / 2 + 16 * useDPR);
                }
                y += h + avail * 0.045;
            }

            // ── the stoma: the whole trade in one hole ─────────────────
            const sy = bottom + 6 * useDPR, sh = 26 * useDPR;
            const open = fo.stomataOpen;
            ctx.strokeStyle = open ? accent : "#e74c3c";
            ctx.lineWidth = 2.4 * useDPR;
            const cx = W / 2, gap = open ? 16 * useDPR : 2 * useDPR;
            ctx.beginPath();                       // two guard cells
            ctx.ellipse(cx - gap, sy + sh/2, 7*useDPR, sh/2, 0, 0, Math.PI*2);
            ctx.ellipse(cx + gap, sy + sh/2, 7*useDPR, sh/2, 0, 0, Math.PI*2);
            ctx.stroke();
            ctx.textAlign = "left";
            ctx.fillStyle = open ? accent : "#e74c3c";
            ctx.font = mono(9);
            ctx.fillText(open ? "stoma open" : "stoma shut", 16 * useDPR, sy + 17 * useDPR);

            // Gas traffic, only while the stoma is open. CO2 in, O2 and
            // water out -- water is the cost the pathway is trying to
            // minimise, so it is drawn leaving, not implied.
            if (open) {
                const t = (frac * 2) % 1;
                const drift = (1 - t) * 26 * useDPR;
                ctx.font = mono(10);
                ctx.textAlign = "center";
                ctx.fillStyle = CO2;
                ctx.fillText("CO\u2082", cx - 42 * useDPR, sy + 4 * useDPR + drift);
                ctx.fillStyle = WATER;
                ctx.fillText("H\u2082O", cx + 42 * useDPR, sy + 20 * useDPR - drift);
                ctx.fillStyle = O2;
                ctx.fillText("O\u2082", cx + 78 * useDPR, sy + 20 * useDPR - drift);
            }

            // ── cost readout ───────────────────────────────────────────
            ctx.textAlign = "center";
            ctx.fillStyle = accent;
            ctx.font = `600 ${12 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${fo.atpPerCO2.toFixed(1)} ATP per CO\u2082`, W / 2, H - 42 * useDPR);
            ctx.fillStyle = "#78828e";
            ctx.font = mono(10);
            ctx.fillText(`${fo.waterPerCO2.toFixed(0)} H\u2082O lost  \u00b7  `
                       + `${(fo.photorespirationLoss * 100).toFixed(0)}% carbon back to O\u2082`,
                         W / 2, H - 26 * useDPR);
            ctx.fillStyle = "#4a5260";
            ctx.font = mono(9);
            ctx.fillText(`${idx + 1} / ${steps.length}`, W / 2, H - 9 * useDPR);
        }

        draw(0, 0);
        startSweepLoop(sampleId, durationMs, e => {
            const idx = Math.min(steps.length - 1, Math.floor(e / stepMs));
            draw(idx, (e % stepMs) / stepMs);
        });
    },
});

})();
