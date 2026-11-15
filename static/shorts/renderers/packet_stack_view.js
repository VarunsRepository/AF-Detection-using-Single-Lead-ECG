// ---------------------------------------------------------------------------
// renderers/packet_stack_view.js
//
// Two bytes of payload sitting inside twenty-three bytes on air.
//
// WHY THE BAR IS SCALED TO THE FINAL PACKET FROM THE FIRST FRAME
//   This is the whole design decision, and getting it wrong destroys the
//   card. If each stage rescaled the bar to fit its own current size,
//   the payload would be full width on stage 1 and full width again on
//   stage 6 -- the picture would be identical and teach nothing. Scaled
//   to the FINAL on-air size throughout, the payload starts as a stub
//   occupying a twelfth of the plot and never grows. Every wrapper that
//   arrives makes it visibly smaller as a fraction of the whole.
//
//   The dim outline of the final extent is drawn from frame one for the
//   same reason: the empty space is the message.
//
// WHY THE FIELDS ARE IN TRUE ON-AIR ORDER
//   Preamble, access address, link-layer header, L2CAP header, ATT
//   header, payload, MIC, CRC. Drawing them in stack order instead would
//   be easier and would misrepresent the packet -- some layers prepend
//   and one appends, and a viewer who later opens a sniffer should
//   recognise what they see. Nothing moves between stages: each field
//   occupies its final position from the start and is simply unfilled
//   until its layer arrives.
//
// WHY THE PAYLOAD FRACTION GETS ITS OWN STRIP
//   The ratio is the actionable number -- it is what makes batching
//   obviously correct rather than merely advisable -- and a percentage
//   read off a bar by eye is not convincing. The strip states it.
//
// COLOUR IS NOT THE ONLY CHANNEL
//   Overhead fields are hatched as well as dimmed, and the payload is
//   the only solid-filled block. A viewer who cannot separate the hues
//   can still see which part of the packet anyone wanted.
//
// Reads finalOutput from ble_encapsulation. Self-registers. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// True on-air order, with the layer that owns each field. The widths are
// read from the DSPE rather than restated here -- this table is about
// SEQUENCE, which is a presentation concern, and the DSPE owns the
// arithmetic. A field whose layer contributed nothing (MIC on an
// unencrypted link) simply does not appear.
const ON_AIR_ORDER = [
    { layer: "radio", match: "preamble" },
    { layer: "radio", match: "access address" },
    { layer: "ll",    match: "LLID" },
    { layer: "ll",    match: "length" },
    { layer: "l2cap", match: "length" },
    { layer: "l2cap", match: "CID" },
    { layer: "att",   match: "opcode" },
    { layer: "att",   match: "handle" },
    { layer: "payload", match: "value" },
    { layer: "mic",   match: "MIC" },
    { layer: "radio", match: "CRC" },
];

const LAYER_INDEX = { payload: 0, att: 1, l2cap: 2, ll: 3, mic: 4, radio: 5 };

