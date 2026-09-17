// ---------------------------------------------------------------------------
// filters/pan_tompkins_python_port.js
//
// Pan-Tompkins ported from a Python reference. Registers as
// "pan_tompkins_py" and COEXISTS with pan_tompkins_filter.js rather than
// replacing it -- comparing two implementations of the same algorithm on
// the same record is exactly what the algorithm rail button is for, and
// is much of what this app exists to show.
//
// Same contract as the original:
//   reads    data.y, data.fs, parameters.invertSignal
//   returns  finalOutput.filteredSignal
//            finalOutput.peakIndices
//            finalOutput.rrIntervalsMs
//
// Plus two ADDITIVE fields. No existing renderer reads them, so they
// cannot break one -- but a future renderer could use them:
//   finalOutput.wavePoints   {P, Q, R, S, T} indices
//   finalOutput.threshold    the adaptive threshold trace
//
// The id MUST be unique: registerDspAlgorithm skips a duplicate id and
// keeps whichever file loaded first, warning only to the console -- so a
// clash fails quietly rather than loudly.
// ---------------------------------------------------------------------------

// ── SCOPE ISOLATION ──────────────────────────────────────────────────────
// Everything below is wrapped in an IIFE because filter files are plain
// <script> tags sharing ONE global scope, and this file defines helpers
// whose names collide with pan_tompkins_filter.js:
//
//     panTompkinsDetectPeaks   both files
//     derivativeFilter         both files
//
// This file loads SECOND, so without the wrapper its definitions win and
// the ORIGINAL filter silently calls the wrong function -- getting back
// {R, P, Q, S, T} where it expected {peakIndices, steps}, then throwing
// on undefined.length. The original's own code is untouched and looks
// blameless, which makes it a genuinely nasty failure to trace.
//
// registerDspAlgorithm is the only thing reaching out of the closure.
// The unique-id check in the registry namespaces ALGORITHMS but does
// nothing for helper functions -- this is what covers those.
// ─────────────────────────────────────────────────────────────────────────

