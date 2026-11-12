// ---------------------------------------------------------------------------
// renderers/exchange_view.js
//
// Two parties, side by side, passing packets. Each packet assembles byte
// by byte at the sender, crosses the corridor between them, and lands as
// a line in a transcript that accumulates down the card.
//
// Built for ble_connect, deliberately generic: anything that is a
// request/response conversation wants this picture. The backlog's Matter
// commissioning (item 18, "a message sequence with the failure branches
// shown"), I2C arbitration (9), CAN error frames (10) and a TCP handshake
// all fit the same contract.
//
// THE CONTRACT, so other journeys can reuse it
//   finalOutput.parties    { left: {id,label,sub}, right: {id,label,sub} }
//   finalOutput.exchanges  [{ name, from, to, fields:[{label,bytes,role}],
//                             pduBytes, onAirBytes, gapBeforeUs, gapKind,
//                             note, collapsed }]
//   finalOutput.roleBytes, roleLabels    the colour legend
//   config.glossary        [{acronym, full, plain}]   optional, and on
//                          the CONFIG not the output -- a glossary is a
//                          view concern, supplied by the recipe
//
// WHY COMPLETED PACKETS STAY ON SCREEN
//   A message-sequence diagram's whole value is that you can see the
//   shape of the conversation -- who spoke, how often, in which
//   direction. An animation that showed one packet at a time and cleared
//   it would be strictly worse than the static diagram it replaces. So
//   finished exchanges compress to one dim line each and stay, and the
//   packets still to come are drawn as empty outlines, so the length of
//   the conversation is visible from the first frame.
//
// WHY THE ACTIVE ROW IS THE ONLY DETAILED ONE
//   Eleven packets with every field labelled is unreadable at 390px. The
//   active row expands to show coloured fields and labels; the rest are
//   a name, a direction and a bar. Detail follows attention.
//
// THE ONE PLACE THIS IS NOT TO SCALE, AND IT SAYS SO
//   Transit duration is NOT proportional to the gap. The real gaps in
//   this journey differ by two hundred times -- 150 microseconds inside a
//   connection event against 30 milliseconds between them -- so a
//   faithful animation would spend its entire length on the last gap.
//   Instead every exchange gets an equal slice, the gap is drawn as a
//   bar whose WIDTH is logarithmic in its duration, and the real figure
//   is printed beside it. The canvas states this in words rather than
//   letting a viewer assume the timing is honest.
//
//   Propagation time is not modelled at all, because over a metre it is
//   three nanoseconds. What the transit represents is turnaround.
//
// COLOUR IS NOT THE ONLY CHANNEL
//   Every field carries its byte count, the active row labels each field
//   in text, and direction is shown by an arrow glyph as well as by which
//   side the packet starts from.
//
// Self-registers. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Fractions of one exchange's time slice.
const BUILD_FRAC   = 0.55;
const TRANSIT_FRAC = 0.33;
// remainder is the arrived hold

// Glossary rotation, milliseconds per term.
const TERM_MS = 2600;

