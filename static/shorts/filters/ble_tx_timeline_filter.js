// ---------------------------------------------------------------------------
// filters/ble_tx_timeline_filter.js
//
// The 184 microseconds of transmission, and the 25 milliseconds of
// waiting that surround them.
//
// THE MECHANISM
//   bt_gatt_notify() does not transmit. It validates the subscription,
//   builds the packet, puts it in the controller's transmit queue and
//   returns -- typically in a few microseconds. The packet then sits
//   there until the next connection event, which arrives on the central's
//   schedule and not yours.
//
//   At the anchor point the controller wakes at interrupt priority 0,
//   picks the channel, programs the radio, and hardware does the rest.
//   The peer's reply carries a single acknowledgement bit. If it does
//   not arrive, the packet stays queued and is retried at the next
//   event, indefinitely, until the supervision timeout kills the link.
//
// WHY THIS IS A JOURNEY AND NOT A DIAGRAM
//   Every sequence diagram of this path draws nine steps as nine boxes
//   of roughly equal size. On a real time axis they differ by four
//   orders of magnitude: the ATT and L2CAP work is a few microseconds,
//   the transmission is 184, and the wait is 25,000. Drawn to scale, the
//   picture is almost entirely one long bar of nothing happening -- and
//   that is the fact that explains BLE's power consumption, its latency,
//   and why batching matters.
//
//   The failures it shows: a dropped acknowledgement becoming a silent
//   retry (so the link has no packet loss but does have jitter), and a
//   transmit queue overflowing when the application produces faster
//   than the interval can drain.
//
// STAGING
//   One DSPE serves five stages via `zoom` and two flags:
//     zoom "interval"  the wait, at millisecond scale
//     zoom "event"     one connection event, at microsecond scale
//     zoom "hops"      several events, showing the channel changing
//     failFirstTx      the retry
//     notifyHz high    the overflow
//
// THE ORACLE  (backlog filter, test 3)
//   oracle_ble_txpath.py derives independently:
//     airtime      = bits / symbol rate                   exact
//     widening     = interval x (SCA_c + SCA_p) ppm        exact
//     hop sequence = (last + hop) mod 37                   exact, per spec
//     saturation   = packetsPerEvent / interval            exact
//     fill time    = buffers / (notifyHz - drainHz)        exact
//   Verified agreement at 30 ms, LE 1M, 23 bytes on air:
//     tx 184 us, event total 956 us, TX is 1.15% of elapsed,
//     saturation 133.33 notifications/s, hop=7 -> [0,7,14,21,28,35,5,12]
//
// MODEL, NOT SPEC -- and the cards say so
//   HFXO startup 400 us and radio ramp-up 40 us are nRF52840 figures and
//   crystal dependent. Transmit buffer count and packets drained per
//   event are stack configuration, not protocol. Everything else above
//   is specification arithmetic.
//
// NOT MODELLED, deliberately
//   Peripheral latency skipping events (its own card, backlog item 15),
//   connection parameter updates mid-stream, the MD bit chaining more
//   than packetsPerEvent packets into one event, and channel map
//   updates. Each changes the picture and deserves its own stage.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped.
// ---------------------------------------------------------------------------

