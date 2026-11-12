// ---------------------------------------------------------------------------
// renderers/tx_timeline_view.js
//
// Lanes, segments and a playhead on a real time axis. Built for the BLE
// transmit path, but deliberately generic: the backlog names a timeline
// renderer as the highest-leverage one on the list because interrupt
// latency, priority inversion, rate-monotonic scheduling, DMA contention
// and the Linux boot sequence all want exactly this picture.
//
// THE CONTRACT, so other journeys can reuse it
//   finalOutput.lanes      [{ id, label, owner, segments: [{t0,t1,state,label}] }]
//   finalOutput.windowStartUs, windowUs    the visible span, microseconds
//   everything else is optional and specific to this pack:
//   events[], channels[], packet{}, timing{}, queue{}
//
// WHY TRUE SCALE, AND WHY SUB-PIXEL EVENTS BECOME TICKS
//   This is the point of the card. Every sequence diagram of a BLE
//   transmission draws nine equal boxes; on a real axis the steps differ
//   by four orders of magnitude. At the interval zoom, your code's work
//   is eight microseconds inside a sixty-six millisecond window -- about
//   a hundredth of a pixel. The honest options were to scale it up and
//   lie, or to draw nothing and lose it.
//
//   Neither. A segment narrower than one and a half pixels is drawn as a
//   TICK in its own colour, and the axis says so in words. The viewer
//   learns the true thing: at this scale the CPU work has no width. Then
//   the next stage zooms in and it does.
//
// WHY THE PACKET GETS ITS OWN LANE AND A BRACKET
//   The lanes answer "what is each part doing". The bracket answers
//   "what happened to MY data", which is the question the viewer
//   actually arrived with. Without it the card is a power trace; with
//   it, it is a story about two bytes.
//
// COLOUR IS NOT THE ONLY CHANNEL
//   Transmit segments carry a solid top rule and every lane is labelled,
//   so the lane a thing happened in is readable without separating hues.
//
// Self-registers. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// Minimum drawn width before a segment becomes a tick. Below this a
// filled rect is indistinguishable from a line anyway, so drawing it as
// a line and SAYING SO is both clearer and more truthful.
const TICK_THRESHOLD_PX = 1.5;

