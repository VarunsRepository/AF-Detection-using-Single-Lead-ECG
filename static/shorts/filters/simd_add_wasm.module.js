// ---------------------------------------------------------------------------
// filters/simd_add_wasm.module.js
//
// The SIMD journey's DSPE backed by a REAL WebAssembly v128 instruction,
// compiled from rust/simd_add. Registers as "simd_add_wasm" and sits on
// the rail beside the JS version, the same way pan_tompkins_wasm sits
// beside pan_tompkins.
//
// THIS IS SLOWER THAN THE JS VERSION, AND THAT IS FINE
//   Four integers do not justify a boundary crossing -- the call costs
//   more than the arithmetic. What it buys is honesty: an i32x4.add
//   actually executes, on NEON on a phone and SSE on a laptop, from this
//   one binary. A journey teaching SIMD while quietly running a scalar
//   loop would be the same class of problem as a wrong MixColumns that
//   animates convincingly.
//
// CAPTURES ARE NOT REBUILT HERE
//   buildSimdViews() comes from simd_add_filter.js. The renderer keys on
//   view tags, so a second builder would drift and the WASM version would
//   slowly stop matching the JS one. Only the ARITHMETIC differs between
//   the two algorithms; everything downstream is deliberately identical.
//
// MEMORY
//   The result lives in WASM linear memory. Views are created only AFTER
//   process() returns, and copied immediately: process() can allocate for
//   its input slices, and allocation may GROW memory, which detaches
//   every existing view. A detached view reads as garbage rather than
//   throwing, so the copy is not optional.
//
// PATHS assume the wasm-pack output was copied as:
//   static/shorts/wasm/simd_add/SIMD.js
//   static/shorts/wasm/simd_add/SIMD_bg.wasm
// Rename below if the crate is rebuilt under a different name -- the
// class is SimdAdd regardless, but the FILE names follow the crate.
// ---------------------------------------------------------------------------

import init, { SimdAdd } from "/static/shorts/wasm/simd_add/SIMD.js";

const wasm = await init({
    module_or_path: "/static/shorts/wasm/simd_add/SIMD_bg.wasm",
});

// One instance, reused by every card. process() overwrites it, which is
// safe because results are copied out before returning.
const arena = new SimdAdd();

registerDspAlgorithm("simd_add_wasm", {
    process(envelope, parameters) {
        const a = Array.from(envelope.arrays?.a ?? []);
        const b = Array.from(envelope.arrays?.b ?? []);
        const lanes = globalThis.SIMD_LANES ?? 4;

        if (a.length !== lanes || b.length !== lanes) {
            return { error: `simd_add_wasm needs arrays.a and arrays.b of `
                          + `${lanes} lanes each, got ${a.length} and ${b.length}.` };
        }
        if (typeof globalThis.buildSimdViews !== "function") {
            return { error: "simd_add_wasm requires simd_add_filter.js to be "
                          + "loaded -- it provides the shared view builder." };
        }

        try {
            // Rust returns Result<(), JsValue>; wasm-bindgen turns an Err
            // into a thrown exception, so the lane-count guard inside the
            // Rust surfaces here rather than being silently ignored.
            arena.process(Int32Array.from(a), Int32Array.from(b));
        } catch (e) {
            return { error: `simd_add_wasm failed: ${e}` };
        }

        // Read AFTER process, copy immediately. .slice() on a typed array
        // copies into ordinary JS memory with no further WASM call, so it
        // cannot be invalidated mid-copy.
        const result = Array.from(
            new Int32Array(wasm.memory.buffer, arena.out_ptr(), lanes).slice());

        return {
            interimOutputs: globalThis.buildSimdViews(a, b, result),
            finalOutput: {
                ...globalThis.simdFinalOutput(a, b, result),
                backend: "wasm-simd",       // so the card can say which ran
            },
        };
    },
});
