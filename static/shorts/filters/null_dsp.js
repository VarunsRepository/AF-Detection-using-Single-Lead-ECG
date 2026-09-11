// ---------------------------------------------------------------------------
// filters/null_dsp.js
// Testing stub -- passes raw signal through with zero processing.
//
// Output contract intentionally matches chart_v1's input contract exactly:
//   { filteredSignal: float32[], peakIndices: int[] }
// This means null_dsp + chart_v1 is a valid pairing -- the RE renders
// the raw unprocessed signal as if it were a filtered one, no peaks shown.
//
// Use when:
//   null_dsp + real_renderer  → test rendering pipeline with real data,
//                               no DSP. Verify chart_v1/scatter_density
//                               render correctly before DSP is built.
//   null_dsp + null_renderer  → test feed engine mechanics only
//                               (pagination, scroll, tap zones, progress
//                               bar, pause/resume). No domain logic at all.
//
// Self-registers into DSP_ALGORITHMS (dsp_registry.js must load first).
// ---------------------------------------------------------------------------

registerDspAlgorithm("null_dsp", {
    process(data) {
        // Deliberately no processing -- return raw signal in the exact
        // shape chart_v1 expects so the renderer receives valid data
        // regardless of whether a real DSP algorithm has been built yet.
        // peakIndices is empty: no peaks detected, no markers rendered.
        return {
            interimOutputs: [],
            finalOutput: {
                filteredSignal: data.y,  // raw, unprocessed
                peakIndices:    [],      // no peaks -- null DSP doesn't detect them
                rrIntervalsMs:  [],      // no RR intervals -- same reason
                t:              data.t,  // time vector, passed through for debugging
                fs:             data.fs, // sample rate, passed through for debugging
            },
        };
    },
});
