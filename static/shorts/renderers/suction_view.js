// ---------------------------------------------------------------------------
// renderers/suction_view.js
//
// Four views of one fan car, chosen by config.view:
//
//   speed   downforce against road speed -- wing against fan
//   seal    downforce against skirt gap, with the car drawn in section
//   claim   what a stated downforce figure demands of the air
//   thrust  the cold-gas budget, and why it is a different mechanism
//
// WRITTEN FOR SOMEONE WHO HAS NEVER DONE ANY PHYSICS
//   Two rules follow from that, and they drive most of the code below.
//
//   1. NO PRESSURE UNITS ON SCREEN. "2.5 kPa" means nothing to most
//      people. Every force here is shown as a MULTIPLE OF THE CAR'S OWN
//      WEIGHT, because "it is pressed down twice as hard as it weighs"
//      needs no training to understand, and 1.0 has an obvious meaning:
//      enough to hold itself up.
//
//   2. A LIVE CAPTION, not a label. Each view carries two or three
//      sentences at the bottom that CHANGE as the sweep runs, saying in
//      plain words what is happening right now. They are the main
//      explanation; the chart illustrates them rather than the reverse.
//
// THE CAR WITH NO FAN SPECIFICATION
//   One sample has no published fan data, so there is no fan line to
//   draw. An earlier version simply omitted it and left the legend
//   promising a line that never appeared, which reads as a bug. It now
//   says so, in the plot area, in words.
//
// SIZING -- see the note in moore_view.js. offsetWidth is often 0 when
// render() runs, so there is a literal pixel fallback and all geometry
// is computed inside draw() from the canvas's live size.
//
// Self-registers into RENDER_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

const FAN   = "#2edac4";
const WING  = "#eb7b2b";
const ALERT = "#ff3366";
const DIM   = "#78828e";
const TEXT  = "#e8f4f8";

