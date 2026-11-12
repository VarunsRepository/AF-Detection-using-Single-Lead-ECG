// Cross-checks ble_connect_filter.js against oracle_ble_connect.py's output.
// Shares no code with the oracle; both derive from spec field widths.

const fs = require("fs");
const vm = require("vm");
const P = require("./_paths");

const DSP = {};
const sandbox = {
    registerDspAlgorithm: (id, i) => { DSP[id] = i; },
    console, Math, Set, Array, Number, String, Object, JSON, Infinity,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["ble_connect_filter.js"]) {
    vm.runInContext(P.read(f), sandbox, { filename: f });
}

let fails = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) console.log(`  ok   ${label} = ${JSON.stringify(got)}`);
    else { fails++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const run = s => DSP.ble_connect.process(null, { stage: s, intervalMs: 30 }).finalOutput;

console.log("packet counts per stage");
eq("packetsPerStage", run(1).oracle.packetsPerStage, [3, 2, 2, 7, 2, 11]);
for (let s = 1; s <= 6; s++) {
    eq(`stage ${s} count`, run(s).exchanges.length, [3, 2, 2, 7, 2, 11][s - 1]);
}

console.log("\nbyte totals");
eq("advDataBytes", run(1).oracle.advDataBytes, 22);
eq("advIndOnAir", run(1).exchanges[0].onAirBytes, 38);
eq("advIndPdu", run(1).exchanges[0].pduBytes, 28);
eq("connectIndPdu", run(2).exchanges[1].pduBytes, 34);
eq("connectIndOnAir", run(2).exchanges[1].onAirBytes, 44);
eq("emptyPduOnAir", run(3).exchanges[0].onAirBytes, 10);
eq("emptyPduPdu", run(3).exchanges[0].pduBytes, 0);
eq("framingBytes", run(1).oracle.framingBytes, 10);
eq("journeyOnAirBytes", run(1).totals.journeyOnAirBytes, 546);
eq("journeyPacketCount", run(1).totals.journeyPacketCount, 26);
eq("overheadRatio", run(1).totals.overheadRatio, 273);

console.log("\nelapsed");
{
    const ms = run(1).totals.journeyElapsedUs / 1000;
    const ok = Math.abs(ms - 337.9) < 0.1;
    if (ok) console.log(`  ok   journeyElapsed = ${ms.toFixed(1)} ms`);
    else { fails++; console.log(`  FAIL journeyElapsed: ${ms.toFixed(1)} ms, want 337.9`); }
}
eq("tIfsUs", run(1).oracle.tIfsUs, 150);

console.log("\nopcodes, against the spec");
const opcodes = {
    4: [0x08, 0x0E, 0x14, 0x15, 0x16, 0x17, 0x18],
    5: [0x02, 0x03],
    6: [0x10, 0x11, 0x08, 0x09, 0x04, 0x05, 0x04, 0x01, 0x12, 0x13, 0x1B],
};
for (const [s, want] of Object.entries(opcodes)) {
    eq(`stage ${s} opcodes`, run(Number(s)).exchanges.map(x => x.opcode), want);
}
eq("stages 1-3 carry no opcodes",
   [1, 2, 3].flatMap(s => run(s).exchanges.map(x => x.opcode)),
   [null, null, null, null, null, null, null]);

console.log("\nsenders alternate correctly");
eq("stage 4 senders", run(4).exchanges.map(x => x.from),
   ["central", "peripheral", "central", "peripheral", "central", "peripheral", "central"]);
eq("stage 1 all peripheral", run(1).exchanges.map(x => x.from),
   ["peripheral", "peripheral", "peripheral"]);
eq("to is always the other party",
   [1, 2, 3, 4, 5, 6].every(s => run(s).exchanges.every(x => x.to !== x.from)), true);

console.log("\nevery response follows a request");
// A response (an *_RSP, or the error) must be preceded by a packet from
// the OTHER party. This is the check that caught the orphaned error
// response in the oracle.
for (let s = 1; s <= 6; s++) {
    const ex = run(s).exchanges;
    let bad = [];
    ex.forEach((x, i) => {
        const isResponse = /_RSP|_IND$/.test(x.name) && x.name !== "ADV_IND"
                           && x.name !== "CONNECT_IND" && x.name !== "LL_PHY_UPDATE_IND";
        if (!isResponse) return;
        if (i === 0 || ex[i - 1].from === x.from) bad.push(x.name);
    });
    if (bad.length) { fails++; console.log(`  FAIL stage ${s}: orphaned responses ${bad.join(", ")}`); }
    else console.log(`  ok   stage ${s}: every response answers the other party`);
}

console.log("\ngaps: spec vs model, and the two scales");
eq("T_IFS gaps are tagged spec",
   run(4).exchanges.filter(x => x.gapBeforeUs === 150).every(x => x.gapKind === "spec"), true);
eq("interval gaps are tagged model",
   run(4).exchanges.filter(x => x.gapBeforeUs === 30000).every(x => x.gapKind === "model"), true);
{
    const g = run(4).exchanges.map(x => x.gapBeforeUs);
    eq("stage 4 gaps alternate 30000/150", g,
       [30000, 150, 30000, 150, 30000, 150, 30000]);
}

console.log("\nthe interval control actually moves the total");
{
    const slow = DSP.ble_connect.process(null, { stage: 1, intervalMs: 100 }).finalOutput;
    const fast = DSP.ble_connect.process(null, { stage: 1, intervalMs: 7.5 }).finalOutput;
    const a = slow.totals.journeyElapsedUs, b = fast.totals.journeyElapsedUs;
    if (a > b * 3) console.log(`  ok   100 ms -> ${(a/1000).toFixed(0)} ms, 7.5 ms -> ${(b/1000).toFixed(0)} ms`);
    else { fails++; console.log(`  FAIL interval barely changes the total: ${a} vs ${b}`); }
    eq("bytes do NOT change with interval",
       slow.totals.journeyOnAirBytes === fast.totals.journeyOnAirBytes, true);
}

console.log("\nroles cover every byte, and the legend is complete");
for (let s = 1; s <= 6; s++) {
    const o = run(s);
    const summed = Object.values(o.roleBytes).reduce((a, b) => a + b, 0);
    const pdus = o.exchanges.reduce((a, x) => a + x.pduBytes, 0);
    if (summed !== pdus) { fails++; console.log(`  FAIL stage ${s}: roles sum ${summed}, PDUs sum ${pdus}`); }
    else console.log(`  ok   stage ${s}: roles account for all ${pdus} PDU bytes`);
    for (const r of Object.keys(o.roleBytes)) {
        if (!o.roleLabels[r]) { fails++; console.log(`  FAIL role "${r}" has no legend label`); }
    }
}

// No glossary section here any more: the terms moved to
// catalog/glossaries/wireless.py and ride on the renderer's config, so
// they are checked by check_glossary.py and by _check_connect_copy.js
// reading the recipe -- not by inspecting DSPE output that no longer
// has them.
console.log("\nthe DSPE must NOT carry glossary terms");
eq("finalOutput has no glossary key", "glossary" in run(1), false);

console.log("\nthe oracle states its own limits");
eq("unverified list is present and non-empty",
   Array.isArray(run(4).oracle.unverified) && run(4).oracle.unverified.length >= 2, true);

console.log("\nerror paths");
eq("intervalMs 0", !!DSP.ble_connect.process(null, { stage: 1, intervalMs: 0 }).error, true);
eq("empty deviceName", !!DSP.ble_connect.process(null, { stage: 1, deviceName: "" }).error, true);
eq("oversized deviceName",
   !!DSP.ble_connect.process(null, { stage: 1, deviceName: "x".repeat(40) }).error, true);
eq("stage clamps low", DSP.ble_connect.process(null, { stage: -5 }).finalOutput.stage, 1);
eq("stage clamps high", DSP.ble_connect.process(null, { stage: 99 }).finalOutput.stage, 6);

console.log(fails === 0
    ? "\nALL CHECKS AGREE WITH THE ORACLE\n"
    : `\n${fails} DISAGREEMENT(S)\n`);
process.exit(fails === 0 ? 0 : 1);
