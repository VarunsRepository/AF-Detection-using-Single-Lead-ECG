// ---------------------------------------------------------------------------
// filters/simd_add_filter.js
//
// One SIMD instruction, taken apart.
//
// THE CLAIM THE JOURNEY MAKES
//   v128.add( [a0,a1,a2,a3], [b0,b1,b2,b3] ) does in ONE instruction what
//   four scalar adds do in four. Not four times faster in wall-clock
//   terms -- memory and dependencies usually dominate -- but four lanes
//   genuinely advance together, and that simultaneity is the thing words
//   struggle to convey and a picture does not.
//
// THREE VIEWS, ONE RUN
//   Every capture carries a `view` tag and the renderer filters on it,
//   the same way the AES journey separates key expansion from encryption.
//   One DSPE run feeds all three stages:
//
//     lanes     A + B = result, lane by lane
//     compare   four scalar ops beside one vector op
//     pipeline  INPUT -> SCALAR -> PACK -> REGISTER -> ADD -> RESULT
//
// WRAPPING IS DELIBERATE
//   Lanes are i32 and wrap on overflow -- that is what the hardware does,
//   and a sample here is chosen to show it. Silently widening to f64
//   would be a lie about the instruction.
//
// Self-registers into DSP_ALGORITHMS. IIFE-wrapped -- filter files share
// one global scope.
// ---------------------------------------------------------------------------

(function () {
"use strict";

const LANES = 4;

// | 0 forces the 32-bit wrap JS otherwise hides behind doubles.
const addI32 = (x, y) => (x + y) | 0;

function makeRecorder() {
    const captures = [];
    return {
        captures,
        push(view, label, tech, data, extra = {}) {
            captures.push({ view, label, tech, data, ...extra });
        },
    };
}


// Shared with filters/simd_add_wasm.module.js, which computes `result`
// with a real v128 instruction and then needs the SAME captures -- the
// renderer keys off the view tags, so two builders would drift and the
// WASM version would slowly stop matching the JS one.
//
// Exposed on globalThis because filter files are plain scripts with no
// module system between them.
function buildSimdViews(a, b, result) {
    const rec = makeRecorder();

        // ── view: lanes ────────────────────────────────────────────────
        rec.push("lanes", "Vector A", "four 32-bit lanes", a.slice());
        rec.push("lanes", "Vector B", "four more lanes",   b.slice());
        rec.push("lanes", "v128.add", "every lane adds AT ONCE",
                 result.slice(), { operands: [a.slice(), b.slice()] });

        // ── view: compare ──────────────────────────────────────────────
        // Scalar first, one lane at a time, so the count is felt rather
        // than stated: four instructions, four results, in sequence.
        const partial = [null, null, null, null];
        for (let i = 0; i < LANES; i++) {
            partial[i] = result[i];
            rec.push("compare", `a[${i}] + b[${i}]`,
                     `scalar instruction ${i + 1} of ${LANES}`,
                     partial.slice(),
                     { mode: "scalar", lane: i, opCount: i + 1 });
        }
        rec.push("compare", "v128.add(A, B)",
                 "one instruction, all four lanes",
                 result.slice(),
                 { mode: "simd", opCount: 1, operands: [a.slice(), b.slice()] });

        // ── view: pipeline ─────────────────────────────────────────────
        // PACK is the step people skip. Values must be contiguous and
        // aligned before a vector register can hold them; when data is
        // not already laid out that way, the packing can cost more than
        // the arithmetic it enables. Showing it as its own stage is the
        // honest version.
        rec.push("pipeline", "INPUT", "two arrays in memory", a.concat(b),
                 { stageKind: "input" });
        rec.push("pipeline", "SCALAR", `${LANES} separate adds -- the slow path`,
                 result.slice(), { stageKind: "scalar", opCount: LANES });
        rec.push("pipeline", "PACK", "lanes gathered into one 128-bit value",
                 a.slice(), { stageKind: "pack", operands: [a.slice(), b.slice()] });
        rec.push("pipeline", "SIMD REGISTER", "128 bits = 4 x i32",
                 a.slice(), { stageKind: "register",
                              operands: [a.slice(), b.slice()] });
        rec.push("pipeline", "SIMD ADD", "one instruction",
                 result.slice(), { stageKind: "add", opCount: 1,
                                   operands: [a.slice(), b.slice()] });
        rec.push("pipeline", "RESULT", "four sums, one step",
                 result.slice(), { stageKind: "result" });

    return rec.captures;
}

globalThis.buildSimdViews = buildSimdViews;
globalThis.SIMD_LANES = LANES;

function simdFinalOutput(a, b, result) {
    const wrapped = a.some((v, i) => v + b[i] !== result[i]);
    return {
        a, b, result,
        lanes:          LANES,
        scalarOps:      LANES,
        simdOps:        1,
        instructionRatio: LANES,     // instructions saved, NOT a
                                     // wall-clock speedup
        wrapped,                     // did any lane overflow i32?
        laneWidthBits:  32,
        registerBits:   128,
    };
}

globalThis.simdFinalOutput = simdFinalOutput;


registerDspAlgorithm("simd_add", {
    process(envelope, parameters) {
        const a = Array.from(envelope.arrays?.a ?? []);
        const b = Array.from(envelope.arrays?.b ?? []);

        if (a.length !== LANES || b.length !== LANES) {
            return { error: `simd_add needs arrays.a and arrays.b of ${LANES} `
                          + `lanes each, got ${a.length} and ${b.length}.` };
        }

        const result = a.map((v, i) => addI32(v, b[i]));

        return {
            interimOutputs: buildSimdViews(a, b, result),
            finalOutput:    simdFinalOutput(a, b, result),
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { addI32, LANES };
}

})();
