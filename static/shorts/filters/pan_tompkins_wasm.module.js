// ---------------------------------------------------------------------------
// filters/pan_tompkins_wasm.module.js
//
// Pan-Tompkins compiled from Rust (wasm-pack --target web), exposed as an
// ordinary synchronous DSPE. Registers as "pan_tompkins_wasm" and
// COEXISTS with the two JS versions -- the JS port is this one's oracle.
//
// WHY A WRAPPER AT ALL
//   wasm-pack's output is an ES MODULE (export class, import.meta.url)
//   with an ASYNC initialiser. The feed loads filters as classic scripts
//   and calls process() synchronously. Loaded directly it would throw on
//   `export`; called directly it would have nothing initialised yet.
//
//   This file is a module (hence .module.js -- the template emits
//   type="module" for that suffix), awaits init at top level, and only
//   THEN registers. Nothing can call process() before WASM is ready,
//   because until then there is nothing registered to call.
//
//   The generated glue (Pan_Tompkins.js + .wasm) is used unmodified --
//   rebuild with wasm-pack and drop the new files in.
//
// MEMORY -- the one trap
//   process() mallocs space for the input signal, and malloc can GROW
//   WebAssembly memory. Growth detaches memory.buffer, and every typed
//   array viewing it then reads garbage -- silently, not as an error.
//
//   So: views are created only AFTER process() returns, and everything
//   is COPIED out before returning. The copy is not optional here. The
//   renderer holds these arrays across frames, and the next card's
//   process() on this same shared instance may grow memory and detach
//   anything still pointing into it. Zero-copy holds within one call;
//   it cannot survive across cards sharing an instance.
//
// TYPES -- CONFIRMED against lib.rs
//   data (stages)      Vec<f32>   Float32Array
//   offsets, lengths   Vec<u32>   in ELEMENTS (push_stage uses data.len())
//   R, P, Q, S, T      Vec<u32>   sample indices
//   rr                 Vec<f32>   milliseconds
//
//   Stages 2-4 are ONE SAMPLE SHORTER than 0-1: derivative_filter is
//   np.diff, n -> n-1. That is correct and matches the Python reference;
//   lengths[] carries it, so nothing here assumes equal stage lengths.
//
// VERIFIED: an f32 emulation of lib.rs (Math.fround after every op)
// produces IDENTICAL peak indices to pan_tompkins_py on sinus, inverted,
// AFib and noisy signals. f32-vs-f64 could in principle shift a threshold
// breach by one sample, but R is the argmax of the RAW signal within a
// group, which both sides compute identically -- so it does not in practice.
// ---------------------------------------------------------------------------

import init, { PanTompkinsArena }
    from "/static/shorts/wasm/pan_tompkins/Pan_Tompkins.js";

const wasm = await init({
    module_or_path: "/static/shorts/wasm/pan_tompkins/Pan_Tompkins_bg.wasm",
});

// One arena, reused by every card. process() overwrites it, which is
// fine because every result is copied out before returning -- and it
// avoids allocating (and relying on FinalizationRegistry to free) a new
// arena per card.
const arena = new PanTompkinsArena();

// Labels in the order the JS port emits them. The arena exports counts
// and offsets but no names, so these are matched by position. If
// total_stages() disagrees, generic labels are used rather than risking
// a correct-looking caption on the wrong stage.
const STAGE_LABELS = [
    "Original", "Removing Noise", "Spotting Changes",
    "Making Peaks Bigger", "Smoothing Out",
];

// Views onto WASM memory, taken fresh each time and copied immediately.
// .slice() on a typed array copies into ordinary JS memory -- no WASM
// call, so it cannot trigger growth mid-copy.
const copyF32 = (ptr, len) =>
    len ? new Float32Array(wasm.memory.buffer, ptr, len).slice() : new Float32Array(0);
const copyU32 = (ptr, len) =>
    len ? Array.from(new Uint32Array(wasm.memory.buffer, ptr, len)) : [];


registerDspAlgorithm("pan_tompkins_wasm", {
    process(data, parameters) {
        const invert = !!parameters?.invertSignal;

        // Computed here, identically to the JS port, so filteredSignal
        // matches it exactly regardless of how the Rust stages the
        // inversion internally. The chart draws this field.
        const y = invert ? data.y.map(v => -v) : data.y;

        arena.process(Float32Array.from(data.y), data.fs, invert);

        // ── everything below reads memory AFTER process() has returned ──
        const n       = arena.total_stages();
        const offsets = copyU32(arena.offsets_ptr(), n);
        const lengths = copyU32(arena.lengths_ptr(), n);
        const total   = n ? offsets[n - 1] + lengths[n - 1] : 0;
        const blob    = copyF32(arena.data_ptr(), total);

        const labels = n === STAGE_LABELS.length
            ? STAGE_LABELS
            : Array.from({ length: n }, (_, i) => `Stage ${i + 1}`);

        const steps = offsets.map((off, i) => ({
            label: labels[i],
            data:  blob.subarray(off, off + lengths[i]),   // view onto the
        }));                                               // COPY, safe

        const R = copyU32(arena.r_ptr(), arena.r_len());

        return {
            interimOutputs: steps,
            finalOutput: {
                filteredSignal: y,
                peakIndices:    R,
                rrIntervalsMs:  Array.from(copyF32(arena.rr_ptr(), arena.rr_len())),
                wavePoints: {
                    P: copyU32(arena.p_ptr(), arena.p_len()),
                    Q: copyU32(arena.q_ptr(), arena.q_len()),
                    R,
                    S: copyU32(arena.s_ptr(), arena.s_len()),
                    T: copyU32(arena.t_ptr(), arena.t_len()),
                },
                threshold: arena.get_threshold(),
            },
        };
    },
});