registerRenderingAlgorithm("tx_timeline_view", {

    // A view preference: whether the per-event channel numbers are
    // shown. On the hops stage they are the entire content; on the
    // event zoom there is only one and the label is clutter.
    choices(envelope) {
        return [
            {
                key: "showChannels",
                label: "Channels",
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
        const lanes = fo.lanes ?? [];
        if (lanes.length === 0) {
            container.innerHTML =
                `<p style="color:#ff4d4d;padding:20px;">tx_timeline_view needs finalOutput.lanes.</p>`;
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
        const DOWN  = "#e74c3c";
        const WARN  = "#e0a030";
        const MUTED = "#5c6470";
        const DEAD  = "#3a4049";

        // One colour per state. tx takes the theme accent so the thing
        // the card is about follows the viewer's chosen palette.
        const ST = {
            clock: "#7a6433",
            ramp:  WARN,
            tx:    accent,
            idle:  DEAD,
            rx:    "#4a8fd0",
            app:   "#9b7fe0",
            ctrl:  "#e07a30",
            wait:  "#2f3640",
        };

        const t0Us    = fo.windowStartUs ?? 0;
        const spanUs  = fo.windowUs ?? 1000;
        const zoom    = fo.zoom ?? "interval";
        const showCh  = config.showChannels !== false;
        const queue   = fo.queue ?? null;
        const showQueue = !!queue && (queue.notifyHz ?? 1) > 1;

        const fmtT = us => {
            if (spanUs >= 20000) return `${(us / 1000).toFixed(0)} ms`;
            if (spanUs >= 2000)  return `${(us / 1000).toFixed(1)} ms`;
            return `${us.toFixed(0)} µs`;
        };
        const fmtDur = us => us >= 1000 ? `${(us / 1000).toFixed(2)} ms`
                                        : `${us.toFixed(0)} µs`;

        function draw(t) {
            lastT = t;
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            const M = { top: 62 * useDPR, left: 66 * useDPR, right: 14 * useDPR };
            const plotW = W - M.left - M.right;

            const queueH = showQueue ? 78 * useDPR : 0;
            const axisH  = 30 * useDPR;
            const claimH = 24 * useDPR;
            const lanesH = H - M.top - axisH - queueH - claimH;
            const laneH  = Math.min(34 * useDPR, lanesH / lanes.length);
            const lanePitch = lanesH / lanes.length;

            const toX = us => M.left + ((us - t0Us) / spanUs) * plotW;
            const nowUs = t0Us + t * spanUs;
            const headX = toX(nowUs);

            let anySubPixel = false;

            // ── lanes ─────────────────────────────────────────────────
            lanes.forEach((lane, li) => {
                const ly = M.top + li * lanePitch;
                const lh = laneH;

                // lane bed
                ctx.fillStyle = "rgba(255,255,255,0.025)";
                ctx.fillRect(M.left, ly, plotW, lh);
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.lineWidth = 1 * useDPR;
                ctx.strokeRect(M.left, ly, plotW, lh);

                ctx.textAlign = "right";
                ctx.fillStyle = "#cfd6de";
                ctx.font = `600 ${9.5 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(lane.label, M.left - 6 * useDPR, ly + lh / 2 - 1 * useDPR);
                if (lane.owner) {
                    ctx.fillStyle = MUTED;
                    ctx.font = `${7.5 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(lane.owner, M.left - 6 * useDPR, ly + lh / 2 + 9 * useDPR);
                }

                for (const seg of lane.segments ?? []) {
                    if (seg.t1 < t0Us || seg.t0 > t0Us + spanUs) continue;

                    // Only draw what the playhead has reached, so the
                    // card is a sweep and not a static chart that
                    // happens to have a line moving over it.
                    const visEnd = Math.min(seg.t1, nowUs);
                    if (visEnd <= seg.t0) continue;

                    const x = toX(seg.t0);
                    const w = toX(visEnd) - x;
                    const colour = ST[seg.state] ?? MUTED;

                    if (w < TICK_THRESHOLD_PX * useDPR) {
                        // Narrower than a pixel at this zoom. Drawn as a
                        // tick, and the axis note says why. See header.
                        anySubPixel = true;
                        ctx.strokeStyle = colour;
                        ctx.lineWidth = TICK_THRESHOLD_PX * useDPR;
                        ctx.beginPath();
                        ctx.moveTo(x, ly + 2 * useDPR);
                        ctx.lineTo(x, ly + lh - 2 * useDPR);
                        ctx.stroke();
                        continue;
                    }

                    ctx.fillStyle = colour;
                    ctx.globalAlpha = seg.state === "wait" ? 0.75 : 1;
                    ctx.fillRect(x, ly + 2 * useDPR, w, lh - 4 * useDPR);
                    ctx.globalAlpha = 1;

                    // Transmit gets a solid top rule: a second channel
                    // besides hue for the one state that matters most.
                    if (seg.state === "tx") {
                        ctx.strokeStyle = "#ffffff";
                        ctx.lineWidth = 1.6 * useDPR;
                        ctx.beginPath();
                        ctx.moveTo(x, ly + 2 * useDPR);
                        ctx.lineTo(x + w, ly + 2 * useDPR);
                        ctx.stroke();
                    }

                    if (seg.label && w > 52 * useDPR) {
                        ctx.fillStyle = seg.state === "tx" ? "#0d1117" : "#cfd6de";
                        ctx.font = `${8 * useDPR}px "IBM Plex Mono", monospace`;
                        ctx.textAlign = "left";
                        ctx.fillText(seg.label, x + 4 * useDPR, ly + lh / 2 + 3 * useDPR);
                    }
                }
            });

            // ── anchor points and channel labels ──────────────────────
            const lanesTop = M.top, lanesBot = M.top + lanesH;
            for (const e of fo.events ?? []) {
                const x = toX(e.anchorUs);
                if (x < M.left || x > M.left + plotW) continue;
                ctx.strokeStyle = "rgba(255,255,255,0.18)";
                ctx.lineWidth = 1 * useDPR;
                ctx.setLineDash([2 * useDPR, 3 * useDPR]);
                ctx.beginPath();
                ctx.moveTo(x, lanesTop - 8 * useDPR);
                ctx.lineTo(x, lanesBot);
                ctx.stroke();
                ctx.setLineDash([]);

                if (showCh) {
                    ctx.textAlign = "center";
                    ctx.fillStyle = e.anchorUs <= nowUs ? WARN : MUTED;
                    ctx.font = `600 ${8.5 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText(`ch ${e.channel}`, x, lanesTop - 11 * useDPR);
                }
            }

            // ── our packet's bracket ──────────────────────────────────
            const pk = fo.packet;
            if (pk) {
                const bx0 = toX(pk.producedUs);
                const bx1 = toX(Math.min(pk.ackUs, nowUs));
                const by = lanesBot + 9 * useDPR;
                if (bx1 > bx0) {
                    ctx.strokeStyle = accent;
                    ctx.lineWidth = 1.4 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(bx0, by - 4 * useDPR); ctx.lineTo(bx0, by);
                    ctx.lineTo(bx1, by); ctx.lineTo(bx1, by - 4 * useDPR);
                    ctx.stroke();

                    if (nowUs >= pk.ackUs && bx1 - bx0 > 70 * useDPR) {
                        ctx.textAlign = "center";
                        ctx.fillStyle = accent;
                        ctx.font = `${8.5 * useDPR}px "IBM Plex Mono", monospace`;
                        ctx.fillText(`${fmtDur(pk.elapsedUs)} end to end`,
                                     (bx0 + bx1) / 2, by + 11 * useDPR);
                    }
                }

                // A failed attempt is crossed, not merely a different
                // colour -- the same argument as the torn-down routers
                // in maxprefix_cascade_view.
                for (const a of pk.attempts ?? []) {
                    if (a.acked || a.txEndUs > nowUs) continue;
                    const ax = (toX(a.txStartUs) + toX(a.txEndUs)) / 2;
                    const ay = M.top + 2 * lanePitch + laneH / 2;
                    ctx.strokeStyle = DOWN;
                    ctx.lineWidth = 1.8 * useDPR;
                    const d = 5 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(ax - d, ay - d); ctx.lineTo(ax + d, ay + d);
                    ctx.moveTo(ax + d, ay - d); ctx.lineTo(ax - d, ay + d);
                    ctx.stroke();
                }
            }

            // ── playhead ──────────────────────────────────────────────
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            ctx.lineWidth = 1.2 * useDPR;
            ctx.beginPath();
            ctx.moveTo(headX, lanesTop - 8 * useDPR);
            ctx.lineTo(headX, lanesBot + 4 * useDPR);
            ctx.stroke();

            // ── time axis ─────────────────────────────────────────────
            const axisY = lanesBot + 24 * useDPR;
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1 * useDPR;
            ctx.beginPath();
            ctx.moveTo(M.left, axisY); ctx.lineTo(M.left + plotW, axisY);
            ctx.stroke();

            ctx.textAlign = "center";
            ctx.fillStyle = MUTED;
            ctx.font = `${8.5 * useDPR}px "IBM Plex Mono", monospace`;
            for (let k = 0; k <= 4; k++) {
                const us = t0Us + (k / 4) * spanUs;
                const x = toX(us);
                ctx.beginPath();
                ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 3 * useDPR);
                ctx.stroke();
                ctx.fillText(fmtT(us), x, axisY + 14 * useDPR);
            }

            if (anySubPixel) {
                ctx.textAlign = "left";
                ctx.fillStyle = MUTED;
                ctx.font = `${7.5 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText("ticks = narrower than one pixel at this scale",
                             M.left, axisY + 25 * useDPR);
            }

            // ── header readout ────────────────────────────────────────
            const ti = fo.timing ?? {};
            ctx.textAlign = "left";
            ctx.fillStyle = "#cfd6de";
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(
                zoom === "event" ? "one connection event"
                : zoom === "hops" ? `hopping, increment ${fo.hopIncrement}`
                : `interval ${fo.intervalMs} ms`,
                M.left - 48 * useDPR, 26 * useDPR);

            ctx.fillStyle = MUTED;
            ctx.font = `${9.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(
                `${fo.onAirBytes} B on air  ·  TX ${fmtDur(ti.txUs ?? 0)}`
                + `  ·  awake ${fmtDur(ti.eventTotalUs ?? 0)} per event`,
                M.left - 48 * useDPR, 42 * useDPR);

            ctx.textAlign = "right";
            ctx.fillStyle = (ti.dutyCyclePct ?? 0) < 10 ? accent : WARN;
            ctx.font = `600 ${13 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText(`${(ti.dutyCyclePct ?? 0).toFixed(2)}%`,
                         M.left + plotW, 26 * useDPR);
            ctx.fillStyle = MUTED;
            ctx.font = `${8.5 * useDPR}px "IBM Plex Mono", monospace`;
            ctx.fillText("duty cycle", M.left + plotW, 40 * useDPR);

            // ── the queue panel ───────────────────────────────────────
            // Only when the application is producing fast enough for the
            // queue to be the story. At one notification a second it is
            // always empty and the panel would be a flat line.
            if (showQueue) {
                const qY = H - claimH - queueH + 14 * useDPR;
                const qH = queueH - 28 * useDPR;
                const cap = Math.max(1, queue.capacity ?? 3);
                const tS = queue.tS ?? [];
                const occ = queue.occupancy ?? [];
                const tMax = tS[tS.length - 1] || 1;

                ctx.textAlign = "left";
                ctx.fillStyle = MUTED;
                ctx.font = `${9 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(
                    `transmit queue · notify ${queue.notifyHz}/s`
                    + ` · drains ${queue.saturationHz.toFixed(0)}/s`,
                    M.left, qY - 4 * useDPR);

                ctx.fillStyle = "rgba(255,255,255,0.025)";
                ctx.fillRect(M.left, qY, plotW, qH);

                const qx = s => M.left + (s / tMax) * plotW;
                const qy = n => qY + qH - (n / (cap + 1)) * qH;

                // capacity line: the thing being hit
                ctx.strokeStyle = DOWN;
                ctx.lineWidth = 1.2 * useDPR;
                ctx.setLineDash([4 * useDPR, 3 * useDPR]);
                ctx.beginPath();
                ctx.moveTo(M.left, qy(cap)); ctx.lineTo(M.left + plotW, qy(cap));
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = DOWN;
                ctx.font = `${8 * useDPR}px "IBM Plex Mono", monospace`;
                ctx.fillText(`${cap} buffers`, M.left + 3 * useDPR, qy(cap) - 3 * useDPR);

                const upto = Math.floor(t * (tS.length - 1));
                ctx.strokeStyle = queue.sustainable ? accent : WARN;
                ctx.lineWidth = 1.8 * useDPR;
                ctx.beginPath();
                for (let s = 0; s <= upto; s++) {
                    const x = qx(tS[s]), y = qy(occ[s]);
                    if (s === 0) ctx.moveTo(x, y);
                    else { ctx.lineTo(x, qy(occ[s - 1])); ctx.lineTo(x, y); }
                }
                ctx.stroke();

                if (queue.overflowAtS != null && tS[upto] >= queue.overflowAtS) {
                    const ox = qx(queue.overflowAtS);
                    ctx.strokeStyle = DOWN;
                    ctx.lineWidth = 1.4 * useDPR;
                    ctx.beginPath();
                    ctx.moveTo(ox, qY); ctx.lineTo(ox, qY + qH);
                    ctx.stroke();
                    ctx.textAlign = "left";
                    ctx.fillStyle = DOWN;
                    ctx.font = `600 ${8.5 * useDPR}px "IBM Plex Mono", monospace`;
                    ctx.fillText("-ENOMEM", ox + 3 * useDPR, qY + 10 * useDPR);
                }
            }

            // ── the closing claim ────────────────────────────────────
            if (t > 0.92) {
                ctx.textAlign = "center";
                ctx.font = `600 ${11.5 * useDPR}px "IBM Plex Mono", monospace`;

                if (showQueue && !queue.sustainable) {
                    ctx.fillStyle = DOWN;
                    ctx.fillText(
                        `${queue.notifyHz}/s into a ${queue.saturationHz.toFixed(0)}/s pipe`
                        + ` — full after ${(queue.fillTimeS * 1000).toFixed(0)} ms`,
                        W / 2, H - 9 * useDPR);
                } else if (pk?.retried) {
                    ctx.fillStyle = WARN;
                    ctx.fillText(
                        `not acknowledged — retried one interval later, on a new channel`,
                        W / 2, H - 9 * useDPR);
                } else if (zoom === "hops") {
                    ctx.fillStyle = accent;
                    ctx.fillText(
                        `${(fo.channels ?? []).slice(0, 6).join(" → ")}  ·  never negotiated`,
                        W / 2, H - 9 * useDPR);
                } else if (zoom === "event") {
                    ctx.fillStyle = WARN;
                    ctx.fillText(
                        `${fmtDur(ti.txUs ?? 0)} of transmit inside `
                        + `${fmtDur(ti.eventTotalUs ?? 0)} awake`,
                        W / 2, H - 9 * useDPR);
                } else {
                    // The AVERAGE case, from oracle, not the single drawn
                    // packet's own fraction -- the claim is general, and
                    // the two numbers differ. See the note in the DSPE.
                    const pct = fo.oracle?.txFractionOfElapsedPct ?? 0;
                    ctx.fillStyle = WARN;
                    ctx.fillText(
                        `${pct.toFixed(1)}% of the average wait was transmitting`,
                        W / 2, H - 9 * useDPR);
                }
            }
        }

        draw(0);
        startSweepLoop(sampleId, durationMs, e => draw(Math.min(1, e / durationMs)));
    },
});

})();
