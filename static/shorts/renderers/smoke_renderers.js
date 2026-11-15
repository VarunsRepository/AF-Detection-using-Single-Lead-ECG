// Renderer smoke harness. The backlog wants a renderer smoke page; this is
// the headless half of it. It will not tell you the picture is RIGHT -- the
// master document is explicit that "does this look right" has no oracle --
// but it does catch the cheap failures: a parse error, an undefined read, a
// renderer that draws nothing, and a draw() that throws partway through the
// sweep instead of on frame one.

const fs = require("fs");
const vm = require("vm");
const P = require("./_paths");

const DSP = {}, RE = {};
let drawOps = 0;

function stubCtx() {
    const noop = () => {};
    const count = () => { drawOps++; };
    return new Proxy({
        canvas: { width: 1170, height: 1260 },
        globalAlpha: 1,
        fillRect: count, strokeRect: count, fillText: count, stroke: count,
        fill: count, clearRect: noop, beginPath: noop, moveTo: noop,
        lineTo: noop, arc: noop, rect: noop, clip: noop, save: noop,
        restore: noop, setLineDash: noop, measureText: () => ({ width: 10 }),
    }, {
        get(t, k) {
            if (k in t) return t[k];
            return noop;                 // any unmocked ctx method
        },
        set(t, k, v) { t[k] = v; return true; },
    });
}

const sweepCallbacks = [];
const sandbox = {
    registerDspAlgorithm:       (id, impl) => { DSP[id] = impl; },
    registerRenderingAlgorithm: (id, impl) => { RE[id]  = impl; },
    // The interpreter owns the real one; here we capture the callback so
    // the sweep can be stepped deliberately rather than on a timer.
    startSweepLoop: (sampleId, durationMs, cb) => { sweepCallbacks.push({ durationMs, cb }); },
    getComputedStyle: () => ({ getPropertyValue: () => "#5cc24a" }),
    devicePixelRatio: 3,
    ResizeObserver: class { observe() {} disconnect() {} },
    document: {
        documentElement: {},
        createElement: () => ({
            style: {}, width: 0, height: 0,
            getContext: () => stubCtx(),
            appendChild() {},
        }),
    },
    console, Math, Set, Array, Number, String, Object, JSON, Infinity,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of [
                 "ble_encapsulation_filter.js", "ble_tx_timeline_filter.js",
                 "ble_connect_filter.js",
                 "packet_stack_view.js", "tx_timeline_view.js",
                 "exchange_view.js"]) {
    vm.runInContext(P.read(f), sandbox, { filename: f });
}

console.log("registered DSPEs:    ", Object.keys(DSP).join(", "));
console.log("registered renderers:", Object.keys(RE).join(", "));

let fails = 0;
const ok = m => console.log(`  ok   ${m}`);
function smoke(label, rendererId, dspId, params, rendererConfig = {}) {
    drawOps = 0;
    sweepCallbacks.length = 0;
    const container = {
        innerHTML: "", style: {}, offsetWidth: 390, offsetHeight: 420,
        appendChild() {},
    };
    try {
        const out = DSP[dspId].process(null, params);
        RE[rendererId].render(container, out, rendererConfig, "smoke", 500, 9000);
        if (container.innerHTML && container.innerHTML.includes("#ff4d4d")) {
            throw new Error(`renderer bailed: ${container.innerHTML.slice(0, 90)}`);
        }
        // Step the whole sweep, not just frame zero. The master document's
        // scrub bugs were all "fine on the first frame".
        const sw = sweepCallbacks[0];
        if (!sw) throw new Error("renderer never called startSweepLoop");
        for (let i = 0; i <= 20; i++) sw.cb((i / 20) * sw.durationMs);

        if (drawOps < 20) throw new Error(`only ${drawOps} draw ops -- drew nothing meaningful`);
        console.log(`  ok   ${label}  (${drawOps} draw ops)`);
    } catch (e) {
        fails++;
        console.log(`  FAIL ${label}: ${e.message}`);
    }
}

