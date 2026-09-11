// ---------------------------------------------------------------------------
// baseline_correction_filter.js
// Removes baseline wander -- the slow drift in an ECG caused by breathing,
// movement, or poor electrode contact. Pure computation, no rendering, same
// "one file per algorithm" convention as pan_tompkins_filter.js.
//
// This is a DISTINCT, genuinely useful step ahead of Pan-Tompkins, not a
// redundant one: PT's own bandpass filter is tuned for QRS emphasis
// (5-15Hz), not slow-drift removal specifically. A low cutoff here (0.5Hz)
// flattens the wandering baseline while leaving P/QRS/T content -- all well
// above 0.5Hz -- completely untouched.
// ---------------------------------------------------------------------------

function removeBaselineWander(x, fs, cutoffHz = 0.5) {
    // single-pole high-pass -- same structural shape as the high-pass half
    // of Pan-Tompkins' own bandpass filter, just parameterized with a much
    // lower cutoff appropriate for slow baseline drift rather than QRS
    // emphasis
    const dt = 1 / fs;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const alpha = rc / (rc + dt);

    const y = new Array(x.length);
    y[0] = x[0];
    for (let i = 1; i < x.length; i++) {
        y[i] = alpha * (y[i - 1] + x[i] - x[i - 1]);
    }
    return y;
}