registerRenderingAlgorithm("suction_view", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const view = config.view ?? "speed";
        const fo = dspOutput.finalOutput ?? {};
        const steps = (dspOutput.interimOutputs ?? []).filter(c => c.view === view);
        if (steps.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">This car has no "${view}" data.</p>`;
            return;
        }
        if (!Number.isFinite(fo.weight)) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">Model produced no usable
                 numbers (weight = ${fo.weight}).</p>`;
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
                       || root.getPropertyValue("--accent").trim() || "#2edac4";

        const mono = s => `${s * useDPR}px "IBM Plex Mono", monospace`;
        const bold = s => `600 ${s * useDPR}px "IBM Plex Mono", monospace`;
        let last = [0, 0];

        // Forces are shown as multiples of the car's own weight throughout.
        const toG = f => f / fo.weight;

        function wrap(ctx, text, maxW) {
            const words = text.split(" ");
            const lines = [];
            let line = "";
            for (const w of words) {
                const t = line ? line + " " + w : w;
                if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
                else line = t;
            }
            if (line) lines.push(line);
            return lines;
        }

        // The caption block. This is the explanation; everything above it
        // is a picture of what it says.
        function note(ctx, W, H, M, text, hiCol) {
            ctx.font = mono(11);
            ctx.textAlign = "left";
            const maxW = W - M.left - M.right;
            const lines = wrap(ctx, text, maxW);
            const lh = 15 * useDPR;
            let y = H - 22 * useDPR - lines.length * lh;
            for (const ln of lines) {
                ctx.fillStyle = hiCol ?? "#b6c0cc";
                ctx.fillText(ln, M.left, y);
                y += lh;
            }
        }

        function head(ctx, M, title, sub, col) {
            ctx.textAlign = "left";
            ctx.fillStyle = accent;
            ctx.font = bold(14);
            ctx.fillText(title, M.left, 24 * useDPR);
            if (sub) {
                ctx.fillStyle = col ?? DIM;
                ctx.font = mono(10);
                ctx.fillText(sub, M.left, 40 * useDPR);
            }
        }

        function draw(idx, frac) {
            last = [idx, frac];
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            if (!W || !H) return;

            const M = { left: 54 * useDPR, right: 16 * useDPR,
                        top: 56 * useDPR, bottom: 112 * useDPR };
            const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
            if (pw <= 0 || ph <= 0) return;

            ctx.clearRect(0, 0, W, H);
            const step = steps[idx]?.step;
            if (!step) return;

            if (view === "speed")  drawSpeed(ctx, W, H, M, pw, ph, idx, step);
            if (view === "seal")   drawSeal(ctx, W, H, M, pw, ph, idx, step);
            if (view === "claim")  drawClaim(ctx, W, H, M, pw, ph, idx, step);
            if (view === "thrust") drawThrust(ctx, W, H, M, pw, ph, idx, step);

            ctx.textAlign = "center";
            ctx.fillStyle = "#4a5260";
            ctx.font = mono(9);
            ctx.fillText(`${idx + 1} / ${steps.length}`, W / 2, H - 6 * useDPR);
        }

        function gGrid(ctx, M, pw, ph, gMax) {
            ctx.strokeStyle = "rgba(255,255,255,0.055)";
            ctx.lineWidth = 1 * useDPR;
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.textAlign = "right";
            for (let i = 0; i <= 4; i++) {
                const y = M.top + ph - (i / 4) * ph;
                ctx.beginPath();
                ctx.moveTo(M.left, y); ctx.lineTo(M.left + pw, y); ctx.stroke();
                ctx.fillText(`${(gMax * i / 4).toFixed(1)}x`,
                             M.left - 6 * useDPR, y + 3 * useDPR);
            }
            ctx.save();
            ctx.translate(13 * useDPR, M.top + ph / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = "center";
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.fillText("pressed down, x its own weight", 0, 0);
            ctx.restore();
        }

        // ── 1. speed ────────────────────────────────────────────────────
        function drawSpeed(ctx, W, H, M, pw, ph, idx, step) {
            const S = fo.speedSteps;
            const gMax = Math.max(toG(fo.fanForce ?? 0),
                                  ...S.map(s => toG(s.wing))) * 1.15 || 1;
            const vMax = S[S.length - 1].v;
            const tx = v => M.left + (v / vMax) * pw;
            const ty = f => M.top + ph - (toG(f) / gMax) * ph;

            gGrid(ctx, M, pw, ph, gMax);
            ctx.textAlign = "center";
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            for (const v of [0, vMax / 2, vMax]) {
                ctx.fillText(v === 0 ? "parked" : `${(v * 3.6).toFixed(0)} km/h`,
                             tx(v), M.top + ph + 16 * useDPR);
            }

            if (fo.fanForce) {
                ctx.strokeStyle = FAN;
                ctx.lineWidth = 2.6 * useDPR;
                ctx.beginPath();
                ctx.moveTo(M.left, ty(fo.fanForce));
                ctx.lineTo(tx(step.v), ty(fo.fanForce));
                ctx.stroke();
            } else {
                // Say it, rather than leaving a legend entry with no line.
                ctx.textAlign = "center";
                ctx.fillStyle = ALERT;
                ctx.font = bold(11);
                ctx.fillText("no fan line: this car's fan was never specified",
                             M.left + pw / 2, M.top + ph * 0.42);
                ctx.fillStyle = DIM;
                ctx.font = mono(10);
                ctx.fillText("the next card checks the claim a different way",
                             M.left + pw / 2, M.top + ph * 0.42 + 16 * useDPR);
            }

            ctx.strokeStyle = WING;
            ctx.lineWidth = 2.6 * useDPR;
            ctx.beginPath();
            S.slice(0, idx + 1).forEach((s, i) =>
                i ? ctx.lineTo(tx(s.v), ty(s.wing)) : ctx.moveTo(tx(s.v), ty(s.wing)));
            ctx.stroke();

            if (fo.crossV !== null && step.v >= fo.crossV) {
                const cx = tx(fo.crossV);
                ctx.setLineDash([4 * useDPR, 4 * useDPR]);
                ctx.strokeStyle = ALERT;
                ctx.lineWidth = 1.5 * useDPR;
                ctx.beginPath();
                ctx.moveTo(cx, M.top); ctx.lineTo(cx, M.top + ph); ctx.stroke();
                ctx.setLineDash([]);
            }

            const entries = [[WING, "the wing"]];
            if (fo.fanForce) entries.push([FAN, "the fan"]);
            legend(ctx, M, H, entries);

            let msg;
            if (!fo.fanForce) {
                msg = "A wing only works when air rushes over it, so the faster "
                    + "the car goes the harder it is pushed down. Tesla has not "
                    + "published what its fan can do, so there is nothing "
                    + "honest to draw for it here.";
            } else if (step.v === 0) {
                msg = `Standing still, the wing does nothing at all — no air is `
                    + `moving over it. The fan is already pulling this car onto `
                    + `the road ${toG(fo.fanForce).toFixed(2)} times as hard as it weighs.`;
            } else if (fo.crossV !== null && step.v >= fo.crossV) {
                msg = `Past about ${fo.crossKmh.toFixed(0)} km/h the wing finally `
                    + `overtakes the fan. Fans win the slow corners; wings win `
                    + `the fast ones. That is why nobody ever built a car with `
                    + `only a fan.`;
            } else {
                msg = `At ${step.kmh.toFixed(0)} km/h the wing is starting to bite, `
                    + `but the fan has been pressing down just as hard since the `
                    + `car was parked. The flat green line is the whole point.`;
            }
            note(ctx, W, H, M, msg);

            head(ctx, M, "A wing needs speed. A fan does not.",
                 fo.fanForce ? `${fo.name} — green line never changes`
                             : `${fo.name} — no fan figures published`,
                 fo.fanForce ? DIM : ALERT);
        }

        // ── 2. seal ─────────────────────────────────────────────────────
        function drawSeal(ctx, W, H, M, pw, ph, idx, step) {
            const S = fo.sealSteps;
            const gMax = Math.max(...S.map(s => toG(s.force ?? 0))) * 1.15 || 1;
            const gapMax = S[S.length - 1].gapMm;
            const chartH = ph * 0.55;
            const tx = g => M.left + (g / gapMax) * pw;
            const ty = f => M.top + chartH - (toG(f) / gMax) * chartH;

            ctx.strokeStyle = "rgba(255,255,255,0.055)";
            ctx.lineWidth = 1 * useDPR;
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.textAlign = "right";
            for (let i = 0; i <= 3; i++) {
                const y = M.top + chartH - (i / 3) * chartH;
                ctx.beginPath();
                ctx.moveTo(M.left, y); ctx.lineTo(M.left + pw, y); ctx.stroke();
                ctx.fillText(`${(gMax * i / 3).toFixed(1)}x`,
                             M.left - 6 * useDPR, y + 3 * useDPR);
            }

            ctx.strokeStyle = FAN;
            ctx.lineWidth = 2.6 * useDPR;
            ctx.beginPath();
            S.slice(0, idx + 1).forEach((s, i) =>
                i ? ctx.lineTo(tx(s.gapMm), ty(s.force))
                  : ctx.moveTo(tx(s.gapMm), ty(s.force)));
            ctx.stroke();
            ctx.fillStyle = FAN;
            ctx.beginPath();
            ctx.arc(tx(step.gapMm), ty(step.force), 5 * useDPR, 0, Math.PI * 2);
            ctx.fill();

            ctx.textAlign = "center";
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.fillText("skirt touching", tx(0.5) + 24 * useDPR,
                         M.top + chartH + 15 * useDPR);
            ctx.fillText("2 cm of daylight", tx(gapMax) - 30 * useDPR,
                         M.top + chartH + 15 * useDPR);

            // The car in section. Only the gap is to scale, said on screen,
            // because a drawing that silently lies about proportion is
            // worse than no drawing.
            const cy = M.top + ph - 16 * useDPR;
            const cw = pw * 0.76, cx0 = M.left + (pw - cw) / 2;
            const gapPx = Math.min(24 * useDPR, step.gapMm * 2.0 * useDPR);
            const bodyH = 26 * useDPR;
            const shade = Math.max(0, Math.min(1, (step.dP ?? 0) / (S[0].dP || 1)));

            ctx.fillStyle = `rgba(46,218,196,${0.08 + 0.42 * shade})`;
            ctx.fillRect(cx0, cy - gapPx, cw, gapPx);
            ctx.fillStyle = "#2b3240";
            ctx.fillRect(cx0, cy - gapPx - bodyH, cw, bodyH);
            ctx.strokeStyle = "#4a5668";
            ctx.lineWidth = 1.4 * useDPR;
            ctx.strokeRect(cx0, cy - gapPx - bodyH, cw, bodyH);
            ctx.strokeStyle = "#5c6470";
            ctx.lineWidth = 2 * useDPR;
            ctx.beginPath();
            ctx.moveTo(M.left, cy); ctx.lineTo(M.left + pw, cy); ctx.stroke();
            for (const ex of [cx0, cx0 + cw]) {
                ctx.strokeStyle = step.gapMm > 8 ? ALERT : "#8a94a2";
                ctx.lineWidth = 3 * useDPR;
                ctx.beginPath();
                ctx.moveTo(ex, cy - gapPx - 2 * useDPR);
                ctx.lineTo(ex, cy - gapPx);
                ctx.stroke();
            }
            ctx.textAlign = "center";
            ctx.fillStyle = "#4a5260";
            ctx.font = mono(9);
            ctx.fillText("side view — the gap is drawn much larger than life",
                         M.left + pw / 2, cy + 14 * useDPR);

            let msg;
            if (step.gapMm < 3) {
                msg = `The rubber skirts are nearly touching the road. Almost no `
                    + `air can sneak back in underneath, so the fan keeps the `
                    + `space below the car emptied out, and the car is sucked `
                    + `down ${step.g.toFixed(2)} times its own weight.`;
            } else if (step.gapMm < 9) {
                msg = `The car has risen a little and air is leaking back in `
                    + `around the edges. The fan is still winning, but it is `
                    + `having to work against the leak — down to `
                    + `${step.g.toFixed(2)} times its weight.`;
            } else {
                msg = `A finger's width of daylight under the skirt and most of `
                    + `the grip is gone — only ${step.g.toFixed(2)} times its `
                    + `weight left. Grip like this does not fade away gently. `
                    + `It vanishes, mid-corner, which is exactly what made these `
                    + `cars so dangerous.`;
            }
            note(ctx, W, H, M, msg, step.gapMm > 9 ? "#ffb3c4" : "#b6c0cc");

            head(ctx, M, "The fan is not the trick. The seal is.",
                 `skirt ${step.gapMm.toFixed(1)} mm off the road`,
                 step.g < 0.5 ? ALERT : DIM);
        }

        // ── 3. claim ────────────────────────────────────────────────────
        function drawClaim(ctx, W, H, M, pw, ph, idx, step) {
            const S = fo.claimSteps;
            const target = S[S.length - 1];
            const barW = pw * 0.26, barX = M.left + 4 * useDPR;
            const barTop = M.top + 6 * useDPR, barH = ph - 26 * useDPR;

            ctx.fillStyle = "rgba(255,255,255,0.07)";
            ctx.fillRect(barX, barTop, barW, barH);
            // Exaggerated 3x, because a true-to-scale 2.5% sliver would be
            // two pixels and the view would look like nothing happens.
            const drop = Math.min(barH, barH * (step.pctOfAtm / 100) * 3);
            ctx.fillStyle = ALERT + "55";
            ctx.fillRect(barX, barTop, barW, drop);
            ctx.strokeStyle = "#4a5668";
            ctx.lineWidth = 1.4 * useDPR;
            ctx.strokeRect(barX, barTop, barW, barH);

            ctx.textAlign = "center";
            ctx.fillStyle = DIM;
            ctx.font = mono(9);
            ctx.fillText("air under", barX + barW / 2, barTop + barH + 14 * useDPR);
            ctx.fillText("the car", barX + barW / 2, barTop + barH + 25 * useDPR);
            ctx.fillStyle = ALERT;
            ctx.font = bold(11);
            ctx.fillText(`${step.pctOfAtm.toFixed(1)}%`, barX + barW / 2,
                         barTop + Math.max(14 * useDPR, drop) - 5 * useDPR);
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.fillText("taken out", barX + barW / 2,
                         barTop + Math.max(26 * useDPR, drop + 11 * useDPR) - 5 * useDPR);

            const rx = barX + barW + 26 * useDPR;
            ctx.textAlign = "left";
            const rows = [
                ["air normally pressing on the floor",
                 `${fo.atmTonnes.toFixed(0)} tonnes`, DIM],
                ["share of it the fan removes",
                 `${step.pctOfAtm.toFixed(1)} %`, ALERT],
                ["so the car is pressed down",
                 `${step.g.toFixed(2)}x its weight`, TEXT],
            ];
            rows.forEach((r, i) => {
                const y = barTop + 24 * useDPR + i * 44 * useDPR;
                if (y > barTop + barH) return;
                ctx.fillStyle = "#5c6470"; ctx.font = mono(9);
                for (const [j, ln] of wrap(ctx, r[0], pw - (rx - M.left)).entries()) {
                    ctx.fillText(ln, rx, y + j * 11 * useDPR);
                }
                ctx.fillStyle = r[2]; ctx.font = bold(15);
                ctx.fillText(r[1], rx, y + 27 * useDPR);
            });

            const claimed = fo.claimedG !== null;
            let msg;
            if (idx === 0) {
                msg = `Air is already pressing down on this car's floor with about `
                    + `${fo.atmTonnes.toFixed(0)} tonnes of force. You never feel `
                    + `it because exactly the same air pushes up from underneath, `
                    + `and the two cancel out.`;
            } else if (idx < S.length - 1) {
                msg = `The fan is taking some of the air out from under the car. `
                    + `Every bit it removes is a bit that has stopped pushing `
                    + `upward — so the air on top wins by that much, and presses `
                    + `the car onto the road.`;
            } else if (claimed) {
                msg = `To reach the claimed ${fo.claimedG}g you would have to `
                    + `remove ${target.pctOfAtm.toFixed(0)}% of the air under the `
                    + `whole floor and hold it there. Not impossible — but around `
                    + `five times what the 1978 Brabham managed.`;
            } else {
                msg = `This car holds about ${target.pctOfAtm.toFixed(1)}% of the `
                    + `air out from under its floor. That small a share is enough `
                    + `to press it down roughly as hard as it weighs.`;
            }
            note(ctx, W, H, M, msg, claimed && idx === S.length - 1 ? "#ffb3c4" : "#b6c0cc");

            head(ctx, M,
                 claimed ? "What the claim actually asks for"
                         : "How little air it takes",
                 `${fo.name} — floor area ${fo.area} m²`,
                 claimed ? ALERT : DIM);
        }

        // ── 4. thrust ───────────────────────────────────────────────────
        function drawThrust(ctx, W, H, M, pw, ph, idx, step) {
            const barX = M.left, barW = pw, barY = M.top + 10 * useDPR;
            const barH = 30 * useDPR;

            ctx.fillStyle = "rgba(255,255,255,0.07)";
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = (step.frac > 0.2 ? FAN : ALERT) + "99";
            ctx.fillRect(barX, barY, barW * step.frac, barH);
            ctx.strokeStyle = "#4a5668";
            ctx.lineWidth = 1.4 * useDPR;
            ctx.strokeRect(barX, barY, barW, barH);

            ctx.textAlign = "left";
            ctx.fillStyle = "#5c6470";
            ctx.font = mono(9);
            ctx.fillText("compressed air left in the tank", barX, barY - 8 * useDPR);
            ctx.textAlign = "right";
            ctx.fillStyle = step.frac > 0.2 ? TEXT : ALERT;
            ctx.font = bold(13);
            ctx.fillText(`${step.gasLeft.toFixed(1)} kg`, barX + barW, barY - 8 * useDPR);

            const rows = [
                ["air thrown away each second", `${fo.mdot.toFixed(0)} kg`, TEXT],
                ["pushes with", `${fo.thrustToWeight.toFixed(1)}x the car's weight`, TEXT],
                ["and then it is empty, after", `${fo.burnS.toFixed(2)} seconds`, ALERT],
            ];
            ctx.textAlign = "left";
            rows.forEach((r, i) => {
                const y = barY + barH + 36 * useDPR + i * 34 * useDPR;
                if (y > M.top + ph) return;
                ctx.fillStyle = "#5c6470"; ctx.font = mono(9);
                ctx.fillText(r[0], M.left, y);
                ctx.fillStyle = r[2]; ctx.font = bold(14);
                ctx.fillText(r[1], M.left, y + 17 * useDPR);
            });

            let msg;
            if (step.frac > 0.6) {
                msg = `A fan moves air along without using it up, so it can run all `
                    + `day. A thruster is the opposite: it throws stored air away `
                    + `to shove the car the other way, like letting go of a balloon.`;
            } else if (step.frac > 0.15) {
                msg = `It is throwing away ${fo.mdot.toFixed(0)} kilograms of air `
                    + `every second — more than the weight of a grown adult, every `
                    + `second. The tank is emptying fast.`;
            } else {
                msg = `Gone, in about ${fo.burnS.toFixed(2)} of a second. That is `
                    + `plenty for a jump or a flip, and nowhere near enough for `
                    + `flying. The sums are not an objection to the car — they are `
                    + `a description of what it can do.`;
            }
            note(ctx, W, H, M, msg, step.frac <= 0.15 ? "#ffb3c4" : "#b6c0cc");

            head(ctx, M, "The thrusters are a different trick",
                 "nothing to do with the fan", DIM);
        }

        function legend(ctx, M, H, entries) {
            ctx.textAlign = "left";
            ctx.font = mono(9);
            let x = M.left;
            const y = H - 112 * useDPR + 12 * useDPR;
            for (const [col, name] of entries) {
                ctx.fillStyle = col;
                ctx.fillRect(x, y - 5 * useDPR, 10 * useDPR, 3 * useDPR);
                ctx.fillStyle = DIM;
                ctx.fillText(name, x + 15 * useDPR, y);
                x += ctx.measureText(name).width + 34 * useDPR;
            }
        }

        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            draw(...last);
        }).observe(container);

        const stepMs = durationMs / steps.length;
        draw(0, 0);
        startSweepLoop(sampleId, durationMs, e => {
            const idx = Math.min(steps.length - 1, Math.floor(e / stepMs));
            draw(idx, (e % stepMs) / stepMs);
        });
    },
});

})();
