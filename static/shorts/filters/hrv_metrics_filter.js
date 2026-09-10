// ---------------------------------------------------------------------------
// hrv_metrics_filter.js
// Pure computation, no rendering -- same convention as the other filter
// files. Takes peak indices (from Pan-Tompkins) and a sample rate, returns
// RR intervals and the standard time-domain + Poincaré HRV metrics.
// ---------------------------------------------------------------------------

function computeHRVMetrics(peakIndices, fs) {
    // Need at least 3 peaks to get 2 RR intervals -- fewer than that and
    // every one of these statistics is meaningless (SDNN of a single value
    // is undefined, RMSSD needs at least one successive difference, etc).
    // Returning null here is a deliberate signal for the renderer to show
    // an honest "not enough data" state instead of fabricating a metric
    // from noise.
    if (peakIndices.length < 3) return null;

    // RR intervals in MILLISECONDS between consecutive peaks
    const rrMs = [];
    for (let i = 1; i < peakIndices.length; i++) {
        rrMs.push(((peakIndices[i] - peakIndices[i - 1]) / fs) * 1000);
    }

    const n = rrMs.length;
    const meanRR = rrMs.reduce((a, b) => a + b, 0) / n;
    const meanHR = 60000 / meanRR; // bpm, since meanRR is already in ms

    // SDNN -- standard deviation of RR intervals, the classic overall
    // variability measure
    const variance = rrMs.reduce((sum, rr) => sum + (rr - meanRR) ** 2, 0) / n;
    const sdnn = Math.sqrt(variance);

    // successive differences (ms) -- feeds both RMSSD and pNN50
    const diffs = [];
    for (let i = 1; i < n; i++) diffs.push(rrMs[i] - rrMs[i - 1]);

    const rmssd = diffs.length > 0
        ? Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length)
        : 0;

    const nn50Count = diffs.filter(d => Math.abs(d) > 50).length;
    const pnn50 = diffs.length > 0 ? (nn50Count / diffs.length) * 100 : 0;

    // Poincaré plot data: each point is (RR[n], RR[n+1]) -- consecutive
    // interval pairs, revealing short vs long-term variability visually as
    // the shape of the scattered cloud.
    const rrN = rrMs.slice(0, -1);
    const rrN1 = rrMs.slice(1);

    // SD1/SD2 -- the standard published Poincaré-derived formulas.
    // SD1 = sqrt(0.5) * RMSSD is a known mathematical identity (not a
    // coincidence -- both measure the same short-term, beat-to-beat
    // variability, just via slightly different derivations).
    const sd1 = Math.sqrt(0.5) * rmssd;
    const sd2Squared = 2 * sdnn * sdnn - 0.5 * sd1 * sd1;
    const sd2 = sd2Squared > 0 ? Math.sqrt(sd2Squared) : 0;

    return { rrMs, meanHR, sdnn, rmssd, pnn50, sd1, sd2, rrN, rrN1 };
}