(function () {
"use strict";

// ---------------------------------------------------------------------------
// pan_tompkins_filter.js
//
// JavaScript implementation of the Python "Pan Tompkins Native"
// implementation from:
//
//     DSP_modules/peak_detection_algorithms.py
//
// The Shorts interface is deliberately preserved:
//
//     registerDspAlgorithm("pan_tompkins", {
//         process(data, parameters) { ... }
//     })
//
// Output contract:
//
//     interimOutputs: [
//         { label, tech, data },
//         ...
//     ]
//
//     finalOutput: {
//         filteredSignal,
//         peakIndices,
//         rrIntervalsMs
//     }
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// BUTTERWORTH BANDPASS
//
// Equivalent in intent to:
//
//     b, a = butter(1, [low, high], btype='band')
//     filtered_signal = lfilter(b, a, signal)
//
// The Python implementation uses a first-order Butterworth prototype
// transformed into a bandpass filter.
//
// Sampling rate is supplied dynamically.
// ---------------------------------------------------------------------------

function butterworthBandpass(signal, fs, lowCutHz = 5.0, highCutHz = 15.0) {

    if (!signal || signal.length === 0) {
        return [];
    }

    // Bilinear-transform prewarping.
    const omega1 =
        2 * fs * Math.tan(Math.PI * lowCutHz / fs);

    const omega2 =
        2 * fs * Math.tan(Math.PI * highCutHz / fs);

    const bandwidth = omega2 - omega1;
    const omega0 = Math.sqrt(omega1 * omega2);

    const K = 2 * fs;

    // Analog band-pass:
    //
    //              B*s
    // H(s) = ----------------------
    //        s² + B*s + w0²
    //
    // Bilinear transform:
    //
    //        K(1-z⁻¹)
    // s = ----------------
    //        (1+z⁻¹)
    //

    const K2 = K * K;

    const a0 =
        K2 +
        bandwidth * K +
        omega0 * omega0;

    const a1 =
        2 * (omega0 * omega0 - K2);

    const a2 =
        K2 -
        bandwidth * K +
        omega0 * omega0;

    const b0 = bandwidth * K;
    const b1 = 0;
    const b2 = -bandwidth * K;

    // Normalize coefficients by a0, as scipy.signal.lfilter
    // effectively expects a[0] == 1.
    const B0 = b0 / a0;
    const B1 = b1 / a0;
    const B2 = b2 / a0;

    const A1 = a1 / a0;
    const A2 = a2 / a0;

    // Direct Form I implementation of:
    //
    // y[n] =
    //     B0*x[n]
    //   + B1*x[n-1]
    //   + B2*x[n-2]
    //   - A1*y[n-1]
    //   - A2*y[n-2]

    const y = new Array(signal.length).fill(0);

    for (let i = 0; i < signal.length; i++) {

        const x0 = signal[i];
        const x1 = i >= 1 ? signal[i - 1] : 0;
        const x2 = i >= 2 ? signal[i - 2] : 0;

        const y1 = i >= 1 ? y[i - 1] : 0;
        const y2 = i >= 2 ? y[i - 2] : 0;

        y[i] =
            B0 * x0 +
            B1 * x1 +
            B2 * x2 -
            A1 * y1 -
            A2 * y2;
    }

    return y;
}


// ---------------------------------------------------------------------------
// PYTHON np.diff()
//
// Python:
//
//     derivative = np.diff(filtered_signal)
//
// np.diff() returns N-1 samples.
//
// This is intentionally NOT the 5-point derivative used by the current
// Shorts implementation.
// ---------------------------------------------------------------------------

function derivativeFilter(x) {

    if (x.length < 2) {
        return [];
    }

    const y = new Array(x.length - 1);

    for (let i = 1; i < x.length; i++) {
        y[i - 1] = x[i] - x[i - 1];
    }

    return y;
}


// ---------------------------------------------------------------------------
// SQUARING
//
// Python:
//
//     squared = derivative ** 2
// ---------------------------------------------------------------------------

function squareSignal(x) {

    return x.map(v => v * v);
}


// ---------------------------------------------------------------------------
// MOVING WINDOW INTEGRATION
//
// Python:
//
//     window_width = int(0.15 * sampling_rate)
//
//     integrated = np.convolve(
//         squared,
//         np.ones(window_width) / window_width,
//         mode='same'
//     )
//
// This implements the SAME convolution behaviour rather than the
// trailing moving average used by the existing Shorts implementation.
// ---------------------------------------------------------------------------

function movingWindowIntegrationPythonStyle(x, fs) {

    const windowWidth = Math.floor(0.15 * fs);

    if (x.length === 0) {
        return [];
    }

    if (windowWidth <= 1) {
        return [...x];
    }

    const kernelValue = 1 / windowWidth;

    const y = new Array(x.length).fill(0);

    // np.convolve(..., mode='same') returns an output with the same
    // length as the larger input for this case.
    //
    // We explicitly reproduce the centred convolution behaviour.

    const half = Math.floor(windowWidth / 2);

    for (let i = 0; i < x.length; i++) {

        let sum = 0;

        for (let k = 0; k < windowWidth; k++) {

            const sourceIndex =
                i - half + k;

            if (
                sourceIndex >= 0 &&
                sourceIndex < x.length
            ) {
                sum += x[sourceIndex];
            }
        }

        y[i] = sum * kernelValue;
    }

    return y;
}


// ---------------------------------------------------------------------------
// PYTHON np.where(integrated > threshold)
//
// Returns indices where the condition is true.
// ---------------------------------------------------------------------------

function thresholdIndices(signal, threshold) {

    const indices = [];

    for (let i = 0; i < signal.length; i++) {

        if (signal[i] > threshold) {
            indices.push(i);
        }
    }

    return indices;
}


// ---------------------------------------------------------------------------
// GROUP CONTIGUOUS INDICES
//
// Python:
//
// groups = np.split(
//     threshold_breaches,
//     np.where(np.diff(threshold_breaches) > 1)[0] + 1
// )
// ---------------------------------------------------------------------------

function groupContiguousIndices(indices) {

    if (indices.length === 0) {
        return [];
    }

    const groups = [];
    let currentGroup = [indices[0]];

    for (let i = 1; i < indices.length; i++) {

        if (indices[i] - indices[i - 1] > 1) {

            groups.push(currentGroup);
            currentGroup = [indices[i]];

        } else {

            currentGroup.push(indices[i]);
        }
    }

    groups.push(currentGroup);

    return groups;
}


// ---------------------------------------------------------------------------
// PAN-TOMPKINS NATIVE
//
// This follows the logic of:
//
//     run_pan_tompkins_segmentation()
//
// in the Python implementation.
// ---------------------------------------------------------------------------

function panTompkinsDetectPeaks(rawY, fs) {

    // -------------------------------------------------------
    // Step 1 — Butterworth bandpass 5–15 Hz
    // -------------------------------------------------------

    const filteredSignal =
        butterworthBandpass(rawY, fs, 5.0, 15.0);


    // -------------------------------------------------------
    // Step 2 — np.diff()
    // -------------------------------------------------------

    const derivative =
        derivativeFilter(filteredSignal);


    // -------------------------------------------------------
    // Step 3 — square
    // -------------------------------------------------------

    const squared =
        squareSignal(derivative);


    // -------------------------------------------------------
    // Step 4 — 150 ms moving-window integration
    // -------------------------------------------------------

    const integrated =
        movingWindowIntegrationPythonStyle(squared, fs);


    // -------------------------------------------------------
    // Step 5 — dynamic threshold
    //
    // Python:
    //
    //     threshold = np.mean(integrated) * 1.8
    // -------------------------------------------------------

    let sum = 0;

    for (const value of integrated) {
        sum += value;
    }

    const mean =
        integrated.length > 0
            ? sum / integrated.length
            : 0;

    const threshold =
        mean * 1.8;


    // -------------------------------------------------------
    // Step 6 — threshold breaches
    // -------------------------------------------------------

    const thresholdBreaches =
        thresholdIndices(integrated, threshold);


    // -------------------------------------------------------
    // Step 7 — group continuous threshold breaches
    // -------------------------------------------------------

    const groups =
        groupContiguousIndices(thresholdBreaches);


    // -------------------------------------------------------
    // Step 8 — find maximum RAW ECG value inside each group
    //
    // Python:
    //
    //     actual_signal_window = signal[group]
    //     r_peaks.append(
    //         int(group[np.argmax(actual_signal_window)])
    //     )
    // -------------------------------------------------------

    const rPeaks = [];

    for (const group of groups) {

        if (group.length === 0) {
            continue;
        }

        let bestIndex = group[0];
        let bestValue = rawY[bestIndex];

        for (const index of group) {

            if (rawY[index] > bestValue) {
                bestValue = rawY[index];
                bestIndex = index;
            }
        }

        rPeaks.push(bestIndex);
    }


    // -------------------------------------------------------
    // Step 9 — 400 ms refractory period
    //
    // Python:
    //
    //     (p - previous) > int(fs * 0.4)
    // -------------------------------------------------------

    const refractorySamples =
        Math.floor(fs * 0.4);

    const refractoryPeaks = [];

    for (let i = 0; i < rPeaks.length; i++) {

        if (
            i === 0 ||
            rPeaks[i] - rPeaks[i - 1] > refractorySamples
        ) {
            refractoryPeaks.push(rPeaks[i]);
        }
    }


    // -------------------------------------------------------
    // P / Q / S / T segmentation
    // -------------------------------------------------------

    const pPoints = [];
    const qPoints = [];
    const sPoints = [];
    const tPoints = [];


    for (const r of refractoryPeaks) {

        // Python:
        //
        // if r < 120 or r > len(signal) - 150:
        //     continue

        if (
            r < 120 ||
            r > rawY.length - 150
        ) {
            continue;
        }


        // ---------------------------------------------------
        // Q
        //
        // q_idx = (r - 12) +
        //         np.argmin(signal[r-12:r])
        // ---------------------------------------------------

        let qIndex = r - 12;
        let qValue = rawY[qIndex];

        for (let i = r - 12; i < r; i++) {

            if (rawY[i] < qValue) {
                qValue = rawY[i];
                qIndex = i;
            }
        }

        qPoints.push(qIndex);


        // ---------------------------------------------------
        // S
        //
        // s_idx = r +
        //         np.argmin(signal[r:r+12])
        // ---------------------------------------------------

        let sIndex = r;
        let sValue = rawY[r];

        for (let i = r; i < r + 12; i++) {

            if (rawY[i] < sValue) {
                sValue = rawY[i];
                sIndex = i;
            }
        }

        sPoints.push(sIndex);


        // ---------------------------------------------------
        // P
        //
        // p_idx = (r - 60) +
        //         np.argmax(signal[r-60:r-15])
        // ---------------------------------------------------

        let pIndex = r - 60;
        let pValue = rawY[pIndex];

        for (let i = r - 60; i < r - 15; i++) {

            if (rawY[i] > pValue) {
                pValue = rawY[i];
                pIndex = i;
            }
        }

        pPoints.push(pIndex);


        // ---------------------------------------------------
        // T
        //
        // t_idx = (r + 30) +
        //         np.argmax(signal[r+30:r+120])
        // ---------------------------------------------------

        let tIndex = r + 30;
        let tValue = rawY[tIndex];

        for (let i = r + 30; i < r + 120; i++) {

            if (rawY[i] > tValue) {
                tValue = rawY[i];
                tIndex = i;
            }
        }

        tPoints.push(tIndex);
    }


    return {
        P: pPoints,
        Q: qPoints,
        R: refractoryPeaks,
        S: sPoints,
        T: tPoints,

        // Keep the intermediate processing available to Shorts.
        filteredSignal,
        derivative,
        squared,
        integrated,
        threshold
    };
}


// ---------------------------------------------------------------------------
// SHORTS DSP REGISTRATION
//
// IMPORTANT:
// The public Shorts interface remains unchanged.
// ---------------------------------------------------------------------------

registerDspAlgorithm("pan_tompkins_py", {

    process(data, parameters) {

        const y =
            parameters?.invertSignal
                ? data.y.map(v => -v)
                : data.y;

        const fs =
            data.fs ?? 300;


        const result =
            panTompkinsDetectPeaks(y, fs);


        // ---------------------------------------------------
        // RR intervals
        // ---------------------------------------------------

        const rrIntervalsMs = [];

        for (
            let i = 1;
            i < result.R.length;
            i++
        ) {

            rrIntervalsMs.push(
                (
                    (result.R[i] - result.R[i - 1])
                    / fs
                ) * 1000
            );
        }


        // ---------------------------------------------------
        // Preserve the Shorts "interimOutputs" contract.
        //
        // These are the Python pipeline stages, exposed to
        // the existing renderer.
        // ---------------------------------------------------

        const steps = [

            {
                label: "Original",
                tech: "Raw Signal",
                data: y
            },

            {
                label: "Removing Noise",
                tech: "Butterworth Bandpass Filter",
                data: result.filteredSignal
            },

            {
                label: "Spotting Changes",
                tech: "First Difference",
                data: result.derivative
            },

            {
                label: "Making Peaks Bigger",
                tech: "Squared",
                data: result.squared
            },

            {
                label: "Smoothing Out",
                tech: "Moving Window Integration",
                data: result.integrated
            }

        ];


        // ---------------------------------------------------
        // EXACT Shorts output contract
        // ---------------------------------------------------

        return {

            interimOutputs: steps,

            finalOutput: {

                filteredSignal: y,

                peakIndices: result.R,

                rrIntervalsMs,

                // Extra P/Q/S/T information is useful for the
                // ECG journey and does not break the existing
                // consumer because it is simply additional data.
                wavePoints: {
                    P: result.P,
                    Q: result.Q,
                    R: result.R,
                    S: result.S,
                    T: result.T
                },

                threshold: result.threshold
            }
        };
    }

});

})();