console.log("\npacket_stack_view -- every stage of the encapsulation chain");
for (let L = 0; L <= 5; L++) {
    smoke(`upToLayer ${L}`, "packet_stack_view", "ble_encapsulation",
          { bytesPerReading: 2, batchCount: 1, upToLayer: L });
}
smoke("batched x10", "packet_stack_view", "ble_encapsulation",
      { bytesPerReading: 2, batchCount: 10, upToLayer: 5 });
smoke("batched x10, 2M", "packet_stack_view", "ble_encapsulation",
      { bytesPerReading: 2, batchCount: 10, upToLayer: 5, phy: "2M" });
smoke("over the MTU", "packet_stack_view", "ble_encapsulation",
      { bytesPerReading: 4, batchCount: 10, upToLayer: 5 });
smoke("unencrypted (no MIC field)", "packet_stack_view", "ble_encapsulation",
      { bytesPerReading: 2, batchCount: 1, upToLayer: 5, encrypted: false });
smoke("field bytes hidden", "packet_stack_view", "ble_encapsulation",
      { bytesPerReading: 2, batchCount: 1, upToLayer: 5 }, { showFieldBytes: false });

console.log("\ntx_timeline_view -- every zoom and both failure modes");
smoke("zoom interval", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "interval" });
smoke("zoom event", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "event" });
smoke("zoom hops", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "hops", hopIncrement: 7 });
smoke("retry", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "interval", failFirstTx: true });
smoke("queue overflow", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "interval", notifyHz: 500, txBuffers: 3 });
smoke("queue sustainable", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "interval", notifyHz: 50, txBuffers: 3 });
smoke("1 s interval", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 1000, zoom: "interval" });
smoke("7.5 ms interval", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 7.5, zoom: "interval" });
smoke("LFRC 500 ppm", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 1000, zoom: "event", peripheralScaPpm: 500 });
smoke("channels hidden", "tx_timeline_view", "ble_tx_timeline",
      { intervalMs: 30, zoom: "hops" }, { showChannels: false });

console.log("\nexchange_view -- all six stages of ble_connect");
for (let st = 1; st <= 6; st++) {
    smoke(`stage ${st}`, "exchange_view", "ble_connect", { stage: st, intervalMs: 30 });
}
smoke("stage 6 at 100 ms", "exchange_view", "ble_connect", { stage: 6, intervalMs: 100 });
smoke("stage 6 at 7.5 ms", "exchange_view", "ble_connect", { stage: 6, intervalMs: 7.5 });
smoke("glossary hidden", "exchange_view", "ble_connect", { stage: 1 }, { showGlossary: false });
// The terms ride on the renderer config now, so the only way to smoke the
// strip is to supply them the way the recipe does.
smoke("glossary supplied", "exchange_view", "ble_connect", { stage: 1 }, {
    showGlossary: true,
    glossary: [{ acronym: "PDU", full: "Protocol Data Unit",
                 plain: "one packet's worth of content" }],
});
smoke("glossary absent entirely", "exchange_view", "ble_connect", { stage: 1 }, {});
smoke("long device name", "exchange_view", "ble_connect", { stage: 1, deviceName: "A Rather Long Name" });

// REGRESSION: a card rendered blank on load because the ResizeObserver
// resized the canvas (which clears it) and never repainted. Any renderer
// that observes a resize must draw again.
console.log("\na resize must repaint -- resizing a canvas clears it");
for (const [reId, dspId, params] of [
        ["exchange_view", "ble_connect", { stage: 1 }],
        ["packet_stack_view", "ble_encapsulation", { upToLayer: 3 }],
        ["tx_timeline_view", "ble_tx_timeline", { intervalMs: 30 }]]) {
    let observerCb = null;
    const savedRO = sandbox.ResizeObserver;
    sandbox.ResizeObserver = class { constructor(cb) { observerCb = cb; } observe() {} };
    drawOps = 0; sweepCallbacks.length = 0;
    const container = { innerHTML: "", style: {}, offsetWidth: 390, offsetHeight: 420, appendChild() {} };
    try {
        RE[reId].render(container, DSP[dspId].process(null, params), {}, "chk", 500, 9000);
        const afterFirstDraw = drawOps;
        if (!observerCb) throw new Error("renderer did not observe a resize at all");
        drawOps = 0;
        observerCb([{ contentRect: { width: 500, height: 600 } }]);
        if (drawOps === 0)
            throw new Error("resize produced no draw ops -- the canvas is now blank");
        ok(`${reId} repaints on resize (${afterFirstDraw} initial, ${drawOps} after)`);
    } catch (e) { fails++; console.log(`  FAIL ${reId}: ${e.message}`); }
    sandbox.ResizeObserver = savedRO;
}

