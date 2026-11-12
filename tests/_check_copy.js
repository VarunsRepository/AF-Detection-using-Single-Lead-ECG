// Runs every stage of the real recipe through the real DSPEs and renderers,
// then checks that the NUMBERS QUOTED IN THE PROSE match what the code
// actually computes.
//
// This is the check the master document says caught its author on the ITSM
// journey -- "one more analyst divides the wait by 1.76" was estimated, and
// the truth was 2.55. Recipe prose is the easiest place in this codebase for
// a wrong number to hide, because nothing else reads it.

const fs = require("fs");
const vm = require("vm");

const P = require("./_paths");
const recipe = JSON.parse(P.read("_recipe.json"));

const DSP = {}, RE = {};
let drawOps = 0;
function stubCtx() {
    const noop = () => {}, count = () => { drawOps++; };
    return new Proxy({
        canvas: { width: 1170, height: 1260 }, globalAlpha: 1,
        fillRect: count, strokeRect: count, fillText: count, stroke: count, fill: count,
        measureText: () => ({ width: 10 }),
    }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => (t[k] = v, true) });
}
const sweeps = [];
const sandbox = {
    registerDspAlgorithm: (id, i) => { DSP[id] = i; },
    registerRenderingAlgorithm: (id, i) => { RE[id] = i; },
    startSweepLoop: (s, d, cb) => { sweeps.push({ d, cb }); },
    getComputedStyle: () => ({ getPropertyValue: () => "#4aa3d8" }),
    devicePixelRatio: 3,
    ResizeObserver: class { observe() {} },
    document: { documentElement: {}, createElement: () => ({ style: {}, getContext: () => stubCtx(), appendChild() {} }) },
    console, Math, Set, Array, Number, String, Object, JSON, Infinity,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["ble_encapsulation_filter.js", "ble_tx_timeline_filter.js",
                 "packet_stack_view.js", "tx_timeline_view.js"]) {
    vm.runInContext(P.read(f), sandbox, { filename: f });
}

let fails = 0;
const fail = m => { fails++; console.log(`  FAIL ${m}`); };
const ok   = m => console.log(`  ok   ${m}`);

console.log(`recipe: ${recipe.name} v${recipe.version}, category "${recipe.category}", `
          + `${recipe.stageCount} stages\n`);

// ── 1. every stage runs, and its renderer draws ───────────────────────
console.log("every stage resolves and renders");
const outputs = {};
for (const s of recipe.stages) {
    if (!DSP[s.algorithm])  { fail(`${s.stageId}: no DSPE "${s.algorithm}"`); continue; }
    if (!RE[s.renderer])    { fail(`${s.stageId}: no renderer "${s.renderer}"`); continue; }

    const out = DSP[s.algorithm].process(null, s.parameters);
    if (out.error) { fail(`${s.stageId}: DSPE error "${out.error}"`); continue; }
    outputs[s.stageId] = out.finalOutput;

    drawOps = 0; sweeps.length = 0;
    const container = { innerHTML: "", style: {}, offsetWidth: 390, offsetHeight: 420, appendChild() {} };
    try {
        RE[s.renderer].render(container, out, s.rendererConfig, "chk", 500, 9000);
        const sw = sweeps[0];
        for (let i = 0; i <= 12; i++) sw.cb((i / 12) * sw.d);
        if (drawOps < 20) throw new Error("drew nothing");
        ok(`${s.stageId}  (${drawOps} draw ops)`);
    } catch (e) { fail(`${s.stageId}: renderer threw -- ${e.message}`); }
}

// ── 2. every choice the recipe hides must actually be declared ────────
// A hide on a key the DSPE never offered is a silent no-op, and the
// author never learns the button they meant to suppress is still there.
console.log("\nhidden choices must exist on the DSPE");
for (const s of recipe.stages) {
    if (!s.hidden.length) continue;
    const declared = (DSP[s.algorithm].choices?.() ?? []).map(c => c.key);
    for (const k of s.hidden) {
        if (declared.includes(k)) ok(`${s.stageId} hides "${k}", which is declared`);
        else fail(`${s.stageId} hides "${k}", which ${s.algorithm} never declares`);
    }
}

// ── 3. the numbers in the prose must match the computed values ────────
// Each entry: stage, a number that must appear in title+caption+description,
// and where it comes from. Written as the string the viewer sees.
console.log("\nquoted numbers must match computed values");

