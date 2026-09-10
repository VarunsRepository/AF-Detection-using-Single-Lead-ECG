// ---------------------------------------------------------------------------
// filters/math_algorithms.js
// Pure math algorithms with no external filter dependency.
// Previously appended to db4_filter.js which was wrong -- they're not
// wavelet algorithms, and tying them to db4_filter.js meant ECG journeys
// had to load a wavelet file just to get Poincaré math.
//
// Self-registers into DSP_ALGORITHMS (defined in dsp_registry.js).
// Loaded only for journeys that reference poincare_standard or passthrough.
// ---------------------------------------------------------------------------

registerDspAlgorithm("poincare_standard", {
    process(rrIntervalsMs) {
        const rrCurrent = rrIntervalsMs.slice(0, -1);
        const rrNext = rrIntervalsMs.slice(1);
        const diffs = rrCurrent.map((v, i) => v - rrNext[i]);
        const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance = arr => {
            const m = mean(arr);
            return mean(arr.map(v => (v - m) ** 2));
        };
        const sd1 = Math.sqrt(0.5 * variance(diffs));
        const sd2 = Math.sqrt(2 * variance(rrCurrent) - sd1 * sd1);
        return {
            interimOutputs: [],
            finalOutput: { rrCurrent, rrNext, sd1, sd2 },
        };
    },
});

registerDspAlgorithm("passthrough", {
    process(data) {
        // Passes input through unchanged as finalOutput -- works for any
        // PREVIOUS_STAGE_PIPELINE input shape, not just {y, t, fs}.
        // rr_tachogram uses this to receive rrIntervalsMs directly.
        return {
            interimOutputs: [],
            finalOutput: Array.isArray(data)
                ? { rrIntervalsMs: data }   // bare array from PREVIOUS_STAGE_PIPELINE consumedField
                : { filteredSignal: data.y, peakIndices: [], ...data }, // HTTP_REST shape
        };
    },
});