registerRenderingAlgorithm("packet_stack_view", {

    // A view preference, so it lives on the renderer: whether every
    // field carries its byte count. At two bytes the labels are the
    // interesting part; on a batched 41-byte packet they crowd.
    choices(envelope) {
        return [
            {
                key: "showFieldBytes",
                label: "Bytes",
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
        const layers = fo.layers ?? [];
        if (layers.length !== 6) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">packet_stack_view expects six layers from ble_encapsulation.</p>`;
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
                       || root.getPropertyValue("--accent").trim() || "#5cc24a";
        const WARN  = "#e0a030";
        const MUTED = "#5c6470";
        const DEAD  = "#3a4049";
        const OVER  = "#6c7684";   // overhead fields

        const upTo       = fo.upToLayer ?? 5;
        const onAirBytes = fo.onAirBytes ?? 23;
        const payloadB   = fo.payloadBytes ?? 2;
        const showBytes  = config.showFieldBytes !== false;

        // ── build the field list once, in on-air order ────────────────
        const byId = {};
        for (const l of layers) byId[l.id] = l;

        const fields = [];
        let cursor = 0;
        for (const spec of ON_AIR_ORDER) {
            const layer = byId[spec.layer];
            if (!layer) continue;
            const f = (layer.fields ?? []).find(x => x.label.includes(spec.match));
            if (!f || f.bytes <= 0) continue;        // e.g. MIC when unencrypted
            fields.push({
                label: f.label,
                bytes: f.bytes,
                offset: cursor,
                layerId: spec.layer,
                layerIndex: LAYER_INDEX[spec.layer],
                isPayload: spec.layer === "payload",
            });
            cursor += f.bytes;
        }
        // If this ever disagrees with the DSPE, the picture is lying
        // about the packet. Loud rather than silently truncated.
        if (cursor !== onAirBytes) {
            console.warn(`packet_stack_view: field widths sum to ${cursor} but `
                       + `the DSPE says ${onAirBytes} bytes on air. Check ON_AIR_ORDER.`);
        }

        const fmtUs = us => us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${us.toFixed(0)} µs`;

        function hatch(ctx, x, y, w, h, colour) {
            ctx.save();
            ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1 * useDPR;
            const pitch = 5 * useDPR;
            for (let d = -h; d < w + h; d += pitch) {
                ctx.beginPath();
                ctx.moveTo(x + d, y + h);
                ctx.lineTo(x + d + h, y);
                ctx.stroke();
            }
            ctx.restore();
        }

        function draw(t) {
            lastT = t;
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            const M = { top: 68 * useDPR, left: 18 * useDPR, right: 18 * useDPR };
            const plotW = W - M.left - M.right;
            const barH  = 54 * useDPR;
            const barY  = M.top;

            // Bytes to pixels, FIXED to the final packet. See the header
            // comment -- this is the one thing not to "improve".
            const toX = b => M.left + (b / onAirBytes) * plotW;
            const bw  = b => (b / onAirBytes) * plotW;

            // The newest layer fades in over the first 45% of the stage,
            // so the eye is drawn to what changed rather than having to
            // diff two cards from memory.
            const reveal = Math.min(1, t / 0.45);

            // ── the final extent, dim, from frame one ─────────────────
            ctx.strokeStyle = DEAD;
            ctx.lineWidth = 1.5 * useDPR;
            ctx.setLineDash([4 * useDPR, 4 * useDPR]);
            ctx.strokeRect(M.left, barY, plotW, barH);
            ctx.setLineDash([]);

            ctx.fillStyle = MUTED;
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "right";
            ctx.fillText(`${onAirBytes} bytes on air`, M.left + plotW, barY - 6 * useDPR);

            // ── the fields ────────────────────────────────────────────
            for (const f of fields) {
                if (f.layerIndex > upTo) continue;

                const x = toX(f.offset), w = bw(f.bytes);
                const isNew = f.layerIndex === upTo;
                const a = isNew ? reveal : 1;

                if (f.isPayload) {
                    ctx.globalAlpha = a;
                    ctx.fillStyle = accent;
                    ctx.fillRect(x, barY, w, barH);
                    ctx.globalAlpha = 1;
                } else {
                    ctx.globalAlpha = a * 0.5;
                    ctx.fillStyle = OVER;
                    ctx.fillRect(x, barY, w, barH);
                    ctx.globalAlpha = a;
                    hatch(ctx, x, barY, w, barH, "rgba(255,255,255,0.10)");
                    ctx.globalAlpha = 1;
                }

                ctx.globalAlpha = a;
                ctx.strokeStyle = isNew ? WARN : "rgba(0,0,0,0.45)";
                ctx.lineWidth = (isNew ? 1.8 : 1) * useDPR;
                ctx.strokeRect(x, barY, w, barH);
                ctx.globalAlpha = 1;

                // Byte count inside the block only when it fits. A label
                // wider than its block is worse than no label.
                if (showBytes && w > 15 * useDPR) {
                    ctx.globalAlpha = a;
                    ctx.fillStyle = f.isPayload ? "#0d1117" : "#cfd6de";
                    ctx.font = `600 ${9.5 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.textAlign = "center";
                    ctx.fillText(String(f.bytes), x + w / 2, barY + barH / 2 + 3.5 * useDPR);
                    ctx.globalAlpha = 1;
                }
            }

            // ── what the newest layer added ───────────────────────────
            const cur = layers[upTo];
            ctx.textAlign = "left";
            ctx.fillStyle = upTo === 0 ? accent : WARN;
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(upTo === 0 ? cur.name : `+ ${cur.name}`, M.left, 26 * useDPR);

            ctx.fillStyle = MUTED;
            ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(cur.owner, M.left, 41 * useDPR);

            ctx.textAlign = "right";
            ctx.fillStyle = "#cfd6de";
            ctx.font = `600 ${15 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${cur.bytes} bytes`, M.left + plotW, 28 * useDPR);
            ctx.fillStyle = MUTED;
            ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(
                upTo === 0 ? cur.note
                           : `+${cur.added} this layer`,
                M.left + plotW, 43 * useDPR);

            // ── field names, below the bar, only where there is room ──
            let labelY = barY + barH + 14 * useDPR;
            ctx.font = `${8.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.textAlign = "center";
            for (const f of fields) {
                if (f.layerIndex > upTo) continue;
                const w = bw(f.bytes);
                if (w < 34 * useDPR) continue;
                ctx.fillStyle = f.isPayload ? accent : MUTED;
                ctx.fillText(f.label.split(" ")[0], toX(f.offset) + w / 2, labelY);
            }

            // ── the payload-fraction strip ────────────────────────────
            const stripY = barY + barH + 36 * useDPR;
            const stripH = 12 * useDPR;
            const frac = payloadB / cur.bytes;

            ctx.fillStyle = DEAD;
            ctx.fillRect(M.left, stripY, plotW, stripH);
            ctx.fillStyle = accent;
            ctx.fillRect(M.left, stripY, plotW * frac, stripH);
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = 1 * useDPR;
            ctx.strokeRect(M.left, stripY, plotW, stripH);

            ctx.textAlign = "left";
            ctx.fillStyle = MUTED;
            ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText("useful payload", M.left, stripY + stripH + 13 * useDPR);
            ctx.textAlign = "right";
            ctx.fillStyle = frac < 0.2 ? WARN : accent;
            ctx.font = `600 ${9.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${(100 * frac).toFixed(1)}%`,
                         M.left + plotW, stripY + stripH + 13 * useDPR);

            // ── airtime, once the packet is actually on air ───────────
            let infoY = stripY + stripH + 36 * useDPR;
            if (upTo === 5) {
                ctx.textAlign = "left";
                ctx.fillStyle = MUTED;
                ctx.font = `${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(
                    `airtime ${fmtUs(fo.airtimeUs ?? 0)} at LE ${fo.phy ?? "1M"}`,
                    M.left, infoY);
                infoY += 16 * useDPR;
            }

            // ── the batch comparison, only when batching ─────────────
            // Hidden at batchCount 1 rather than drawn as a degenerate
            // single bar: a comparison of a thing with itself reads as a
            // bug in the renderer.
            if ((fo.batchCount ?? 1) > 1 && upTo === 5) {
                const unb = fo.unbatchedOnAirBytes ?? onAirBytes;
                const cmpH = 11 * useDPR;
                const scale = plotW / unb;

                ctx.textAlign = "left";
                ctx.fillStyle = MUTED;
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${fo.batchCount} readings, sent separately`, M.left, infoY);
                infoY += 7 * useDPR;
                ctx.fillStyle = "rgba(231,76,60,0.55)";
                ctx.fillRect(M.left, infoY, unb * scale, cmpH);
                ctx.fillStyle = "#cfd6de";
                ctx.font = `600 ${8.5 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "right";
                ctx.fillText(`${unb} B`, M.left + unb * scale - 4 * useDPR,
                             infoY + cmpH - 2.5 * useDPR);

                infoY += cmpH + 14 * useDPR;
                ctx.textAlign = "left";
                ctx.fillStyle = MUTED;
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText("the same readings, batched", M.left, infoY);
                infoY += 7 * useDPR;
                ctx.fillStyle = accent;
                ctx.fillRect(M.left, infoY, onAirBytes * scale, cmpH);
                ctx.fillStyle = "#0d1117";
                ctx.font = `600 ${8.5 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.textAlign = "right";
                ctx.fillText(`${onAirBytes} B`,
                             M.left + onAirBytes * scale - 4 * useDPR,
                             infoY + cmpH - 2.5 * useDPR);
            }

            // ── the MTU warning, when the batch has outgrown it ──────
            if (fo.exceedsMtu) {
                ctx.textAlign = "center";
                ctx.fillStyle = "#e74c3c";
                ctx.font = `600 ${10 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(
                    `${payloadB} B exceeds the ${fo.attValueLimit} B ATT value limit`
                    + ` — negotiate the MTU up`,
                    W / 2, H - 26 * useDPR);
            }

            // ── the closing claim ────────────────────────────────────
            // Held to the last tenth so it reads as a conclusion rather
            // than a caption that was true before anything happened.
            if (t > 0.92) {
                ctx.textAlign = "center";
                ctx.font = `600 ${11.5 * useDPR}px "IBM Plex Mono", monospace`;
                if (upTo < 5) {
                    ctx.fillStyle = MUTED;
                    ctx.fillText(`${cur.bytes} bytes, and not on air yet`,
                                 W / 2, H - 9 * useDPR);
                } else if ((fo.batchCount ?? 1) > 1) {
                    ctx.fillStyle = accent;
                    ctx.fillText(
                        `${(fo.batchSavingRatio ?? 1).toFixed(1)}× less airtime, same data`,
                        W / 2, H - 9 * useDPR);
                } else {
                    ctx.fillStyle = WARN;
                    ctx.fillText(
                        `${payloadB} bytes of data cost ${onAirBytes} on air`
                        + `  —  ${(fo.overheadRatio ?? 0).toFixed(1)}×`,
                        W / 2, H - 9 * useDPR);
                }
            }
        }

        draw(0);
        startSweepLoop(sampleId, durationMs, e => draw(Math.min(1, e / durationMs)));
    },
});

})();