(function () {
"use strict";

// ── spec constants ─────────────────────────────────────────────────────
const T_IFS_US      = 150;   // inter-frame space, fixed by the spec
const DATA_CHANNELS = 37;
const EMPTY_PDU_ON_AIR_1M = 10;  // preamble 1 + AA 4 + header 2 + CRC 3

// ── model constants, nRF52840 ──────────────────────────────────────────
// Named so the card can say which numbers are measurements of a chip
// rather than requirements of a protocol.
const HFXO_STARTUP_US = 400;
const RADIO_RAMP_US   = 40;

// Resolution of the queue-occupancy series. Enough steps that the
// overflow instant is finer than anything drawn.
const QUEUE_STEPS = 600;


function airtimeUs(bytes, phy) {
    return (bytes * 8) / (phy === "2M" ? 2 : 1);
}

// Both clocks drift, so the receiver opens early and closes late. This
// is the entire reason a 32.768 kHz crystal is worth its board area.
function wideningUs(intervalMs, scaCentralPpm, scaPeripheralPpm) {
    return intervalMs * 1000 * ((scaCentralPpm + scaPeripheralPpm) / 1e6);
}

// Channel selection algorithm #1. 37 is prime, so any non-zero increment
// visits every channel; the spec's 5..16 range is about decorrelating
// from a wide interferer, not about coverage.
function hopSequence(hopIncrement, n, start) {
    const out = [];
    let ch = start % DATA_CHANNELS;
    for (let i = 0; i < n; i++) {
        out.push(ch);
        ch = (ch + hopIncrement) % DATA_CHANNELS;
    }
    return out;
}

// One connection event, broken into its phases. Returned as segments
// relative to the anchor so the same function serves both zoom levels.
function eventSegments(anchorUs, onAirBytes, phy, intervalMs, scaC, scaP) {
    const w   = wideningUs(intervalMs, scaC, scaP);
    const tx  = airtimeUs(onAirBytes, phy);
    const rx  = airtimeUs(EMPTY_PDU_ON_AIR_1M, phy) + 2 * w;

    const segs = [];
    let t = anchorUs - HFXO_STARTUP_US;   // wake BEFORE the anchor

    segs.push({ t0: t, t1: t + HFXO_STARTUP_US, state: "clock",
                label: "32 MHz crystal starting" });
    t += HFXO_STARTUP_US;                 // t is now the anchor
    segs.push({ t0: t, t1: t + RADIO_RAMP_US, state: "ramp", label: "TX ramp-up" });
    t += RADIO_RAMP_US;
    segs.push({ t0: t, t1: t + tx, state: "tx", label: "transmit" });
    t += tx;
    segs.push({ t0: t, t1: t + T_IFS_US, state: "idle", label: "T_IFS 150 us" });
    t += T_IFS_US;
    segs.push({ t0: t, t1: t + RADIO_RAMP_US, state: "ramp", label: "RX ramp-up" });
    t += RADIO_RAMP_US;
    segs.push({ t0: t, t1: t + rx, state: "rx", label: "receive the reply" });
    t += rx;

    return { segs, endUs: t, txStartUs: anchorUs + RADIO_RAMP_US,
             txEndUs: anchorUs + RADIO_RAMP_US + tx, wideningUs: w,
             txUs: tx, rxUs: rx,
             totalUs: t - (anchorUs - HFXO_STARTUP_US) };
}


registerDspAlgorithm("ble_tx_timeline", {

    // Interval is the parameter the whole trade-off turns on, so it is
    // the control. Everything a viewer might want to poke at here --
    // latency, power, how long their data sits in a queue -- moves when
    // this moves.
    choices() {
        return [
            {
                key: "intervalMs",
                label: "Interval",
                values: [7.5, 15, 30, 100, 1000],
                value: 30,
                display: {
                    7.5: "7.5 ms (fastest)",
                    15: "15 ms",
                    30: "30 ms",
                    100: "100 ms",
                    1000: "1 s (lowest power)",
                },
            },
        ];
    },

    process(data, parameters) {
        const p = parameters ?? {};

        const intervalMs   = p.intervalMs   ?? 30;
        const onAirBytes   = p.onAirBytes   ?? 23;
        const payloadBytes = p.payloadBytes ?? 2;
        const phy          = p.phy === "2M" ? "2M" : "1M";
        const zoom         = p.zoom ?? "interval";

        const scaC = p.centralScaPpm    ?? 50;
        const scaP = p.peripheralScaPpm ?? 50;

        const hopIncrement = p.hopIncrement ?? 7;
        const startChannel = p.startChannel ?? 0;

        const notifyHz        = p.notifyHz        ?? 1;
        const txBuffers       = p.txBuffers       ?? 3;
        const packetsPerEvent = p.packetsPerEvent ?? 4;

        const failFirstTx = p.failFirstTx ?? false;

        if (intervalMs <= 0)  return { error: "intervalMs must be > 0." };
        if (onAirBytes <= 0)  return { error: "onAirBytes must be > 0." };
        if (hopIncrement < 1 || hopIncrement > 36)
            return { error: "hopIncrement must be 1..36 (the spec uses 5..16)." };

        const intervalUs = intervalMs * 1000;

        // ── how many events are in frame, and the window ──────────────
        // zoom decides the time scale, which is the whole point of
        // having three of these cards rather than one.
        let nEvents, windowUs, windowStartUs;
        if (zoom === "event") {
            nEvents = 1;
            windowStartUs = -HFXO_STARTUP_US - 100;
            windowUs = 1400;                      // microsecond scale
        } else if (zoom === "hops") {
            nEvents = 6;
            windowStartUs = -HFXO_STARTUP_US - 200;
            windowUs = 6 * intervalUs;
        } else {
            nEvents = 3;
            windowStartUs = -HFXO_STARTUP_US - 200;
            windowUs = 2.2 * intervalUs;          // millisecond scale
        }

        const channels = hopSequence(hopIncrement, Math.max(nEvents, 8), startChannel);

        // ── the events ────────────────────────────────────────────────
        const events = [];
        const radioSegs = [];
        for (let i = 0; i < nEvents; i++) {
            const anchorUs = i * intervalUs;
            const e = eventSegments(anchorUs, onAirBytes, phy, intervalMs, scaC, scaP);
            events.push({
                index: i,
                anchorUs,
                channel: channels[i],
                txStartUs: e.txStartUs,
                txEndUs: e.txEndUs,
                endUs: e.endUs,
                totalUs: e.totalUs,
            });
            radioSegs.push(...e.segs);
        }
        const firstEvent = events[0];
        const evShape = eventSegments(0, onAirBytes, phy, intervalMs, scaC, scaP);

        // ── our packet's life ─────────────────────────────────────────
        // Produced partway between two anchors, which is the honest
        // case: your code has no idea where in the interval it is.
        // A quarter of the way in, so the wait is visible but the card
        // is not claiming a worst case.
        const producedUs = zoom === "event" ? -HFXO_STARTUP_US - 60
                                            : 0.25 * intervalUs;

        // Which event actually carries it. Any event whose anchor is at
        // or after producedUs; plus one more if the first attempt fails.
        let carryIdx = events.findIndex(e => e.anchorUs >= producedUs);
        if (carryIdx < 0) carryIdx = 0;
        const attempts = [];
        if (failFirstTx && carryIdx + 1 < events.length) {
            attempts.push({ eventIndex: carryIdx, acked: false,
                            txStartUs: events[carryIdx].txStartUs,
                            txEndUs: events[carryIdx].txEndUs,
                            channel: events[carryIdx].channel });
            carryIdx += 1;
        }
        attempts.push({ eventIndex: carryIdx, acked: true,
                        txStartUs: events[carryIdx].txStartUs,
                        txEndUs: events[carryIdx].txEndUs,
                        channel: events[carryIdx].channel });

        const carrier   = events[carryIdx];
        const queuedUs  = Math.max(0, carrier.anchorUs - producedUs);
        const ackUs     = carrier.endUs;
        const elapsedUs = ackUs - producedUs;

        // ── lanes ─────────────────────────────────────────────────────
        // Three lanes because there are three distinct owners, and the
        // whole architecture point is that two of them share one core.
        const appSegs = [{
            t0: producedUs, t1: producedUs + 8, state: "app",
            label: "notify() builds and queues",
        }];

        const ctrlSegs = events.map(e => ({
            t0: e.anchorUs - 30, t1: e.anchorUs + 20, state: "ctrl",
            label: "controller, priority 0",
        }));

        const queueSegs = [{
            t0: producedUs, t1: carrier.txEndUs, state: "wait",
            label: "queued, radio off",
        }];
        if (failFirstTx && attempts.length > 1) {
            queueSegs[0].label = "queued, first attempt not acknowledged";
        }

        const lanes = [
            { id: "app",   label: "Your code",       owner: "CPU, app priority", segments: appSegs },
            { id: "ctrl",  label: "Controller",      owner: "CPU, priority 0",   segments: ctrlSegs },
            { id: "radio", label: "Radio",           owner: "hardware",          segments: radioSegs },
            { id: "queue", label: "This packet",     owner: "transmit queue",    segments: queueSegs },
        ];

        // ── the transmit queue, and where it breaks ───────────────────
        // Deterministic producer against a deterministic drain. No
        // randomness, so the overflow instant is an exact number rather
        // than a statistical claim.
        const drainHz     = packetsPerEvent / (intervalMs / 1000);
        const sustainable = notifyHz <= drainHz;
        const fillTimeS   = sustainable ? null : txBuffers / (notifyHz - drainHz);

        const qWindowS = sustainable ? 1 : Math.min(2, Math.max(0.05, fillTimeS * 2.2));
        const qT = new Array(QUEUE_STEPS + 1);
        const qN = new Array(QUEUE_STEPS + 1);
        let overflowAtS = null;
        for (let s = 0; s <= QUEUE_STEPS; s++) {
            const t = (s / QUEUE_STEPS) * qWindowS;
            // Produced minus drained, floored at zero and capped at the
            // buffer count: a full queue rejects, it does not grow.
            const produced = Math.floor(notifyHz * t);
            const drained  = Math.floor(packetsPerEvent * Math.floor(t / (intervalMs / 1000)));
            const raw      = produced - drained;
            qT[s] = t;
            qN[s] = Math.max(0, Math.min(txBuffers, raw));
            if (overflowAtS === null && raw > txBuffers) overflowAtS = t;
        }

        // ── the independent arithmetic, carried for checking ──────────
        const oracle = {
            method: "airtime = bits/symbol rate; widening = interval x ppm; "
                  + "hop = (last+hop) mod 37; saturation = packets/interval",
            specConstants: { T_IFS_US, DATA_CHANNELS },
            modelConstants: { HFXO_STARTUP_US, RADIO_RAMP_US, txBuffers, packetsPerEvent },
            txUs: evShape.txUs,
            rxUs: evShape.rxUs,
            eventTotalUs: evShape.totalUs,
            wideningUsEachSide: evShape.wideningUs,
            dutyCyclePct: (100 * evShape.totalUs) / intervalUs,
            meanQueueWaitUs: intervalUs / 2,
            txFractionOfElapsedPct: (100 * evShape.txUs) / (intervalUs / 2 + evShape.totalUs),
            hopSequenceFirst8: hopSequence(hopIncrement, 8, startChannel),
            visitsAllChannels:
                new Set(hopSequence(hopIncrement, DATA_CHANNELS, startChannel)).size
                === DATA_CHANNELS,
            saturationHz: drainHz,
            queueFillTimeS: fillTimeS,
        };

        return {
            interimOutputs: events.map(e => ({
                id: `event_${e.index}`,
                label: `event ${e.index}, channel ${e.channel}`,
                anchorUs: e.anchorUs,
                channel: e.channel,
            })),

            finalOutput: {
                zoom,
                windowStartUs,
                windowUs,
                intervalMs,
                intervalUs,
                phy,
                onAirBytes,
                payloadBytes,

                lanes,
                events,
                channels,
                hopIncrement,

                packet: {
                    producedUs,
                    queuedUs,
                    txStartUs: carrier.txStartUs,
                    txEndUs: carrier.txEndUs,
                    ackUs,
                    elapsedUs,
                    attempts,
                    retried: attempts.length > 1,
                },

                timing: {
                    hfxoStartupUs: HFXO_STARTUP_US,
                    rampUs: RADIO_RAMP_US,
                    txUs: evShape.txUs,
                    tIfsUs: T_IFS_US,
                    rxUs: evShape.rxUs,
                    eventTotalUs: evShape.totalUs,
                    wideningUsEachSide: evShape.wideningUs,
                    dutyCyclePct: (100 * evShape.totalUs) / intervalUs,
                    // CAREFUL -- there are two honest answers to "what
                    // fraction of the elapsed time was transmitting",
                    // and _check_copy.js caught them disagreeing on
                    // screen. THIS one is about the single packet the
                    // card draws, which is produced a quarter of the way
                    // into the interval and therefore waits longer than
                    // average. oracle.txFractionOfElapsedPct is the
                    // AVERAGE case, from a mean half-interval wait, and
                    // that is the one the prose quotes and the renderer
                    // puts in its closing claim. Named apart so the next
                    // person cannot reach for the wrong one by accident.
                    txFractionOfThisPacketPct: (100 * evShape.txUs) / elapsedUs,
                },

                queue: {
                    tS: qT,
                    occupancy: qN,
                    capacity: txBuffers,
                    notifyHz,
                    packetsPerEvent,
                    saturationHz: drainHz,
                    sustainable,
                    overflowAtS,
                    fillTimeS,
                },

                scaCentralPpm: scaC,
                scaPeripheralPpm: scaP,

                oracle,
            },
        };
    },
});

})();
