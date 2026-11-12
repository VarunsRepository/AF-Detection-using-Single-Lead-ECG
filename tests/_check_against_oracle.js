// Cross-check harness. Loads both DSPEs with a stub registry and compares
// their output to the values oracle_ble_txpath.py printed. Not shipped --
// this is the "run it, compare to a known vector" step.

const fs = require("fs");
const vm = require("vm");
const P = require("./_paths");

const DSP = {};
const sandbox = {
    registerDspAlgorithm: (id, impl) => { DSP[id] = impl; },
    console,
    Math,
    Set,
    Array,
    Number,
    String,
    Object,
    Infinity,
};
vm.createContext(sandbox);

for (const f of ["ble_encapsulation_filter.js", "ble_tx_timeline_filter.js"]) {
    vm.runInContext(P.read(f), sandbox, { filename: f });
}

let fails = 0;
function eq(label, got, want, tol = 0) {
    const ok = tol === 0
        ? JSON.stringify(got) === JSON.stringify(want)
        : Math.abs(got - want) <= tol;
    if (!ok) { fails++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
    else      { console.log(`  ok   ${label} = ${JSON.stringify(got)}`); }
}

console.log("\nble_encapsulation -- 2 byte payload, encrypted, LE 1M");
{
    const o = DSP.ble_encapsulation.process(null, {
        bytesPerReading: 2, batchCount: 1, encrypted: true, phy: "1M", upToLayer: 5,
    }).finalOutput;
    eq("layerBytes", o.layers.map(l => l.bytes), [2, 5, 9, 11, 15, 23]);
    eq("onAirBytes", o.onAirBytes, 23);
    eq("airtimeUs", o.airtimeUs, 184);
    eq("overheadRatio", o.overheadRatio, 11.5, 1e-9);
    eq("payloadFractionPct", Number(o.payloadFractionPct.toFixed(1)), 8.7, 0.05);
    eq("attValueLimit", o.attValueLimit, 20);
    eq("fragments", o.fragments, 1);
    eq("attMtuExactlyFitsLl", o.oracle.attMtuExactlyFitsLl, true);
}

console.log("\nble_encapsulation -- staged: upToLayer 0..5 must march the chain");
{
    const want = [2, 5, 9, 11, 15, 23];
    for (let L = 0; L <= 5; L++) {
        const o = DSP.ble_encapsulation.process(null, {
            bytesPerReading: 2, batchCount: 1, upToLayer: L,
        }).finalOutput;
        eq(`upToLayer ${L} current`, o.currentLayer.bytes, want[L]);
    }
}

console.log("\nble_encapsulation -- batching 10 readings");
{
    const o = DSP.ble_encapsulation.process(null, {
        bytesPerReading: 2, batchCount: 10, encrypted: true, phy: "1M",
    }).finalOutput;
    eq("payloadBytes", o.payloadBytes, 20);
    eq("onAirBytes", o.onAirBytes, 41);
    eq("unbatchedOnAirBytes", o.unbatchedOnAirBytes, 230);
    eq("batchSavingRatio", Number(o.batchSavingRatio.toFixed(4)), 5.6098, 1e-4);
    eq("overheadRatio", Number(o.overheadRatio.toFixed(2)), 2.05, 1e-3);
    eq("exceedsMtu at exactly 20", o.exceedsMtu, false);
    eq("fragments", o.fragments, 1);
}

console.log("\nble_encapsulation -- LE 2M");
{
    const o = DSP.ble_encapsulation.process(null, {
        bytesPerReading: 2, batchCount: 1, phy: "2M",
    }).finalOutput;
    eq("onAirBytes", o.onAirBytes, 24);
    eq("airtimeUs", o.airtimeUs, 96);
}

console.log("\nble_tx_timeline -- 30 ms, 23 bytes, LE 1M");
{
    const o = DSP.ble_tx_timeline.process(null, {
        intervalMs: 30, onAirBytes: 23, phy: "1M", zoom: "interval",
    }).finalOutput;
    eq("txUs", o.timing.txUs, 184);
    eq("eventTotalUs", o.timing.eventTotalUs, 900);
    eq("tIfsUs", o.timing.tIfsUs, 150);
    eq("wideningUsEachSide", o.timing.wideningUsEachSide, 3, 1e-9);
    eq("dutyCyclePct", Number(o.timing.dutyCyclePct.toFixed(2)), 3.00, 0.01);
    eq("oracle meanQueueWaitUs", o.oracle.meanQueueWaitUs, 15000);
    eq("oracle txFractionOfElapsedPct",
       Number(o.oracle.txFractionOfElapsedPct.toFixed(2)), 1.16, 0.01);
}

console.log("\nble_tx_timeline -- widening, the LFXO vs LFRC argument");
{
    for (const [ppm, intervalMs, want] of [[50, 30, 3], [500, 30, 16.5],
                                            [50, 1000, 100], [500, 1000, 550]]) {
        const o = DSP.ble_tx_timeline.process(null, {
            intervalMs, onAirBytes: 23, peripheralScaPpm: ppm, centralScaPpm: 50,
        }).finalOutput;
        eq(`widening ${ppm}ppm @ ${intervalMs}ms`, o.timing.wideningUsEachSide, want, 1e-9);
    }
}

console.log("\nble_tx_timeline -- channel selection algorithm #1");
{
    const o = DSP.ble_tx_timeline.process(null, {
        intervalMs: 30, hopIncrement: 7, startChannel: 0, zoom: "hops",
    }).finalOutput;
    eq("hop=7 first 8", o.oracle.hopSequenceFirst8, [0, 7, 14, 21, 28, 35, 5, 12]);
    eq("visitsAllChannels", o.oracle.visitsAllChannels, true);
    for (const h of [5, 11, 16, 1, 36]) {
        const r = DSP.ble_tx_timeline.process(null, { hopIncrement: h }).finalOutput;
        eq(`hop=${h} covers 37`, r.oracle.visitsAllChannels, true);
    }
}

console.log("\nble_tx_timeline -- queue saturation and overflow");
{
    const base = { intervalMs: 30, packetsPerEvent: 4, txBuffers: 3 };
    const sat = DSP.ble_tx_timeline.process(null, base).finalOutput;
    eq("saturationHz", Number(sat.queue.saturationHz.toFixed(4)), 133.3333, 1e-3);

    for (const [hz, wantSustainable, wantFillMs] of
         [[1, true, null], [100, true, null], [200, false, 45], [500, false, 8]]) {
        const o = DSP.ble_tx_timeline.process(null, { ...base, notifyHz: hz }).finalOutput;
        eq(`notify ${hz}/s sustainable`, o.queue.sustainable, wantSustainable);
        if (wantFillMs !== null) {
            eq(`notify ${hz}/s fill ms`,
               Math.round(o.queue.fillTimeS * 1000), wantFillMs, 1);
        }
    }
}

console.log("\nble_tx_timeline -- retry keeps the packet queued across two events");
{
    const o = DSP.ble_tx_timeline.process(null, {
        intervalMs: 30, zoom: "interval", failFirstTx: true,
    }).finalOutput;
    eq("attempts", o.packet.attempts.length, 2);
    eq("retried", o.packet.retried, true);
    eq("first attempt not acked", o.packet.attempts[0].acked, false);
    eq("second attempt acked", o.packet.attempts[1].acked, true);
    const gap = o.packet.attempts[1].txStartUs - o.packet.attempts[0].txStartUs;
    eq("retry gap is one interval", gap, 30000);
    eq("retry changed channel",
       o.packet.attempts[0].channel !== o.packet.attempts[1].channel, true);
}

console.log("\nble_tx_timeline -- error paths return an error, not nonsense");
{
    eq("intervalMs 0", !!DSP.ble_tx_timeline.process(null, { intervalMs: 0 }).error, true);
    eq("hopIncrement 0", !!DSP.ble_tx_timeline.process(null, { hopIncrement: 0 }).error, true);
    eq("hopIncrement 37", !!DSP.ble_tx_timeline.process(null, { hopIncrement: 37 }).error, true);
    eq("payload 0", !!DSP.ble_encapsulation.process(null, { bytesPerReading: 0, batchCount: 0 }).error, true);
}

console.log(fails === 0
    ? "\nALL CHECKS AGREE WITH THE ORACLE\n"
    : `\n${fails} DISAGREEMENT(S) WITH THE ORACLE\n`);
process.exit(fails === 0 ? 0 : 1);