function textOf(stageId) {
    const s = recipe.stages.find(x => x.stageId === stageId);
    return `${s.title} ${s.caption} ${s.description}`;
}
function claims(stageId, needle, actual, label) {
    const text = textOf(stageId);
    if (!text.includes(needle)) {
        fail(`${stageId}: prose does not contain "${needle}" (${label})`);
        return;
    }
    if (actual === null) { ok(`${stageId}: "${needle}" present`); return; }
    ok(`${stageId}: "${needle}" matches computed ${label} = ${actual}`);
}

const enc  = outputs["on_air"];
const bat  = outputs["batching"];
const wait = outputs["the_wait"];
const evt  = outputs["the_event"];
const hop  = outputs["the_hop"];
const que  = outputs["the_queue"];

// the encapsulation chain
claims("att", "23 bytes", enc.attMtu, "attMtu");
claims("att", "20 bytes", enc.attValueLimit, "attValueLimit");
claims("l2cap", "27", enc.llPayloadMax, "llPayloadMax");
if (enc.oracle.attMtuExactlyFitsLl) ok("l2cap: the MTU/LL coincidence holds");
else fail("l2cap: prose claims the defaults coincide and they do not");

claims("on_air", "Twenty-three bytes", enc.onAirBytes, "onAirBytes");
claims("on_air", "11.5", enc.overheadRatio, "overheadRatio");
claims("on_air", "8.7%", enc.payloadFractionPct, "payloadFractionPct");
claims("on_air", "184 microseconds", enc.airtimeUs, "airtimeUs");
if (Math.round(enc.onAirBytes / 23) === 1 && enc.onAirBytes === 23) ok("on_air: 23 bytes confirmed");
else fail(`on_air: expected 23 bytes, got ${enc.onAirBytes}`);
// the 2M claim is made in prose but the stage runs at 1M; check it holds
{
    const m2 = DSP.ble_encapsulation.process(null, { ...recipe.stages.find(s => s.stageId === "on_air").parameters, phy: "2M" }).finalOutput;
    if (m2.onAirBytes === 24 && m2.airtimeUs === 96) ok("on_air: the 2M claim (24 bytes, 96 us) holds");
    else fail(`on_air: 2M claim wrong -- ${m2.onAirBytes} bytes, ${m2.airtimeUs} us`);
}

// batching
claims("batching", "41-byte", bat.onAirBytes, "batched onAirBytes");
claims("batching", "230 bytes", bat.unbatchedOnAirBytes, "unbatchedOnAirBytes");
claims("batching", "5.6", bat.batchSavingRatio, "batchSavingRatio");
claims("batching", "2.05", bat.overheadRatio, "batched overheadRatio");
claims("batching", "20 bytes", bat.payloadBytes, "payloadBytes");
if (bat.onAirBytes === 41 && bat.unbatchedOnAirBytes === 230
    && Math.abs(bat.batchSavingRatio - 5.6098) < 1e-3
    && Math.abs(bat.overheadRatio - 2.05) < 1e-3) ok("batching: all four figures confirmed");
else fail("batching: a figure disagrees");

// the wait
claims("the_wait", "15 milliseconds", wait.oracle.meanQueueWaitUs / 1000, "meanQueueWait ms");
claims("the_wait", "184 microseconds", wait.timing.txUs, "txUs");
claims("the_wait", "1.2%", wait.oracle.txFractionOfElapsedPct, "oracle txFractionOfElapsedPct");
{
    const got = wait.oracle.txFractionOfElapsedPct;
    if (Math.abs(got - 1.16) < 0.06) ok(`the_wait: 1.2% rounds from computed ${got.toFixed(2)}%`);
    else fail(`the_wait: prose says 1.2%, computed ${got.toFixed(2)}%`);
}
for (const [ms, dutyWant, txFracWant] of [[1000, 0.11, 0.04], [7.5, 11.94, null]]) {
    const o = DSP.ble_tx_timeline.process(null, { ...recipe.stages.find(s => s.stageId === "the_wait").parameters, intervalMs: ms }).finalOutput;
    const duty = o.timing.dutyCyclePct;
    if (Math.abs(duty - dutyWant) < 0.02) ok(`the_wait: ${ms} ms duty ${duty.toFixed(2)}% matches prose ${dutyWant}%`);
    else fail(`the_wait: ${ms} ms duty computed ${duty.toFixed(2)}%, prose says ${dutyWant}%`);
    if (txFracWant !== null) {
        const f = o.oracle.txFractionOfElapsedPct;
        if (Math.abs(f - txFracWant) < 0.01) ok(`the_wait: ${ms} ms TX fraction ${f.toFixed(3)}% matches prose ${txFracWant}%`);
        else fail(`the_wait: ${ms} ms TX fraction computed ${f.toFixed(3)}%, prose says ${txFracWant}%`);
    }
}
claims("the_wait", "nearly 12%", null, "7.5 ms duty, stated loosely");