// REGRESSION, SECOND KIND. The first blank-card bug was a resize that
// cleared the canvas without repainting (above). This is the other one:
// in a scroll feed the sweep only drives the active card, so an inactive
// card shows nothing but its initial draw(0) -- and frame zero of an
// animation is an exchange in which nothing has been sent yet. A card
// that is not animating must still draw its content.
console.log("\nan un-animated card must still draw its content");
{
    const savedSweep = sandbox.startSweepLoop;
    for (const stage of [1, 3, 6]) {
        let cb = null;
        sandbox.startSweepLoop = (s_, d_, c) => { cb = c; };
        drawOps = 0;
        const container = { innerHTML: "", style: {}, offsetWidth: 390,
                            offsetHeight: 420, appendChild() {} };
        try {
            RE.exchange_view.render(container,
                DSP.ble_connect.process(null, { stage }), {}, "chk", 500, 9000);
            const poster = drawOps;            // sweep has not ticked
            drawOps = 0; cb(0);
            const animatedAtZero = drawOps;    // same t, now animating
            drawOps = 0; cb(0);
            const again = drawOps;             // a loop re-entering zero
            if (poster <= 0) {
                console.log(`  FAIL exchange_view stage ${stage} drew nothing un-animated`);
                fails++;
            } else if (poster < animatedAtZero) {
                console.log(`  FAIL exchange_view stage ${stage} poster ${poster} < animated ${animatedAtZero}`);
                fails++;
            } else if (again !== animatedAtZero) {
                // the poster must not come back once the sweep owns the card
                console.log(`  FAIL exchange_view stage ${stage} flickers on loop: ${animatedAtZero} then ${again}`);
                fails++;
            } else {
                ok(`stage ${stage} un-animated draws ${poster}, animated frame zero ${animatedAtZero}, no flicker`);
            }
        } catch (e) {
            console.log(`  FAIL exchange_view stage ${stage} poster threw: ${e.message}`);
            fails++;
        }
    }
    sandbox.startSweepLoop = savedSweep;
}

console.log("\nrenderers must survive a DSPE error without throwing");
for (const [reId, dspId] of [["packet_stack_view", "ble_encapsulation"],
                             ["tx_timeline_view", "ble_tx_timeline"],
                             ["exchange_view", "ble_connect"]]) {
    const container = { innerHTML: "", style: {}, offsetWidth: 390,
                        offsetHeight: 420, appendChild() {} };
    try {
        RE[reId].render(container, { error: "deliberate" }, {}, "smoke", 500, 9000);
        const shown = container.innerHTML.includes("deliberate");
        console.log(shown ? `  ok   ${reId} surfaced the error`
                          : `  FAIL ${reId} swallowed the error`);
        if (!shown) fails++;
    } catch (e) {
        fails++;
        console.log(`  FAIL ${reId} threw on an error payload: ${e.message}`);
    }
}

console.log("\nboth renderers must declare choices()");
for (const id of Object.keys(RE)) {
    const c = RE[id].choices?.({});
    const ok = Array.isArray(c) && c.length > 0 && c.every(x => x.key && x.label);
    console.log(ok ? `  ok   ${id} declares ${c.length} choice(s)`
                   : `  FAIL ${id} choices() malformed`);
    if (!ok) fails++;
}

console.log(fails === 0 ? "\nSMOKE CLEAN\n" : `\n${fails} SMOKE FAILURE(S)\n`);
process.exit(fails === 0 ? 0 : 1);
