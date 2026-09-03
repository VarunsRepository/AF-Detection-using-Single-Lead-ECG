// ---------------------------------------------------------------------------
// hamilton_tompkins_filter.js
// A second, genuinely different peak detector -- not a copy of Pan-Tompkins
// with a new name. Reuses the shared low-level DSP primitives already
// defined in pan_tompkins_filter.js (bandpassFilter, derivativeFilter,
// movingWindowIntegration -- genuinely shared math, not algorithm-specific
// logic, so no reason to duplicate them), but differs in the one part that
// actually matters: how the threshold is chosen.
//
// Pan-Tompkins (as simplified here) uses ONE FIXED threshold, computed once
// from a percentile of the whole recording. Hamilton-Tompkins' real
// distinguishing idea is an ADAPTIVE threshold that tracks running
// estimates of "signal level" and "noise level," updated after every beat
// -- letting it adapt as amplitude drifts over a longer recording, rather
// than committing to one static number up front.
//
// Same simplification caveat as Pan-Tompkins: a genuine adaptive-threshold
// scheme, not the full published algorithm's search-back/edge-case
// handling. Good for demonstrating a real, meaningfully different
// algorithm in the same slot -- not clinical-grade.
// ---------------------------------------------------------------------------

function hamiltonTompkinsDetectPeaks(rawY, fs) {
    const bp = bandpassFilter(rawY, fs);
    const derivative = derivativeFilter(bp);
    const squared = derivative.map(v => v * v);
    const integrated = movingWindowIntegration(squared, fs);

    const refractorySamples = Math.round(fs * 0.2);

    // Seed the running signal/noise levels from the first second of data --
    // gives the adaptive threshold a reasonable starting point before any
    // real detections have happened yet.
    const seedWindow = integrated.slice(0, Math.min(fs, integrated.length));
    const seedMax = Math.max(...seedWindow, 0.001);
    let signalLevel = seedMax * 0.5;
    let noiseLevel = seedMax * 0.1;

    let lastPeakIdx = -Infinity;
    const rawPeaks = [];

    for (let i = 1; i < integrated.length - 1; i++) {
        // threshold sits between the current noise and signal estimates --
        // this is what lets it drift with the recording, unlike a single
        // value fixed for the whole signal
        const threshold = noiseLevel + 0.25 * (signalLevel - noiseLevel);

        const isCandidate =
            integrated[i] > threshold &&
            integrated[i] > integrated[i - 1] &&
            integrated[i] >= integrated[i + 1] &&
            i - lastPeakIdx > refractorySamples;

        if (isCandidate) {
            rawPeaks.push(i);
            lastPeakIdx = i;
            signalLevel = 0.875 * signalLevel + 0.125 * integrated[i]; // adapt toward confirmed peaks
        } else {
            noiseLevel = 0.875 * noiseLevel + 0.125 * integrated[i]; // adapt toward background level
        }
    }

    // Same backtrack-to-true-peak refinement as Pan-Tompkins -- the
    // derivative/integration stages introduce the same processing delay
    // regardless of which threshold scheme picked the candidate.
    const searchWindow = Math.round(fs * 0.1);
    const refined = rawPeaks.map(idx => {
        const start = Math.max(0, idx - searchWindow);
        let bestIdx = start, bestVal = rawY[start];
        for (let i = start; i <= idx; i++) {
            if (rawY[i] > bestVal) { bestVal = rawY[i]; bestIdx = i; }
        }
        return bestIdx;
    });
    const peakIndices = [...new Set(refined)].sort((a, b) => a - b);

    // Same shape as Pan-Tompkins' return value -- {peakIndices, steps} --
    // is EXACTLY what makes these two interchangeable in Stage 2's slot
    // without touching stage_renderers.js at all.
    return {
        peakIndices,
        steps: [
            { label: "Original", tech: "Raw Signal", data: rawY },
            { label: "Removing Noise", tech: "Bandpass Filter", data: bp },
            { label: "Spotting Changes", tech: "Derivative", data: derivative },
            { label: "Making Peaks Bigger", tech: "Squared", data: squared },
            { label: "Smoothing Out", tech: "Moving Average / Integration", data: integrated },
        ],
    };
}
