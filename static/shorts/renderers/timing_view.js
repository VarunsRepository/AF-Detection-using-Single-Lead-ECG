// ---------------------------------------------------------------------------
// renderers/timing_view.js
// Weyland-Yutani Corp // Bus Analyser
//
// A logic analyser, drawn the way one looks: a lane per wire, square
// transitions, a playhead sweeping left to right in REAL frame time.
//
// WHY REAL TIME AND NOT A STEP PER BEAT
//   The pathway renderers give each step an equal slice, because a walk
//   has no clock. A bus does. Every protocol here is uniformly timed, so
//   real time and equal time happen to coincide for the bits -- but the
//   idle gaps, the setup time after CS asserts and the ninth clock of an
//   I2C byte only read correctly when the horizontal axis IS time. The
//   moment the axis stops being time, the picture stops being a timing
//   diagram and becomes a flowchart with square corners.
//
// THE SAMPLE POINT IS THE POINT
//   Drawing the waveform is the easy half and teaches almost nothing --
//   a square wave is a square wave. What makes a protocol legible is
//   WHERE the receiver looks, so every decoded step carries a sampleAt
//   and every one of them is drawn as a tick on the lane. Stage two is
//   then legible without any words: the ticks have moved.
//
// Self-registers into RENDER_ALGORITHMS (rendering_registry.js first).
// ---------------------------------------------------------------------------

