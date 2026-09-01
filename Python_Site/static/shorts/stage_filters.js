// ---------------------------------------------------------------------------
// stage_filters.js
// Pure computation only -- no DOM, no Plotly, no timing/animation concerns.
// Every function here takes an array in and returns an array (or indices)
// out. This is the "filter" half of the filter/renderer split: compute the
// whole result once, eagerly; a renderer elsewhere decides how much of it
// to reveal and when.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FILTER: simplified Pan-Tompkins R-peak detection.
//
// This is a SIMPLIFIED version of the classic 1985 algorithm -- a single
// fixed threshold with a refractory period, not the full adaptive dual-
// threshold + search-back scheme from the original paper. Good enough to
// visibly find R-peaks on reasonably clean recordings for testing/demo
// purposes; not a clinical-grade implementation.
// ---------------------------------------------------------------------------

function bandpassFilter(x, fs, lowCutHz = 5, highCutHz = 15) {
    const dt = 1 / fs;

    // single-pole high-pass -- removes baseline wander below lowCutHz
    const rcHigh = 1 / (2 * Math.PI * lowCutHz);
    const alphaHigh = rcHigh / (rcHigh + dt);
    const hp = new Array(x.length);
    hp[0] = x[0];
    for (let i = 1; i < x.length; i++) {
        hp[i] = alphaHigh * (hp[i - 1] + x[i] - x[i - 1]);
    }

    // single-pole low-pass -- smooths above highCutHz
    const rcLow = 1 / (2 * Math.PI * highCutHz);
    const alphaLow = dt / (rcLow + dt);
    const bp = new Array(x.length);
    bp[0] = hp[0];
    for (let i = 1; i < x.length; i++) {
        bp[i] = bp[i - 1] + alphaLow * (hp[i] - bp[i - 1]);
    }
    return bp;
}

function derivativeFilter(x) {
    // classic PT 5-point derivative approximation
    const y = new Array(x.length).fill(0);
    for (let i = 4; i < x.length; i++) {
        y[i] = (2 * x[i] + x[i - 1] - x[i - 3] - 2 * x[i - 4]) / 8;
    }
    return y;
}

function movingWindowIntegration(x, fs, windowMs = 150) {
    const windowSize = Math.max(1, Math.round((fs * windowMs) / 1000));
    const y = new Array(x.length).fill(0);
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
        sum += x[i];
        if (i >= windowSize) sum -= x[i - windowSize];
        y[i] = sum / windowSize;
    }
    return y;
}

function panTompkinsDetectPeaks(rawY, fs) {
    const bp = bandpassFilter(rawY, fs);
    const derivative = derivativeFilter(bp);
    const squared = derivative.map(v => v * v);
    const integrated = movingWindowIntegration(squared, fs);

    // threshold set from the signal's own scale (99th percentile, robust to
    // a handful of unusually large spikes) rather than a fixed magic number
    const sorted = [...integrated].sort((a, b) => b - a);
    const robustMax = sorted[Math.floor(sorted.length * 0.01)] ?? Math.max(...integrated);
    const threshold = robustMax * 0.35;

    const refractorySamples = Math.round(fs * 0.2); // ~200ms minimum gap between beats
    const rawPeaks = [];
    let lastPeakIdx = -Infinity;

    for (let i = 1; i < integrated.length - 1; i++) {
        if (
            integrated[i] > threshold &&
            integrated[i] > integrated[i - 1] &&
            integrated[i] >= integrated[i + 1] &&
            i - lastPeakIdx > refractorySamples
        ) {
            rawPeaks.push(i);
            lastPeakIdx = i;
        }
    }

    // The derivative + integration stages introduce a processing DELAY --
    // a detected peak's index lags behind the true R-wave in the raw
    // signal. Refine each one by searching a short window backward in the
    // ORIGINAL signal for the true local maximum, so markers land on the
    // actual R-wave rather than the delayed integrated-signal peak.
    const searchWindow = Math.round(fs * 0.1); // ~100ms back-search
    const refined = rawPeaks.map(idx => {
        const start = Math.max(0, idx - searchWindow);
        let bestIdx = start, bestVal = rawY[start];
        for (let i = start; i <= idx; i++) {
            if (rawY[i] > bestVal) { bestVal = rawY[i]; bestIdx = i; }
        }
        return bestIdx;
    });

    return [...new Set(refined)].sort((a, b) => a - b); // de-duplicate in case refinement collapsed two detections together
}