registerRenderingAlgorithm("exchange_view", {

    // View preferences, so they live here rather than on the DSPE.
    choices(envelope) {
        return [
            {
                key: "showGlossary",
                label: "Terms",
                values: [true, false],
                value: true,
                display: { true: "shown", false: "hidden" },
            },
        ];
    },

    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        if (dspOutput?.error) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">${dspOutput.error}</p>`;
            return;
        }

        const fo = dspOutput.finalOutput ?? {};
        const ex = fo.exchanges ?? [];
        const parties = fo.parties;
        if (!ex.length || !parties?.left || !parties?.right) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">exchange_view needs finalOutput.exchanges and .parties.</p>`;
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

        // RESIZING A CANVAS CLEARS IT, so the observer MUST repaint.
        //
        // Without the draw() below the card renders blank on load and
        // only appears once something else triggers a frame -- a seek, or
        // the sweep's first tick. The sequence is: draw(0) paints into a
        // canvas sized from the fallback because the container has not
        // been laid out yet, layout settles, this fires, the canvas is
        // wiped, and nothing repaints. A card the feed has suspended
        // never gets that rescuing frame at all.
        //
        // Repainted at lastT rather than 0 so a resize mid-stage does not
        // jump the animation back to the beginning.
        new ResizeObserver(e => {
            const { width, height } = e[0].contentRect;
            if (!width || !height) return;
            canvas.width  = Math.round(width  * useDPR);
            canvas.height = Math.round(height * useDPR);
            canvas.style.width = width + "px"; canvas.style.height = height + "px";
            draw(lastT);
        }).observe(container);

        // Last position drawn, so the resize repaint lands where the
        // animation actually is.
        let lastT = 0;

        const root   = getComputedStyle(document.documentElement);
        const accent = (typeof THEMES !== "undefined" && THEMES[themeIndex]?.traceColor)
                       || root.getPropertyValue("--accent").trim() || "#4aa3d8";
        const MUTED = "#5c6470";
        const DEAD  = "#3a4049";
        const WARN  = "#e0a030";

        // One colour per role. payload takes the theme accent, because it
        // is the thing the viewer came to follow.
        const ROLE_COLOUR = {
            addressing: "#4a8fd0",
            timing:     "#e0a030",
            channels:   "#9b7fe0",
            framing:    "#6c7684",
            payload:    accent,
        };

        const glossary = config.glossary ?? [];
        const showGlossary = config.showGlossary !== false && glossary.length > 0;
        const N = ex.length;

        // Scale every packet in this stage to the stage's largest, so bar
        // lengths are comparable within a card. Rescaling per packet would
        // make a 10-byte empty PDU look the same size as a 44-byte
        // CONNECT_IND, which is the one comparison worth having.
        const maxBytes = Math.max(...ex.map(x => x.onAirBytes), 1);

        // Gap bars are logarithmic in duration. Linear would make every
        // 150 us gap a sub-pixel sliver next to the 30 ms ones.
        const gaps = ex.map(x => x.gapBeforeUs).filter(g => g > 0);
        const gapLo = gaps.length ? Math.min(...gaps) : 1;
        const gapHi = gaps.length ? Math.max(...gaps) : 1;
        const gapFrac = g => {
            if (g <= 0) return 0;
            if (gapHi === gapLo) return 0.5;
            return 0.18 + 0.82 * (Math.log(g / gapLo) / Math.log(gapHi / gapLo));
        };

        const fmtUs = us => us >= 1000 ? `${(us / 1000).toFixed(us >= 10000 ? 0 : 1)} ms`
                                       : `${us.toFixed(0)} µs`;

        function draw(t) {
            lastT = t;
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            const M = { top: 90 * useDPR, left: 12 * useDPR, right: 12 * useDPR };
            const labelW = 58 * useDPR;
            const corridorX0 = M.left + labelW;
            const corridorX1 = W - M.right - labelW;
            const corridorW = corridorX1 - corridorX0;

            const glossH = showGlossary ? 48 * useDPR : 0;

            // MEASURED, not assumed. At the larger type the five role
            // labels no longer fit one line -- "the actual content" alone
            // is a third of a phone's width -- so the legend wraps and the
            // footer is sized for however many lines that takes. A fixed
            // footer height would clip the last line or leave a gap,
            // depending on which stage you were looking at.
            const LEGEND_PX = 10.5 * useDPR;
            const LEGEND_LINE_H = 17 * useDPR;
            ctx.font = `${LEGEND_PX}px "IBM Plex Mono", monospace`;
            const legendItems = ["addressing", "timing", "channels", "framing", "payload"]
                .filter(r => r in (fo.roleBytes ?? {}))
                .map(r => {
                    const label = fo.roleLabels?.[r] ?? r;
                    return { role: r, label,
                             w: 14 * useDPR + ctx.measureText(label).width + 14 * useDPR };
                });
            const legendAvail = W - 12 * useDPR - 12 * useDPR - 58 * useDPR - 58 * useDPR + 116 * useDPR;
            const legendLines = [[]];
            let lineW = 0;
            for (const it of legendItems) {
                if (lineW + it.w > legendAvail && legendLines[legendLines.length - 1].length) {
                    legendLines.push([]); lineW = 0;
                }
                legendLines[legendLines.length - 1].push(it);
                lineW += it.w;
            }
            const footH = (30 * useDPR) + legendLines.length * LEGEND_LINE_H + 18 * useDPR;

            // Rows EXPAND to fill the band, capped so two of them do not
            // become absurd, and the block is CENTRED when it does not
            // fill. The previous hard 30px cap was the "so much space and
            // yet clogging" problem: stage 3 has two rows and used 60px of
            // a 250px band, while stage 6 crammed eleven into the same
            // space. Filling and centring fixes both ends at once.
            const bandTop = M.top;
            const bandH = H - bandTop - glossH - footH;
            const rowH = Math.min(52 * useDPR, bandH / N);

            // MEASURED CONSTRAINT, not a preference. A readable bar plus a
            // readable name beneath it needs about 44px of row. Stage 6 has
            // eleven packets and cannot have both on a phone, so below that
            // threshold the per-row names are dropped and the header
            // carries the active packet's name instead. The bars still show
            // direction, size and order -- which is what the transcript is
            // for -- and the name you actually need is the current one.
            const roomForNames = rowH >= 44 * useDPR;

            const rowsH = rowH * N;
            const rowsTop = bandTop + (bandH - rowsH) / 2;
            const barH = Math.max(12 * useDPR, Math.min(24 * useDPR, rowH * 0.55));
            // How far above its own bar a gap line can sit without
            // crossing into the row above. Derived rather than fixed: a
            // flat 7px offset cleared the row at stage 1 and poked 4px
            // into it at stage 6, which is the same class of mistake as
            // the hardcoded 80px dead zone in the rail.
            const gapLift = Math.min(7 * useDPR, (rowH - barH) / 2 - 2 * useDPR);
            // Under about 3px of lift the line is touching its own bar and
            // reads as part of it, so on cramped rows only the ACTIVE
            // packet gets one -- which is the only row carrying a figure
            // anyway, and where the eye already is.
            const gapLinesForAll = gapLift >= 3 * useDPR;

            // ── which exchange, and where within it ───────────────────
            const slice = 1 / N;
            const active = Math.min(N - 1, Math.floor(t / slice));
            const within = Math.min(1, (t - active * slice) / slice);
            const building = Math.min(1, within / BUILD_FRAC);
            const transit  = within <= BUILD_FRAC ? 0
                : Math.min(1, (within - BUILD_FRAC) / TRANSIT_FRAC);

            // ── party columns ─────────────────────────────────────────
            ctx.textAlign = "left";
            ctx.fillStyle = "#cfd6de";
            ctx.font = `600 ${13.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(parties.left.label, M.left, 26 * useDPR);
            ctx.textAlign = "right";
            ctx.fillText(parties.right.label, W - M.right, 26 * useDPR);

            ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillStyle = MUTED;
            ctx.textAlign = "left";
            ctx.fillText(parties.left.sub ?? "", M.left, 38 * useDPR);
            ctx.textAlign = "right";
            ctx.fillText(parties.right.sub ?? "", W - M.right, 38 * useDPR);

            // the two edges of the corridor, so direction reads spatially
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.lineWidth = 1 * useDPR;
            for (const x of [corridorX0, corridorX1]) {
                ctx.beginPath();
                ctx.moveTo(x, bandTop - 6 * useDPR);
                ctx.lineTo(x, bandTop + bandH);
                ctx.stroke();
            }

            // ── rows ──────────────────────────────────────────────────
            for (let i = 0; i < N; i++) {
                const x = ex[i];
                const y = rowsTop + i * rowH;
                const cy = y + rowH / 2;
                const fromLeft = x.from === parties.left.id;
                const w = Math.max(10 * useDPR, (x.onAirBytes / maxBytes) * corridorW * 0.86);

                // not reached yet: an empty outline, so the length of the
                // conversation is known from the first frame
                if (i > active) {
                    const px = fromLeft ? corridorX0 + 4 * useDPR
                                        : corridorX1 - 4 * useDPR - w;
                    ctx.strokeStyle = DEAD;
                    ctx.lineWidth = 1 * useDPR;
                    ctx.setLineDash([3 * useDPR, 3 * useDPR]);
                    ctx.strokeRect(px, cy - barH / 2, w, barH);
                    ctx.setLineDash([]);
                    continue;
                }

                // the gap that preceded this packet, as a bar whose width
                // is logarithmic in its real duration
                if (x.gapBeforeUs > 0 && (gapLinesForAll || i === active)) {
                    // The wait before this packet went out. Width is
                    // logarithmic in the duration because the real gaps
                    // span 200x -- a linear bar would make every 150 us
                    // T_IFS a sub-pixel sliver beside the 30 ms ones.
                    //
                    // POSITIONED RELATIVE TO ITS OWN BAR, not to the row's
                    // top edge. At the row's top it sat in the PREVIOUS
                    // row's space, and once the fonts grew the label
                    // collided with that row's name -- both were centred on
                    // the corridor, so they landed on each other exactly.
                    const gw = gapFrac(x.gapBeforeUs) * corridorW * 0.5;
                    const gx = corridorX0 + (corridorW - gw) / 2;
                    const gy = cy - barH / 2 - Math.max(3 * useDPR, gapLift);
                    ctx.strokeStyle = x.gapKind === "model" ? MUTED : WARN;
                    ctx.lineWidth = 1.4 * useDPR;
                    ctx.setLineDash(x.gapKind === "model"
                                    ? [2 * useDPR, 2 * useDPR] : []);
                    ctx.beginPath();
                    ctx.moveTo(gx, gy); ctx.lineTo(gx + gw, gy);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (i === active) {
                        // BESIDE the line, not above it. There is no
                        // vertical room above a bar that fills 55% of its
                        // row, and sideways there is plenty.
                        ctx.fillStyle = x.gapKind === "model" ? MUTED : WARN;
                        ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
                        const gTxt = fmtUs(x.gapBeforeUs)
                            + (x.gapKind === "model" ? " *" : "");
                        const fits = gx + gw + 6 * useDPR
                            + ctx.measureText(gTxt).width < corridorX1;
                        ctx.textAlign = fits ? "left" : "right";
                        ctx.fillText(gTxt,
                            fits ? gx + gw + 6 * useDPR : gx - 6 * useDPR,
                            gy + 3.5 * useDPR);
                    }
                }

                // horizontal position: at the sender until transit, then
                // interpolated across, then parked at the receiver
                const startX = fromLeft ? corridorX0 + 4 * useDPR
                                        : corridorX1 - 4 * useDPR - w;
                const endX   = fromLeft ? corridorX1 - 4 * useDPR - w
                                        : corridorX0 + 4 * useDPR;
                const prog = i < active ? 1 : transit;
                // ease so the packet leaves and arrives softly rather than
                // sliding at constant speed, which reads as mechanical
                const eased = prog < 0.5 ? 2 * prog * prog
                                         : 1 - Math.pow(-2 * prog + 2, 2) / 2;
                const px = startX + (endX - startX) * eased;

                const isActive = i === active;
                const alpha = isActive ? 1 : 0.4;

                // the bytes, as filled boxes divided by field
                let fx = px;
                const revealBytes = isActive && transit === 0
                    ? building * x.pduBytes : x.pduBytes;
                let drawn = 0;
                ctx.globalAlpha = alpha;
                if (x.fields.length === 0) {
                    // an empty PDU has no fields; draw the framing alone so
                    // it is visibly a packet and visibly carrying nothing
                    ctx.fillStyle = ROLE_COLOUR.framing;
                    ctx.fillRect(px, cy - barH / 2, w, barH);
                    ctx.strokeStyle = "rgba(0,0,0,0.45)";
                    ctx.lineWidth = 1 * useDPR;
                    ctx.strokeRect(px, cy - barH / 2, w, barH);
                } else {
                    for (const fl of x.fields) {
                        const fw = (fl.bytes / x.onAirBytes) * w;
                        const show = Math.max(0, Math.min(fl.bytes, revealBytes - drawn));
                        if (show > 0) {
                            const sw = (show / fl.bytes) * fw;
                            ctx.fillStyle = ROLE_COLOUR[fl.role] ?? MUTED;
                            ctx.fillRect(fx, cy - barH / 2, sw, barH);
                            ctx.strokeStyle = "rgba(0,0,0,0.45)";
                            ctx.lineWidth = 0.8 * useDPR;
                            ctx.strokeRect(fx, cy - barH / 2, sw, barH);
                        }
                        drawn += fl.bytes;
                        fx += fw;
                    }
                    // the framing the radio adds, always shown as the tail
                    const framingW = w - (x.pduBytes / x.onAirBytes) * w;
                    if (framingW > 0.5) {
                        ctx.fillStyle = ROLE_COLOUR.framing;
                        ctx.globalAlpha = alpha * 0.55;
                        ctx.fillRect(fx, cy - barH / 2, framingW, barH);
                        ctx.globalAlpha = alpha;
                        ctx.strokeStyle = "rgba(0,0,0,0.45)";
                        ctx.lineWidth = 0.8 * useDPR;
                        ctx.strokeRect(fx, cy - barH / 2, framingW, barH);
                    }
                }
                ctx.globalAlpha = 1;

                // name, direction arrow and size
                ctx.globalAlpha = isActive ? 1 : 0.55;
                ctx.fillStyle = isActive ? "#cfd6de" : MUTED;
                ctx.font = `${isActive ? 600 : 400} ${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = fromLeft ? "left" : "right";
                const nameX = fromLeft ? M.left : W - M.right;
                ctx.fillText(fromLeft ? "→" : "←", nameX, cy + 3 * useDPR);

                ctx.textAlign = "center";
                ctx.fillText(
                    `${x.name}  ${x.onAirBytes}B`
                    + (x.collapsed ? `   ×${x.collapsed + 1}` : ""),
                    corridorX0 + corridorW / 2,
                    cy + barH / 2 + 13 * useDPR);
                ctx.globalAlpha = 1;
            }

            // ── the active packet, named in the header ────────────────
            // Both lines, always. When rows are tight this is the ONLY
            // place the packet's name appears, so showing the note instead
            // of the name -- which the first version did -- left the card
            // with no way to tell you what you were looking at.
            const a = ex[active];
            ctx.textAlign = "left";
            ctx.fillStyle = WARN;
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${a.name}  ·  ${a.onAirBytes} B`, M.left, 60 * useDPR);
            if (a.note) {
                ctx.fillStyle = MUTED;
                ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(a.note, M.left, 76 * useDPR);
            }

            // ── glossary, one term at a time ──────────────────────────
            if (showGlossary) {
                const terms = glossary;
                // durationMs is guarded: if it ever arrives undefined the
                // arithmetic goes NaN, terms[NaN] is undefined, and reading
                // .acronym throws -- aborting draw() partway and leaving a
                // half-painted card.
                const dur = Number.isFinite(durationMs) && durationMs > 0
                    ? durationMs : 8000;
                const idx = Math.abs(Math.floor((t * dur) / TERM_MS)) % terms.length;
                const term = terms[idx] ?? terms[0];
                const gy = H - footH - glossH + 16 * useDPR;
                ctx.textAlign = "left";
                ctx.fillStyle = accent;
                ctx.font = `600 ${12.5 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${term.acronym} — ${term.full}`, M.left, gy);
                ctx.fillStyle = MUTED;
                ctx.font = `${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(term.plain, M.left, gy + 17 * useDPR);
            }

            // ── role legend ───────────────────────────────────────────
            const legendTop = H - footH + 16 * useDPR;
            ctx.font = `${LEGEND_PX}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "left";
            legendLines.forEach((line, li) => {
                let lx = M.left;
                const ly = legendTop + li * LEGEND_LINE_H;
                for (const it of line) {
                    ctx.fillStyle = ROLE_COLOUR[it.role];
                    ctx.fillRect(lx, ly - 9 * useDPR, 10 * useDPR, 10 * useDPR);
                    ctx.fillStyle = MUTED;
                    ctx.fillText(it.label, lx + 14 * useDPR, ly);
                    lx += it.w;
                }
            });
            const ly = legendTop + (legendLines.length - 1) * LEGEND_LINE_H;

            // The one honesty note the design requires. See the header.
            ctx.fillStyle = DEAD;
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "left";
            ctx.fillText("transit is not to scale; gap figures are real, * = model",
                         M.left, ly + 16 * useDPR);

            // ── the closing claim ─────────────────────────────────────
            if (t > 0.92) {
                const tot = fo.totals ?? {};
                ctx.textAlign = "right";
                ctx.font = `600 ${11 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillStyle = WARN;
                ctx.fillText(
                    fo.stage === 6
                        ? `${tot.journeyPacketCount} packets, ${tot.journeyOnAirBytes} B, `
                          + `${(tot.journeyElapsedUs / 1000).toFixed(0)} ms — for 2 bytes`
                        : `${N} packets, ${tot.stageOnAirBytes} B on air`,
                    W - M.right, ly + 16 * useDPR);
            }
        }

        draw(0);
        startSweepLoop(sampleId, durationMs, e => draw(Math.min(1, e / durationMs)));
    },
});

})();