(function () {
"use strict";

function ROMULUS_BG() {
    const t = (typeof THEMES !== "undefined" && THEMES[themeIndex]) || {};
    return t.label === "Romulus" ? "#020503" : (t.bg || "#000000");
}

function levelAt(line, t) {
    const e = line.edges;
    let lo = 0, hi = e.length - 1, ans = e.length ? e[0][1] : 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (e[mid][0] <= t) { ans = e[mid][1]; lo = mid + 1; }
        else hi = mid - 1;
    }
    return ans;
}

registerRenderingAlgorithm("timing_view", {

    choices(envelope) {
        const V = envelope?.meta?.frame?.vocabulary ?? {};
        const cap = s => s ? s.toUpperCase() : s;
        return [{
            key: "emphasis",
            label: "READOUT",
            values: ["decode", "field", "wire"],
            display: {
                decode: "BYTES",
                field:  cap(V.side ?? "FIELD"),
                wire:   cap(V.node ?? "LINE"),
            },
        }];
    },

    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";
        container.style.backgroundColor = ROMULUS_BG();

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff3b30;font-family:'Courier New',monospace;padding:20px;">`
                + `[BUS_FAULT]: ${dspOutput.error.toUpperCase()}</p>`;
            return;
        }
        const fo = dspOutput.finalOutput ?? {};
        const lines = fo.lines ?? [];
        const steps = fo.steps ?? [];
        if (!lines.length) {
            container.innerHTML =
                `<p style="color:#ff8b1f;font-family:'Courier New',monospace;padding:20px;">`
                + `[NO_TRAFFIC]</p>`;
            return;
        }

        const useDPR = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        container.appendChild(canvas);
        const iw = container.offsetWidth || 390, ih = container.offsetHeight || 640;
        canvas.width = Math.round(iw * useDPR); canvas.height = Math.round(ih * useDPR);
        canvas.style.width = iw + "px"; canvas.style.height = ih + "px";

        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width = Math.round(width * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
            const c = activeSweepControl.get(sampleId);
            if (c) c.drawFn(c.lastElapsedMs);
        }).observe(container);

        // ── skin ─────────────────────────────────────────────────────────
        const _theme  = (typeof THEMES !== "undefined" && THEMES[themeIndex]) || {};
        const ROMULUS = _theme.label === "Romulus";
        const _accent = _theme.traceColor || "#2edac4";
        const FONT    = ROMULUS ? '"Courier New", monospace'
                                : '"IBM Plex Mono", monospace';

        const AMBER = ROMULUS ? "#ff9900" : "#d9a441";
        const TRACE = ROMULUS ? "#57e389" : _accent;
        const CYAN  = ROMULUS ? "#2de2e6" : "#3b82f6";
        const WARN  = ROMULUS ? "#ff3b30" : "#e74c3c";
        const MUTED = ROMULUS ? "#3d4b3d" : "#49525e";
        const DIM   = ROMULUS ? "#5c6d5c" : "#6b7a88";

        // Colour carries the MEANING of a field, not its position, so the
        // same palette reads identically across four protocols that share
        // no structure.
        const KIND = {
            start: AMBER, stop: DIM, bit: TRACE, addr: CYAN, data: TRACE,
            parity: CYAN, ack: TRACE, nack: WARN, error: WARN, lose: WARN,
        };
        const colourOf = s => KIND[s.kind] ?? TRACE;

        const tEnd = fo.tEnd || 1;
        const emphasis = config.emphasis ?? "decode";

        function draw(elapsed) {
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            const U = useDPR;
            const mono = (s, w = 400) => `${w} ${s * U}px ${FONT}`;
            ctx.clearRect(0, 0, W, H);

            const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, durationMs)));
            const now = progress * tEnd;

            // ── header ───────────────────────────────────────────────────
            ctx.textAlign = "left";
            ctx.fillStyle = AMBER;
            ctx.font = mono(12, 700);
            ctx.fillText(`WY-BUS // ${fo.protocol.toUpperCase()}`, 18 * U, 26 * U);

            ctx.font = mono(9);
            ctx.fillStyle = DIM;
            ctx.fillText(fo.name.toUpperCase(), 18 * U, 42 * U);

            if (fo.perturbed && fo.perturbNote) {
                ctx.fillStyle = WARN;
                ctx.font = mono(9, 700);
                ctx.fillText(fo.perturbNote.toUpperCase(), 18 * U, 58 * U);
            }

            // ── geometry ─────────────────────────────────────────────────
            // The label gutter is sized from the WIDEST label rather than
            // a constant: "ECU A" and "SCLK" need very different room, and
            // a fixed gutter either clips CAN or wastes a tenth of the
            // width on UART.
            ctx.font = mono(9, 700);
            let gutter = 0;
            lines.forEach(l => {
                gutter = Math.max(gutter, ctx.measureText(l.label.toUpperCase()).width);
            });
            const x0 = 18 * U + gutter + 10 * U;
            const x1 = W - 18 * U;
            const span = x1 - x0;
            const xOf = t => x0 + (t / tEnd) * span;

            const top = (fo.perturbed ? 84 : 72) * U;
            const bottom = H - 165 * U;
            // Lanes are CAPPED and then CENTRED in what is left. Capping
            // alone pinned a one-wire UART frame to the top of the card
            // with two thirds of the height empty beneath it; centring
            // alone would have stretched a single lane across the whole
            // panel, which reads as a chart rather than as a wire.
            const laneH = Math.min((bottom - top) / lines.length, 104 * U);
            // Lanes start at the top and the readout follows DIRECTLY
            // beneath them. Anchoring the two to opposite ends of the card
            // left a one-wire UART frame with a third of the panel empty
            // in the middle, and the leftover space is better spent at the
            // bottom, where the journey's own title overlay sits anyway.
            const laneTop = top;
            const laneBottom = laneTop + laneH * lines.length;
            const amp = Math.min(laneH * 0.32, 34 * U);

            const cur = steps.find(s => now >= s.t0 && now < s.t1)
                     ?? (now >= tEnd ? steps[steps.length - 1] : null);

            // ── lanes ────────────────────────────────────────────────────
            lines.forEach((line, li) => {
                const yMid = laneTop + laneH * (li + 0.5);
                const yHi = yMid - amp, yLo = yMid + amp;

                ctx.fillStyle = DIM;
                ctx.font = mono(9, 700);
                ctx.textAlign = "left";
                ctx.fillText(line.label.toUpperCase(), 18 * U, yMid + 3 * U);

                // Baseline, so an idle-high line is still visibly a line.
                ctx.strokeStyle = "rgba(120,130,142,0.10)";
                ctx.lineWidth = 1 * U;
                ctx.beginPath(); ctx.moveTo(x0, yLo); ctx.lineTo(x1, yLo); ctx.stroke();

                // The trace is drawn in two passes: everything, dim, then
                // the elapsed part bright. Drawing only the elapsed part
                // would leave the viewer with no idea how much frame is
                // left, which on a 20-step I2C write reads as the card
                // having finished early.
                const paint = (untilT, colour, width, alpha) => {
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = colour;
                    ctx.lineWidth = width;
                    ctx.lineJoin = "miter";
                    ctx.beginPath();
                    let lastY = levelAt(line, 0) ? yHi : yLo;
                    ctx.moveTo(x0, lastY);
                    for (const [t, v] of line.edges) {
                        if (t > untilT) break;
                        const x = xOf(t), y = v ? yHi : yLo;
                        if (y !== lastY) { ctx.lineTo(x, lastY); ctx.lineTo(x, y); lastY = y; }
                        else ctx.lineTo(x, y);
                    }
                    const xe = xOf(Math.min(untilT, tEnd));
                    ctx.lineTo(xe, lastY);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                };
                paint(tEnd, MUTED, 1.4 * U, 0.55);
                paint(now, TRACE, 2.2 * U, 1);
            });

            const laneY = id => {
                const i = lines.findIndex(l => l.id === id);
                return laneTop + laneH * ((i < 0 ? lines.length - 1 : i) + 0.5);
            };

            // ── sample ticks ─────────────────────────────────────────────
            // Where the RECEIVER looked. The whole second stage is legible
            // from these alone: the ticks have moved off the valid window.
            steps.forEach(s => {
                if (s.sampleAt === undefined || s.sampleAt > now) return;
                const x = xOf(s.sampleAt), y = laneY(s.lane);
                const c = colourOf(s);
                ctx.strokeStyle = c;
                ctx.globalAlpha = s === cur ? 1 : 0.45;
                ctx.lineWidth = (s === cur ? 1.8 : 1) * U;
                ctx.beginPath();
                ctx.moveTo(x, y - amp - 5 * U); ctx.lineTo(x, y + amp + 5 * U);
                ctx.stroke();
                if (s === cur) {
                    ctx.fillStyle = c;
                    ctx.beginPath();
                    ctx.arc(x, y - amp - 7 * U, 2.6 * U, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            });

            // ── CAN: intent versus bus ───────────────────────────────────
            // A node that has lost arbitration is still drawn, greyed, for
            // the rest of the frame. Removing its lane would hide the one
            // thing worth seeing: it is sitting there silent while the
            // other one finishes, having lost nothing.
            if (fo.arbitration && cur && cur.losers && cur.losers.length) {
                const li = cur.losers[0];
                const y = laneTop + laneH * (li + 0.5);
                ctx.strokeStyle = WARN;
                ctx.lineWidth = 1.2 * U;
                ctx.setLineDash([3 * U, 3 * U]);
                ctx.strokeRect(xOf(cur.t0) - 3 * U, y - amp - 9 * U,
                               xOf(cur.t1) - xOf(cur.t0) + 6 * U, amp * 2 + 18 * U);
                ctx.setLineDash([]);
            }

            // ── playhead ─────────────────────────────────────────────────
            const px = xOf(Math.min(now, tEnd));
            ctx.strokeStyle = AMBER;
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1 * U;
            ctx.beginPath();
            ctx.moveTo(px, laneTop - 10 * U);
            ctx.lineTo(px, laneTop + laneH * lines.length + 10 * U);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // ── current field ───────────────────────────────────────────
            let y = laneBottom + 34 * U;
            ctx.textAlign = "left";
            if (cur) {
                ctx.fillStyle = colourOf(cur);
                ctx.font = mono(15, 700);
                const val = cur.value !== undefined && cur.value !== null
                    ? `  ${cur.value}` : "";
                ctx.fillText(cur.name.toUpperCase() + val, 18 * U, y);
                if (cur.note) {
                    y += 15 * U;
                    ctx.fillStyle = DIM;
                    ctx.font = mono(9);
                    ctx.fillText(cur.note, 18 * U, y);
                }
            }

            // ── readout ─────────────────────────────────────────────────
            y += 32 * U;
            if (emphasis === "decode") {
                const done = steps.filter(s =>
                    s.sampleAt !== undefined && s.sampleAt <= now &&
                    ["bit", "addr", "data", "parity"].includes(s.kind));
                const bits = done.map(s => s.value).filter(v => v === 0 || v === 1);

                ctx.fillStyle = DIM;
                ctx.font = mono(8);
                // Labelled as WIRE ORDER, because for UART it is not the
                // byte: the line sends least-significant first, so these
                // digits are the reverse of the number they spell. Showing
                // them unlabelled invited exactly that misreading.
                ctx.fillText("AS SAMPLED, IN WIRE ORDER", 18 * U, y);
                y += 16 * U;

                ctx.fillStyle = TRACE;
                ctx.font = mono(13, 700);
                ctx.fillText(bits.slice(-24).join("") || "\u2014", 18 * U, y);
                y += 20 * U;

                ctx.fillStyle = progress >= 0.999 ? AMBER : DIM;
                ctx.font = mono(11, 700);
                ctx.fillText(progress >= 0.999 ? fo.summary : `${bits.length} ${fo.vocabulary.edges}`,
                             18 * U, y);
            } else {
                const entries = Object.entries(fo.readout ?? {});
                ctx.font = mono(10);
                entries.slice(0, 4).forEach(([k, v]) => {
                    ctx.fillStyle = DIM;
                    ctx.fillText(k.toUpperCase(), 18 * U, y);
                    ctx.fillStyle = TRACE;
                    ctx.textAlign = "right";
                    // Long readout values wrap off the card, so they are
                    // trimmed rather than allowed to run under the label.
                    const txt = String(v);
                    ctx.fillText(txt.length > 30 ? txt.slice(0, 29) + "\u2026" : txt,
                                 W - 18 * U, y);
                    ctx.textAlign = "left";
                    y += 15 * U;
                });
            }

            // ── verdict ─────────────────────────────────────────────────
            // Only once the frame has finished. Shown earlier it would be
            // a spoiler, and on the broken card it would give the answer
            // away before the sample ticks have had a chance to show why.
            if (progress >= 0.999 && fo.verdict) {
                y += 26 * U;
                const ok = fo.verdict.ok;
                ctx.fillStyle = ok ? TRACE : WARN;
                ctx.font = mono(10, 700);
                ctx.fillText(ok ? "DECODED CLEAN"
                                : `EXPECTED ${fo.verdict.expected}`, 18 * U, y);
                if (!ok && fo.verdict.why) {
                    y += 14 * U;
                    ctx.fillStyle = DIM;
                    ctx.font = mono(9);
                    ctx.fillText(fo.verdict.why, 18 * U, y);
                }
                if (fo.errors && fo.errors.length) {
                    y += 14 * U;
                    ctx.fillStyle = WARN;
                    ctx.font = mono(9);
                    ctx.fillText(fo.errors[0], 18 * U, y);
                }
            }

            // ── footer ───────────────────────────────────────────────────
            ctx.textAlign = "center";
            ctx.fillStyle = DIM;
            ctx.font = mono(8);
            const us = Math.round(now);
            ctx.fillText(`T+${us}µs  /  ${Math.round(tEnd)}µs`
                       + `   ·   ${fo.stepCount} ${fo.vocabulary.edges}`,
                         W / 2, H - 4 * U);

            if (ROMULUS) {
                ctx.fillStyle = "rgba(0,0,0,0.22)";
                for (let yy = 0; yy < H; yy += 3 * U) ctx.fillRect(0, yy, W, 1.2 * U);
            }
        }

        draw(0);
        startSweepLoop(sampleId, durationMs, draw);
    },
});

})();