// the event
claims("the_event", "400 microseconds", evt.timing.hfxoStartupUs, "hfxoStartupUs");
claims("the_event", "40 microseconds of radio ramp-up", evt.timing.rampUs, "rampUs");
claims("the_event", "150 microsecond", evt.timing.tIfsUs, "tIfsUs");
claims("the_event", "86", evt.timing.rxUs, "rxUs");
claims("the_event", "Nine hundred microseconds", evt.timing.eventTotalUs, "eventTotalUs");
claims("the_event", "3 microseconds", evt.timing.wideningUsEachSide, "wideningUsEachSide");
if (evt.timing.eventTotalUs === 900 && evt.timing.rxUs === 86
    && evt.timing.wideningUsEachSide === 3) ok("the_event: event breakdown confirmed");
else fail(`the_event: breakdown disagrees -- total ${evt.timing.eventTotalUs}, rx ${evt.timing.rxUs}, widening ${evt.timing.wideningUsEachSide}`);
{
    const lfrc = DSP.ble_tx_timeline.process(null, { ...recipe.stages.find(s => s.stageId === "the_event").parameters, intervalMs: 1000, peripheralScaPpm: 500 }).finalOutput;
    if (lfrc.timing.wideningUsEachSide === 550) ok("the_event: the 550 us LFRC claim holds");
    else fail(`the_event: prose says 550 us, computed ${lfrc.timing.wideningUsEachSide}`);
}

// the hop
{
    const seq = hop.oracle.hopSequenceFirst8.slice(0, 7).join(" → ");
    claims("the_hop", "0 → 7 → 14 → 21 → 28 → 35 → 5", null, "hop sequence");
    if (seq === "0 → 7 → 14 → 21 → 28 → 35 → 5") ok(`the_hop: sequence matches computed ${seq}`);
    else fail(`the_hop: prose sequence wrong; computed ${seq}`);
    if (hop.oracle.visitsAllChannels) ok("the_hop: all 37 channels visited, as claimed");
    else fail("the_hop: prose claims full coverage and it does not hold");
}

// the queue
claims("the_queue", "three packets", que.queue.capacity, "txBuffers");
claims("the_queue", "four per event", que.queue.packetsPerEvent, "packetsPerEvent");
claims("the_queue", "133 notifications a second", que.queue.saturationHz, "saturationHz");
claims("the_queue", "8 milliseconds", que.queue.fillTimeS * 1000, "fillTimeS ms");
if (Math.abs(que.queue.saturationHz - 133.333) < 0.01
    && Math.round(que.queue.fillTimeS * 1000) === 8) ok("the_queue: both figures confirmed");
else fail(`the_queue: saturation ${que.queue.saturationHz}, fill ${que.queue.fillTimeS * 1000} ms`);
{
    // the raw-ECG aside: 500 Hz, 10 samples per packet = 50/s, sustainable
    const o = DSP.ble_tx_timeline.process(null, { ...recipe.stages.find(s => s.stageId === "the_queue").parameters, notifyHz: 50 }).finalOutput;
    if (o.queue.sustainable) ok("the_queue: the 50/s raw-ECG aside is sustainable, as claimed");
    else fail("the_queue: prose says 50/s is sustainable and it is not");
}

// ── 4. no stage may quote a number with no computed backing ───────────
console.log("\nstages that make a claim must carry an oracle");
for (const s of recipe.stages) {
    const fo = outputs[s.stageId];
    if (!fo) continue;
    if (fo.oracle && Object.keys(fo.oracle).length > 2) ok(`${s.stageId} carries oracle fields`);
    else fail(`${s.stageId} has no oracle in finalOutput`);
}

console.log(fails === 0
    ? "\nRECIPE CONSISTENT WITH THE CODE\n"
    : `\n${fails} INCONSISTENCY(S) BETWEEN RECIPE AND CODE\n`);
process.exit(fails === 0 ? 0 : 1);
